# WORKER_REMINDER_POLICY.md

Версия: 0.2  
Статус: Draft — patched after Codex review, awaiting second worker review  
Проект: AI Task Assistant / Time Management System  
Локальный путь: `C:\Dima\Projects\CURSOR\time-management`

**Связанные документы:**

| Документ | Роль |
| --- | --- |
| `docs/TZ_MVP.md` | Продуктовые требования MVP |
| `docs/ARCHITECTURE_BASELINE.md` | Worker layer, ADR-008, §12 Reminder/Worker |
| `docs/DATA_MODEL.md` | `reminders`, `reminder_deliveries`, `worker_job_locks`, `recurrence_rules`, `notifications` |
| `docs/ACCESS_CONTROL.md` | Worker log privacy, notification IDs-only, reminder access |
| `docs/API_CONTRACTS.md` | Reminder API, Notification API, Event side effects §21 |
| `docs/AI_CONTRACTS.md` | AI raw retention, voice retention, CleanupArchive |
| `docs/TESTING_STRATEGY.md` | RG-27..RG-30, RG-22, RG-24, §12, §16 |

---

## 1. Назначение документа

Данный документ определяет **worker/reminder policy MVP** — правила фоновой обработки напоминаний, повторяющихся задач, уведомлений и retention cleanup для self-hosted инсталляции на 1–10 пользователей.

**Что документ определяет:**

- ответственность worker-процесса (`apps/worker`);
- каталог job types и их контракты;
- политику lease-locks (`worker_job_locks`);
- lifecycle доставки (`reminder_deliveries`);
- idempotency, retry/backoff, terminal states;
- правила создания notifications (IDs-only);
- recurrence generation и cleanup/retention;
- privacy/logging boundary для worker;
- test matrix (WRK-T01..WRK-T23) и release gates.

**Согласованность:**

Документ следует `ARCHITECTURE_BASELINE.md` §12, `DATA_MODEL.md` §8 (entities 8.19–8.20, reminders, deliveries), `ACCESS_CONTROL.md` §5.5, §5.8, §8.5, `API_CONTRACTS.md` §12, §17, §21, `AI_CONTRACTS.md` §13.3, §15.5, `TESTING_STRATEGY.md` §12, §16, §17.1 (RG-22, RG-24, RG-27..RG-30, RG-31).

**Для кого:**

| Аудитория | Использование |
| --- | --- |
| **Cursor** | Реализация `apps/worker` без нарушения idempotency/privacy |
| **Codex** | Ревью worker PR по данному policy |
| **Разработчик** | Единый источник истины до появления кода worker |

**Что документ НЕ является:**

- кодом, миграциями, ORM-схемой или тестами;
- заменой `DATA_MODEL.md` или `API_CONTRACTS.md` — только operational policy поверх них.

**Целевой артефакт реализации:** `apps/worker` (отдельный Node.js процесс, shared `packages/core` + `packages/db`).

---

## 2. Worker Design Principles

| # | Принцип | Описание |
| --- | --- | --- |
| P-01 | **Idempotency first** | Повторный запуск job не создаёт duplicate delivery/notification/instance |
| P-02 | **Lease-based locking** | `worker_job_locks.locked_until` — единственный механизм exclusive processing |
| P-03 | **Atomic state transitions** | `ReminderDelivery`: pending → processing → sent/failed — одна транзакция на claim |
| P-04 | **No duplicate sends** | `sent` delivery + `sent` reminder — immutable; повторная отправка запрещена |
| P-05 | **Terminal states are immutable** | `sent`, `canceled`, `skipped` — без retry и без resend |
| P-06 | **Retry is bounded** | Max attempts (default 4); после max → terminal `failed` |
| P-07 | **Worker logs are privacy-safe** | Только IDs и operational metadata; без title/body/transcript |
| P-08 | **Notifications are IDs-only** | Payload при создании — только ссылки; display через ACL-safe API |
| P-09 | **Cleanup is deterministic and testable** | Retention jobs с явными config flags; seed + clock mock в тестах |
| P-10 | **Events via Domain/EventService** | `reminder_sent`, `recurrence_generated` — через Domain, не raw repository |
| P-11 | **Worker does not expose private content** | Internal processing по IDs; user-facing outputs без private text |
| P-12 | **Worker jobs are safe to rerun** | Crash/restart → expired lock + idempotency_key → no-op или safe retry |
| P-13 | **Worker handles crash/restart** | DB-backed state; catch-up poll на `remind_at <= now()` |
| P-14 | **Default tests use mocks/no external network** | RG-36; in-app channel = DB insert, без real push/email |

---

## 3. Worker Job Catalog

### 3.1 Сводная таблица

| Job | Frequency | Purpose |
| --- | --- | --- |
| **ReminderSender** | every 1 min | Process due reminders → delivery → notification → event |
| **RecurrenceGenerator** | every 5 min | Generate recurring task instances |
| **OverdueNotifier** | hourly | Create overdue notifications for active tasks past due |
| **EveningReviewNudge** | per user setting | Create evening review notification |
| **DailyDigest** | per user setting | Future / optional (post-MVP default) |
| **CleanupArchive** | daily | Purge expired raw/voice/notifications/locks |

### 3.2 ReminderSender

| Aspect | Value |
| --- | --- |
| **Input source** | Due reminders (§5.1); retry queue (§5.2); stuck processing recovery (§8.5) |
| **Output** | `ReminderDelivery` (sent/failed/skipped), `Notification` (in_app), `reminders.status = sent`, `TaskEvent reminder_sent` |
| **Idempotency** | `idempotency_key = '{reminder_id}:{channel}:{remind_at_iso}'`; unique constraint → duplicate run no-op |
| **Lock strategy** | Per-resource: `lock_key = 'reminder:{reminder_id}'`; lease 5 min |
| **Privacy** | Logs: reminder_id, delivery_id, task_id, user_id only; no task title |
| **Events** | `reminder_sent` (success); skip path — delivery `skipped`, optional no TaskEvent (§11) |

### 3.3 RecurrenceGenerator

