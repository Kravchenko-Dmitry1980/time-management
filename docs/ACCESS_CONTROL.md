# ACCESS_CONTROL.md

Версия: 0.4  
Статус: Draft — cross-doc consistency patch after AI_CONTRACTS v0.2 review  
Проект: AI Task Assistant / Time Management System  
Локальный путь: `C:\Dima\Projects\CURSOR\time-management`  
Связанные документы: `docs/TZ_MVP.md`, `docs/ARCHITECTURE_BASELINE.md`, `docs/DATA_MODEL.md`, `docs/AI_CONTRACTS.md`

---

## 1. Назначение документа

Данный документ определяет **правила доступа MVP** для AI Task Assistant — единый источник истины для авторизации на backend.

| Аспект | Описание |
| --- | --- |
| **Что определяет** | Visibility rules, permission model, endpoint matrix, field filtering, policy contracts, тесты IDOR/BOLA/privacy |
| **Основа** | `ARCHITECTURE_BASELINE.md` §9, §14, §19; `DATA_MODEL.md` tables, invariants, privacy constraints |
| **Для кого** | Backend-разработчик, Cursor (`AccessControlService`), Codex (security review), QA (ACL test suite) |
| **Что НЕ является** | Исполняемым кодом, ORM schema, миграцией |

Документ является основой для:
- реализации `packages/core/access` (или `packages/auth/acl`);
- endpoint authorization в API layer;
- reusable SQL/ORM predicates;
- integration-тестов `tests/access-control/`.

---

## 2. Access Control Principles

1. **Deny by default** — доступ разрешён только при явном совпадении policy; отсутствие правила = запрет.
2. **Backend-only authorization** — UI может скрывать кнопки, но это не считается защитой.
3. **Same predicate for list and get-by-id** — если задача не в list, `GET /:id` возвращает 404 для того же user.
4. **Strict privacy by default** — private tasks недоступны без явного ACL path.
5. **Workspace Owner is not superuser over private content** — Owner управляет системой, но не читает чужие private tasks.
6. **404 for invisible resource** — существование private resource не раскрывается (IDOR protection).
7. **403 for visible but forbidden action** — user видит resource, но action запрещён (например, Guest delete).
8. **Field-level response filtering** — DTO allowlisted per role/share permission.
9. **No private content in analytics** — агрегации без title/description; private counts исключены из shared views (ADR-013).
10. **No private content in notifications** — payload strictly IDs-only; display always via ACL-safe API on demand.
11. **AI receives only accessible context** — classify не получает недоступные spaces/projects/tasks.
12. **Access decisions must be testable** — каждое правило имеет negative test case.
13. **Access checks must be explicit** — не implicit через JOIN без policy; каждый handler вызывает policy function.
14. **ProjectMember does not override private task visibility** — membership never grants access to `visibility = private` tasks owned by others.
15. **TaskShare provenance is part of visibility** — active share row alone is insufficient; `shared_by_user_id` must satisfy provenance rules (§5.1.4).

---

## 3. Actors and Scopes

### 3.1 Actors

| # | Actor | Описание | Типичный контекст |
| --- | --- | --- | --- |
| 1 | **Anonymous** | Неаутентифицированный клиент | Login page |
| 2 | **Authenticated User** | Любой user с valid session | Базовый actor |
| 3 | **Workspace Owner** | `workspace_members.role = owner`, active | Системные настройки, users, spaces |
| 4 | **Workspace Admin** | `workspace_members.role = admin`, active | Ограниченное workspace admin |
| 5 | **Space Owner/Admin** | `space_members.role IN (owner, admin)`, active | Управление space и members |
| 6 | **Space Member** | `space_members.role = member`, active | CRUD в space per policy |
| 7 | **Project Owner/Admin** | `project_members.role IN (owner, admin)`, active | Управление project |
| 8 | **Project Member** | `project_members.role = member`, active | **Non-private** задачи проекта only |
| 9 | **Task Owner** | `task.owner_id = user.id` | Полный контроль над task (кроме system constraints) |
| 10 | **Task Assignee** | `task.assignee_id = user.id` | Выполнение, комментарии |
| 11 | **Task Creator** | `task.created_by = user.id` | Видимость; edit per space policy |
| 12 | **TaskShare Guest** | active `task_shares` с permission read/comment/complete | Одна задача, ограниченные actions |
| 13 | **System Worker** | `apps/worker` process | Reminders, recurrence, cleanup — без content leakage |
| 14 | **AI Service** | `packages/ai` internal | Classify/transcribe — только accessible context |
| 15 | **Technical Audit Viewer** | Workspace Owner в tech audit mode | Metadata/redacted only, no raw private content |

### 3.2 Scopes

| Scope | Граница | Ключевые таблицы |
| --- | --- | --- |
| **workspace** | Одна self-hosted инсталляция | `workspaces`, `workspace_members` |
| **space** | Логическая область задач | `spaces`, `space_members` |
| **project** | Подмножество space с project ACL | `projects`, `project_members` |
| **task** | Единица работы | `tasks`, `task_shares` |
| **comment** | Комментарий к task | `comments` |
| **reminder** | Напоминание | `reminders`, `reminder_deliveries` |
| **analytics** | Агрегаты | Производный от task ACL + privacy filters |
| **AI log** | AI audit | `ai_classification_logs` |
| **voice capture** | Голосовой ввод | `voice_captures` |
| **notification** | In-app уведомление | `notifications` |
| **auth audit** | Auth events | `auth_audit_events` |

### 3.3 Membership Types (MVP clarification)

| Type | Definition | Space membership required? | MVP |
| --- | --- | --- | --- |
| **Workspace Member** | `workspace_members.status = active` | — | Required for all users |
| **Space Member** | `space_members.status = active` | — | Required for space-wide access |
| **Project Member** | `project_members.status = active` | **Yes** (ACCESS-ADR-001) | Project tasks only |
| **TaskShare Guest** | active `task_shares` | **No** | Single task only |

---

## 4. Resource Model

| Resource | Owner | Scope | Who can view | Who can mutate | Privacy notes |
| --- | --- | --- | --- | --- | --- |
| **User** | Self | workspace | Self; Workspace Owner/Admin (directory) | Self (profile); Owner (manage) | `password_hash` never exposed |
| **UserSettings** | Self | user | Self only | Self only | Owner admin mode: no sensitive prefs |
| **Workspace** | `owner_id` | workspace | All workspace members | Workspace Owner | settings: no secrets |
| **WorkspaceMember** | workspace | workspace | Members; Owner/Admin | Owner/Admin | — |
| **Space** | `created_by` / space admin | workspace | Active SpaceMembers; Owner (non-private) | Space Owner/Admin; Workspace Owner | `type=private`: per-user convention |
| **SpaceMember** | space | space | Space members; managers | Space Owner/Admin | Only `status=active` for ACL |
| **Project** | `owner_id` | space | Project members; space admins; space members (if open policy) | Project Owner/Admin | ProjectMember requires space membership (ADR-001) |
| **ProjectMember** | project | project | Project members; managers | Project Owner/Admin | Requires space membership; **no** access to private tasks via membership alone |
| **Task** | `owner_id` | space | See §5.1 | Owner; assignee; space/project admin; share per permission | `visibility=private` blocks ProjectMember/SpaceMember bypass |
| **TaskShare** | `shared_by_user_id` | task | Sharer; sharee (if active) | Owner/manage; revoke by sharer | Revoked/expired = no access |
| **Comment** | `author_id` | task | Task viewers | Task commenters | Body not in events/analytics/notifications |
| **Reminder** | `user_id` (recipient) | task | Recipient; task owner (creator) | User with `canEditTask` | Per-user delivery |
| **ReminderDelivery** | system | reminder | Worker; recipient (status only) | Worker only | No task content in errors |
| **RecurrenceRule** | template task owner | task | Task viewers with edit | Task editors | Worker: valid lifecycle states only |
| **TaskEvent** | system | task | Task viewers | Append-only via Domain | No comment body in metadata |
| **AIClassificationLog** | `user_id` | task/user | Task owner (full); user (own pre-task); tech audit (redacted) | System/AI only | Raw encrypted: owner + retention |
| **VoiceCapture** | `user_id` | user | Capture owner (full transcript); tech audit (redacted) | Owner | Task viewers ≠ transcript access |
| **Notification** | `user_id` | user | Recipient only | Recipient (read/delete) | Payload: IDs only |
| **AuthAuditEvent** | system | workspace | Workspace Owner (tech) | Append-only | No passwords/tokens |
| **Goal** | `owner_id` | workspace | Owner; workspace members (future) | Owner | UI outside MVP |

