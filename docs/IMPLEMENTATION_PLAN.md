# IMPLEMENTATION_PLAN.md

Версия: 0.2  
Статус: Draft — patched after Codex review, ready for Stage 0.1  
Проект: AI Task Assistant / Time Management System  
Локальный путь: `C:\Dima\Projects\CURSOR\time-management`  
Связанные документы: `docs/TZ_MVP.md`, `docs/ARCHITECTURE_BASELINE.md`, `docs/DATA_MODEL.md`, `docs/ACCESS_CONTROL.md`, `docs/API_CONTRACTS.md`, `docs/AI_CONTRACTS.md`, `docs/TESTING_STRATEGY.md`, `docs/WORKER_REMINDER_POLICY.md`, `docs/CURSOR_SYSTEM_PROMPT.md`, `docs/CODEX_REVIEW_PROMPT.md`

---

## 1. Назначение документа

Данный документ определяет **технический план поэтапной реализации MVP** AI Task Assistant после завершения контрактной документации.

| Аспект | Описание |
| --- | --- |
| **Что определяет** | Implementation phases, dependency order, skeleton scope, first coding milestone, acceptance gates, Codex review points, Cursor task sequencing, risk controls |
| **Основа** | Все contract docs перечислены выше; обязательные test IDs: ACL-T01..ACL-T31, API-T01..API-T16, AI-T01..AI-T16, WRK-T01..WRK-T23, RG-01..RG-36 |
| **Для кого** | Cursor (coding prompts), Codex (phase review), разработчик (delivery roadmap) |
| **Что НЕ является** | Кодом, тестами, миграциями, ORM schema, CI workflow, package.json |

Документ является **source of truth** для поэтапной реализации и будет основой для Cursor/Codex coding prompts. Любая реализация должна следовать контрактным документам; отклонения требуют явного patch контракта до кода.

---

## 2. Implementation Principles

Следующие принципы обязательны на всех фазах:

1. **Contract-first implementation** — endpoint, DTO, ACL, worker flow и event side effects определены в docs до handler/job кода.
2. **Small vertical slices** — каждая фаза завершается runnable, testable increment, не «big bang».
3. **No bypass of ACL** — все list/get/mutation проходят через `AccessControlService`; единый predicate для list и GET.
4. **Tests before risky features** — ACL, mass assignment, AI injection, worker idempotency покрываются до расширения scope.
5. **Privacy gates are release-blocking** — RG-01..RG-36 (особенно RG-01, RG-02, RG-21, RG-25, RG-27) блокируют release.
6. **AI is suggestion-only** — classify не создаёт task; apply revalidates поля; provider не получает `user_id`.
7. **Worker jobs are idempotent** — `reminder_deliveries.idempotency_key`, `worker_job_locks.lock_key`; terminal states immutable.
8. **No raw private content in notifications/logs/events** — IDs-only payload; redacted AI logs; comment_id без body в TaskEvent.
9. **No external provider dependency in CI** — mock AI/STT; no-network; no secrets (RG-36).
10. **Codex review after each phase** — diff audit по `CODEX_REVIEW_PROMPT.md` + contract alignment.
11. **Avoid scope creep** — features из §6 «Do Not Implement Yet» не добавляются без patch TZ/контрактов.
12. **Git baseline required before coding** — docs committed; ADR-0001 stack decision; skeleton scope agreed.

---

## 3. Pre-Skeleton Prerequisites

Обязательные действия **до первого кода**:

| # | Prerequisite | Owner | Output |
| --- | --- | --- | --- |
| 1 | Initialize git repository if not exists | Dev | `git init`; `.gitignore` |
| 2 | Commit current docs as baseline | Dev | Baseline commit: all `docs/*.md` |
| 3 | **Decide stack (umbrella)** | Dev + ADR | `docs/ADR/0001-project-architecture.md` — сводный ADR; детали в строках 3a–3g ниже |
| 3a | Decide web framework | ADR | Next.js vs Vite+React (или эквивалент React ecosystem) |
| 3b | Decide backend/API framework | ADR | Node.js API layer vs fullstack framework routes |
| 3c | Decide ORM | ADR | Prisma / Drizzle / Kysely |
| 3d | Decide migration strategy | ADR | ORM-native migrations vs SQL-first; rollback policy; test DB apply order |
| 3e | Decide validation library | ADR | Zod / similar — DTO allowlist, mass assignment rejection |
| 3f | Decide test framework | ADR | Vitest vs Jest — unit + integration runner |
| 3g | Decide E2E tool | ADR | Playwright (recommended vector) vs alternative |
| 4 | Decide package manager | ADR | pnpm workspaces (recommended vector) или npm/yarn |
| 5 | Decide auth/session strategy | ADR | Session cookies + server-side store; bcrypt/argon2 |
| 6 | Decide test DB strategy | ADR | Ephemeral PostgreSQL (docker) или test schema per suite |
| 7 | Decide CI provider | ADR | GitHub Actions / GitLab CI — no-network, no-secrets default |
| 8 | Decide worker process model | ADR | Separate `apps/worker` process (recommended) vs in-process for dev only |
| 9 | Decide whether OverdueNotifier is in first worker scope | Product + Tech | Default: **NO** until dedup storage contract |
| 10 | If OverdueNotifier in first scope | Tech | Patch `DATA_MODEL.md`: `notifications.idempotency_key` или `notification_dedup` **before** migrations |

**Вектор из `ARCHITECTURE_BASELINE.md` (не финальный выбор):**

| Слой | Вектор |
| --- | --- |
| Language | TypeScript strict |
| Frontend | React ecosystem (Next.js или Vite+React) |
| Backend API | Node.js API layer или fullstack framework routes |
| Database | PostgreSQL 15+ |
| ORM | Prisma / Drizzle / Kysely |
| Worker | Node.js, shared packages |
| Tests | Vitest/Jest + Supertest + Playwright |
| Monorepo | `apps/` + `packages/` (pnpm workspaces / turborepo) |

---

## 4. Proposed MVP Implementation Phases

### Phase 0 — Repository and Skeleton

**Purpose:** Создать monorepo structure, tooling baseline, CI smoke без бизнес-логики.

**Scope:**