| Aspect | Value |
| --- | --- |
| **Input source** | `recurrence_rules` WHERE `status = 'active'` AND `next_run_at <= now()` |
| **Output** | New task instance; `recurrence_rules.next_run_at` updated; `occurrences_created` incremented; `TaskEvent recurrence_generated` |
| **Idempotency** | Unique `(recurrence_rule_id, scheduled_for)` on tasks; existing instance → skip create, update rule only |
| **Lock strategy** | `lock_key = 'recurrence:{recurrence_rule_id}'`; lease 10 min |
| **Privacy** | Logs: rule_id, template_task_id, generated task_id; no title copy in logs |
| **Events** | `recurrence_generated` with metadata `{ recurrence_rule_id, instance_task_id }` — IDs only |

### 3.4 OverdueNotifier

| Aspect | Value |
| --- | --- |
| **Input source** | Active tasks: `due_at < now()`, status ∉ (done, canceled, archived), `deleted_at IS NULL`; ACL: user still has access |
| **Output** | `Notification` type `task_overdue`, IDs-only payload |
| **Idempotency** | `idempotency_key = 'overdue:{task_id}:{date_bucket}'` — requires dedup storage contract (§14.3); **not production-ready without it** |
| **Lock strategy** | Optional batch lock `overdue:{workspace_id}:{date_bucket}` or per-task; lease 5 min |
| **Privacy** | No title in payload; user_id + task_id only |
| **Events** | No TaskEvent required for overdue notification (notification-only side effect) |

### 3.5 EveningReviewNudge

| Aspect | Value |
| --- | --- |
| **Input source** | `user_settings` WHERE `evening_review_time` matches current slot in `user_settings.timezone` |
| **Output** | `Notification` type `evening_review_pending` |
| **Idempotency** | `evening_review:{user_id}:{date_bucket}` — one nudge per user per local day |
| **Lock strategy** | `lock_key = 'evening_review:{user_id}:{date_bucket}'`; lease 5 min |
| **Privacy** | Payload: `{ "action": "evening_review_pending" }` or user_id only; digest content loaded via `GET /api/dashboard/evening-review` |
| **Events** | None required |
| **MVP note** | Included in MVP if evening review notification is in TZ scope; otherwise Phase 1.1 |

### 3.6 DailyDigest

| Aspect | Value |
| --- | --- |
| **Input source** | `user_settings.morning_digest_time` + timezone |
| **Output** | Future notification; content via ACL-safe Today API on client |
| **Idempotency** | `digest:{user_id}:{date_bucket}` |
| **Lock strategy** | Per-user daily lock |
| **Privacy** | No task titles in stored payload |
| **Events** | None |
| **Status** | **Post-MVP / optional** — job stub allowed, not release-blocking |

### 3.7 CleanupArchive

| Aspect | Value |
| --- | --- |
| **Input source** | Expired rows per §13 (AI raw, voice, notifications, locks, optional auth audit) |
| **Output** | Null fields / hard delete per entity policy |
| **Idempotency** | Safe to rerun; already-purged rows no-op |
| **Lock strategy** | Global: `lock_key = 'cleanup:archive'`; lease 30 min |
| **Privacy** | Logs: counts purged, entity types; no content |
| **Events** | None (system maintenance) |

---

## 4. WorkerJobLock Policy

### 4.1 Таблица `worker_job_locks`

Источник: `DATA_MODEL.md` § worker_job_locks, `ARCHITECTURE_BASELINE.md` §12.2, ADR-008.

| Field | Type | Description |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `job_type` | text | e.g. `reminder`, `recurrence`, `cleanup`, `overdue`, `evening_review` |
| `resource_id` | uuid (nullable) | reminder_id, rule_id, user_id, etc. |
| `lock_key` | text | **Unique** identifier |
| `locked_by` | text | Worker instance id (hostname + pid or UUID) |
| `locked_until` | timestamptz | Lease expiry |
| `status` | worker_lock_status | `active`, `released`, `expired`, `failed` |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |

Enum `worker_lock_status`: `active`, `released`, `expired`, `failed`.

### 4.2 Правила acquisition

**Lock expiry boundary (единое правило):** expired lock means `locked_until <= now()`. Active lock means `locked_until > now()`.

1. **`lock_key` unique** — enforced by DB unique index.
2. Worker **must acquire lock** before processing mutable resource.
3. If lock exists AND `locked_until > now()` → **skip** (another worker owns).
4. If lock **expired** (`locked_until <= now()`) → **reacquire** (UPDATE or UPSERT).
5. On **success** → release (`status = released`) or let expire (acceptable for short leases).
6. On **failure** → leave lock to expire OR mark `status = failed` depending on job (cleanup marks failed on unrecoverable error).
7. **Lock logs** contain only: `lock_key`, `job_type`, `resource_id`, `worker_id`, `status`, `locked_until`.

### 4.3 Lease duration (MVP defaults)

| Job / lock pattern | Lease duration |
| --- | --- |
| ReminderSender — `reminder:{reminder_id}` | **5 minutes** |
| RecurrenceGenerator — `recurrence:{recurrence_rule_id}` | **10 minutes** |
| CleanupArchive — `cleanup:archive` | **30 minutes** |
| OverdueNotifier — per-task or batch | **5 minutes** |
| EveningReviewNudge — per user/day | **5 minutes** |

### 4.4 Conceptual atomic acquire

```sql
-- conceptual only, not final SQL
INSERT INTO worker_job_locks (
  job_type, resource_id, lock_key, locked_by, locked_until, status
) VALUES (
  :jobType, :resourceId, :lockKey, :workerId, :newLease, 'active'
)
ON CONFLICT (lock_key)
DO UPDATE SET
  locked_by = :workerId,
  locked_until = :newLease,
  status = 'active',
  updated_at = now()
WHERE worker_job_locks.locked_until <= now()
   OR worker_job_locks.status IN ('expired', 'released', 'failed')
RETURNING *;
```

If `RETURNING` empty → lock not acquired → skip job for this resource.

### 4.5 Lock key examples

| Pattern | Example |
| --- | --- |
| Reminder | `reminder:{reminder_id}` |
| Recurrence | `recurrence:{recurrence_rule_id}` |
| Cleanup global | `cleanup:archive` |
| Overdue dedup | `overdue:{task_id}:{date_bucket}` |
| Evening review | `evening_review:{user_id}:{YYYY-MM-DD}` |