---

## 5. Core Visibility Rules

### 5.1 Task visibility rule

Правило **двухуровневое**: сначала проверяется private override; только для non-private tasks применяется общий ACL.

#### 5.1.0 Private override (приоритет)

Если `task.visibility = 'private'` **ИЛИ** задача находится в private/system personal scope (`spaces.type IN ('private', 'system')` и user не является owner/creator/assignee по convention), задача видна **только** если:

1. `task.owner_id = user.id`
2. `task.assignee_id = user.id`
3. `task.created_by = user.id`
4. active `TaskShare` с валидным **provenance** (§5.1.4) — share не revoked, не expired, `shared_by_user_id` удовлетворяет правилам

**Заблокировано для private task (даже внутри project):**

- `ProjectMember` — **не даёт** доступ автоматически
- `SpaceMember` — **не даёт** доступ к чужой private task
- `SpaceAdmin` — **не даёт** доступ к чужой private task
- `WorkspaceOwner` / `WorkspaceAdmin` — **не дают** доступ (strict privacy mode)

> **BLOCKER fix:** Private task inside project **не становится** видимой ProjectMember. ProjectMember видит задачи проекта только при `task.visibility IN ('project', 'space', 'shared')`.

#### 5.1.1 General rule (non-private tasks)

Для задач, **не попадающих** под private override (`task.visibility != 'private'` и не private/system personal scope для чужого user):

```
task.deleted_at IS NULL
AND (
  task.owner_id = user.id
  OR task.assignee_id = user.id
  OR task.created_by = user.id
  OR hasActiveSpaceAccess(user, task)
  OR hasActiveProjectAccess(user, task)
  OR hasActiveTaskShare(user, task.id)
  OR hasScopedAdminAccess(user, task)
)
```

#### 5.1.2 `hasActiveSpaceAccess`

Применяется **только** если `task.visibility != 'private'`.

- `space_members` WHERE `space_id = task.space_id` AND `user_id = user.id` AND `status = 'active'`
- **И** space type / visibility не блокируют доступ:

| Condition | Rule |
| --- | --- |
| `space.type = private` | Только owner/creator/assignee/share — space membership alone **недостаточен** для чужих tasks |
| `space.type = system` (Inbox) | Только owner/creator/assignee/share до классификации |
| `task.project_id IS NOT NULL` | Space membership **не даёт** доступ, если project restricted — см. `hasActiveProjectAccess` |

`hasActiveSpaceAccess` **не обходит** project restriction и **не даёт** доступ к `visibility = private`.

#### 5.1.3 `hasActiveProjectAccess`

**ProjectMember не получает доступ к private task автоматически.**

`hasActiveProjectAccess(user, task) = true` **только если**:

1. `task.project_id IS NOT NULL`
2. `task.visibility != 'private'` (и `task.visibility IN ('project', 'space', 'shared')`)
3. `task.deleted_at IS NULL`
4. `project.deleted_at IS NULL`
5. user является active `ProjectMember` для `task.project_id`
6. `project_members.status = 'active'`
7. user имеет active `SpaceMember` для `project.space_id` (ACCESS-ADR-001)
8. `tasks.space_id = projects.space_id` (domain invariant)

Private task внутри project **остаётся невидимой** для ProjectMember. Доступ возможен только через owner/assignee/creator/TaskShare paths из §5.1.0.

#### 5.1.4 `hasActiveTaskShare`

Базовые условия:

```sql
task_shares ts
WHERE ts.task_id = task.id
  AND ts.shared_with_user_id = user.id
  AND ts.status = 'active'
  AND ts.revoked_at IS NULL
  AND (ts.expires_at IS NULL OR ts.expires_at > now())
```

**Provenance rule** (обязательно, вместе с базовыми условиями):

Для **private task** active TaskShare валиден только если:

- `ts.shared_by_user_id = task.owner_id` (строгое MVP-правило)

Для **non-private task** active TaskShare валиден если:

- `ts.shared_by_user_id = task.owner_id`, **или**
- `task_share_created_by_allowed_manager(ts.shared_by_user_id, task.id)` — пользователь имел `canShareTask` **на момент создания** share (см. §9.1 `canShareTask`)

Альтернативные пути (для полноты модели, не дублируют MVP strict rule):

- share создан system action, прошедший `canShareTask` и записавший TaskEvent / audit metadata

**Важно:** `AccessControlService` **не должен** слепо доверять active `task_shares` row. Для private tasks provenance является частью visibility predicate. Invalid/stale row (например, `shared_by_user_id` ≠ owner) **не открывает** задачу.

Дополнительно:

- Revoked share (`status = revoked` OR `revoked_at IS NOT NULL`) → **нет доступа**
- Expired share (`status = expired` OR `expires_at <= now()`) → **нет доступа**
- Share даёт доступ **только к одной задаче**; не открывает project/space
- API создания TaskShare обязан валидировать `canShareTask` at creation time и писать TaskEvent / audit metadata

#### 5.1.5 `hasScopedAdminAccess`

| Role | Scope | Access |
| --- | --- | --- |
| Space Admin | Same `task.space_id` | Tasks in space **except** `visibility = private` чужих users |
| Workspace Owner | Workspace | System management; **не** private tasks других users (strict mode) |
| Workspace Admin | Workspace | Per workspace policy; default: same as Owner for private |

**Критические уточнения:**

- Workspace Owner **не получает** автоматический доступ к private tasks других users.
- **ProjectMember does not override private task visibility** — private task in project → 404 for ProjectMember.
- Project membership **не открывает** другие проекты в том же space.
- TaskShare **не открывает** project metadata или sibling tasks.
- Private task в private space: share возможен **только** от `task.owner_id` или `canShareTask` holder.

### 5.2 Project visibility rule

Пользователь **может видеть** project (`canViewProject = true`), если:

```
project.deleted_at IS NULL
AND (
  project.owner_id = user.id
  OR isActiveProjectMember(user, project.id)
  OR isSpaceAdmin(user, project.space_id)
  OR (isActiveSpaceMember(user, project.space_id) AND projectHasOpenListingPolicy(project))
  OR isWorkspaceOwnerOrAdmin(user, project.workspace_id) AND space.type NOT IN ('private') AND NOT isOtherUserPrivateSpace(space, user)
)
```

**Уточнения:**

- **Project-only access:** ProjectMember видит project metadata + **non-private** tasks в проекте (`visibility IN ('project', 'space', 'shared')`).
- ProjectMember **не видит** Project Y в том же space, если не member.
- **Guest project access (MVP):** только через `ProjectMember.role = guest` **с обязательным space membership** (ACCESS-ADR-001). Внешние гости — только TaskShare.
- Listing policy: MVP default — project list фильтруется по ProjectMember OR space admin OR open space member.

### 5.3 Space visibility rule

Пользователь **может видеть** space (`canViewSpace = true`), если:

```
space.archived_at IS NULL
AND (
  isActiveSpaceMember(user, space.id)
  OR (isWorkspaceOwnerOrAdmin(user, space.workspace_id) AND space.type != 'private' OR isOwnPrivateSpace(space, user))
)
```

**Специальные ограничения:**

| Space type | Rule |
| --- | --- |
| `private` | Convention: один private space per user; видит только owner/creator member |
| `system` (Inbox) | Per-user inbox semantics; tasks visible per task ACL |
| `family`, `work`, etc. | Active SpaceMember required |

Workspace Owner **не видит** private space другого user как содержимое tasks (может видеть space entity в admin directory — см. Open Questions).

### 5.4 Comment visibility rule

- **View:** `canViewTask(user, task)` для parent task.
- **Create:** `canCommentTask(user, task)`:
  - `canEditTask(user, task)` OR
  - TaskShare `permission IN ('comment', 'complete')` OR
  - Space/Project member with comment role
- **Edit/Delete own comment:** author + `canViewTask`; moderators: space/project admin.
- **Soft-deleted comment:** invisible in list; `comment_added` event keeps `comment_id` only.

### 5.5 Reminder visibility rule

| Actor | Access |
| --- | --- |
| Reminder recipient (`reminder.user_id`) | Full reminder |
| Task owner | Own reminders on own tasks |
| User with `canEditTask` | Create/update/delete reminders on task (for self) |
| System Worker | Process delivery; no task title in worker logs |
| TaskShare guest (read/comment/complete) | **Cannot** create reminders (MVP) |
| Read-only task viewer | **Cannot** create reminders |
| Other users | **Deny** |

**Create policy (MVP, synchronized with §9.6):**

Создание reminder требует `canCreateReminder(user, task, reminderUserId)`:

1. `canEditTask(user, task)` AND `reminderUserId = user.id`, **или**
2. `task.owner_id = user.id` AND `reminderUserId = user.id`, **или**
3. `canDelegateTask(user, task)` AND reminder для assignee / allowed user

Read-only viewer и TaskShare guest **не создают** reminders в MVP.

**MVP default:** reminders are **per-user** (`reminder.user_id`).

### 5.6 AIClassificationLog visibility rule

> **Sync with `AI_CONTRACTS.md` v0.2:** `raw_input_encrypted` / `raw_output_encrypted` are internal storage fields. MVP API **never** returns them in any mode.

| Viewer | Mode | API fields returned |
| --- | --- | --- |
| Task owner | `full` | Redacted input/output, confidence, model/provider, accepted/corrected, sanitized errors, metadata — **no** `raw_*_encrypted` |
| Log creator (`user_id`) when `task_id IS NULL` | `own_pre_task` | Same as `full` for own log — **no** `raw_*_encrypted` |
| Task viewer (not owner) | **Deny** | — |
| Technical Audit Viewer | `tech_audit` | `id`, `model_name`, `provider`, `confidence`, `sensitivity_level`, `error_code`, `provider_payload_hash`, `retention_until`, redacted fields — **no** `raw_*_encrypted` |
| Other users | **Deny** | — |

```text
raw_input_encrypted и raw_output_encrypted are internal storage fields.

MVP API never returns raw_*_encrypted in any mode:
- not owner full;
- not own pre-task;
- not tech audit;
- not admin audit.

Owner full API receives only:
- redacted input/output;
- confidence;
- model/provider;
- accepted/corrected flags;
- sanitized errors;
- metadata.

Optional decrypted/raw export endpoint is future and not part of MVP.
```

### 5.7 VoiceCapture visibility rule

| Viewer | Access |
| --- | --- |
| Capture owner (`voice_captures.user_id`) | Full `transcript_text`; audio URL if stored and within retention |
| Linked task viewers | **No automatic** full transcript; may see `task_id` reference only via separate API |
| Technical Audit Viewer | `transcript_text_redacted`, metadata, `stt_confidence`, `status` — no raw audio |
| Raw audio | Owner only, only if `audio_blob_url` exists and before `retention_until`; default policy: not stored |

**Policy:** Task access **не расширяет** voice transcript access. Transcript promotion to task description — explicit user action.

### 5.8 Notification visibility rule

- User видит **только** `notifications WHERE user_id = self`.
- Payload: **IDs-only** — `{ "task_id", "comment_id", "reminder_id", "actor_user_id", "type" }`.
- Display: client **всегда** загружает task/comment через ACL-safe API on demand.
- Creating notification: system stores IDs only; **не** полагается на snapshot title/body.
- **Stale access safety:** даже если recipient имел доступ в момент создания, payload **не хранит** title/body — доступ может быть отозван (revoke share, privacy change).

### 5.9 Analytics visibility rule

```
analytics_tasks = tasks WHERE canViewTask(user, task)
  AND NOT (task.visibility = 'private' AND task.owner_id != user.id)  -- for shared/cross-user views
```

| View type | Rule |
| --- | --- |
| Personal analytics | Full ACL predicate |
| Space analytics | Tasks in space + ACL; exclude other users' private |
| Cross-user / system analytics | Counts/rates only; **no titles**; private tasks excluded if viewer ≠ owner |
| Small group (1–10 users) | Private counts can deanonymize → **exclude** from shared aggregates |

---

## 6. Permission Model

### 6.1 Actions glossary

| Action | Description |
| --- | --- |
| `list` | List collection with ACL filter |
| `read` | Get single resource |
| `create` | Create new resource |
| `update` | Modify fields |
| `delete` | Hard delete (rare) |
| `soft_delete` | Set `deleted_at` |
| `restore` | Clear `deleted_at` |
| `complete` | Mark task done |
| `reschedule` | Change dates |
| `delegate` | Change assignee |
| `comment` | Add/view comments |
| `share` | Create TaskShare |
| `revoke_share` | Revoke TaskShare |
| `manage_members` | Add/remove members |
| `view_analytics` | Analytics endpoints |
| `view_audit` | Auth/AI tech audit |
| `view_raw_ai_log` | Internal raw encrypted AI fields (storage/debug only; **not** MVP API) |
| `view_redacted_ai_log` | Redacted AI log |
| `view_voice_transcript` | Full transcript |
| `view_redacted_voice_metadata` | Redacted voice metadata |

### 6.2 Resource × Action matrix (summary)

| Resource | list | read | create | update | soft_delete | complete | comment | share | manage_members | view_analytics |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| User | Owner/Admin | Self/Owner | Owner | Self/Owner | Owner | — | — | — | Owner | — |
| UserSettings | — | Self | — | Self | — | — | — | — | — | — |
| Space | Member+ | canViewSpace | Owner | canManageSpace | Owner | — | — | — | canManageSpace | filtered |
| Project | ACL | canViewProject | Space member+ | canManageProject | canManageProject | — | — | — | canManageProject | filtered |
| Task | ACL predicate | canViewTask | canCreateInSpace | canEditTask | canDeleteTask | canCompleteTask | canCommentTask | canShareTask | — | derived |
| TaskShare | task managers | parties | canShareTask | revoke | revoke | — | — | — | — | — |
| Comment | task viewers | task viewers | canCommentTask | author | author/admin | — | — | — | — | no body |
| Reminder | self+editors | recipient+ | canEditTask | canEditTask | canEditTask | — | — | — | — | — |
| AIClassificationLog | — | policy mode | AI system | — | — | — | — | — | — | redacted only |
| VoiceCapture | — | owner | self | owner | owner | — | — | — | — | — |
| Notification | self | self | system | self read | self | — | — | — | — | — |
| AuthAuditEvent | Owner tech | Owner tech | system | — | — | — | — | — | — | — |
| Goal | owner (future) | owner | owner | owner | owner | — | — | — | — | — |

---

## 7. Endpoint-Level Access Matrix

**Legend:** Invisible = 404; Forbidden = 403; Auth = 401.