- Monorepo: `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/auth`, `packages/ai`, `packages/shared`
- Package manager, lint, typecheck, test placeholders
- `.env.example` без реальных ключей
- CI: install → lint → typecheck → placeholder test; **no external network; no secrets**
- `GET /health` stub
- Worker stub (process starts, no jobs execute)
- `docs/ADR/0001-project-architecture.md`

**Exclusions:**

- No business features
- No AI provider
- No worker job execution beyond stub
- No DB migrations beyond initial config (unless ORM requires empty schema)

**Acceptance:**

- [ ] `pnpm install` (or chosen PM) succeeds
- [ ] Lint and typecheck pass
- [ ] Unit test placeholder passes
- [ ] CI runs without external network and secrets (RG-36)
- [ ] Codex review: no layer violations, no secrets in repo

---

### Phase 1 — Database and Domain Foundation

**Purpose:** Core DB schema, migrations, repositories, base domain services, event service skeleton.

**Scope:**

- Tables: `users`, `user_settings`, `workspaces`, `workspace_members`, `spaces`, `space_members`, `projects`, `project_members`, `tasks`, `categories`, `tags`, `task_tags`, `task_events`
- Enums per `DATA_MODEL.md`
- Repositories in `packages/db`
- `EventService` skeleton (write API, same-transaction contract)
- Seed: minimal workspace (owner + 2 spaces + sample tasks for dev only)
- Migration strategy documented in ADR

**Exclusions:**

- No public API (or minimal internal smoke only)
- No ACL enforcement yet (schema only)
- No AI, notifications, reminders tables yet (Phase 3/5)

**Acceptance:**

- [ ] Migrations run clean on empty DB
- [ ] Seed creates minimal workspace
- [ ] Event same-transaction pattern established (integration smoke)
- [ ] Codex review against `DATA_MODEL.md` §entities Phase 1 scope

**Test gates:** RG-31 (event foundation smoke)

---

### Phase 2 — Auth + ACL Foundation

**Purpose:** Auth/session, `AccessControlService`, user endpoints, ACL predicates.

**Scope:**

- Login / logout / `GET /me`
- Session middleware
- `user_settings` CRUD (owner)
- Workspace membership resolution
- ACL predicates: `canViewTask`, `canEditTask`, `canViewTaskEvent`, `canCreateReminder`, etc.
- 404/403 semantics per `ACCESS_CONTROL.md` §12
- `AuthAuditEvent` (MVP-lite)

**Exclusions:**

- No full task API yet (ACL unit/integration tests with fixtures)
- No AI, worker, dashboards

**Acceptance:**

- [ ] ACL-T01, ACL-T02, ACL-T20, ACL-T25, ACL-T30 planned or implemented
- [ ] No private task leak in test harness
- [ ] Owner strict privacy preserved
- [ ] List/get use same predicate
- [ ] Codex review against `ACCESS_CONTROL.md`

**Test gates:** RG-01..RG-06 (foundation subset)

---

### Phase 3 — Task API Core

**Purpose:** Task CRUD, DTO filtering, mutations with TaskEvent.

**Scope:**

- `GET/POST/PATCH/DELETE /api/tasks`
- Complete, reschedule, delegate
- Comments (basic)
- TaskShare (basic)
- Reminders create/update/delete (API only; worker in Phase 5)
- DTO levels: full, member, guest, summary
- Mass assignment protection
- Tables: `comments`, `task_shares`, `reminders`, `notifications` (schema)

**Exclusions:**

- No worker send
- No AI classify
- No dashboard/analytics endpoints

**Acceptance:**

- [ ] API-T01..API-T16 mapped to tests
- [ ] Mass assignment blocked (RG-11..RG-13)
- [ ] TaskEvent written for all mutations (RG-31, RG-32)
- [ ] Guest DTO safe (RG-07..RG-09)
- [ ] Notification payload stubs IDs-only if created manually
- [ ] Codex review against `API_CONTRACTS.md`

**Test gates:** RG-07..RG-13, RG-31, RG-32

---

### Phase 4 — Dashboards and Analytics

**Purpose:** Today dashboard, evening review, basic analytics with privacy-safe aggregates.

**Scope:**

- `GET /api/dashboard/today`
- `GET /api/dashboard/evening-review`
- `GET /api/dashboard/week` (basic)
- Analytics: daily, weekly, Eisenhower, categories, users
- Event filtering via `canViewTaskEvent`
- Timezone via `user_settings.timezone`

**Exclusions:**

- No AI in dashboards
- No notification delivery
- No raw task content in analytics

**Acceptance:**

- [ ] No title/description in analytics (RG-10, RG-35)
- [ ] Dashboard respects ACL
- [ ] Events filtered by `canViewTaskEvent`
- [ ] Codex review

**Test gates:** RG-10, RG-35

---

### Phase 5 — Worker MVP

**Purpose:** ReminderSender, CleanupArchive minimal, RecurrenceGenerator (if recurrence in MVP).

**Scope:**

- Tables: `reminder_deliveries`, `worker_job_locks`
- `WorkerJobLock` acquire/release
- `ReminderDelivery` lifecycle (pending → processing → sent | failed | skipped)
- `ReminderSender` in-app channel
- `CleanupArchive`: AI raw, voice, expired locks (if fields exist)
- `RecurrenceGenerator` — optional per product decision
- Stuck processing recovery per `WORKER_REMINDER_POLICY.md` §8.5
- Post-rollback failure recording §8.4

**Important exclusions:**

- **Do NOT implement OverdueNotifier** until dedup storage contract (§7.1)
- **Do NOT implement DailyDigest** unless product confirms MVP
- **Do NOT implement external** push/email/telegram channels
- **Do NOT implement EveningReviewNudge** until dedup storage if duplicate prevention required

**Pre-implementation patch decisions (§7):**

- `skipped` terminal sync with `DATA_MODEL.md`
- `last_attempt_at` as processing timestamp vs `processing_started_at`
- `REMINDER_PROCESSING_TIMEOUT_MINUTES` default = 10

**Acceptance:**