---

## 5. Reminder Selection Policy

### 5.1 ReminderSender primary selection

```text
reminders.status = 'pending'
AND reminders.remind_at <= now()
AND task.deleted_at IS NULL
AND task.status NOT IN ('done', 'canceled', 'archived')
AND reminder.status NOT IN ('canceled', 'sent', 'skipped')
```

Join `tasks` on `reminders.task_id` with soft-delete filter.

### 5.2 Retry selection (ReminderSender secondary pass)

**Failed deliveries** (explicit grouping — no ambiguous `AND … OR …`):

```text
(
  reminder_deliveries.status = 'failed'
  AND reminder_deliveries.next_retry_at IS NOT NULL
  AND reminder_deliveries.next_retry_at <= now()
  AND reminder_deliveries.attempt < max_attempts
)
AND linked reminder is still eligible
```

**Pending deliveries:**

```text
pending deliveries are processed only if their reminder remains eligible;
pending without next_retry_at can be processed when the original reminder is due (§5.1).
```

**Processing deliveries:**

```text
processing deliveries are NOT selected by normal retry poll.
They are handled only by stuck-processing recovery policy (§8.5).
```

Failed deliveries with terminal `failed` (max attempts reached) are excluded.

### 5.3 Rules

| # | Rule |
| --- | --- |
| R-01 | Do **not** send for soft-deleted task (`deleted_at IS NOT NULL`) |
| R-02 | Do **not** send for completed task (`status = done`) |
| R-03 | Do **not** send canceled reminder (`reminders.status = canceled`) |
| R-04 | If task completed/canceled/deleted **before** fire: mark reminder `skipped` or `canceled`; mark delivery `skipped`; **no notification** |
| R-05 | If user disabled (`users.status = disabled`): skip; delivery `skipped` |
| R-06 | Private task: notification still **IDs-only**; worker does not embed title |
| R-07 | Worker **must not load task title** for logging; domain may load minimal fields for eligibility checks only |
| R-08 | MVP channel: **`in_app` only**; other channels → terminal failed until implemented |

### 5.4 Task complete side effect (API path)

When task completed via API (`POST /api/tasks/:id/complete`), domain cancels pending reminders (`API_CONTRACTS.md` §21). Worker still re-validates inside transaction as defense in depth.

---

## 6. ReminderDelivery Lifecycle

### 6.1 States

Enum `delivery_status`: `pending`, `processing`, `sent`, `failed`, `skipped`, `canceled`.

### 6.2 State diagram

```text
pending → processing → sent          (terminal)
pending → processing → failed → pending (retry, if attempts remain)
pending → processing → failed        (terminal, max attempts)
pending → canceled                   (terminal)
pending → skipped                    (terminal)
processing → failed                  (crash mid-flight → retry or terminal)
sent                                   (terminal — NEVER resent)
canceled                               (terminal — NEVER sent)
skipped                                (terminal — NEVER sent)
```

### 6.3 Rules

| # | Rule |
| --- | --- |
| L-01 | **`sent` is terminal** — no UPDATE to pending/processing; no second notification |
| L-02 | **`canceled` is terminal** |
| L-03 | **`skipped` is terminal** — task ineligible, user disabled, etc. |
| L-04 | **`failed` may retry** while `attempt < max_attempts` (default max = 4) |
| L-05 | No resend after `sent` — idempotency_key collision → no-op |
| L-06 | No retry after max attempts — status stays `failed` |
| L-07 | Every attempt **increments** `attempt` |
| L-08 | **`last_attempt_at`** updated on each attempt |
| L-09 | **`next_retry_at`** set on retryable failure |
| L-10 | **`error_message`** redacted — no task title, no stack with secrets |
| L-11 | **`sent_at`** required when `status = sent` (DB check) |
| L-12 | Atomic claim: `UPDATE … SET status = 'processing' WHERE status IN ('pending', 'failed') AND id = :id RETURNING *` |

### 6.4 Reminder entity lifecycle (parallel)

`reminders.status`: `pending` → `sent` | `failed` | `canceled` | `skipped`.

On successful delivery: `reminders.status = sent`, `reminders.sent_at = now()`.

### 6.5 DATA_MODEL sync note

This policy treats `skipped` and `canceled` as **terminal** `delivery_status` values with explicit lifecycle rules (§6.2–§6.3). `DATA_MODEL.md` `reminder_deliveries` transition list is currently weaker on `skipped`. **Follow-up:** sync `DATA_MODEL.md` in a later patch to align enum transitions and check constraints with this policy. Until then, application layer enforces terminal immutability per this document.

---

## 7. Idempotency Key Policy

### 7.1 Deterministic key format

```text
idempotency_key = "{reminder_id}:{channel}:{remind_at_iso}"
```

Where `remind_at_iso` = ISO-8601 UTC string from `reminders.remind_at` at time of delivery creation (stable for that reminder row).

Example: `a1b2c3d4-...:in_app:2026-06-13T09:00:00.000Z`

### 7.2 Rules

| # | Rule |
| --- | --- |
| I-01 | **Unique** in `reminder_deliveries` (DB unique index) |
| I-02 | Same reminder + channel + remind_at → **one** delivery row |
| I-03 | Duplicate worker run → find existing delivery; if `sent` → no-op; if `processing` → skip or wait |
| I-04 | If `remind_at` **changes** (PATCH reminder) → new key may apply; old pending delivery canceled or orphaned per domain rule |
| I-05 | Key **must not** contain task title, user text, or workspace name |
| I-06 | Key **stable across worker restarts** — derived only from DB fields |
| I-07 | Overdue/other jobs use separate namespaces (§14) — never collide with reminder keys |

### 7.3 Related reminder-level idempotency

Partial unique index on `reminders (task_id, user_id, remind_at, channel) WHERE status NOT IN ('canceled')` prevents duplicate active reminders at API level (`DATA_MODEL.md`).

---

## 8. Atomic Processing Flow: ReminderSender

### 8.1 Sequence