### Auth

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | `POST /api/auth/login` | login | Public | — | 401 bad creds | Rate limit 5/min/IP |
| Auth | `POST /api/auth/logout` | logout | Authenticated | — | 401 | — |
| Auth | `GET /api/auth/me` | read | Authenticated | — | 401 | Returns self profile DTO |

### Users

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| User | `GET /api/users` | list | Workspace Owner/Admin | — | 403 | Directory; no password_hash |
| User | `POST /api/users` | create | Workspace Owner | — | 403 | MVP: password auth required |
| User | `GET /api/users/:id` | read | Self OR Owner/Admin | 404 | 403 | — |
| User | `PATCH /api/users/:id` | update | Self OR Owner/Admin | 404 | 403 | Mass assignment blocked |
| User | `DELETE /api/users/:id` | soft_delete | Workspace Owner | 404 | 403 | Disable/archive user |

### UserSettings

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| UserSettings | `GET /api/user-settings/me` | read | Authenticated self | — | 401 | — |
| UserSettings | `PATCH /api/user-settings/me` | update | Authenticated self | — | 401 | — |
| UserSettings | `GET /api/user-settings/:userId` | read | Self only | 404 | 403 | Owner admin: future limited |

### Spaces

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Space | `GET /api/spaces` | list | Authenticated; ACL filter | 200 `[]` | — | — |
| Space | `POST /api/spaces` | create | Workspace Owner | — | 403 | — |
| Space | `GET /api/spaces/:id` | read | canViewSpace | 404 | — | — |
| Space | `PATCH /api/spaces/:id` | update | canManageSpace | 404 | 403 | — |
| Space | `DELETE /api/spaces/:id` | archive | Workspace Owner / Space Owner | 404 | 403 | archive, not hard delete |
| Space | `GET /api/spaces/:id/members` | list | canViewSpace | 404 | — | — |
| Space | `POST /api/spaces/:id/members` | manage | canManageSpaceMembers | 404 | 403 | — |
| Space | `DELETE /api/spaces/:id/members/:userId` | manage | canManageSpaceMembers | 404 | 403 | status → removed |

### Projects

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Project | `GET /api/projects` | list | Project ACL predicate | 200 `[]` | — | — |
| Project | `POST /api/projects` | create | canCreateInSpace(space) | — | 403 | Validate space membership |
| Project | `GET /api/projects/:id` | read | canViewProject | 404 | — | — |
| Project | `PATCH /api/projects/:id` | update | canManageProject | 404 | 403 | — |
| Project | `DELETE /api/projects/:id` | soft_delete | canManageProject | 404 | 403 | — |
| Project | `GET /api/projects/:id/members` | list | canViewProject OR canManageProject | 404 | 403 | — |
| Project | `POST /api/projects/:id/members` | manage | canManageProjectMembers | 404 | 403 | Requires target space membership |
| Project | `DELETE /api/projects/:id/members/:userId` | manage | canManageProjectMembers | 404 | 403 | — |

### Tasks

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Task | `GET /api/tasks` | list | Task ACL predicate | 200 `[]` | — | Same as dashboard |
| Task | `POST /api/tasks` | create | canCreateTaskInSpace | — | 403 | Validate space_id membership |
| Task | `GET /api/tasks/:id` | read | canViewTask | 404 | — | Field filter per level |
| Task | `PATCH /api/tasks/:id` | update | canEditTask | 404 | 403 | Guest share read-only → 403 |
| Task | `DELETE /api/tasks/:id` | soft_delete | canDeleteTask | 404 | 403 | — |
| Task | `POST /api/tasks/:id/complete` | complete | canCompleteTask | 404 | 403 | Share complete OK |
| Task | `POST /api/tasks/:id/reschedule` | reschedule | canRescheduleTask | 404 | 403 | Requires edit, not share-read |
| Task | `POST /api/tasks/:id/delegate` | delegate | canDelegateTask | 404 | 403 | — |

### TaskShare

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| TaskShare | `GET /api/tasks/:id/shares` | list | canShareTask OR task owner | 404 | 403 | — |
| TaskShare | `POST /api/tasks/:id/shares` | share | canShareTask | 404 | 403 | Private: owner only |
| TaskShare | `PATCH /api/task-shares/:id` | revoke_share | canRevokeTaskShare | 404 | 403 | Sets revoked_at/by |
| TaskShare | `DELETE /api/task-shares/:id` | revoke_share | canRevokeTaskShare | 404 | 403 | Alias revoke |

### Comments

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Comment | `GET /api/tasks/:id/comments` | list | canViewTask | 404 | — | — |
| Comment | `POST /api/tasks/:id/comments` | comment | canCommentTask | 404 | 403 | — |
| Comment | `PATCH /api/comments/:id` | update | canEditComment | 404 | 403 | — |
| Comment | `DELETE /api/comments/:id` | soft_delete | canDeleteComment | 404 | 403 | — |

### Reminders

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Reminder | `GET /api/reminders` | list | Self reminders + editable tasks | 200 `[]` | — | — |
| Reminder | `POST /api/reminders` | create | canCreateReminder | 404 | 403 | — |
| Reminder | `PATCH /api/reminders/:id` | update | canEditReminder | 404 | 403 | — |
| Reminder | `DELETE /api/reminders/:id` | delete | canDeleteReminder | 404 | 403 | — |

### Dashboards

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `GET /api/dashboard/today` | read | Task ACL predicate | 200 empty blocks | — | User timezone |
| Dashboard | `GET /api/dashboard/evening-review` | read | Task ACL + events | 200 empty | — | — |
| Dashboard | `GET /api/dashboard/week` | read | Task ACL predicate | 200 empty | — | — |

### Analytics

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Analytics | `GET /api/analytics/daily` | view_analytics | Analytics predicate | — | 403 wrong scope | No titles |
| Analytics | `GET /api/analytics/weekly` | view_analytics | Analytics predicate | — | 403 | — |
| Analytics | `GET /api/analytics/eisenhower` | view_analytics | Analytics predicate | — | 403 | — |
| Analytics | `GET /api/analytics/categories` | view_analytics | Analytics predicate | — | 403 | — |
| Analytics | `GET /api/analytics/users` | view_analytics | Owner/Admin OR self-only counts | — | 403 | Cross-user: counts only |
| Analytics | `GET /api/analytics/created-vs-completed` | view_analytics | Analytics predicate | — | 403 | Event-based |

### AI

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AI | `POST /api/ai/classify-task` | create | Authenticated | — | 401 | Accessible context only |
| AI | `POST /api/ai/transcribe-task` | create | Authenticated + upload valid | — | 400/401 | — |
| AI | `POST /api/ai/reclassify-task` | update | canEditTask(task) | 404 | 403 | — |
| AI | `GET /api/ai/logs/:id` | read | canViewAIClassificationLog | 404 | 403 | Mode: full/redacted |

### Voice

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Voice | `POST /api/voice-captures` | create | Authenticated self | — | 401 | — |
| Voice | `GET /api/voice-captures/:id` | read | canViewVoiceCapture(user, capture, mode) | 404 | 403 | Full transcript: owner mode only |
| Voice | `DELETE /api/voice-captures/:id` | delete | owner | 404 | 403 | Purge request |

### Notifications

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Notification | `GET /api/notifications` | list | Self only | 200 `[]` | 401 | — |
| Notification | `PATCH /api/notifications/:id/read` | update | canViewNotification | 404 | 403 | — |
| Notification | `DELETE /api/notifications/:id` | delete | canViewNotification | 404 | 403 | — |

### Audit

| Resource | Endpoint | Action | Required Policy | Invisible | Forbidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Audit | `GET /api/audit/auth` | view_audit | canViewAuthAuditEvent | — | 403 | Redacted metadata |
| Audit | `GET /api/audit/ai` | view_audit | canViewAIClassificationLog (redacted mode) | — | 403 | Redacted only |
| TaskEvent | `GET /api/tasks/:id/events` | read | canViewTaskEvent | 404 | — | No comment bodies |