- [ ] WRK-T01..WRK-T22 mapped (WRK-T23 blocked until OverdueNotifier scope + dedup)
- [ ] RG-27..RG-31 satisfied for implemented jobs
- [ ] No duplicate reminder send
- [ ] Notifications IDs-only (RG-25)
- [ ] TaskEvent `reminder_sent` same transaction
- [ ] Worker logs IDs-only (RG-30)
- [ ] Codex review against `WORKER_REMINDER_POLICY.md`

**Test gates:** RG-22, RG-24, RG-25, RG-27..RG-31

---

### Phase 6 — AI Classification

**Purpose:** AI classify with mock provider, adapter abstraction, DTO layers, accessible context.

**Scope:**

- `POST /api/ai/classify-task`, `POST /api/ai/reclassify-task`
- `AIClassificationLog` table
- Provider adapter interface + mock
- Schema validation (Zod/similar)
- Accessible context builder
- Redaction/logging
- `ai_classified` event on apply (not on classify)

**Exclusions:**

- No real provider in CI
- No auto-create task on classify
- No raw fields in API

**Acceptance:**

- [ ] AI-T01..AI-T16 mapped
- [ ] RG-14..RG-21 pass
- [ ] Classify does not create task (RG-19)
- [ ] `model_name` server-set (RG-16)
- [ ] Codex review against `AI_CONTRACTS.md`

---

### Phase 7 — Voice/STT

**Purpose:** Voice capture, STT mock, transcript retention, classify from transcript.

**Scope:**

- `VoiceCapture` table
- Upload validation (MIME, size, duration)
- STT provider abstraction + mock
- Transcript owner-only access
- `VOICE_AUDIO_STORE=false` default
- Classify from transcript flow

**Acceptance:**

- [ ] AI-T09 pass
- [ ] RG-23, RG-24 pass
- [ ] Voice privacy tests (ACL-T17)
- [ ] Codex review

---

### Phase 8 — Frontend MVP

**Purpose:** Web UI for core flows.

**Scope:**

- Login / logout
- Today dashboard
- Inbox / tasks list
- Task detail
- Quick add
- AI preview (classify → confirm → create)
- Reminders UI
- Evening review
- Basic analytics
- Settings (profile, timezone, notifications prefs)

**Exclusions:**

- No offline-first
- No native mobile
- No external notification channels UI beyond in-app

**Acceptance:**

- [ ] E2E smoke: login → today → quick add → AI preview → create task
- [ ] Access denied UI (403/404 handling)
- [ ] No hidden data in DOM/network responses (guest path)
- [ ] Codex review

---

### Phase 9 — Release Hardening

**Purpose:** Final security/privacy regression, CI gates, documentation update.

**Scope:**

- RG-01..RG-36 runnable suites
- E2E smoke full path
- CI no-network/no-secrets verification
- Deployment notes in README
- Deferred gates explicitly documented

**Acceptance:**

- [ ] All release-blocking gates pass or explicitly deferred with product sign-off
- [ ] No HIGH findings in Codex review
- [ ] MVP baseline ready for self-hosted deployment

---