```text
1. Run stuck processing recovery (§8.5).
2. Poll due reminders (§5.1) + retry queue (§5.2).
3. For each candidate reminder_id:
   a. Acquire lock "reminder:{reminder_id}".
      → If not acquired: skip.
   b. BEGIN transaction.
   c. Re-load reminder + task (+ user status) FOR UPDATE.
   d. Validate eligibility (§5):
      → If ineligible: mark reminder skipped/canceled;
        create/find delivery → skipped; COMMIT; release lock; continue.
   e. Compute idempotency_key.
   f. INSERT delivery ON CONFLICT (idempotency_key) DO NOTHING;
      SELECT delivery FOR UPDATE.
      → If delivery.status = sent: COMMIT; release lock; continue (no-op).
   g. Atomic: delivery pending|failed → processing (single winner).
      → If no row updated: ROLLBACK; release lock; continue.
   h. NotificationService.create({
        user_id: reminder.user_id,
        type: 'reminder_due',
        payload: { task_id, reminder_id, action: 'reminder_due' }  // IDs-only
      }).
   i. delivery → sent; reminder → sent; set sent_at fields.
   j. EventService.record({
        taskId, userId: null (system/worker),
        eventType: 'reminder_sent',
        metadata: { reminder_id, delivery_id, channel, attempt }
      }).
   k. COMMIT.
   l. Release lock (or let expire).
4. On transient error: ROLLBACK main transaction; run **post-rollback failure recording** (§8.4); release lock.
```

### 8.2 Transaction invariants

| # | Invariant |
| --- | --- |
| T-01 | **No notification outside successful transaction** unless NotificationService participates in same TX (required for MVP) |
| T-02 | If notification creation fails → delivery **must not** become `sent` |
| T-03 | If event creation fails → **ROLLBACK** entire transaction |
| T-04 | Never mark `sent` before notification row is durably inserted |
| T-05 | Worker crash after COMMIT but before lock release → idempotency prevents duplicate send |
| T-06 | Worker crash during `processing` → see §8.5 stuck recovery; never duplicate notification if `sent` |

### 8.3 MVP in-app channel

MVP `in_app` delivery = INSERT into `notifications` + update delivery/reminder — no external network call. Future channels (email, push) may add provider step with transient error classification (§9, §17).

**MVP in_app rule:** notification insert + delivery `sent` + reminder `sent` + `TaskEvent reminder_sent` **must** remain in **one DB transaction** (§17.3).

### 8.4 Post-rollback failure recording

**Problem:** if ReminderSender transaction rolls back, delivery cannot be marked `failed` inside the same rolled-back transaction.

**Contract:**

```text
If ReminderSender transaction rolls back after a delivery was claimed or created,
failure recording must happen in a new recovery transaction.
```

**Algorithm:**

```text
1. Catch transient error outside the failed transaction.
2. Open a new recovery transaction.
3. SELECT reminder_deliveries by idempotency_key FOR UPDATE.
4. If no delivery exists:
   - leave reminder pending; normal poll will retry.
5. If delivery.status IN ('processing', 'pending'):
   - update status = 'failed'
   - increment/confirm attempt according to claim semantics
   - set last_attempt_at = now()
   - set next_retry_at = now() + backoff(attempt)
   - set error_message = redacted error code/message
6. If delivery.status = 'sent':
   - do nothing (idempotent no-op).
7. If max attempts reached:
   - status = 'failed' terminal
   - next_retry_at = NULL
8. COMMIT recovery transaction.
```

**Rules:**

- `error_message` **redacted** — no task title/body.
- Recovery logs: IDs only (`reminder_id`, `delivery_id`, `error_code`).
- Recovery transaction itself **must be idempotent** — safe to rerun.
- Failure recording **must not** create notification.
- If failure happened **before** delivery row creation, reminder remains `pending`; normal poll retries.
- Recovery **must not** transition `sent` → any other state.

### 8.5 Stuck processing recovery

**MVP primary model:** `processing` should normally live inside the send transaction and should not survive rollback. If TX commits partial state incorrectly, defensive recovery applies.

**Defensive recovery:** if a committed delivery remains `status = 'processing'` longer than `REMINDER_PROCESSING_TIMEOUT_MINUTES`, worker may reclaim it as failed/retryable.

| Config | Default |
| --- | --- |
| `REMINDER_PROCESSING_TIMEOUT_MINUTES` | **10** |

**Recovery predicate:**

```text
delivery.status = 'processing'
AND delivery.last_attempt_at IS NOT NULL
AND delivery.last_attempt_at < now() - INTERVAL 'REMINDER_PROCESSING_TIMEOUT_MINUTES minutes'
AND delivery.status NOT IN ('sent', 'canceled', 'skipped')
```

(`status = 'processing'` already excludes terminal states; explicit `NOT IN` documents intent.)

**Recovery action:**

```text
1. Acquire lock reminder:{reminder_id}.
2. SELECT delivery FOR UPDATE.
3. If still processing and stale:
   - status = 'failed'
   - next_retry_at = now()
   - error_message = 'processing_timeout' (redacted code)
4. Release lock.
5. Normal retry poll (§5.2) handles subsequent send attempt.
```

**Rules:**

- **Never** recover `sent` — if `sent`, no-op.
- **Never** duplicate notification — recovery only moves delivery to retryable `failed`; send path still checks idempotency and `sent`.
- No private content in recovery logs.
- Stuck recovery runs as part of ReminderSender tick (before or after normal poll).
- `processing` deliveries are **excluded** from §5.2 retry poll.

**Test mapping:** WRK-T21 → RG-27, RG-28.

---

## 9. Retry / Backoff Policy

### 9.1 MVP default schedule

| Attempt | Delay after previous failure |
| --- | --- |
| 1 | immediate (on first due) |
| 2 | +1 minute |
| 3 | +5 minutes |
| 4 | +15 minutes |
| >4 | **terminal `failed`** — no further retry |

Config keys (open question §20): `REMINDER_MAX_ATTEMPTS` (default 4), `REMINDER_PROCESSING_TIMEOUT_MINUTES` (default 10, §8.5), backoff intervals env or constants.

### 9.2 Retry eligibility