---

## 8. Field-Level Response Filtering

### 8.1 Task response levels

| Field | task_summary | task_detail | task_guest_read | task_guest_complete | task_admin_metadata | task_analytics_aggregate |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| id | ✅ | ✅ | ✅ | ✅ | ✅ | count only |
| title | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| description | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| due_at | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| scheduled_for | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| category | ✅ | ✅ | ✅ | ✅ | id only | id only |
| tags | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| assignee | id+name | ✅ | id+name | id+name | id only | ❌ |
| owner | id+name | ✅ | ❌ | ❌ | id only | ❌ |
| ai_confidence | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ aggregate |
| ai_classification_status | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| importance/urgency/quadrant | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ aggregate |
| visibility | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| source | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| deleted_at | ❌ | admin only | ❌ | ❌ | ✅ | ❌ |
| workspace_id | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| space_id | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| project_id | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| internal metadata | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**`TaskSummaryResponse` rule (synced with `API_CONTRACTS.md` §9.1):**

- `space_id` and `project_id` **may** appear in `task_summary` only for authenticated users who `canViewTask` through normal owner/member/editor paths.
- `workspace_id`, `ai_confidence`, `ai_classification_status`, `source`, `deleted_at` — **never** in `task_summary`.
- Guest DTOs (`task_guest_read`, `task_guest_complete`) — **no** `space_id` / `project_id` unless explicitly required and safe (MVP: excluded).
- `task_analytics_aggregate` — counts/buckets only; **no** task-level `space_id` / `project_id` as private content.

**Guest DTO rules (`task_guest_read`, `task_guest_complete`):**

Guest DTO **must not include:**

- owner full profile (только assignee id+name если нужно для UX)
- internal metadata
- `ai_confidence`
- `ai_classification_status`
- `workspace_id` / `space_id` (unless explicitly required and safe)
- `source`
- `deleted_at`

`task_guest_complete` имеет **те же read fields**, что `task_guest_read`, плюс permission выполнить `complete`. **Не даёт** edit, reschedule, delete, delegate.

### 8.2 Comment response levels

| Level | body | author | timestamps |
| --- | :---: | :---: | :---: |
| comment owner/full | ✅ | ✅ | ✅ |
| task member/full | ✅ | ✅ | ✅ |
| guest comment/read | ✅ if canComment | ✅ | ✅ |
| notification reference | ❌ | id only | ❌ |
| analytics | ❌ | ❌ | count only |

### 8.3 AI log response levels

> **Authoritative:** `AI_CONTRACTS.md` v0.2 §13.2.1 — raw encrypted fields are internal storage only.

| Level | API fields |
| --- | --- |
| task owner full | Redacted input/output, confidence, model/provider, accepted/corrected, errors, metadata — **no** raw encrypted |
| user own pre-task log | Same as owner full for `user_id = self` AND `task_id IS NULL` — **no** raw encrypted |
| tech audit redacted | metadata, redacted text/json, confidence, errors, hash — **no** raw |
| forbidden in all MVP API modes | `raw_input_encrypted`, `raw_output_encrypted` |

### 8.4 Voice capture response levels

| Level | transcript | audio | metadata |
| --- | :---: | :---: | :---: |
| owner full | `transcript_text` | URL if stored | ✅ |
| linked task viewer | ❌ | ❌ | task_id only via task API |
| tech audit redacted | `transcript_text_redacted` | ❌ | stt_provider, confidence, status |
| raw audio | owner only, pre-retention | — | — |

### 8.5 Notification payload policy

**Notification payload must be IDs-only.**

**Allowed in payload:**
```json
{
  "task_id": "uuid",
  "comment_id": "uuid",
  "reminder_id": "uuid",
  "actor_user_id": "uuid",
  "action": "task_assigned"
}
```

**Forbidden in payload:**

- task title
- private task title
- task description
- comment body
- raw AI text
- transcript
- any user-private content

**Display rule:** Display data **must always** be loaded on demand through ACL-safe API (`GET /api/tasks/:id`, etc.).

**Stale access safety:** Even if recipient had access at notification creation time, payload **must not** store title/body because access can be revoked later (TaskShare revoke, privacy change, soft delete). Clicking notification fetches current ACL state — may return 404.

---

## 9. Policy Functions

Контракты для `packages/core/access` — без реализации.

### 9.1 Task policies

#### `canViewTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Inputs | `User`, `Task` (+ joined space/project/share rows) |
| Tables | `tasks`, `space_members`, `project_members`, `task_shares`, `spaces` |
| Returns | `true` if §5.1.0 private override OR §5.1.1 non-private rule satisfied |
| Deny | Invisible → API 404 |
| Edge cases | deleted task; private space; expired share; **private task inside project for ProjectMember** → 404 |

#### `canCreateTaskInSpace(user, space): boolean`

| Aspect | Detail |
| --- | --- |
| Tables | `space_members`, `spaces`, `workspace_members` |
| Returns | Active space member OR workspace owner creating in allowed space |
| Deny | 403 for non-members |
| Edge cases | Guest cannot create; system inbox: all members |

#### `canEditTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Owner; space/project admin; assignee (if policy); member with edit — **not** TaskShare read-only |
| Deny | 404 invisible; 403 share read/complete-only |
| Edge cases | Guest complete ≠ edit |

#### `canDeleteTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Owner; space admin; project admin — **not** assignee by default; **not** guest |
| Deny | 403 |

#### `canCompleteTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | canEditTask OR assignee OR TaskShare `permission = complete` |
| Deny | 403 for share read/comment only |

#### `canRescheduleTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Same as canEditTask (share complete **not** sufficient) |
| Deny | 403 |

#### `canDelegateTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | canEditTask AND assignee change allowed in space |
| Deny | 403; validate target user is space/project member |

#### `canCommentTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | canEditTask OR TaskShare permission IN (comment, complete) |
| Deny | 403 for share read |

#### `canShareTask(user, task): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `task.owner_id = user` OR space/project admin OR manage permission |
| Private task | **Owner only** may share; `shared_by_user_id` must be `task.owner_id` at read time |
| Deny | 403 |
| Creation | Must validate `canShareTask`; record TaskEvent; provenance checked on read (§5.1.4, §10.1) |

#### `canRevokeTaskShare(user, taskShare): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `shared_by_user_id = user` OR task owner OR admin |
| Effect | `status = revoked`, `revoked_at`, `revoked_by` |

### 9.2 Project policies

#### `canViewProject(user, project): boolean`

§5.2 predicate; 404 if false.

#### `canManageProject(user, project): boolean`

Owner; project admin; space admin.

#### `canManageProjectMembers(user, project): boolean`

canManageProject; target user **must** be active space member (ACCESS-ADR-001).

### 9.3 Space policies

#### `canViewSpace(user, space): boolean`

§5.3; 404 if false.

#### `canManageSpace(user, space): boolean`

Space owner/admin; workspace owner.

#### `canManageSpaceMembers(user, space): boolean`

canManageSpace.

### 9.4 Analytics and sensitive resources

#### `canViewAnalytics(user, scope): boolean`

Authenticated; scope (space/workspace) accessible; cross-user views: Owner/Admin only.

#### `canViewAIClassificationLog(user, log, mode): 'full' | 'redacted' | 'deny'`

| mode | Rule |
| --- | --- |
| `full` | Task owner OR (log.user_id = user AND task_id IS NULL) — returns redacted API fields only |
| `redacted` | Workspace Owner tech audit |
| `deny` | default |

**API filter:** response DTO **never** includes `raw_input_encrypted` / `raw_output_encrypted` in MVP (any mode). Internal storage may retain raw fields when `AI_STORE_RAW_LOGS=true`; see `AI_CONTRACTS.md` v0.2.