## 5. Phase Dependency Graph

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3
Phase 3 → Phase 4
Phase 3 → Phase 5
Phase 2 + Phase 3 → Phase 6
Phase 6 → Phase 7
Phase 3 + Phase 4 + Phase 6 → Phase 8
All → Phase 9
```

### Dependency rationale

| Dependency | Reason |
| --- | --- |
| Phase 0 before all | Git, stack, CI, monorepo structure required |
| Phase 1 before Phase 2 | ACL predicates need schema and repositories |
| Phase 2 before Phase 3 | ACL before full task exposure; 404/403 semantics |
| Phase 3 before Phase 4 | Dashboard/analytics query tasks with DTO filtering |
| Phase 3 before Phase 5 | Reminder API schema before worker send |
| Phase 2 + 3 before Phase 6 | AI context builder needs ACL + task/space fixtures |
| Phase 6 before Phase 7 | Voice flow ends in classify; shared AI adapter |
| Phase 3 + 4 + 6 before Phase 8 | UI consumes task, dashboard, AI APIs |
| All before Phase 9 | Full regression requires complete vertical slices |

**Critical path:** 0 → 1 → 2 → 3 → 5 → 6 → 8 → 9

**Parallelizable after Phase 3:** Phase 4 (dashboards) and Phase 5 (worker) can proceed in parallel if team capacity allows.

---

## 6. Explicit Implementation Blocks / Do Not Implement Yet

Следующие элементы **запрещены** до явного patch контрактов и product sign-off:

| # | Block | Reason |
| --- | --- | --- |
| 1 | OverdueNotifier production behavior | Dedup storage contract missing (`notifications.idempotency_key` or `notification_dedup`) |
| 2 | DailyDigest | Not confirmed MVP; requires dedup storage |
| 3 | External notification channels (push, email, telegram) | Outbox pattern + channel adapters post-MVP |
| 4 | Real AI provider in CI | RG-36; mock only in default test suite |
| 5 | Local LLM requirement | Cloud API on MVP per TZ |
| 6 | Vector DB / RAG | Out of MVP scope |
| 7 | Mobile native app | Web-first → PWA → Capacitor later |
| 8 | Enterprise SSO / SCIM | 1–10 users |
| 9 | Calendar/Gmail integrations | Post-MVP |
| 10 | Raw AI export endpoint | Privacy risk; not in contracts |
| 11 | Outbox pattern | Required only when external delivery channels added |
| 12 | Kubernetes / microservices | Modular monolith on MVP |

---

## 7. Required DATA_MODEL Follow-Up Before Certain Features

### 7.1 OverdueNotifier

**Before implementation choose one:**

| Option | Storage contract |
| --- | --- |
| **A (preferred)** | `notifications.idempotency_key` (text, nullable) + unique partial index |
| **B** | Separate `notification_dedup` table keyed by `idempotency_key` + `user_id` |
| **C** | Another non-private unique storage contract (document in ADR) |

**Not acceptable:** dedup key only inside `notifications.payload` — payload is strictly IDs-only.

**Until decision:**

```text
OverdueNotifier is policy-defined but implementation-blocked for production.
```

Logical key (policy-level): `overdue:{task_id}:{date_bucket}`

**WRK-T23** remains blocked/pending until storage contract exists.

### 7.2 EveningReviewNudge / DailyDigest

If implemented as scheduled notifications with duplicate prevention:

- Same dedup decision class as §7.1 required
- Product sign-off for MVP inclusion (default: post-MVP)

### 7.3 `skipped` terminal sync

`WORKER_REMINDER_POLICY.md` §6.3: `skipped` is **terminal** and immutable.

`DATA_MODEL.md` transition list for `reminder_deliveries` is currently weaker on `skipped`.

**Action:** Patch `DATA_MODEL.md` enum transitions and check constraints **before** Phase 5 migrations.

### 7.4 Stuck processing recovery

`WORKER_REMINDER_POLICY.md` §8.5 uses:

```sql
delivery.last_attempt_at IS NOT NULL
AND delivery.last_attempt_at < now() - INTERVAL 'REMINDER_PROCESSING_TIMEOUT_MINUTES minutes'
```

**Before Phase 5 implementation decide:**

| Option | Approach |
| --- | --- |
| **A (recommended)** | Use `last_attempt_at` as processing timestamp; set on claim |
| **B** | Add `processing_started_at` column; patch `DATA_MODEL.md` |

**Risk if skipped:** `last_attempt_at = NULL` fallback must be handled in stuck recovery query before skeleton coding of worker jobs.

### 7.5 Reminder idempotency (already covered)

`reminder_deliveries.idempotency_key` — **ready** per `DATA_MODEL.md`. No patch required for ReminderSender.

`notifications.idempotency_key` — **not yet** in `DATA_MODEL.md`. Required only for OverdueNotifier / scheduled digest dedup.

---

## 8. Testing and CI Plan

### 8.1 Phase → Test Focus mapping

| Phase | Test Focus | Release Gates | Test IDs (primary) |
| --- | --- | --- | --- |
| Phase 0 | install / lint / typecheck / no secrets | RG-36 | CI config review |
| Phase 1 | migrations / domain / events | RG-31 | EV-13, AB-E01 |
| Phase 2 | ACL / auth | RG-01..RG-06 | ACL-T01, T02, T20, T25, T30, T31 |
| Phase 3 | API / DTO / mass assignment | RG-07..RG-13, RG-31, RG-32 | API-T01..T16, ACL-T24, T28 |
| Phase 4 | analytics / privacy | RG-10, RG-35 | ACL-T14, API-T12 |
| Phase 5 | worker / reminders / cleanup | RG-22, RG-24, RG-25, RG-27..RG-31 | WRK-T01..T22 |
| Phase 6 | AI classify | RG-14..RG-23 | AI-T01..T16 |
| Phase 7 | voice / STT | RG-23, RG-24 | AI-T09, ACL-T17 |
| Phase 8 | e2e smoke | selected RG smoke | E2E + ACL spot checks |
| Phase 9 | full regression | RG-01..RG-36 | All suites runnable |

### 8.2 RG-01..RG-36 full matrix (reference)

| Gate | Area | Phase | Key Test IDs |
| --- | --- | --- | --- |
| RG-01 | No private task leak | 2, 9 | ACL-T01, ACL-T02 |
| RG-02 | No ProjectMember private leak | 2, 3, 9 | ACL-T25, API-T01 |
| RG-03 | No invalid TaskShare provenance | 3, 9 | ACL-T30, API-T02 |
| RG-04 | List/get consistency | 2, 3, 9 | ACL-T20, API-T06 |
| RG-05 | Correct 404/403 | 2, 3, 9 | ACL-T01, T20, API-T01, T03 |
| RG-06 | Guest cannot create reminder | 3, 9 | ACL-T31, API-T03 |
| RG-07 | DTO allowlist | 3, 9 | DTO-01..DTO-11 |
| RG-08 | Guest DTO privacy | 3, 9 | DTO-01..07, ACL-T07, T09 |
| RG-09 | TaskSummary privacy | 3, 9 | DTO-08, DTO-09 |
| RG-10 | Analytics no content | 4, 9 | ACL-T14, API-T12 |
| RG-11 | Owner mass assignment | 3, 9 | ACL-T28, API-T05 |
| RG-12 | TaskShare shared_by blocked | 3, 9 | API-T13, MA-03 |
| RG-13 | System lifecycle fields | 3, 9 | MA-04, MA-06 |
| RG-14 | AI accessible context | 6, 9 | ACL-T15, API-T09, AI-T03 |
| RG-15 | No user_id in provider | 6, 9 | MA-05 |
| RG-16 | model_name server-set | 6, 9 | AI-T15 |
| RG-17 | Unknown AI fields rejected | 6, 9 | AI-T04, AI-T16 |
| RG-18 | Prompt injection blocked | 6, 9 | AI-T05, T13, T14 |
| RG-19 | Classify no auto-create | 6, 9 | AI-T11 |
| RG-20 | Apply revalidates fields | 6, 9 | AI-T12, API-T05 |
| RG-21 | Raw AI never in API | 6, 9 | AI-T07, ACL-T16 |
| RG-22 | AI raw retention cleanup | 5, 9 | AI-T08, WRK-T15 |
| RG-23 | STT transcript owner-only | 7, 9 | AI-T09, ACL-T17 |
| RG-24 | Voice retention | 5, 7, 9 | WRK-T16, T17 |
| RG-25 | Notification IDs-only | 5, 9 | ACL-T13, T27, API-T04, WRK-T14 |
| RG-26 | Stale notification safety | 3, 9 | ACL-T27 |
| RG-27 | Reminder idempotency | 5, 9 | WRK-T01..T03, T21, T22 |
| RG-28 | Terminal states | 5, 9 | WRK-T06..T08, T21 |
| RG-29 | Worker lock correctness | 5, 9 | WRK-T10..T12, T20 |
| RG-30 | Worker log privacy | 5, 9 | ACL-T29, WRK-T09 |
| RG-31 | TaskEvent same transaction | 1, 3, 5, 9 | API-T10, EV-01..13 |
| RG-32 | Comment event comment_id only | 3, 9 | ACL-T24, API-T11 |
| RG-33 | AI events no raw prompt | 6, 9 | AB-E03 |
| RG-34 | Auth audit events | 2, 9 | API-T08 |
| RG-35 | Analytics privacy | 4, 9 | ACL-T14, API-T12 |
| RG-36 | CI no provider/network/secrets | 0, 9 | CI config |

### 8.3 CI baseline (Phase 0+)

```text
install → lint → typecheck → test:unit → test:integration (mock DB) → test:acl (subset)
```

- No `OPENAI_API_KEY` or STT keys in CI env
- AI/STT tests use mock adapters only
- Network calls blocked or stubbed in default pipeline

### 8.4 Test directory structure (target)

```text
tests/
  unit/
  integration/
  access-control/     # ACL-T01..T31
  ai-contract/        # AI-T01..T16
  worker/             # WRK-T01..T23
  e2e/