| Failure class | Retry? |
| --- | --- |
| DB transient (connection, deadlock) | Yes |
| Notification insert failure (same TX rollback) | Yes — delivery stays pending/failed with backoff |
| Provider/network (future channels) | Yes if transient |
| Validation: task deleted/completed/canceled | **No** → `skipped` |
| Validation: reminder canceled | **No** → `canceled`/`skipped` |
| User disabled | **No** → `skipped` |
| Channel unsupported (non in_app on MVP) | **No** → terminal `failed` |
| Max attempts exceeded | **No** → terminal `failed` |

### 9.3 Rules

1. Retry **only transient** failures.
2. Validation/lifecycle failures → `skipped`/`canceled`, **not** retry loop.
3. **`error_message`** redacted in DB and logs.
4. **`next_retry_at`** = `now() + backoff(attempt)`.
5. ReminderSender poll includes `next_retry_at <= now()` for failed deliveries.

---

## 10. Notification Creation Policy

### 10.1 Payload contract (strict)

Worker-created notifications **must** follow `ACCESS_CONTROL.md` §8.5 and `DATA_MODEL.md` notifications:

```json
{
  "task_id": "uuid",
  "reminder_id": "uuid",
  "actor_user_id": null,
  "action": "reminder_due"
}
```

Type field on row: `notification_type = 'reminder_due'`.

### 10.2 Allowed payload fields

- `task_id`
- `reminder_id`
- `comment_id` (not for reminder job)
- `actor_user_id` (nullable / system)
- `action` / `type`

### 10.3 Forbidden payload fields

- task title
- task description
- comment body
- raw AI text
- transcript
- private metadata
- reasoning_summary
- notification display text pre-rendered

### 10.4 Rules

| # | Rule |
| --- | --- |
| N-01 | Create notification **only** for `reminder.user_id` |
| N-02 | Notification does **not** prove permanent task visibility |
| N-03 | Client display **must** fetch task/reminder via ACL-safe API (`GET /api/tasks/:id`, etc.) |
| N-04 | Stale notification after access revoke **must remain safe** — payload has no embedded private content |
| N-05 | Creation logs/events **must not** include private title/body |
| N-06 | Set `expires_at` per retention policy (default **90 days** from `DATA_MODEL.md`) |
| N-07 | Payload IDs-only at **creation time** — not stripped at read time (`TESTING_STRATEGY.md` §11) |

---

## 11. Reminder Event Policy

### 11.1 Worker side effects

| Outcome | TaskEvent | Notes |
| --- | --- | --- |
| Successful send | `reminder_sent` | Required; same transaction |
| Skipped (task done/deleted) | Optional `reminder_skipped` | **Not in enum MVP** — use delivery `skipped` only; open question §20 |
| Failed attempt (non-terminal) | None | Log delivery status only |
| Terminal failed (max attempts) | Optional audit log | No TaskEvent required MVP |
| Notification created | — | No task content in any metadata |

### 11.2 Event metadata (IDs-only)

```json
{
  "reminder_id": "uuid",
  "delivery_id": "uuid",
  "channel": "in_app",
  "attempt": 1
}
```

### 11.3 Rules

1. TaskEvent via **Domain/EventService** only (`ARCHITECTURE_BASELINE.md` E-07).
2. Event in **same transaction** as final state transition.
3. **`user_id`** on event: NULL for system/worker actor.
4. **No** task title/body in `old_value`, `new_value`, `metadata`.
5. **No** raw AI/voice content.

Existing enum includes `reminder_sent` (`DATA_MODEL.md` task_event_type). `reminder_created` is API path only.

---

## 12. RecurrenceGenerator Policy

### 12.1 Selection

```text
recurrence_rules.status = 'active'
AND recurrence_rules.next_run_at <= now()
```

Skip: `paused`, `completed`, template task deleted, template task not eligible.

### 12.2 Processing rules

| # | Rule |
| --- | --- |
| RC-01 | Paused/completed rules **skipped** |
| RC-02 | Generate next instance **idempotently** via `RecurrenceService` / `TaskService.createFromRecurrence()` |
| RC-03 | Unique `(recurrence_rule_id, scheduled_for)` on tasks prevents duplicates |
| RC-04 | Generated task copies **safe fields only** (title, description from template — domain decision; no forbidden ACL bypass) |
| RC-05 | Inherits owner/space/project after validation |
| RC-06 | Generated task **does not bypass ACL** — visible per normal space/project rules |
| RC-07 | Write `recurrence_generated` TaskEvent in same transaction |
| RC-08 | Update `next_run_at` (domain calculates next occurrence UTC) and `occurrences_created` |
| RC-09 | If `max_occurrences` reached → `recurrence_rules.status = completed` |
| RC-10 | If `end_date` passed → `status = completed` |

### 12.3 Lock

```text
lock_key = "recurrence:{recurrence_rule_id}"
```

Lease: 10 minutes.

### 12.4 Flow

```text
1. Acquire lock recurrence:{rule_id}.
2. BEGIN transaction.
3. Re-load rule FOR UPDATE; verify still active and due.
4. SELECT task WHERE recurrence_rule_id = X AND scheduled_for = next_run_at.
   → IF exists: update next_run_at only; COMMIT; release lock.
5. ELSE: createFromRecurrence() → task + recurrence_generated event.
6. Update next_run_at, occurrences_created; check max/end_date.
7. COMMIT; release lock.
```

---

## 13. CleanupArchive Policy

Daily job; global lock `cleanup:archive` (30 min lease). Safe to rerun.

### 13.1 AI raw cleanup

Source: `AI_CONTRACTS.md` §13.3, `AI_STORE_RAW_LOGS`.

| Config | Default |
| --- | --- |
| `AI_STORE_RAW_LOGS` | `false` |

Rules:

- Select `ai_classification_logs` WHERE `raw_input_encrypted IS NOT NULL OR raw_output_encrypted IS NOT NULL` AND `retention_until < now()`.
- Action: SET `raw_input_encrypted = NULL`, `raw_output_encrypted = NULL`.
- **Keep** `input_text_redacted`, `output_json_redacted`, metadata, confidence, hashes.
- If `AI_STORE_RAW_LOGS=false`, rows should not have raw fields at insert — cleanup is no-op for most installs.

### 13.2 Voice cleanup