#### `canViewVoiceCapture(user, capture, mode): 'full' | 'redacted' | 'deny'`

| mode | Rule |
| --- | --- |
| `full` | capture.user_id = user |
| `redacted` | tech audit |
| `deny` | task viewers without ownership |

#### `canViewNotification(user, notification): boolean`

`notification.user_id = user.id`

### 9.5 Comment policies

#### `canViewComment(user, comment): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `canViewTask(user, comment.task)` |
| Deny | 404 if task invisible |
| Body | Never returned without `canViewComment` |

#### `canEditComment(user, comment): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `comment.author_id = user.id` OR moderator/admin with task access |
| Deny | 403 |

#### `canDeleteComment(user, comment): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `comment.author_id = user.id` OR space/project admin with task access |
| Deny | 403 |

### 9.6 Reminder policies

#### `canCreateReminder(user, task, reminderUserId): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | (`canEditTask(user, task)` AND `reminderUserId = user.id`) OR (`task.owner_id = user.id` AND `reminderUserId = user.id`) OR (`canDelegateTask(user, task)` AND reminder for assignee/allowed user) |
| Deny | 404 invisible task; **403** for TaskShare guest / read-only viewer |
| Note | Reminder must not embed task title; delivery uses IDs. **Not** `canViewTask` alone. |

#### `canViewReminder(user, reminder): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `reminder.user_id = user.id` OR (`canEditTask(user, reminder.task)` AND task owner context) |
| Deny | 404 |

#### `canEditReminder(user, reminder): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `canEditTask(user, reminder.task)` OR (`reminder.user_id = user.id` AND owns reminder on own task) |
| Deny | 403 |

#### `canDeleteReminder(user, reminder): boolean`

Same as `canEditReminder`.

### 9.7 TaskEvent policies

#### `canViewTaskEvent(user, taskEvent): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | `canViewTask(user, taskEvent.task)` |
| Response filter | metadata filtered; no comment body; no raw AI prompt |
| Deny | 404 |

### 9.8 Auth audit policies

#### `canViewAuthAuditEvent(user, event): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Workspace Owner tech audit only |
| Fields | Redacted metadata only; no password/token/session secret |
| Deny | 403 |

### 9.9 User management policies

#### `canManageUser(actor, targetUser): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Workspace Owner; Workspace Admin (limited) |
| Deny | 403 |

#### `canViewUserDirectory(actor, workspace): boolean`

| Aspect | Detail |
| --- | --- |
| Returns | Workspace Owner/Admin |
| Fields | email, name, status allowed; **no** private task content |
| Deny | 403 |

---

## 10. ACL Predicate Strategy

> **Sync requirement:** §10 predicates **must match** §5 visibility rules. Helper functions (`project_is_restricted`, `hasScopedAdminAccess`, `workspace_owner_or_admin`, `is_private_personal_scope`, `task_share_created_by_allowed_manager`) are defined in this document and **must be implemented** in `AccessControlService` with identical semantics.

### 10.1 Task ACL predicate (SQL-like)

Соответствует §5.1.0 (private override) + §5.1.1 (non-private general rule).

```sql
-- Reusable WHERE clause for list/get consistency
WHERE tasks.deleted_at IS NULL
AND (
  -- §5.1.0 Private override paths (always evaluated)
  tasks.owner_id = :userId
  OR tasks.assignee_id = :userId
  OR tasks.created_by = :userId
  OR EXISTS (
    SELECT 1
    FROM task_shares ts
    WHERE ts.task_id = tasks.id
      AND ts.shared_with_user_id = :userId
      AND ts.status = 'active'
      AND ts.revoked_at IS NULL
      AND (ts.expires_at IS NULL OR ts.expires_at > now())
      AND (
        -- Strict private task provenance (§5.1.4):
        (tasks.visibility = 'private' AND ts.shared_by_user_id = tasks.owner_id)
        -- Non-private task share provenance:
        OR (
          tasks.visibility != 'private'
          AND (
            ts.shared_by_user_id = tasks.owner_id
            OR task_share_created_by_allowed_manager(ts.shared_by_user_id, tasks.id)
          )
        )
      )
  )
  -- §5.1.1 Non-private membership/admin paths
  OR (
    tasks.visibility != 'private'
    AND NOT is_private_personal_scope(tasks, :userId)  -- defined in ACCESS_CONTROL.md
    AND (
      -- Space member branch (§5.1.2)
      EXISTS (
        SELECT 1 FROM space_members sm
        JOIN spaces s ON s.id = sm.space_id
        WHERE sm.space_id = tasks.space_id
          AND sm.user_id = :userId
          AND sm.status = 'active'
          AND NOT (s.type = 'private' AND tasks.owner_id != :userId
                   AND tasks.assignee_id != :userId AND tasks.created_by != :userId)
          AND NOT (s.type = 'system' AND tasks.owner_id != :userId
                   AND tasks.assignee_id != :userId AND tasks.created_by != :userId)
          AND (tasks.project_id IS NULL OR NOT project_is_restricted(tasks.project_id, :userId))
      )
      -- Project member branch (§5.1.3) — BLOCKER fix: visibility != private
      OR (
        tasks.visibility != 'private'
        AND tasks.project_id IS NOT NULL
        AND tasks.visibility IN ('project', 'space', 'shared')
        AND EXISTS (
          SELECT 1
          FROM project_members pm
          JOIN projects p ON p.id = pm.project_id
          JOIN space_members sm ON sm.space_id = p.space_id
          WHERE pm.project_id = tasks.project_id
            AND pm.user_id = :userId
            AND pm.status = 'active'
            AND p.deleted_at IS NULL
            AND p.space_id = tasks.space_id
            AND sm.user_id = :userId
            AND sm.status = 'active'
        )
      )
      -- Scoped admin branch (§5.1.5)
      OR has_scoped_admin_access(tasks, :userId)  -- defined in ACCESS_CONTROL.md
    )
  )
)
```

**Implementation notes:**

- `is_private_personal_scope(task, userId)` — true when `spaces.type IN ('private','system')` and user is not owner/creator/assignee.
- `project_is_restricted(project_id, userId)` — project has ProjectMember roster and user lacks membership; blocks space-wide bypass.
- `has_scoped_admin_access(task, userId)` — Space Admin / Workspace Admin for **non-private** tasks in scope; **never** grants private task access to non-parties.
- `task_share_created_by_allowed_manager(sharedByUserId, taskId)` — named policy/helper in `AccessControlService`. Проверяет, что `shared_by_user_id` был валидным `canShareTask` actor **на момент создания** share (через audit/TaskEvent metadata). **Не** вычисляется только по текущему состоянию, если право могло быть отозвано. API создания TaskShare обязан валидировать `canShareTask` at creation time.
- `canViewTask()` in application layer **must** implement the same logic; SQL predicate is for repository list queries.

### 10.2 Project ACL predicate

Соответствует §5.2.

```sql
WHERE projects.deleted_at IS NULL
AND (
  projects.owner_id = :userId
  OR EXISTS (
    SELECT 1 FROM project_members pm
    JOIN space_members sm ON sm.space_id = projects.space_id
    WHERE pm.project_id = projects.id
      AND pm.user_id = :userId
      AND pm.status = 'active'
      AND sm.user_id = :userId
      AND sm.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM space_members sm
    WHERE sm.space_id = projects.space_id
      AND sm.user_id = :userId
      AND sm.role IN ('owner', 'admin')
      AND sm.status = 'active'
  )
  OR (
    workspace_owner_or_admin(:userId, projects.workspace_id)
    AND NOT is_other_user_private_space(projects.space_id, :userId)
  )
)
```

`workspace_owner_or_admin` and `is_other_user_private_space` — defined in ACCESS_CONTROL.md; must be implemented in AccessControlService.