```

---

## 9. Codex Review Gates

Каждая фаза завершается Codex review. Обязательный формат отчёта:

1. **Summary of files changed** — список путей и nature of change
2. **Commands run** — install, lint, test commands with exit codes
3. **Tests passed/failed** — по test IDs и RG gates
4. **Contract alignment report** — сверка с relevant contract doc sections
5. **Risk report** — BLOCKER / HIGH / MEDIUM / LOW per `CODEX_REVIEW_PROMPT.md`
6. **No scope creep statement** — явное подтверждение отсутствия §6 blocks
7. **Open questions** — unresolved items for next phase

### Codex must REJECT if:

| Violation | Severity |
| --- | --- |
| Private data leak (cross-user task visibility) | BLOCKER |
| ACL bypass (handler without policy check) | BLOCKER |
| Missing TaskEvent on mutation | BLOCKER |
| Raw AI field returned by API | BLOCKER |
| Notification title/body stored in payload | BLOCKER |
| Worker duplicate send (idempotency broken) | BLOCKER |
| CI requires real provider key | BLOCKER |
| Unapproved external infrastructure added | BLOCKER |
| Mass assignment accepted silently | HIGH |
| List/get predicate mismatch | HIGH |
| Guest DTO exposes forbidden fields | HIGH |

### Verdict scale

- **APPROVE** — phase complete, proceed to next
- **APPROVE WITH FIXES** — non-blocking fixes required before next phase starts
- **REJECT** — BLOCKER present; phase not complete

---

## 10. Cursor Task Sequencing

Рекомендуемая последовательность задач для Cursor. Каждый stage — один focused PR/diff.

---

### STAGE 0.1 — Initialize Git and Baseline Docs

| Field | Value |
| --- | --- |
| **Objective** | Git repo + baseline commit of all contract docs |
| **Allowed files** | `.gitignore`, `README.md` (minimal), `docs/**` (read-only, no edits unless fixing typos blocking git) |
| **Forbidden** | `apps/`, `packages/`, code, tests, migrations, CI |
| **Acceptance** | `git log` shows baseline; all docs tracked |
| **Test commands** | `git status` clean after commit |
| **Codex review** | Required — verify no secrets, docs complete |

---

### STAGE 0.2 — Create Monorepo Skeleton

| Field | Value |
| --- | --- |
| **Objective** | `apps/web`, `apps/worker`, `packages/*` directories; root package.json; workspace config |
| **Allowed files** | Root `package.json`, `pnpm-workspace.yaml`, `apps/*/package.json`, `packages/*/package.json`, `tsconfig` bases, `README.md` |
| **Forbidden** | Business logic, DB, API routes beyond health stub, AI, worker jobs |
| **Acceptance** | Workspace install succeeds; TypeScript project references resolve |
| **Test commands** | `pnpm install`; `pnpm -r exec tsc --noEmit` (if configured) |
| **Codex review** | Required — layer boundaries, no premature dependencies |

---

### STAGE 0.3 — Add Tooling Baseline

| Field | Value |
| --- | --- |
| **Objective** | ESLint, Prettier, Vitest/Jest placeholder, `.env.example` |
| **Allowed files** | Lint configs, `vitest.config.ts`, `.env.example`, `scripts/` stubs |
| **Forbidden** | Real secrets, provider keys, business domain code |
| **Acceptance** | `pnpm lint`, `pnpm typecheck`, `pnpm test` pass (placeholder) |
| **Test commands** | `pnpm lint && pnpm typecheck && pnpm test` |
| **Codex review** | Required |

---

### STAGE 0.4 — Add CI No-Secrets Smoke

| Field | Value |
| --- | --- |
| **Objective** | CI pipeline: install → lint → typecheck → test; no network; no secrets |
| **Allowed files** | `.github/workflows/*` or equivalent, `docs/ADR/0001-project-architecture.md` |
| **Forbidden** | External service calls, secret env vars in CI |
| **Acceptance** | CI green on push; RG-36 satisfied |
| **Test commands** | Local equivalent of CI job |
| **Codex review** | Required — RG-36 audit |

---

### STAGE 1.1 — DB Schema Initial

| Field | Value |
| --- | --- |
| **Objective** | Phase 1 tables + enums + migrations |
| **Allowed files** | `packages/db/**`, migration files, `docs/ADR/*` (stack only) |
| **Forbidden** | API routes, ACL, AI, worker, frontend |
| **Acceptance** | Migrations apply on empty PostgreSQL; enums match `DATA_MODEL.md` |
| **Test commands** | `pnpm db:migrate`; migration smoke test |
| **Codex review** | Required — `DATA_MODEL.md` alignment |

---

### STAGE 1.2 — Seed Minimal Workspace

| Field | Value |
| --- | --- |
| **Objective** | Dev seed: owner, 2 spaces, sample tasks for fixture development |
| **Allowed files** | `scripts/seed-dev.ts`, `packages/db/seed/**` |
| **Forbidden** | Production secrets; hardcoded passwords in repo (use env) |
| **Acceptance** | Seed idempotent; supports ACL test fixture structure per `TESTING_STRATEGY.md` §3 |
| **Test commands** | `pnpm db:seed` |
| **Codex review** | Required |

---

### STAGE 1.3 — EventService Foundation

| Field | Value |
| --- | --- |
| **Objective** | `EventService` write API; same-transaction helper |
| **Allowed files** | `packages/core/events/**`, `packages/db/repositories/task-events/**`, integration test |
| **Forbidden** | Full task API; ACL |
| **Acceptance** | Integration test: mutation + event atomic; rollback → no orphan event (EV-13) |
| **Test commands** | `pnpm test:integration -- events` |
| **Codex review** | Required — RG-31 foundation |

---

### STAGE 2.1 — Auth Foundation

| Field | Value |
| --- | --- |
| **Objective** | Login, logout, session, `GET /me`, `AuthAuditEvent` |
| **Allowed files** | `packages/auth/**`, `apps/web` auth routes, session middleware |
| **Forbidden** | Task API; ACL predicates beyond auth |
| **Acceptance** | Login works; disabled user rejected (ACL-T22); no email enumeration (API-T08) |
| **Test commands** | `pnpm test:integration -- auth` |
| **Codex review** | Required — RG-34 |

---

### STAGE 2.2 — AccessControlService Foundation

| Field | Value |
| --- | --- |
| **Objective** | ACL predicates; test fixtures; `tests/access-control/` scaffold |
| **Allowed files** | `packages/core/access/**`, `tests/access-control/**`, fixtures |
| **Forbidden** | Full task CRUD API |
| **Acceptance** | ACL-T01, T02, T20 pass; same predicate list/get |
| **Test commands** | `pnpm test:acl` |
| **Codex review** | Required — `ACCESS_CONTROL.md`; RG-01, RG-04, RG-05 |

---

### STAGE 3.1 — Task API Read/List

| Field | Value |
| --- | --- |
| **Objective** | `GET /api/tasks`, `GET /api/tasks/:id`; DTO filtering |
| **Allowed files** | `apps/web` task routes, `packages/core/tasks/**`, DTO schemas |
| **Forbidden** | Mutations; worker; AI |
| **Acceptance** | ACL-T20; guest DTO; invisible space filter (API-T07) |
| **Test commands** | `pnpm test:integration -- tasks-read` |
| **Codex review** | Required — RG-07..RG-09 |

---

### STAGE 3.2 — Task Mutations + Events

| Field | Value |
| --- | --- |
| **Objective** | Create, update, delete, complete, reschedule, delegate + TaskEvent |
| **Allowed files** | Task mutation handlers, `EventService` integration |
| **Forbidden** | AI; worker send |
| **Acceptance** | API-T10; RG-31; mass assignment (API-T05, RG-11) |
| **Test commands** | `pnpm test:integration -- tasks-mutations` |
| **Codex review** | Required |

---

### STAGE 3.3 — TaskShare + Comments

| Field | Value |
| --- | --- |
| **Objective** | TaskShare CRUD, comments, provenance rules |
| **Allowed files** | Share/comment routes, repositories |
| **Forbidden** | Reminders worker; AI |
| **Acceptance** | API-T02, T13; ACL-T30; API-T11 (comment_id only in event) |
| **Test commands** | `pnpm test:integration -- share-comments` |
| **Codex review** | Required — RG-03, RG-12, RG-32 |

---

### STAGE 3.4 — Reminder API

| Field | Value |
| --- | --- |
| **Objective** | Reminder CRUD; guest denial; schema for deliveries |
| **Allowed files** | Reminder routes, `reminders` table usage |
| **Forbidden** | Worker send; OverdueNotifier |
| **Acceptance** | API-T03; ACL-T31; ACL-T18 |
| **Test commands** | `pnpm test:integration -- reminders-api` |
| **Codex review** | Required — RG-06 |

---

### STAGE 4.1 — Dashboard Today + Evening

| Field | Value |
| --- | --- |
| **Objective** | Implement `GET /api/dashboard/today` and `GET /api/dashboard/evening-review` with ACL-safe task/event filtering |
| **Allowed files** | dashboard routes, dashboard service, DTO schemas, integration tests |
| **Forbidden** | AI-generated dashboard content, raw task content in cross-user views, analytics shortcuts bypassing ACL |
| **Acceptance** | Today dashboard shows only visible tasks; evening review uses `canViewTaskEvent`; no invisible/private tasks in responses |
| **Test commands** | `pnpm test:integration -- dashboard` |
| **Codex review** | Required — RG-10 / RG-35 / event filtering |

**Notes:**

- User timezone from `user_settings.timezone` only — not legacy profile fields.
- Dashboard must not bypass `canViewTask` — same predicate as task list/GET.
- Evening review events must not include comment body or raw AI prompt (`comment_id` only; redacted AI metadata).

---

### STAGE 4.2 — Analytics Endpoints

| Field | Value |
| --- | --- |
| **Objective** | Implement privacy-safe analytics endpoints: daily, weekly, Eisenhower, categories, users |
| **Allowed files** | analytics routes, analytics service, DTO schemas, integration tests |
| **Forbidden** | task title, task description, comment body, raw AI text, transcript, task-level private identifiers in aggregate responses |
| **Acceptance** | analytics responses contain counts/buckets only; private tasks excluded from shared/system views; small-group deanonymization safeguards applied |
| **Test commands** | `pnpm test:integration -- analytics` |
| **Codex review** | Required — RG-10 / RG-35 / ACL-T14 / API-T12 |

**Notes:**

- Category name allowed as taxonomy label in aggregates.
- No task content in analytics responses.
- Cross-user analytics must not expose private task counts where small-group inference is possible.

---

### STAGE 5.1 — WorkerJobLock + ReminderDelivery

| Field | Value |
| --- | --- |
| **Objective** | Lock acquire/release; delivery entity; idempotency key builder |
| **Allowed files** | `apps/worker/**`, `packages/db` delivery/lock repos, `tests/worker/` |
| **Forbidden** | OverdueNotifier; external channels |
| **Pre-requisite** | §7.3 `skipped` patch; §7.4 `last_attempt_at` decision |
| **Acceptance** | WRK-T01..T03; WRK-T10, T11 |
| **Test commands** | `pnpm test:worker -- lock-delivery` |
| **Codex review** | Required — RG-27, RG-29 |

---

### STAGE 5.2 — ReminderSender In-App

| Field | Value |
| --- | --- |
| **Objective** | Full ReminderSender flow; in-app notification; `reminder_sent` event |
| **Allowed files** | `apps/worker/jobs/reminders.ts`, notification creation |
| **Forbidden** | Title/body in notification payload; external channels |
| **Acceptance** | WRK-T04..T09, T13, T14, T21, T22; RG-25..RG-28, RG-30, RG-31 |
| **Test commands** | `pnpm test:worker -- reminder-sender` |
| **Codex review** | Required — `WORKER_REMINDER_POLICY.md` §8 |

---

### STAGE 5.3 — CleanupArchive

| Field | Value |
| --- | --- |
| **Objective** | AI raw cleanup, voice cleanup, stale lock cleanup |
| **Allowed files** | `apps/worker/jobs/cleanup.ts` |
| **Forbidden** | Destructive purge of active data; OverdueNotifier |
| **Acceptance** | WRK-T15..T17, T20; RG-22, RG-24 |
| **Test commands** | `pnpm test:worker -- cleanup` |
| **Codex review** | Required |

---

### STAGE 6.1 — AI Mock Provider + Schema

| Field | Value |
| --- | --- |
| **Objective** | Provider adapter interface; mock modes; JSON schema validation |
| **Allowed files** | `packages/ai/**`, `tests/ai-contract/**` |
| **Forbidden** | Real provider in default tests; auto-create task |
| **Acceptance** | AI-T04, T15, T16; RG-15..RG-17 |
| **Test commands** | `pnpm test:ai-contract` |
| **Codex review** | Required — `AI_CONTRACTS.md` |

---

### STAGE 6.2 — AI Classify Endpoint

| Field | Value |
| --- | --- |
| **Objective** | `classify-task`, `reclassify-task`; accessible context; logging |
| **Allowed files** | AI routes, `AIClassificationLog` |
| **Forbidden** | Raw fields in API response; user_id in provider payload |
| **Acceptance** | AI-T01..T14; RG-14, RG-18..RG-21 |
| **Test commands** | `pnpm test:integration -- ai-classify` |
| **Codex review** | Required |

---

### STAGE 7.1 — Voice Capture + STT Mock

| Field | Value |
| --- | --- |
| **Objective** | Upload, STT mock, transcript retention, owner-only access |
| **Allowed files** | Voice routes, `packages/ai/stt/**`, `voice_captures` |
| **Forbidden** | Raw audio storage when `VOICE_AUDIO_STORE=false` |
| **Acceptance** | AI-T09; RG-23; voice tests §10 |
| **Test commands** | `pnpm test:integration -- voice` |
| **Codex review** | Required |

---

### STAGE 8.1 — Frontend Login + Layout

| Field | Value |
| --- | --- |
| **Objective** | Login page, session handling, app shell, navigation |
| **Allowed files** | `apps/web` UI components, pages, hooks (data fetch only) |
| **Forbidden** | Business logic in components; ACL checks in UI as security |
| **Acceptance** | E2E: login → shell visible |
| **Test commands** | `pnpm test:e2e -- login` |
| **Codex review** | Required — no domain logic in UI |

---

### STAGE 8.2 — Today Dashboard

| Field | Value |
| --- | --- |
| **Objective** | Today view consuming dashboard API |
| **Allowed files** | Dashboard pages, API client hooks |
| **Forbidden** | Analytics raw content in UI state |
| **Acceptance** | E2E smoke; ACL-respecting task list |
| **Test commands** | `pnpm test:e2e -- today` |
| **Codex review** | Required |

---

### STAGE 8.3 — Quick Add + AI Preview

| Field | Value |
| --- | --- |
| **Objective** | Quick add flow; classify preview; confirm create |
| **Allowed files** | Quick add components, AI preview modal |
| **Forbidden** | Auto-create without user confirm |
| **Acceptance** | E2E: text → classify → create; no task without confirm |
| **Test commands** | `pnpm test:e2e -- quick-add` |
| **Codex review** | Required — RG-19 in UI flow |

---

### STAGE 9.1 — Release Gate Regression

| Field | Value |
| --- | --- |
| **Objective** | Full RG-01..RG-36 suite; deployment notes |
| **Allowed files** | `tests/**`, CI config, `README.md` deployment section |
| **Forbidden** | New features; scope creep |
| **Acceptance** | All release-blocking gates pass or documented deferrals |
| **Test commands** | `pnpm test` (full); `pnpm test:acl`; `pnpm test:worker`; `pnpm test:e2e` |
| **Codex review** | Required — final MVP verdict |

---

### Stage dependency note

STAGE 4.1 and STAGE 4.2 are now explicit implementation stages and must be completed after STAGE 3.4 or in parallel with STAGE 5.x only after Task API and ACL gates are stable.

---

## 11. Risk Register

| Risk | Severity | Mitigation | Phase |
| --- | --- | --- | --- |
| No git repository | HIGH | STAGE 0.1 mandatory before any code | 0 |
| OverdueNotifier dedup missing | HIGH | Block implementation (§6, §7.1); WRK-T23 pending | 5 |
| ACL implementation drift | BLOCKER | Single `AccessControlService`; ACL-T20 on every list endpoint | 2, 3 |
| DTO field leakage | HIGH | Allowlist schemas; guest path tests RG-07..RG-09 | 3, 8 |
| Worker duplicate delivery | BLOCKER | `idempotency_key` unique; WRK-T02, T03; atomic TX | 5 |
| Event side effects missing | BLOCKER | `EventService` same-transaction; API-T10; EV-13 | 1, 3, 5 |
| AI provider leakage | BLOCKER | Mock in CI; redaction; AI-T07, T10; RG-15, RG-21 | 6 |
| Voice transcript leakage | BLOCKER | Owner-only GET; ACL-T17; RG-23 | 7 |
| CI requiring secrets | BLOCKER | RG-36; mock adapters; no-network job | 0, 9 |
| Scope creep | MEDIUM | §6 block list; Codex no-scope-creep statement | all |
| Test data insufficient for ACL-T25/T30/T31 | HIGH | Seed per `TESTING_STRATEGY.md` §3.2 fixtures | 1, 2 |
| Inconsistent timezone handling | MEDIUM | `user_settings.timezone` only; clock mock in worker tests | 4, 5 |
| Retention cleanup destructive bug | HIGH | Cleanup tests WRK-T15..T17; dry-run integration tests | 5 |

---

## 12. Definition of Done for Skeleton

Skeleton (Phase 0) complete when **all** true:

1. Git repository initialized with baseline docs commit
2. Monorepo structure exists (`apps/web`, `apps/worker`, `packages/*`)
3. Package manager configured (workspace)
4. Lint / typecheck / test placeholder runs locally
5. CI runs without secrets and external network (RG-36)
6. `.env.example` created without real keys
7. `docs/ADR/0001-project-architecture.md` records stack decisions
8. `GET /health` stub responds
9. Worker process starts (stub loop, no jobs)
10. No business logic, DB migrations, or domain features
11. Contract docs remain source of truth (no conflicting code)
12. Codex approves skeleton with APPROVE or APPROVE WITH FIXES (no BLOCKER)

---

## 13. Definition of Done for MVP Backend

Backend MVP complete when **all** true:

1. DB migrations complete for MVP scope
2. Auth works (login, logout, session, me)
3. ACL policies enforced on all endpoints
4. Task API works (CRUD, complete, reschedule, delegate, share, comments)
5. Events written in same transaction for all mutations (RG-31)
6. DTO filtering works per role/share level (RG-07..RG-09)
7. Mass assignment blocked (RG-11..RG-13)
8. Reminder API works; guest denial enforced (RG-06)
9. Worker ReminderSender works in-app (RG-27..RG-30)
10. CleanupArchive works for AI/voice/locks (RG-22, RG-24)
11. AI classify works with mock + configurable provider (RG-14..RG-21)
12. Voice/STT works with mock + configurable provider (RG-23, RG-24)
13. Dashboards/analytics respect ACL (RG-10, RG-35)
14. Notifications IDs-only (RG-25, RG-26)
15. RG-01..RG-36 pass **or** explicitly deferred with documented product sign-off
16. No HIGH/BLOCKER Codex findings open

**Explicitly NOT required for backend MVP DoD:**

- OverdueNotifier (blocked)
- DailyDigest (unless product confirms)
- External notification channels
- Frontend (separate Phase 8 DoD)

---

## 14. Open Questions

| # | Question | Target resolution | Blocking |
| --- | --- | --- | --- |
| 1 | Final stack choice (Next.js vs Vite+React, ORM) | ADR-0001 at STAGE 0.2 | Phase 0 |
| 2 | Package manager (pnpm vs npm) | ADR-0001 | Phase 0 |
| 3 | ORM (Prisma vs Drizzle vs Kysely) | ADR-0001 | Phase 1 |
| 4 | Test framework (Vitest vs Jest) | ADR-0001 | Phase 0 |
| 5 | E2E tool (Playwright confirmed vector) | ADR-0001 | Phase 8 |
| 6 | Auth/session store (cookie + DB vs Redis) | ADR-0001 | Phase 2 |
| 7 | Worker process model (separate vs in-process dev) | ADR-0001 | Phase 5 |
| 8 | Notification dedup storage (`notifications.idempotency_key` vs `notification_dedup`) | DATA_MODEL patch | OverdueNotifier only |
| 9 | Whether OverdueNotifier is MVP | Product + TZ | Phase 5 scope |
| 10 | Whether DailyDigest is MVP | Product + TZ | Phase 5 scope |
| 11 | CI provider (GitHub Actions vs other) | ADR-0001 | Phase 0 |
| 12 | Deployment target (VPS, Docker Compose layout) | README + ADR | Phase 9 |
| 13 | Backup strategy (pg_dump cron) | Ops doc | Phase 9 |
| 14 | RecurrenceGenerator in MVP? | Product | Phase 5 |
| 15 | `processing_started_at` vs `last_attempt_at` for stuck recovery | DATA_MODEL patch | Phase 5 |
| 16 | `reminder_skipped` TaskEvent enum needed? | DATA_MODEL / product | Phase 5 |

---

## 15. IMPLEMENTATION_PLAN Acceptance Criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | `docs/IMPLEMENTATION_PLAN.md` updated to v0.2 | Draft |
| 2 | Phases 0–9 defined | Draft |
| 3 | Dependencies defined | Draft |
| 4 | Do-not-implement-yet list defined | Draft |
| 5 | DATA_MODEL follow-ups defined | Draft |
| 6 | Testing/CI plan mapped to RG gates | Draft |
| 7 | Codex review gates defined | Draft |
| 8 | Cursor task sequence defined (25 stages) | Needs review |
| 9 | STAGE 4.1 and STAGE 4.2 fully specified | Needs review |
| 10 | Pre-skeleton prerequisites split into explicit decisions | Needs review |
| 11 | Risk register included | Draft |
| 12 | Skeleton DoD defined | Draft |
| 13 | Backend MVP DoD defined | Draft |
| 14 | Open questions listed | Draft |
| 15 | No code/tests/migrations created | Draft |
| 16 | Ready for Stage 0.1 | Ready for Stage 0.1 |
| 17 | Accepted after second Codex implementation review | Pending final review |

---

## Appendix A: Contract Document Index

| Document | Implementation relevance |
| --- | --- |
| `TZ_MVP.md` | Product scope, user roles, scenarios |
| `ARCHITECTURE_BASELINE.md` | Layers, monorepo structure, deployment |
| `DATA_MODEL.md` | Schema, enums, indexes, retention |
| `ACCESS_CONTROL.md` | ACL predicates, 404/403, endpoint matrix |
| `API_CONTRACTS.md` | HTTP contracts, DTO, mass assignment |
| `AI_CONTRACTS.md` | Classify schema, provider rules, voice |
| `TESTING_STRATEGY.md` | ACL/API/AI/Worker test matrices, RG-01..RG-36 |
| `WORKER_REMINDER_POLICY.md` | Worker jobs, idempotency, WRK-T01..T23 |
| `CURSOR_SYSTEM_PROMPT.md` | Cursor coding constraints |
| `CODEX_REVIEW_PROMPT.md` | Review format and rejection criteria |

---

## Appendix B: First Coding Milestone

**First coding milestone** = completion of **STAGE 0.4** (Phase 0).

Deliverable: runnable monorepo with CI green, no business logic, ADR-0001 published.

**Second milestone** = **STAGE 1.3** (Phase 1): migrations + EventService + seed.

No public Task API until **STAGE 2.2** ACL foundation passes RG-01 subset.