Source: `AI_CONTRACTS.md` §15.5.

| Config | Default |
| --- | --- |
| `VOICE_AUDIO_STORE` | `false` |
| `VOICE_TRANSCRIPT_RETENTION_DAYS` | `90` |

Rules:

- If audio stored and `retention_until < now()`: delete blob from storage; SET `audio_blob_url = NULL`; update status toward `purged` where applicable.
- Full `transcript_text`: after `VOICE_TRANSCRIPT_RETENTION_DAYS` from `created_at` or `retention_until` → purge or minimize (NULL or truncate per domain policy).
- `transcript_text_redacted` may remain per policy.
- Owner-initiated delete purges immediately (API path, not worker).

### 13.3 Notification cleanup

- Select `notifications` WHERE `expires_at IS NOT NULL AND expires_at < now()`.
- Action: **hard DELETE** rows (`DATA_MODEL.md` §9.2).
- Default TTL: **90 days** (`expires_at` set at creation).
- Payload remains IDs-only until purge.

### 13.4 Worker lock cleanup

- Select `worker_job_locks` WHERE `locked_until <= now()` AND `status = 'active'` → UPDATE `status = 'expired'`.
- DELETE locks where `status IN ('expired', 'released')` AND `updated_at < now() - lock_retention_window` (e.g. 7 days — config).
- **Do not purge** active non-expired locks (`locked_until > now()`).

### 13.5 Auth audit cleanup

Optional/future:

- Purge `auth_audit_events` after retention if policy defined (default 365 days per `DATA_MODEL.md`).
- **Never purge** before security audit window without explicit config.
- Not MVP release-blocking unless retention policy finalized.

### 13.6 Cleanup logging

Log aggregate counts only: `{ job: 'CleanupArchive', ai_raw_purged: N, voice_purged: N, notifications_deleted: N, locks_purged: N }`.

---

## 14. OverdueNotifier Policy

### 14.1 Selection

- Tasks where `due_at < now()`.
- `status NOT IN ('done', 'canceled', 'archived')`.
- `deleted_at IS NULL`.
- User (owner or assignee per product rule) still has **access** via ACL predicate.

### 14.2 Rules

| # | Rule |
| --- | --- |
| O-01 | Create notification type `task_overdue`, IDs-only payload `{ task_id, action: 'task_overdue' }` |
| O-02 | **Avoid duplicates** within configured window (e.g. once per task per local day) |
| O-03 | Idempotency key: `overdue:{task_id}:{date_bucket}` |
| O-04 | No title/body in notification payload |
| O-05 | No notification if user no longer has access to task |
| O-06 | Hourly poll sufficient for MVP |

### 14.3 OverdueNotifier idempotency storage decision

**ReminderSender does not depend on this** — `reminder_deliveries.idempotency_key` already exists. **EveningReviewNudge** and **DailyDigest** require the same class of dedup storage if implemented with duplicate prevention.

Logical dedup key (policy-level):

```text
overdue:{task_id}:{date_bucket}
```

**MVP implementation must not ship OverdueNotifier duplicate prevention without one of these storage contracts:**

| Option | Description | Preferred |
| --- | --- | --- |
| **A** | Add `notifications.idempotency_key` (text, nullable) with unique partial index | **Preferred before implementation** |
| **B** | Separate `notification_dedup` table keyed by idempotency_key + user_id | Alternative |
| **C** | Unique expression on existing notification fields without private content | Only if provably safe |

**Not acceptable:** storing dedup key only inside `notifications.payload` — payload is strictly IDs-only and must not carry implementation metadata beyond allowed fields (`ACCESS_CONTROL.md` §8.5).

**Production readiness:**

```text
OverdueNotifier is policy-defined but implementation-blocked for dedup-safe production use
until DATA_MODEL provides Option A or B (or proven Option C).
```

**Q-11 is implementation-blocking** for OverdueNotifier if `task_overdue` notifications are in MVP scope.

---

## 15. EveningReviewNudge / DailyDigest Policy

### 15.1 MVP vs future

| Job | MVP status |
| --- | --- |
| **EveningReviewNudge** | MVP if evening review notification in TZ; uses `user_settings.evening_review_time` |
| **DailyDigest** | **Future / optional** — not release-blocking |

### 15.2 Rules

1. Use `user_settings.timezone` for local time slot matching.
2. Use `evening_review_time` / `morning_digest_time` from UserSettings.
3. Notification **IDs-only** — e.g. `{ "action": "evening_review_pending" }`.
4. Digest/review **content generated on demand** via `GET /api/dashboard/evening-review` / `today` — ACL-safe API.
5. **No cross-user** private data in any worker-generated record.
6. One nudge per user per local calendar day (idempotency).
7. **Dedup storage:** same contract class as §14.3 (notification idempotency key or dedup table) required before duplicate-safe production use.

---

## 16. Worker Logging Policy

### 16.1 Allowed log fields

- `request_id` / `job_id`
- `worker_id`
- `job_type`
- `resource_id`
- `reminder_id`
- `delivery_id`
- `task_id`
- `user_id`
- `status`
- `attempt`
- `error_code`
- `duration_ms`
- aggregate counts (cleanup)

### 16.2 Forbidden log fields

- task title
- task description
- comment body
- raw AI prompt
- raw AI output
- `transcript_text`
- notification display text
- password / token / API key
- provider stack trace containing secrets

### 16.3 Rules

1. Logs are **structured** (JSON).
2. Error messages **redacted** — generic codes preferred (`delivery_failed`, `db_transient`).
3. Worker log privacy is **release-blocking** — ACL-T29 / **RG-30**.
4. No private content in retry/error logs.
5. Aligns with `ACCESS_CONTROL.md` SR-10, System Worker role §2.

---

## 17. Failure Handling

### 17.1 Failure class matrix