### 10.3 Space ACL predicate

Соответствует §5.3.

```sql
WHERE spaces.archived_at IS NULL
AND (
  EXISTS (
    SELECT 1 FROM space_members sm
    WHERE sm.space_id = spaces.id
      AND sm.user_id = :userId
      AND sm.status = 'active'
  )
  OR (
    workspace_owner_or_admin(:userId, spaces.workspace_id)
    AND (spaces.type != 'private' OR is_own_private_space(spaces.id, :userId))
  )
)
```

`is_own_private_space` — defined in ACCESS_CONTROL.md; must be implemented in AccessControlService.

### 10.4 Analytics predicate

```sql
-- Derived from task ACL + privacy filter
SELECT ... FROM tasks
WHERE <task_acl_predicate>
AND NOT (
  tasks.visibility = 'private'
  AND tasks.owner_id != :userId
  AND :viewMode IN ('shared', 'cross_user', 'system')
)
```

---

## 11. Special Cases and Edge Cases

| # | Case | Behavior |
| --- | --- | --- |
| 1 | Workspace Owner vs private task | **404** — strict privacy |
| 2 | Space Admin vs private task outside scope | **404** |
| 3 | ProjectMember sees Project X only | List/get filtered; **private tasks in project excluded** |
| 4 | TaskShare Guest | One task only via share predicate |
| 5 | Revoked TaskShare | `status=revoked` → **404** immediately |
| 6 | Expired TaskShare | `expires_at <= now()` or `status=expired` → **404** |
| 7 | Guest read | Cannot comment → **403** |
| 8 | Guest comment | Can comment; cannot complete unless `permission=complete` |
| 9 | Guest complete | Can complete; cannot edit/delete → **403** |
| 10 | Comment in notification | Payload: `comment_id` only |
| 11 | Analytics private counts | Excluded from shared views |
| 12 | AI classify context | Only accessible spaces/projects list |
| 13 | Voice transcript | Not auto-visible to task viewers |
| 14 | Reminder create | Requires `canEditTask` or owner-self policy |
| 15 | Deleted tasks | `deleted_at IS NOT NULL` → invisible (404) |
| 16 | System worker | Processes by ID; notification text loaded ACL-safe |
| 17 | Failed login audit | `user_id` nullable |
| 18 | Project-only guest without space membership | **NOT allowed MVP** — ACCESS-ADR-001 |
| 19 | Private task inside project | ProjectMember GET → **404**; owner/assignee/share only |

### ACCESS-ADR-001: Project-only guest without space membership

| | |
| --- | --- |
| **Decision** | Project-only guest **without** space membership is **NOT allowed** for MVP |
| **Reason** | Упрощает ACL; предотвращает orphan project access; внешние партнёры используют TaskShare |
| **Rule** | `canManageProjectMembers` requires target `user_id` has active `space_members` for `project.space_id` |
| **External guests** | TaskShare only — read/comment/complete on single task |
| **Consequences** | Seed `work_partner` must be space member of «Работа» AND ProjectMember; external guests use TaskShare only |
| **Precedence** | **ACCESS-ADR-001 overrides** open question DM-R08 / §16 in `DATA_MODEL.md`. Before migrations, `DATA_MODEL.md` should be patched or annotated to align with this ADR. |

### MVP Auth Policy: password_hash

| Rule | Detail |
| --- | --- |
| MVP auth | Email + password only; external auth **out of MVP** |
| Active user | `user.status = active` AND password auth → `password_hash IS NOT NULL` required |
| Invited user | `status = invited`; `password_hash` set on activation |
| Validation | Registration/activation rejects active user without hash |
| Future | External auth deferred until ADR session/auth provider |

### recurrence_rules.status (worker note)

`recurrence_rules.status` — text в DATA_MODEL (не enum). Worker/admin jobs обрабатывают только `status = 'active'`; `paused`/`completed` skipped. ACL не применяется к worker internal queries, но worker **не exposes** task content in logs.

---

## 12. 404 vs 403 Rules

| Situation | Response | Reason |
| --- | --- | --- |
| Unauthenticated | **401** | No valid session |
| Resource not found (DB) | **404** | Standard not found |
| Resource exists, user lacks visibility | **404** | IDOR protection — don't confirm existence |
| Resource visible, action forbidden | **403** | User knows resource, lacks permission |
| List endpoint, no accessible items | **200** + `[]` | Not an error |
| Invalid input / malformed JSON | **400** | Bad request |
| Validation error (field-level) | **422** (preferred) or **400** | Per API_CONTRACTS |
| Lifecycle conflict (e.g. revoke twice) | **409** | Conflict |
| Rate limited (login, AI) | **429** | Too many requests |
| TaskShare expired/revoked | **404** | Treated as invisible |
| Soft-deleted task | **404** | Invisible in normal mode |
| Guest PATCH task | **403** | Visible via share, edit forbidden |
| Non-member POST task in space | **403** | Space not visible enough to create |

---

## 13. Security Risks

| # | Risk | Example | Mitigation | Test |
| --- | --- | --- | --- | --- |
| SR-01 | IDOR / BOLA | `GET /api/tasks/{other_uuid}` | canViewTask → 404 | ACL-T01, ACL-T20, **ACL-T25** |
| SR-02 | Mass assignment | PATCH with `owner_id: other` | DTO allowlist | **ACL-T28**, API contract tests |
| SR-03 | Analytics inference | 1 private task → 100% deanonymize | Exclude private from shared | ACL-T14 |
| SR-04 | Notification leak | Title in payload / stale access | IDs only; load on demand | ACL-T13, **ACL-T27** |
| SR-05 | AI context leak | Classify with foreign project list | Accessible context builder | ACL-T15 |
| SR-06 | Voice transcript leak | Task viewer GET voice capture | Owner-only full transcript | ACL-T17 |
| SR-07 | Stale TaskShare | Revoked but cached client | Check status+revoked_at+expires | ACL-T10, ACL-T11 |
| SR-08 | Stale ProjectMember | `status=removed` still in cache | Filter `status=active` | ACL-T05 |
| SR-09 | Deleted task leakage | List excludes, get returns data | Same predicate | ACL-T19, ACL-T20 |
| SR-10 | Worker bypass | Worker returns task title in log | Redacted worker logs | **ACL-T29**, Worker integration |
| SR-11 | Logs private content | Access denied log includes title | Log resource id only | Observability review |
| SR-12 | List/get inconsistency | In list but 403 on get | Single predicate | ACL-T20 |
| SR-13 | ProjectMember private leak | Private task in project visible to member | `visibility != private` in project branch | **ACL-T25** |
| SR-14 | Invalid TaskShare provenance | Stale share row opens private task | Provenance in §5.1.4 / §10.1 | **ACL-T30** |

---

## 14. Required Access Control Tests

| ID | Name | Setup | Action | Expected |
| --- | --- | --- | --- | --- |
| ACL-T01 | Private task isolation | User A private task | User B GET | 404 |
| ACL-T02 | Workspace Owner strict privacy | User B private task | Owner GET | 404 |
| ACL-T03 | Family vs Work isolation | Family task | Family member GET work task | 404 |
| ACL-T04 | Work partner vs family | Family task | work_partner GET | 404 |
| ACL-T05 | ProjectMember scope | Project X member | GET Project X tasks | 200 |
| ACL-T06 | ProjectMember not whole space | Project X member | GET Project Y / list projects | 404 / excluded |
| ACL-T07 | TaskShare read | Guest read share | GET task | 200 guest DTO |
| ACL-T08 | TaskShare comment | Guest comment perm | POST comment | 200 |
| ACL-T09 | TaskShare complete | Guest complete perm | POST complete OK; PATCH | 200 / 403 |
| ACL-T10 | Revoked TaskShare | Revoked share | GET task | 404 |
| ACL-T11 | Expired TaskShare | expires_at past | GET task | 404 |
| ACL-T12 | Comment privacy | No task access | GET comments | 404 |
| ACL-T13 | Notification privacy | Notification to user | Payload | No title/body |
| ACL-T14 | Analytics privacy | 2 private tasks A | B analytics shared | No A private counts |
| ACL-T15 | AI context privacy | Classify as B | Context spaces | B accessible only |
| ACL-T16 | AI log tech audit | Owner tech GET log | Response | Redacted only |
| ACL-T17 | Voice transcript privacy | Task viewer | GET voice capture | 404 or redacted |
| ACL-T18 | Reminder access | No task access | POST reminder | 404 |
| ACL-T19 | Deleted task invisibility | Soft deleted | GET / list | 404 / absent |
| ACL-T20 | List/get consistency | Task not in list | GET by id | 404 |