| Failure | Retry? | Result |
| --- | --- | --- |
| DB transient error | Yes | Backoff via §8.4 recovery TX; delivery `failed` with `next_retry_at` |
| Notification transaction failure | Yes | Main TX rollback; §8.4 recovery records failure |
| Transaction rollback after claim | Yes | New recovery transaction marks delivery `failed` or leaves reminder `pending` if no delivery row |
| Stuck processing timeout | Yes | §8.5 marks `failed`/retryable if stale and not `sent` |
| Validation: task deleted | No | Reminder/delivery `skipped` |
| Validation: task completed | No | Reminder/delivery `skipped` |
| Validation: task canceled | No | Reminder/delivery `skipped` |
| User disabled | No | `skipped` |
| Reminder canceled | No | Delivery `canceled` |
| Channel unsupported | No | Terminal `failed` |
| Lock unavailable | No | Skip; another worker owns (`locked_until > now()`) |
| Provider/network (future channel) | Yes | Retry if transient |
| Max attempts exceeded | No | Terminal `failed`; `next_retry_at = NULL` |
| Notification insert committed but delivery `sent` not committed | Avoid | MVP in_app: same transaction (§17.3); future external channel: outbox pattern |

### 17.2 Global failure rules

- **Never** mark `sent` before notification durably created.
- **Never** retry terminal states (`sent`, `canceled`, `skipped`, terminal `failed`).
- **Never** expose private content in failure reason (DB or logs).
- Transient failures **must not** poison idempotency — same key, increment attempt.
- Post-rollback recovery **must not** create notifications.

### 17.3 MVP in_app single-transaction rule

```text
MVP in_app channel must keep notification insert + delivery sent + reminder sent + TaskEvent in one DB transaction.
```

If future external channels cannot participate in the same DB transaction, use an **outbox pattern** — not in MVP scope.

---

## 18. Worker Privacy / Access Control Boundary

Worker is **internal** (System Worker role, `ACCESS_CONTROL.md` §2) but must honor privacy contracts for user-facing outputs.

| # | Rule |
| --- | --- |
| W-01 | Worker may process entities **by IDs** |
| W-02 | Worker **must not** create user-facing notification with private content |
| W-03 | Worker **must not bypass** TaskShare/ACL when generating displayable data |
| W-04 | Notification display data **always** loaded by client through ACL-safe API |
| W-05 | Worker logs **IDs only** (§16) |
| W-06 | Cleanup **must not** delete redacted audit fields unless retention policy requires |
| W-07 | Worker internal queries **need not** run full ACL for eligibility — but **must** replicate eligibility rules (task not deleted, user active, etc.) |
| W-08 | Overdue/evening jobs **must** check current access before notifying |

---

## 19. Worker Test Matrix

Maps to `TESTING_STRATEGY.md` §12, §16 and release gates **RG-22, RG-24, RG-25, RG-27, RG-28, RG-29, RG-30, RG-31**.

| Test ID | Description | Gate | Expected |
| --- | --- | --- | --- |
| WRK-T01 | Due reminder creates delivery | RG-27 | `ReminderDelivery` row; `status=pending` or progresses to sent |
| WRK-T02 | Duplicate run no duplicate delivery | RG-27 | Second run: same row; no second notification |
| WRK-T03 | Idempotency key unique | RG-27 | DB unique violation prevented; deterministic key |
| WRK-T04 | pending→processing→sent | RG-27, RG-28 | Atomic transitions; single notification |
| WRK-T05 | failed→retry backoff | RG-27 | `next_retry_at` set; attempt incremented |
| WRK-T06 | sent terminal | RG-28 | `sent` immutable; no resend |
| WRK-T07 | canceled reminder skipped | RG-28 | No delivery send; no notification |
| WRK-T08 | completed task reminder skipped | RG-28 | Delivery `skipped`; no notification |
| WRK-T09 | worker logs IDs-only | RG-30, ACL-T29 | No title/body in captured logs |
| WRK-T10 | lock prevents parallel processing | RG-29 | Second worker skips while lock valid |
| WRK-T11 | expired lock reacquired | RG-29 | New worker acquires when `locked_until <= now()` |
| WRK-T12 | stale locks cleaned | RG-29, §16.4 | Expired locks (`locked_until <= now()`) purged; active remain |
| WRK-T13 | retry stops after max attempts | RG-27 | Terminal `failed`; no infinite loop |
| WRK-T14 | notification generated IDs-only | RG-25 | Payload denylist enforced at creation |
| WRK-T15 | AI raw cleanup | RG-22 | Raw nulled; redacted remains |
| WRK-T16 | voice audio cleanup | RG-24 | Blob deleted; URL cleared |
| WRK-T17 | voice transcript cleanup | RG-24 | Full transcript purged after retention |
| WRK-T18 | recurrence duplicate prevention | RG-27 (recurrence) | Unique instance constraint |
| WRK-T19 | recurrence_generated event | RG-31 | Event in same transaction as task |
| WRK-T20 | cleanup does not purge active locks | RG-29 | Valid lock (`locked_until > now()`) survives cleanup |
| WRK-T21 | stuck processing recovery | RG-27, RG-28 | Stale `processing` → `failed` with `next_retry_at`; `sent` unchanged; no duplicate notification |
| WRK-T22 | post-rollback failure recording | RG-27, RG-31 | Transient TX rollback → recovery TX records `failed`/backoff or leaves reminder pending; no notification |
| WRK-T23 | overdue dedup storage enforcement | RG-25, §14.3 | If OverdueNotifier enabled: duplicate run → no duplicate notification; **blocked/pending** until storage contract exists |

### 19.1 Test environment

- Test DB; controlled `remind_at` in past.
- Clock mocking for backoff and timezone jobs.
- Structured log capture in integration tests.
- **No external network** (RG-36).
- Worker in-process or test harness acceptable for MVP (open question §20).

### 19.2 Mapping to TESTING_STRATEGY §12.1

| §12.1 # | WRK-T ID |
| --- | --- |
| 1 | WRK-T01 |
| 2 | WRK-T02 |
| 3 | WRK-T03 |
| 4 | WRK-T04 |
| 5 | WRK-T05 |
| 6 | WRK-T06 |
| 7 | WRK-T07 |
| 8 | WRK-T08 |
| 9 | WRK-T09 |
| 10 | WRK-T10 |
| 11 | WRK-T11 |
| 12 | WRK-T12 |
| 13 | WRK-T13 |
| 14 | WRK-T14 |

---

## 20. Open Questions

| # | Question | Target resolution |
| --- | --- | --- |
| Q-01 | Exact worker scheduler mechanism (setInterval vs node-cron vs pg cron) | `apps/worker` implementation config; ADR skeleton |
| Q-02 | Same process vs separate worker process in dev/CI | Skeleton project decision; TESTING_STRATEGY §12.4 |
| Q-03 | Exact max attempts / backoff config env names | Implementation config; document in `.env.example` |
| Q-04 | Notification retention duration (confirm 90d default) | DATA_MODEL / config |
| Q-05 | Auth audit retention duration | DATA_MODEL update if policy added |
| Q-06 | Whether skipped reminder needs `reminder_skipped` TaskEvent enum | DATA_MODEL enum migration if yes; else delivery status only |
| Q-07 | Whether DailyDigest is MVP or post-MVP | TZ + product sign-off |
| Q-08 | Exact structured logger library (pino, winston, etc.) | ADR-0001 / skeleton |
| Q-09 | Cleanup: hard delete vs nulling fields per entity | Align with DATA_MODEL §9.2; implementation |
| Q-10 | How to test clock/time deterministically (fake timers vs DB `now()` override) | TESTING_STRATEGY update if new pattern; test utilities in `tests/worker/` |
| Q-11 | OverdueNotifier / EveningReview / DailyDigest notification idempotency storage | **Implementation-blocking** for dedup-safe OverdueNotifier if in MVP; preferred: `notifications.idempotency_key` (§14.3 Option A) — DATA_MODEL patch required |
| Q-12 | ~~`processing` stuck recovery TTL~~ | **Closed in v0.2:** `REMINDER_PROCESSING_TIMEOUT_MINUTES=10` (§8.5) |
| Q-13 | DATA_MODEL sync for `delivery_status` terminal `skipped` transitions | DATA_MODEL patch follow-up (§6.5) |

---

## 21. WORKER_REMINDER_POLICY Acceptance Criteria

Document status: **Draft — patched after Codex review, awaiting second worker review**.

| # | Criterion | Status |
| --- | --- | --- |
| AC-01 | `docs/WORKER_REMINDER_POLICY.md` created | Draft |
| AC-02 | Worker principles defined (§2) | Draft |
| AC-03 | Job catalog defined (§3) | Draft |
| AC-04 | WorkerJobLock policy defined (§4) | Needs review |
| AC-05 | Reminder selection policy defined (§5) | Needs review |
| AC-06 | ReminderDelivery lifecycle defined (§6) | Needs review |
| AC-07 | Idempotency key policy defined (§7) | Draft |
| AC-08 | ReminderSender atomic flow defined (§8) | Needs review |
| AC-09 | Retry/backoff policy defined (§9) | Draft |
| AC-10 | Notification creation policy IDs-only (§10) | Draft |
| AC-11 | Reminder event policy defined (§11) | Draft |
| AC-12 | RecurrenceGenerator policy defined (§12) | Draft |
| AC-13 | CleanupArchive policy defined (§13) | Needs review |
| AC-14 | OverdueNotifier policy defined (§14) | Needs review |
| AC-15 | Evening/Daily policy defined (§15) | Draft |
| AC-16 | Worker logging policy defined (§16) | Draft |
| AC-17 | Failure handling defined (§17) | Needs review |
| AC-18 | Worker privacy boundary defined (§18) | Draft |
| AC-19 | Worker test matrix WRK-T01..WRK-T23 defined (§19) | Needs review |
| AC-20 | Open questions listed (§20) | Draft |
| AC-21 | No code/tests/migrations created | Draft |
| AC-22 | Post-rollback failure recording defined (§8.4) | Needs review |
| AC-23 | Stuck processing recovery defined (§8.5) | Needs review |
| AC-24 | Overdue idempotency storage decision documented (§14.3) | Needs review |
| AC-25 | Lock expiry boundary unified (`locked_until <= now()`) | Needs review |
| AC-26 | Retry predicate disambiguated (§5.2) | Needs review |
| AC-27 | WRK-T21..WRK-T23 added | Needs review |
| AC-28 | Accepted after second Codex worker review | Pending final review |

---

## Appendix A: Worker Architecture Reference

```text
apps/worker/
  scheduler.ts           — interval/cron loop
  jobs/
    reminders.ts         — ReminderSender + retry pass + stuck recovery
    recurrence.ts        — RecurrenceGenerator
    overdue.ts           — OverdueNotifier (blocked until dedup storage)
    evening-review.ts    — EveningReviewNudge
    cleanup.ts           — CleanupArchive
  lib/
    job-lock.ts          — WorkerJobLock acquire/release
    delivery.ts          — idempotency key builder, claim helpers
    recovery.ts          — post-rollback failure recording (§8.4)
    logger.ts            — privacy-safe structured logger
```

Dependency flow (from `ARCHITECTURE_BASELINE.md`):

```text
Worker → ACL-eligibility checks (domain) → Domain Services → Persistence
       → NotificationService → EventService (same transaction)
```

---

## Appendix B: Release Gate Cross-Reference

| Gate | Policy section | Test IDs |
| --- | --- | --- |
| RG-22 | §13.1 AI raw cleanup | WRK-T15, AI-T08 |
| RG-24 | §13.2 Voice cleanup | WRK-T16, WRK-T17 |
| RG-25 | §10 Notification IDs-only | WRK-T14, ACL-T13, N-01..N-09 |
| RG-27 | §7, §8 Idempotency + recovery | WRK-T01..WRK-T05, WRK-T13, WRK-T21, WRK-T22 |
| RG-28 | §6, §8.5 Terminal states + stuck recovery | WRK-T06..WRK-T08, WRK-T21 |
| RG-29 | §4 WorkerJobLock | WRK-T10..WRK-T12, WRK-T20 |
| RG-30 | §16 Worker log privacy | WRK-T09, ACL-T29 |
| RG-31 | §8, §11, §12 Events same TX | WRK-T04, WRK-T19, WRK-T22, API-T10 |
| RG-25 (Overdue) | §14.3 Overdue dedup storage | WRK-T23 (blocked until DATA_MODEL) |

---

*Конец документа WORKER_REMINDER_POLICY.md v0.2*