**Additional recommended tests:**

| ID | Name |
| --- | --- |
| ACL-T21 | Add ProjectMember without space membership → 403 (ACCESS-ADR-001) |
| ACL-T22 | Active user without password_hash cannot login |
| ACL-T23 | Space admin cannot view member private task in private space |
| ACL-T24 | `GET /api/tasks/:id/events` returns no comment bodies |
| ACL-T25 | Private task inside project invisible to ProjectMember |
| ACL-T26 | ProjectMember can see non-private project task |
| ACL-T27 | Notification stale access safety |
| ACL-T28 | Mass assignment owner_id blocked |
| ACL-T29 | Worker log privacy |
| ACL-T30 | Invalid TaskShare provenance cannot expose private task |
| ACL-T31 | Read-only user cannot create reminder |

### ACL-T25..ACL-T31 detail

| ID | Setup | Action | Expected |
| --- | --- | --- | --- |
| ACL-T25 | User A creates `visibility=private` task in Project X; User B is ProjectMember + SpaceMember | B GET `/api/tasks/:id`; B GET `/api/tasks` | 404; task absent from list |
| ACL-T26 | Same Project X; task `visibility=project` | B GET task | 200 |
| ACL-T27 | Notification with `task_id`; access revoked after creation | GET notification payload; click → GET task | Payload has no title/body; task GET → 404 |
| ACL-T28 | User PATCH task with `owner_id` or `created_by` | API response | Field ignored/rejected; 400/422/403; owner unchanged |
| ACL-T29 | Worker processes reminder for private task | Inspect worker logs | `task_id`/`reminder_id` only; no title/description/body |
| ACL-T30 | User A owns private task; DB has active share for B with `shared_by_user_id` ≠ A and not allowed manager | B GET `/api/tasks/:id`; B GET `/api/tasks` | 404; absent from list |
| ACL-T31 | Guest has TaskShare read/comment/complete on task | POST `/api/reminders` | 403 |

---

## 15. Implementation Guidance for Future Code

1. **API handler never queries DB directly** for protected resources without ACL predicate.
2. **API handler calls policy** before domain mutation: `authenticate → authorize → execute → filter response`.
3. **Domain service owns mutation** — ACL checked in API, business rules in Domain.
4. **Repositories expose scoped queries** — `findAccessibleTasks(userId, filters)` wraps predicate.
5. **Response DTOs are allowlisted** — map entity → DTO per response level (§8).
6. **Tests must include negative cases** — every `canX` has deny test.
7. **For every new endpoint** — add row to §7 matrix first.
8. **For every new resource** — define owner/scope/policies in §4 first.
9. **Never trust client-supplied** `owner_id`, `created_by`, `workspace_id`, `shared_by_user_id`.
10. **All IDs in request are untrusted** — load resource, then authorize.

**Handler template:**

```
1. session = authenticate(request)
2. resource = repository.findById(id)  // may return null
3. if (!resource) return 404
4. if (!policy.canX(session.user, resource)) return isVisible? 403 : 404
5. result = domainService.action(...)
6. return filterDto(result, responseLevel)
```

---

## 16. Open Questions

| # | Question | Status / Recommendation | Target doc |
| --- | --- | --- | --- |
| 1 | Session: JWT vs server-side sessions | Open | ADR-0001 |
| 2 | Project-only guest without space membership | **Closed: NO for MVP** — ACCESS-ADR-001 has precedence over DATA_MODEL.md DM-R08 | — |
| 3 | Private space per user: DB constraint vs convention | Convention in MVP; one private space per user via seed | API_CONTRACTS.md |
| 4 | Exact API error format | Open (404 body shape, error codes) | API_CONTRACTS.md |
| 5 | Workspace Owner sees user email but not private content | **Closed for MVP:** directory email/name/status OK; task content NO | API_CONTRACTS.md |
| 6 | Family admins manage all family tasks vs assigned only | **Recommended:** admin manages all **non-private** tasks in family space | ACCESS_CONTROL v0.3 if needed |
| 7 | Reminders per-user vs per-task global | **Closed for MVP:** per-user (`reminder.user_id`) | API_CONTRACTS.md |
| 8 | AI logs before task creation promoted after confirm | **Recommended:** update `task_id` on confirm | AI_CONTRACTS.md |

**Cross-doc conflict note (ACCESS-ADR-001 precedence):**

`DATA_MODEL.md` and `ARCHITECTURE_BASELINE.md` may still contain older wording about project-only guest or guest-limited project member without space membership.

**Current source of truth for MVP access control:**

**ACCESS-ADR-001:** Project-only guest without active space membership is **NOT allowed** in MVP. External guests use **TaskShare** only.

Before migrations, `DATA_MODEL.md` and `ARCHITECTURE_BASELINE.md` **must** be patched or annotated to remove conflicting wording. This document (`ACCESS_CONTROL.md` v0.3) overrides older open questions in those files.

---

## 17. ACCESS_CONTROL Acceptance Criteria

| # | Criterion | Status |
| --- | --- | --- |
| AC-01 | `docs/ACCESS_CONTROL.md` создан / обновлён до v0.3 | Draft |
| AC-02 | Все actors описаны | Draft |
| AC-03 | Все scopes описаны | Draft |
| AC-04 | Все resources описаны | Draft |
| AC-05 | Task visibility rule описан (private override + non-private) | Needs review |
| AC-06 | Project visibility rule описан | Draft |
| AC-07 | Space visibility rule описан | Draft |
| AC-08 | Comment access описан | Draft |
| AC-09 | Reminder access описан | Draft |
| AC-10 | AI log access описан | Draft |
| AC-11 | Voice capture access описан | Draft |
| AC-12 | Notification privacy описана (IDs-only, stale safe) | Needs review |
| AC-13 | Analytics privacy описана | Draft |
| AC-14 | Endpoint-level matrix создана | Draft |
| AC-15 | 404/403 правила описаны | Draft |
| AC-16 | Field-level filtering описан (guest DTO rules) | Needs review |
| AC-17 | Policy function contracts описаны (incl. comment/reminder/event/audit/user) | Needs review |
| AC-18 | ACL predicates синхронизированы с §5 | Needs review |
| AC-19 | Edge cases описаны (private in project) | Needs review |
| AC-20 | Required tests описаны (ACL-T01..T31) | Draft |
| AC-21 | BLOCKER: ProjectMember cannot see private task in project | Needs review |
| AC-22 | ACCESS-ADR-001 precedence documented | Draft |
| AC-23 | TaskShare provenance check in §5.1.4 and §10.1 | Needs review |
| AC-24 | Reminder creation policy synchronized (§5.5 ↔ §9.6) | Needs review |
| AC-25 | Endpoint matrix uses named policy functions | Draft |
| AC-26 | ACL-T30 and ACL-T31 added | Draft |
| AC-27 | Accepted after final Codex access-control review | Pending |

---

*Конец документа ACCESS_CONTROL.md v0.4*
