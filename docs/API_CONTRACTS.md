# API_CONTRACTS.md

Версия: 0.2  
Статус: Draft — cross-doc consistency patch after API/AI review  
Проект: AI Task Assistant / Time Management System  
Локальный путь: `C:\Dima\Projects\CURSOR\time-management`  
Связанные документы: `docs/TZ_MVP.md`, `docs/ARCHITECTURE_BASELINE.md`, `docs/DATA_MODEL.md`, `docs/ACCESS_CONTROL.md`, `docs/AI_CONTRACTS.md`

---

## 1. Назначение документа

Данный документ определяет **HTTP API контракты MVP** для AI Task Assistant — единый источник истины для API layer.

| Аспект | Описание |
| --- | --- |
| **Что определяет** | Endpoints, request/response DTO, validation, status codes, error format, pagination/filter/sort, auth, access policy per endpoint, field-level filtering, mass assignment protection, side effects |
| **Основа** | `ARCHITECTURE_BASELINE.md` (§9, §10, §11, §12, §13, §14, §19), `DATA_MODEL.md`, `ACCESS_CONTROL.md` v0.3 |
| **Для кого** | Backend-разработчик, Cursor (route handlers, DTO schemas), Codex (API/security review), QA (integration tests) |
| **Что НЕ является** | Исполняемым кодом, ORM schema, миграцией, тестами |

Документ является основой для:

- реализации API routes в `apps/web` (или backend module);
- DTO schemas и validation (Zod / similar);
- integration-тестов `tests/integration/` и `tests/access-control/`;
- будущего PWA / Capacitor Android client (API-first, UI-agnostic).

---

## 2. API Design Principles

1. **Contract-first** — endpoint, DTO и status codes определены до реализации handler.
2. **DTO allowlist** — request body принимает только явно разрешённые поля; лишние поля → `422 validation_error` или strip + log (рекомендуется reject).
3. **Backend authorization before domain mutation** — `authenticate → authorize → execute → filter response`.
4. **No direct DB access from handlers without policy** — handler вызывает ACL + Domain Service, не repository напрямую для mutations.
5. **Consistent error format** — единый JSON envelope для всех ошибок (§4).
6. **Strict 404/403 semantics** — invisible resource → `404`; visible but forbidden action → `403` (`ACCESS_CONTROL.md` §12).
7. **Pagination by default for list endpoints** — cursor-based; `limit` с server default и max cap.
8. **All timestamps in ISO-8601 UTC** — в JSON response; хранение в DB — `timestamptz` UTC.
9. **User timezone only through `user_settings`** — dashboard/analytics boundaries используют `UserSettings.timezone`, не legacy profile fields.
10. **No private content in notification payloads** — IDs-only (`ACCESS_CONTROL.md` §8.5).
11. **No raw AI/voice private content in tech audit responses** — redacted DTO only.
12. **All IDs are untrusted input** — load resource, then authorize; invalid UUID → `422`.
13. **Client cannot set system fields** — `owner_id`, `created_by`, `workspace_id`, `shared_by_user_id` и др. (§20).
14. **API responses use field-level filtering** — DTO level per ACL (`ACCESS_CONTROL.md` §8).

---

## 3. API Global Conventions

### 3.1 Base path

```
/api
```

Health check (вне MVP scope API contracts, но для справки): `GET /health`.

### 3.2 Content type

| Context | Content-Type |
| --- | --- |
| JSON request | `application/json` |
| JSON response | `application/json; charset=utf-8` |
| Voice upload (MVP) | `multipart/form-data` — поле `audio` (file blob) + optional JSON metadata fields |

Binary-only endpoint (`POST /api/voice-captures/raw`) — **не в MVP**; зафиксировано в Open Questions (§23).

### 3.3 ID format

- Public resource IDs: **UUID v4 string** (RFC 4122).
- Path params `:id`, `:userId`, `:taskId` — UUID.
- **Invalid UUID format** → `422` + `validation_error` + field `details.path_param`.
- **Valid UUID, resource not found or invisible** → `404` + `not_found` (без раскрытия приватности).

### 3.4 Timestamp format

- Response: ISO-8601 string в UTC, например `"2026-06-14T07:00:00.000Z"`.
- Request: ISO-8601 с offset или `Z`; server нормализует в UTC перед persist.
- Client **не** передаёт «локальную дату без timezone» для `due_at` / `scheduled_for` / `remind_at` — всегда ISO-8601 с timezone или UTC.
- Display boundaries (Today, Evening Review): server использует `user_settings.timezone` (ADR-012).

### 3.5 Pagination format

**Query params (list endpoints):**

| Param | Type | Default | Max | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | 50 | 100 | Page size |
| `cursor` | string | null | — | Opaque cursor (base64 or UUID of last item + sort key) |
| `sort` | string | resource-specific | — | Field name: `created_at`, `due_at`, `updated_at`, `title` |
| `order` | enum | `desc` | — | `asc` \| `desc` |

`page` offset pagination — **не используется** в MVP (cursor preferred).

**Response envelope:**

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "next_cursor": null,
    "has_more": false
  }
}
```

- `next_cursor = null` и `has_more = false` — последняя страница.
- Пустой список: `200` + `data: []`, не `404`.

### 3.6 Filtering format

Общие query params для task list и dashboard-related queries:

| Param | Type | Description |
| --- | --- | --- |
| `space_id` | UUID | Filter by space; must be visible to user |
| `project_id` | UUID | Filter by project; ACL applies |
| `status` | task_status enum | Comma-separated allowed |
| `assignee_id` | UUID | Filter assignee |
| `owner_id` | UUID | Filter owner; cross-user only if analytics/admin scope |
| `due_from` | ISO-8601 | `due_at >= due_from` |
| `due_to` | ISO-8601 | `due_at <= due_to` |
| `scheduled_from` | ISO-8601 | `scheduled_for >= scheduled_from` |
| `scheduled_to` | ISO-8601 | `scheduled_for <= scheduled_to` |
| `category_id` | UUID | Category filter |
| `tag` | string | Tag name (exact match, case-insensitive) |
| `eisenhower_quadrant` | enum | Quadrant filter |
| `source` | task_source enum | Server-side filter only for admins |
| `visibility` | task_visibility enum | Restricted; owner/admin contexts |
| `q` | string | Search in title (ACL-filtered); max 200 chars |

**Rules:**

- Filters **never bypass ACL** — predicate из `ACCESS_CONTROL.md` §10.1 применяется поверх filters.
- Filter references **invisible** `space_id` / `project_id` on list endpoints → `200` + `[]` (не 404).
- Filter references invisible resource on **detail** endpoints → `404`.
- `owner_id` filter for non-admin viewing another user's tasks → empty list (не leak existence).

---

## 4. Error Contract

### 4.1 Standard error response

```json
{
  "error": {
    "code": "string_code",
    "message": "Human readable safe message",
    "details": {},
    "request_id": "req_xxx"
  }
}
```

- `message` — safe для клиента; без stack trace, internal provider details, подтверждения существования private resource.
- `request_id` — correlation id из middleware (header `X-Request-Id` echo).
- `details` — optional; для validation — field-level map.

**Validation error example (`422`):**

```json
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "details": {
      "fields": {
        "title": ["Required"],
        "due_at": ["Must be valid ISO-8601 datetime"]
      }
    },
    "request_id": "req_abc123"
  }
}
```

### 4.2 Error codes

| Code | HTTP | When |
| --- | --- | --- |
| `unauthenticated` | 401 | No valid session |
| `forbidden` | 403 | Visible resource, action denied |
| `not_found` | 404 | Resource not found or invisible (IDOR) |
| `validation_error` | 422 | Field/business validation failed |
| `bad_request` | 400 | Malformed JSON, unsupported method, invalid content type |
| `conflict` | 409 | Lifecycle conflict (duplicate share, already revoked, invalid state transition) |
| `rate_limited` | 429 | Rate limit exceeded |
| `ai_provider_error` | 502 | AI provider failure (sanitized) |
| `stt_provider_error` | 502 | STT provider failure (sanitized) |
| `upload_too_large` | 413 | Voice/audio exceeds max size |
| `unsupported_media_type` | 415 | Wrong MIME for upload |
| `worker_state_conflict` | 409 | Optimistic lock / delivery state conflict (internal; rare in API) |
| `internal_error` | 500 | Unhandled server error (sanitized message) |

### 4.3 Status code matrix

| Case | HTTP | Error code |
| --- | --- | --- |
| Unauthenticated | 401 | `unauthenticated` |
| Invisible resource (including private / IDOR) | 404 | `not_found` |
| Visible but forbidden action | 403 | `forbidden` |
| Malformed JSON body | 400 | `bad_request` |
| Validation error (fields, invalid UUID) | 422 | `validation_error` |
| Lifecycle / state conflict | 409 | `conflict` |
| Rate limited | 429 | `rate_limited` |
| Server error | 500 | `internal_error` |

**Privacy rules for errors:**

- `not_found` message: generic `"Resource not found"` — **не** «Task not found» vs «Access denied» distinction in message text.
- Provider errors (`ai_provider_error`, `stt_provider_error`): no API keys, no provider stack traces.
- Login failure: generic `"Invalid email or password"` — не раскрывать существование email.

---

## 5. Authentication and Session API

> Session strategy (JWT vs server-side store) — Open Question → ADR-0001. API contracts assume **HTTP-only session cookie** with CSRF protection on mutations (ARCHITECTURE_BASELINE §19).

### 5.1 POST /api/auth/login

**Access:** Public (rate limited: 5 req/min per IP).

**Request DTO:**

```json
{
  "email": "owner@local.dev",
  "password": "string"
}
```

| Field | Validation |
| --- | --- |
| `email` | Required; valid email; max 320 chars; trimmed lowercase |
| `password` | Required; min 8 chars; max 128 chars |

**Response `200`:**

```json
{
  "user": {
    "id": "uuid",
    "email": "owner@local.dev",
    "name": "Владелец",
    "status": "active",
    "avatar_url": null,
    "created_at": "2026-01-01T00:00:00.000Z"
  }
}
```

- Sets session cookie (HttpOnly, Secure in production, SameSite=Lax).
- **Never** returns `password_hash`.

**Rules:**

- Active user requires `password_hash IS NOT NULL` (ACCESS_CONTROL MVP Auth Policy).
- Failed login → `AuthAuditEvent` `login_failed` (no password in metadata).
- Success → `login_success` audit event.
- Invalid credentials → `401` + `unauthenticated` + generic message (no email enumeration).
- Disabled/archived user → `401` (same generic message).

**Status codes:** `200`, `401`, `422`, `429`.

---

### 5.2 POST /api/auth/logout

**Access:** Authenticated session required.

**Request:** Empty body.

**Response:** `204 No Content`

**Rules:**

- Clears session cookie.
- Creates `AuthAuditEvent` `logout`.
- Idempotent: logout without session → `401`.

**Status codes:** `204`, `401`.

---

### 5.3 GET /api/auth/me

**Access:** Authenticated.

**Response `200`:**

```json
{
  "user": {
    "id": "uuid",
    "email": "owner@local.dev",
    "name": "Владелец",
    "status": "active",
    "avatar_url": null,
    "created_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": null
  },
  "user_settings_summary": {
    "timezone": "Europe/Moscow",
    "locale": "ru",
    "ai_confirmation_mode": "confirm_on_low_confidence"
  }
}
```

- No `password_hash`.
- `user_settings_summary` — optional convenience subset; full settings via `GET /api/user-settings/me`.

**Status codes:** `200`, `401`.

---

## 6. User and UserSettings API

### 6.1 GET /api/users

**Policy:** `canViewUserDirectory` — Workspace Owner/Admin only.

**Query:** pagination (`limit`, `cursor`, `sort`, `order`); optional `status` filter.

**Response:** Paginated `UserDirectoryResponse[]`:

```json
{
  "id": "uuid",
  "email": "family@local.dev",
  "name": "Семья",
  "status": "active",
  "avatar_url": null,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

- **MVP default:** email visible **Owner/Admin directory only** (not all workspace members).
- No `password_hash`, no private task content.

**Status codes:** `200`, `401`, `403`.

---

### 6.2 POST /api/users

**Policy:** Workspace Owner.

**Request DTO (`CreateUserRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `email` | yes | Email, unique, max 320 |
| `name` | yes | 1–200 chars |
| `password` | yes (MVP) | 8–128 chars |
| `status` | no | Default `invited`; enum `user_status` |
| `role` | no | `workspace_role`; default `member` — only Owner may set `admin` |

**Forbidden:** `id`, `password_hash`, `created_at`, `workspace_id` (server-derived).

**Response `201`:** `UserDirectoryResponse`.

**Side effects:** `AuthAuditEvent` `user_invited`; create `user_settings` row; create `workspace_members`.

**Status codes:** `201`, `401`, `403`, `409` (duplicate email), `422`.

---

### 6.3 GET /api/users/:id

**Policy:** Self OR `canManageUser` / directory access.

**Response:** `UserProfileResponse` (same fields as directory + optional membership summary).

**Status codes:** `200`, `401`, `404`, `403`.

---

### 6.4 PATCH /api/users/:id

**Policy:** Self (limited fields) OR Workspace Owner/Admin.

**Request DTO (`UpdateUserRequest`):**

| Field | Self | Owner/Admin |
| --- | --- | --- |
| `name` | ✅ | ✅ |
| `avatar_url` | ✅ | ✅ |
| `email` | ✅ | ✅ |
| `password` | ✅ (current + new — future) | ✅ reset |
| `status` | ❌ | ✅ |
| `role` | ❌ | ✅ (workspace role) |

**Forbidden:** `password_hash`, `id`, `created_at`.

**Side effects:** `password_changed` audit on password update.

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 6.5 DELETE /api/users/:id

**Policy:** Workspace Owner.

**Behavior:** Soft disable/archive (`status` → `disabled` or `archived`); не hard delete в MVP.

**Side effects:** `user_disabled` audit; task transfer policy — explicit scenario (future).

**Status codes:** `204`, `401`, `404`, `403`, `409`.

---

### 6.6 GET /api/user-settings/me

**Policy:** Authenticated self.

**Response DTO (`UserSettingsResponse`):**

```json
{
  "user_id": "uuid",
  "timezone": "Europe/Moscow",
  "locale": "ru",
  "notification_preferences": {},
  "ai_confirmation_mode": "confirm_on_low_confidence",
  "ai_confidence_threshold": 0.75,
  "morning_digest_time": "08:00:00",
  "evening_review_time": "21:00:00",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

**Status codes:** `200`, `401`.

---

### 6.7 PATCH /api/user-settings/me

**Policy:** Authenticated self.

**Request DTO (`UpdateUserSettingsRequest`):** allowlist only:

- `timezone`, `locale`, `notification_preferences`, `ai_confirmation_mode`, `ai_confidence_threshold`, `morning_digest_time`, `evening_review_time`

**Validation:** See §19.

**Status codes:** `200`, `401`, `422`.

---

### 6.8 GET /api/user-settings/:userId

**Policy:** Self only (MVP). Owner admin read — **future**; MVP → `404`/`403` for others.

**Status codes:** `200`, `401`, `404`, `403`.

---

## 7. Spaces API

### 7.1 GET /api/spaces

**Policy:** Authenticated; ACL-filtered list (`Space ACL predicate` §ACCESS_CONTROL §10.3).

**Response:** Paginated `SpaceSummaryResponse[]`:

```json
{
  "id": "uuid",
  "name": "Семья",
  "type": "family",
  "visibility": "members",
  "member_count": 3,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Status codes:** `200`, `401`.

---

### 7.2 POST /api/spaces

**Policy:** Workspace Owner.

**Request DTO (`CreateSpaceRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `name` | yes | 1–200 chars |
| `type` | yes | `space_type` enum; not `system` from client |
| `visibility` | no | Default per type |

**Forbidden:** `id`, `workspace_id`, `created_by` (server = session user).

**Response `201`:** `SpaceDetailResponse`.

**Side effects:** Creator added as space admin/owner member.

**Status codes:** `201`, `401`, `403`, `422`.

---

### 7.3 GET /api/spaces/:id

**Policy:** `canViewSpace` → else `404`.

**Response DTO (`SpaceDetailResponse`):**

```json
{
  "id": "uuid",
  "name": "Семья",
  "type": "family",
  "visibility": "members",
  "created_by": { "id": "uuid", "name": "..." },
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "archived_at": null
}
```

- **Does not include** private tasks of members or task lists.

**Status codes:** `200`, `401`, `404`.

---

### 7.4 PATCH /api/spaces/:id

**Policy:** `canManageSpace` → invisible `404`, forbidden `403`.

**Request DTO (`UpdateSpaceRequest`):** `name`, `visibility` (if allowed).

**Forbidden:** `type` change (MVP — restricted), `workspace_id`, `created_by`.

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 7.5 DELETE /api/spaces/:id

**Policy:** Workspace Owner / Space Owner.

**Behavior:** Archive (`archived_at`); system spaces (Inbox) — **403** delete.

**Status codes:** `204`, `401`, `404`, `403`, `409`.

---

### 7.6 GET /api/spaces/:id/members

**Policy:** `canViewSpace`.

**Response:** `SpaceMemberResponse[]`:

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "user": { "id": "uuid", "name": "...", "email": "..." },
  "role": "member",
  "status": "active",
  "joined_at": "2026-01-01T00:00:00.000Z"
}
```

- Email in member list: visible to space managers and members (collaboration context).

**Status codes:** `200`, `401`, `404`.

---

### 7.7 POST /api/spaces/:id/members

**Policy:** `canManageSpaceMembers`.

**Request DTO (`AddSpaceMemberRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `user_id` | yes | UUID; must be workspace member |
| `role` | no | `member_role`; default `member` |

**Side effects:** membership row; optional `user_invited` if user was invited.

**Status codes:** `201`, `401`, `404`, `403`, `409`, `422`.

---

### 7.8 DELETE /api/spaces/:id/members/:userId

**Policy:** `canManageSpaceMembers`.

**Behavior:** `status` → `removed` (soft remove).

**Status codes:** `204`, `401`, `404`, `403`.

---

## 8. Projects API

### 8.1 GET /api/projects

**Policy:** Project ACL predicate (`ACCESS_CONTROL.md` §10.2).

**Query filters:** `space_id`, `status`, pagination, sort.

**Response:** Paginated `ProjectSummaryResponse[]`:

```json
{
  "id": "uuid",
  "name": "Рабочий проект",
  "space_id": "uuid",
  "status": "active",
  "owner_id": "uuid",
  "due_date": "2026-12-31",
  "task_count": 12
}
```

- `task_count` — non-private accessible tasks only for caller.

**Status codes:** `200`, `401`.

---

### 8.2 POST /api/projects

**Policy:** `canCreateInSpace(user, space_id)` — active space member with create permission.

**Request DTO (`CreateProjectRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `space_id` | yes | UUID; user must manage/create in space |
| `name` | yes | 1–200 chars |
| `description` | no | max 10000 |
| `status` | no | default `active` |
| `start_date` | no | date |
| `due_date` | no | date; >= start_date |
| `goal_id` | no | UUID nullable (future) |

**Forbidden:** `workspace_id`, `owner_id` (server = session user), `id`.

**Validation:**

- `space_id` visible and manageable.
- Creator auto-added as `project_members` owner/admin.

**Response `201`:** `ProjectDetailResponse`.

**Status codes:** `201`, `401`, `403`, `404`, `422`.

---

### 8.3 GET /api/projects/:id

**Policy:** `canViewProject` → else `404`.

**Response DTO (`ProjectDetailResponse`):**

```json
{
  "id": "uuid",
  "space_id": "uuid",
  "name": "Рабочий проект",
  "description": "...",
  "status": "active",
  "owner_id": "uuid",
  "start_date": null,
  "due_date": null,
  "goal_id": null,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

- **Does not embed** private tasks of other users.
- Optional `members_preview` count only.

**Status codes:** `200`, `401`, `404`.

---

### 8.4 PATCH /api/projects/:id

**Policy:** `canManageProject`.

**Request DTO (`UpdateProjectRequest`):** `name`, `description`, `status`, `start_date`, `due_date`, `goal_id`.

**Forbidden:** `space_id` change (MVP — use move endpoint future), `workspace_id`, `owner_id`.

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 8.5 DELETE /api/projects/:id

**Policy:** `canManageProject`.

**Behavior:** Soft delete (`deleted_at`).

**Status codes:** `204`, `401`, `404`, `403`.

---

### 8.6 GET /api/projects/:id/members

**Policy:** `canViewProject` OR `canManageProject`.

**Response:** `ProjectMemberResponse[]`.

**Status codes:** `200`, `401`, `404`, `403`.

---

### 8.7 POST /api/projects/:id/members

**Policy:** `canManageProjectMembers`.

**Request DTO (`AddProjectMemberRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `user_id` | yes | UUID |
| `role` | no | default `member` |

**Critical rule (ACCESS-ADR-001):** target user **must** be active `SpaceMember` for `project.space_id`. Project-only guest without space membership → `403`.

**External guests:** use `TaskShare`, not ProjectMember.

**Status codes:** `201`, `401`, `404`, `403`, `409`, `422`.

---

### 8.8 DELETE /api/projects/:id/members/:userId

**Policy:** `canManageProjectMembers`.

**Behavior:** `status` → `removed`.

**Status codes:** `204`, `401`, `404`, `403`.

---

## 9. Tasks API

**Core invariant:** `GET /api/tasks` and `GET /api/tasks/:id` use **identical ACL predicate** (`ACCESS_CONTROL.md` §10.1).

### 9.1 Task DTO levels

Aligned with `ACCESS_CONTROL.md` §8.1.

#### TaskSummaryResponse (`task_summary`)

Synced with `ACCESS_CONTROL.md` §8.1.

| Field | Included |
| --- | --- |
| `id`, `title`, `status` | ✅ |
| `due_at`, `scheduled_for` | ✅ |
| `category` | `{ id, name, color }` |
| `tags` | `[{ id, name }]` |
| `assignee` | `{ id, name }` |
| `importance_score`, `urgency_score`, `eisenhower_quadrant` | ✅ |
| `project_id`, `space_id` | ✅ for owner/member/editor paths with `canViewTask`; ❌ guest DTO |
| `owner`, `description`, `ai_*`, `visibility`, `source`, `deleted_at`, `workspace_id` | ❌ |

**Rules:**

```text
TaskSummaryResponse may include project_id and space_id
only for authenticated users who canViewTask through normal owner/member/editor paths.

TaskSummaryResponse must not include:
- workspace_id;
- internal metadata;
- ai_confidence;
- ai_classification_status;
- source;
- deleted_at.

Guest DTOs must not include space_id/project_id unless explicitly required and safe (MVP: excluded).

Analytics aggregate DTOs never include task-level space_id/project_id as private content;
only aggregate buckets are allowed.
```

#### TaskDetailResponse (`task_detail`)

All summary fields plus:

- `description`, `owner` `{ id, name }`, `created_by` `{ id, name }`
- `space_id`, `project_id`, `parent_task_id`, `category_id`
- `visibility`, `source`, `importance_score`, `urgency_score`, `eisenhower_quadrant`
- `ai_confidence`, `ai_classification_status` (owner/editor only)
- `completed_at`, `canceled_at`, `created_at`, `updated_at`
- `tag_ids`, `recurrence_rule_id` (read-only reference)

#### TaskGuestReadResponse (`task_guest_read`)

| Field | Included |
| --- | --- |
| `id`, `title`, `description`, `status` | ✅ |
| `due_at`, `scheduled_for` | ✅ |
| `assignee` | `{ id, name }` if present |
| `importance_score`, `urgency_score`, `eisenhower_quadrant` | ✅ |
| `category` | basic |
| `owner` full profile, `ai_*`, `source`, `visibility`, `workspace_id`, `space_id`, `deleted_at`, tags | ❌ |

#### TaskGuestCompleteResponse (`task_guest_complete`)

Same read fields as `task_guest_read`; action permission: `complete` only.

#### TaskAdminMetadataResponse (`task_admin_metadata`)

For space/project admins: internal fields without title/description in cross-user analytics contexts — `id`, `status`, `visibility`, `owner_id`, `assignee_id`, `ai_confidence`, `source`, `deleted_at`.

#### TaskAnalyticsAggregateResponse (`task_analytics_aggregate`)

Counts/buckets only — **no** `title`, **no** `description`.

---

### 9.2 GET /api/tasks

**Policy:** Task ACL predicate.

**Query:** pagination + §3.6 filters.

**Response:** Paginated `TaskSummaryResponse[]` (DTO level based on caller; default summary).

**Status codes:** `200`, `401`, `422` (invalid filter UUID).

---

### 9.3 POST /api/tasks

**Policy:** `canCreateTaskInSpace(user, space_id)`.

**Request DTO (`CreateTaskRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `title` | yes | 1–500 chars |
| `description` | no | max 50000 |
| `space_id` | yes | UUID; visible space |
| `project_id` | no | UUID; must match space; project ACL |
| `parent_task_id` | no | UUID; visible parent |
| `category_id` | no | UUID |
| `tag_ids` | no | UUID[] |
| `assignee_id` | no | UUID; must be valid member if set |
| `status` | no | default `inbox` or `planned` |
| `importance_score` | no | 1–5 |
| `urgency_score` | no | 1–5 |
| `due_at` | no | ISO-8601 |
| `scheduled_for` | no | ISO-8601 |
| `visibility` | no | default `private` or space policy |

**Forbidden client fields:**

`id`, `workspace_id`, `created_by`, `owner_id`, `ai_confidence`, `ai_classification_status`, `recurrence_rule_id`, `completed_at`, `deleted_at`, `source` (server-set: `manual` | `quick_add` | `ai` | `voice`).

**Server-set on create:**

- `workspace_id` — from session context
- `created_by`, `owner_id` — session user (unless delegate flow)
- `source` — derived from endpoint/context
- `eisenhower_quadrant` — computed from scores if provided

**Side effects (same transaction):** `TaskEvent` `task_created`.

**Response `201`:** `TaskDetailResponse`.

**Status codes:** `201`, `401`, `403`, `404`, `422`.

---

### 9.4 GET /api/tasks/:id

**Policy:** `canViewTask` → else `404`.

**Response:** DTO level:

- Owner/editor → `TaskDetailResponse`
- TaskShare guest → `TaskGuestReadResponse` or `TaskGuestCompleteResponse` per permission

**Status codes:** `200`, `401`, `404`.

---

### 9.5 PATCH /api/tasks/:id

**Policy:** `canEditTask` → invisible `404`, read-only share `403`.

**Request DTO (`UpdateTaskRequest`):**

| Field | Allowed |
| --- | --- |
| `title`, `description`, `status` | ✅ |
| `category_id`, `tag_ids` | ✅ |
| `assignee_id` | ✅ if `canDelegateTask` |
| `importance_score`, `urgency_score`, `eisenhower_quadrant` | ✅ |
| `due_at`, `scheduled_for` | ✅ |
| `visibility` | ✅ if edit/share policy |
| `project_id`, `space_id` | ✅ if move allowed (`canEditTask` + manage) |

**Forbidden:** `workspace_id`, `created_by`, `owner_id`, `deleted_at`, `ai_*`, `source`, `completed_at` (use complete endpoint).

**Side effects:** `TaskEvent` `task_updated` (+ specific events for field changes: `priority_changed`, `quadrant_changed`, `task_moved_to_project`, etc.).

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 9.6 DELETE /api/tasks/:id

**Policy:** `canDeleteTask`.

**Behavior:** Soft delete (`deleted_at`).

**Side effects:** `TaskEvent` `task_deleted` (same transaction).

**Status codes:** `204`, `401`, `404`, `403`.

---

### 9.7 POST /api/tasks/:id/complete

**Policy:** `canCompleteTask`.

**Request DTO (optional):**

```json
{
  "completed_at": "2026-06-14T10:00:00.000Z"
}
```

- `completed_at` optional; default `now()` UTC.

**Side effects:** status → `done`; `TaskEvent` `task_completed`; cancel pending reminders.

**Response:** `TaskDetailResponse` or guest DTO.

**Status codes:** `200`, `401`, `404`, `403`, `409` (already done).

---

### 9.8 POST /api/tasks/:id/reschedule

**Policy:** `canRescheduleTask` (= `canEditTask`; share complete **not** sufficient).

**Request DTO:**

```json
{
  "due_at": "2026-06-15T10:00:00.000Z",
  "scheduled_for": "2026-06-15T09:00:00.000Z"
}
```

- At least one field required.

**Side effects:** `TaskEvent` `task_rescheduled`.

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 9.9 POST /api/tasks/:id/delegate

**Policy:** `canDelegateTask`.

**Request DTO:**

```json
{
  "assignee_id": "uuid"
}
```

- Target must be allowed space/project member.

**Side effects:** `TaskEvent` `task_delegated`; optional notification (IDs-only payload).

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 9.10 Access summary (Tasks)

| Endpoint | Policy | Invisible | Forbidden |
| --- | --- | --- | --- |
| `GET /api/tasks` | ACL predicate | — | — |
| `GET /api/tasks/:id` | `canViewTask` | 404 | — |
| `POST /api/tasks` | `canCreateTaskInSpace` | — | 403 |
| `PATCH /api/tasks/:id` | `canEditTask` | 404 | 403 |
| `DELETE /api/tasks/:id` | `canDeleteTask` | 404 | 403 |
| `POST .../complete` | `canCompleteTask` | 404 | 403 |
| `POST .../reschedule` | `canRescheduleTask` | 404 | 403 |
| `POST .../delegate` | `canDelegateTask` | 404 | 403 |

**Critical cases:**

- Private task inside project → `404` for ProjectMember (ACL-T25).
- Invalid TaskShare provenance → `404` (ACL-T30).
- List/get consistency required (ACL-T20).

---

## 10. TaskShare API

### 10.1 GET /api/tasks/:id/shares

**Policy:** `canShareTask` OR task owner.

**Response:** `TaskShareResponse[]`:

```json
{
  "id": "uuid",
  "task_id": "uuid",
  "shared_with_user_id": "uuid",
  "shared_with_user": { "id": "uuid", "name": "..." },
  "shared_by_user_id": "uuid",
  "permission": "read",
  "status": "active",
  "expires_at": null,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Status codes:** `200`, `401`, `404`, `403`.

---

### 10.2 POST /api/tasks/:id/shares

**Policy:** `canShareTask`.

**Rules:**

1. Private task: **only** task owner may share.
2. API sets `shared_by_user_id` from session — **never** from client.
3. Provenance validated at creation; read-time re-check (§5.1.4 ACCESS_CONTROL).

**Request DTO (`CreateTaskShareRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `shared_with_user_id` | yes | UUID; workspace user |
| `permission` | yes | `read` \| `comment` \| `complete` |
| `expires_at` | no | ISO-8601 future datetime |

**Forbidden:** `shared_by_user_id`, `status`, `revoked_at`, `revoked_by`, `task_id` in body (path param).

**Side effects:** TaskEvent or audit metadata for share creation (for `task_share_created_by_allowed_manager` provenance).

**Response `201`:** `TaskShareResponse`.

**Status codes:** `201`, `401`, `404`, `403`, `409` (active share exists), `422`.

---

### 10.3 PATCH /api/task-shares/:id

**Policy:** `canRevokeTaskShare`.

**Request DTO:**

```json
{
  "status": "revoked"
}
```

- MVP: revoke only via `status: revoked`.

**Side effects:** `revoked_at`, `revoked_by` set.

**Status codes:** `200`, `401`, `404`, `403`, `409`.

---

### 10.4 DELETE /api/task-shares/:id

**Policy:** `canRevokeTaskShare` — alias revoke.

**Status codes:** `204`, `401`, `404`, `403`.

---

## 11. Comments API

### 11.1 GET /api/tasks/:id/comments

**Policy:** `canViewTask`.

**Response:** Paginated `CommentResponse[]`:

```json
{
  "id": "uuid",
  "task_id": "uuid",
  "author": { "id": "uuid", "name": "..." },
  "body": "Текст комментария",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

**Status codes:** `200`, `401`, `404`.

---

### 11.2 POST /api/tasks/:id/comments

**Policy:** `canCommentTask`.

**Request DTO (`CreateCommentRequest`):**

```json
{
  "body": "Текст комментария"
}
```

| Field | Validation |
| --- | --- |
| `body` | Required; 1–10000 chars |

**Side effects:** insert comment + `TaskEvent` `comment_added` with metadata `{ "comment_id": "uuid" }` only — **no body in event**; notification IDs-only.

**Status codes:** `201`, `401`, `404`, `403`, `422`.

---

### 11.3 PATCH /api/comments/:id

**Policy:** `canEditComment` (author or moderator).

**Request DTO (`UpdateCommentRequest`):** `body`.

**Status codes:** `200`, `401`, `404`, `403`, `422`.

---

### 11.4 DELETE /api/comments/:id

**Policy:** `canDeleteComment`.

**Behavior:** Soft delete (`deleted_at`).

**Status codes:** `204`, `401`, `404`, `403`.

---

## 12. Reminders API

### 12.1 GET /api/reminders

**Policy:** Self reminders + reminders on tasks where `canEditTask` (optional filter `task_id`).

**Query:** `task_id`, `status`, pagination, `remind_from`, `remind_to`.

**Response:** Paginated `ReminderResponse[]`:

```json
{
  "id": "uuid",
  "task_id": "uuid",
  "user_id": "uuid",
  "remind_at": "2026-06-14T09:00:00.000Z",
  "channel": "in_app",
  "status": "pending",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Status codes:** `200`, `401`.

---

### 12.2 POST /api/reminders

**Policy:** `canCreateReminder(user, task, reminderUserId)`.

**MVP rule:** TaskShare guest / read-only viewer → **403** (ACL-T31).

`canCreateReminder` true only if:

1. `canEditTask(user, task)` AND `reminderUserId = user.id`, **OR**
2. `task.owner_id = user.id` AND `reminderUserId = user.id`, **OR**
3. `canDelegateTask(user, task)` AND target is allowed assignee/member

**Request DTO (`CreateReminderRequest`):**

| Field | Required | Validation |
| --- | --- | --- |
| `task_id` | yes | UUID |
| `remind_at` | yes | ISO-8601 future (or near-past grace — worker handles) |
| `channel` | no | default `in_app` |
| `user_id` | no | default self; delegate only if `canDelegateTask` |

**Forbidden:** `status`, `sent_at`, `canceled_at`.

**Side effects:** optional `TaskEvent` `reminder_created`; worker handles delivery.

**Status codes:** `201`, `401`, `404`, `403`, `422`, `409` (duplicate active reminder).

---

### 12.3 PATCH /api/reminders/:id

**Policy:** `canEditReminder`.

**Request DTO (`UpdateReminderRequest`):** `remind_at`, `channel` (if pending).

**Forbidden:** `status`, `sent_at` direct set.

**Status codes:** `200`, `401`, `404`, `403`, `422`, `409`.

---

### 12.4 DELETE /api/reminders/:id

**Policy:** `canDeleteReminder`.

**Behavior:** Cancel (`status` → `canceled`, `canceled_at` set) — not hard delete.

**Status codes:** `204`, `401`, `404`, `403`.

---

## 13. Dashboard API

All dashboards apply **Task ACL predicate** + `user_settings.timezone` for day boundaries.

### 13.1 GET /api/dashboard/today

**Query:** optional `space_id`.

**Response DTO (`TodayDashboardResponse`):**

```json
{
  "timezone": "Europe/Moscow",
  "date": "2026-06-13",
  "blocks": {
    "overdue": { "tasks": [] },
    "today": { "tasks": [] },
    "important_urgent": { "tasks": [] },
    "important_not_urgent": { "tasks": [] },
    "quick_tasks": { "tasks": [] },
    "waiting": { "tasks": [] },
    "inbox": { "tasks": [] }
  },
  "summary": {
    "total_active": 0,
    "overdue_count": 0
  }
}
```

- Tasks in blocks: `TaskSummaryResponse[]`.
- Empty blocks allowed → `200`.

**Status codes:** `200`, `401`, `422`.

---

### 13.2 GET /api/dashboard/evening-review

**Response DTO (`EveningReviewResponse`):**

```json
{
  "timezone": "Europe/Moscow",
  "date": "2026-06-13",
  "completed_today": { "tasks": [], "count": 0 },
  "not_completed": { "tasks": [], "count": 0 },
  "created_today": { "count": 0 },
  "overdue": { "count": 0 },
  "rescheduled_today": { "count": 0 },
  "events_summary": []
}
```

- Uses `TaskEvent` filtered by `canViewTaskEvent`.
- Event list items: no comment bodies, no raw AI text.

**Status codes:** `200`, `401`.

---

### 13.3 GET /api/dashboard/week

**Response DTO (`WeekDashboardResponse`):**

```json
{
  "timezone": "Europe/Moscow",
  "week_start": "2026-06-09",
  "week_end": "2026-06-15",
  "created_count": 0,
  "completed_count": 0,
  "overdue_count": 0,
  "by_day": []
}
```

**Status codes:** `200`, `401`.

---

## 14. Analytics API

**Global rules:**

1. No task titles/descriptions in responses.
2. Private tasks excluded from shared/system views.
3. Small-group deanonymization protection (ADR-013).
4. Same ACL predicate as `GET /api/tasks`.
5. Built on `TaskEvent` where noted.

**Common query params:** `from`, `to` (ISO-8601 dates), `space_id`, `project_id`.

### 14.1 GET /api/analytics/daily

**Policy:** `canViewAnalytics` for scope.

**Response:**

```json
{
  "period": { "date": "2026-06-13" },
  "created_count": 5,
  "completed_count": 3,
  "overdue_count": 1,
  "rescheduled_count": 2
}
```

**Status codes:** `200`, `401`, `403`, `422`.

---

### 14.2 GET /api/analytics/weekly

Same structure with week range; counts only.

---

### 14.3 GET /api/analytics/eisenhower

**Response:**

```json
{
  "quadrants": {
    "important_urgent": 4,
    "important_not_urgent": 7,
    "not_important_urgent": 2,
    "not_important_not_urgent": 10
  }
}
```

---

### 14.4 GET /api/analytics/categories

**Response:**

```json
{
  "categories": [
    { "category_id": "uuid", "name": "Работа", "count": 12 }
  ]
}
```

- Category `name` allowed (workspace-scoped taxonomy, not task content).

---

### 14.5 GET /api/analytics/users

**Policy:**

- Self: own stats.
- Owner/Admin: counts/rates per user — **no private task content**.

**Response:**

```json
{
  "users": [
    {
      "user_id": "uuid",
      "created_count": 10,
      "completed_count": 8,
      "overdue_count": 1
    }
  ]
}
```

**Status codes:** `200`, `401`, `403`.

---

### 14.6 GET /api/analytics/created-vs-completed

**Response:**

```json
{
  "series": [
    { "date": "2026-06-13", "created": 5, "completed": 3 }
  ]
}
```

Event-based aggregation.

---

## 15. AI API

### 15.1 POST /api/ai/classify-task

**Policy:** Authenticated; rate limit 20/min per user.

**Request DTO (`ClassifyTaskRequest`):**

```json
{
  "text": "Завтра позвонить клиенту",
  "locale": "ru"
}
```

| Field | Validation |
| --- | --- |
| `text` | Required; 1–10000 chars |
| `locale` | Optional; default from user_settings |

**Forbidden in request:** `user_id` (from session), `timezone` (from user_settings).

**Rules:**

1. Context builder: accessible spaces/projects only.
2. AI cannot set ACL or delete tasks.
3. Output schema validated server-side.
4. Low confidence → inbox / `needs_confirmation`.
5. Prompt injection = untrusted input.

**Response DTO (`ClassifyTaskResponse`):**

```json
{
  "log_id": "uuid",
  "title": "Позвонить клиенту",
  "description": null,
  "space_type": "work",
  "space_id": null,
  "category": "Клиенты",
  "category_id": null,
  "project_hint": null,
  "importance_score": 3,
  "urgency_score": 4,
  "eisenhower_quadrant": "not_important_urgent",
  "due_at": null,
  "scheduled_for": null,
  "reminders": [],
  "assignee_hint": "current_user",
  "confidence": 0.82,
  "needs_confirmation": false,
  "privacy_risk": false,
  "model_name": "gpt-4o-mini"
}
```

- Response **does not auto-create task** — client confirms via `POST /api/tasks`.
- Provider errors → `502` + `ai_provider_error` (sanitized).

**Side effects:** `AIClassificationLog` row; optional `ai_classified` event when task linked.

**Status codes:** `200`, `401`, `422`, `429`, `502`.

---

### 15.2 POST /api/ai/transcribe-task

**Policy:** Authenticated + upload validation.

**Request:** `multipart/form-data`:

| Part | Validation |
| --- | --- |
| `audio` | Required file; MIME `audio/webm`, `audio/wav`, `audio/ogg`, `audio/mpeg`; max 10 MB; max duration 120s |
| `locale` | optional string |

**Response DTO (`TranscribeTaskResponse`):**

```json
{
  "voice_capture_id": "uuid",
  "transcript": "Распознанный текст",
  "stt_confidence": 0.91,
  "classification": {}
}
```

- `classification` — optional nested `ClassifyTaskResponse` if auto-classify enabled.

**Status codes:** `200`, `401`, `413`, `415`, `422`, `502`.

---

### 15.3 POST /api/ai/reclassify-task

**Policy:** `canEditTask(task)`.

**Request DTO (`ReclassifyTaskRequest`):**

```json
{
  "task_id": "uuid",
  "text": "optional override text"
}
```

**Side effects:** `ai_classification_corrected` event on user apply.

**Status codes:** `200`, `401`, `404`, `403`, `502`.

---

### 15.4 GET /api/ai/logs/:id

**Policy:** `canViewAIClassificationLog(user, log, mode)`.

**Response levels:**

- `AIClassificationLogResponseFull` — task owner / own pre-task log
- `AIClassificationLogResponseRedacted` — tech audit

**Full fields:** `id`, `task_id`, `input_text_redacted`, `output_json_redacted`, `confidence`, `model_name`, `provider`, `accepted_by_user`, `corrected_by_user`, `created_at`.

**Never in MVP API (any mode):** `raw_input_encrypted`, `raw_output_encrypted` — internal storage only (`AI_CONTRACTS.md` v0.2 §13.2.1).

**Redacted fields:** metadata, redacted text/json, confidence, errors, hash — **no** `raw_*_encrypted`.

**Status codes:** `200`, `401`, `404`, `403`.

---

## 16. Voice API

### 16.1 POST /api/voice-captures

**Policy:** Authenticated self.

**Request:** `multipart/form-data` (same audio rules as §15.2) OR JSON metadata-only pre-step (future).

**Response `201`:** `VoiceCaptureResponseFull` (owner):

```json
{
  "id": "uuid",
  "status": "uploaded",
  "task_id": null,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

- Transcript populated after async/sync STT processing.

---

### 16.2 GET /api/voice-captures/:id

**Policy:** `canViewVoiceCapture(user, capture, mode)`.

| Mode | Response DTO |
| --- | --- |
| `full` (owner) | `VoiceCaptureResponseFull` — includes `transcript_text`, optional `audio_blob_url` |
| `redacted` (tech audit) | `VoiceCaptureResponseRedacted` — metadata only |

**Rules:**

- Task viewers **do not** automatically get transcript.
- Raw audio not stored by default after transcription.

**Status codes:** `200`, `401`, `404`, `403`.

---

### 16.3 DELETE /api/voice-captures/:id

**Policy:** Owner.

**Behavior:** Purge request; clear audio URL; status → `purged`.

**Status codes:** `204`, `401`, `404`, `403`.

---

## 17. Notifications API

### 17.1 GET /api/notifications

**Policy:** Self only (`notification.user_id = session.user.id`).

**Query:** pagination; `unread_only=true`.

**Response:** Paginated `NotificationResponse[]`:

```json
{
  "id": "uuid",
  "type": "task_assigned",
  "payload": {
    "task_id": "uuid",
    "actor_user_id": "uuid",
    "action": "task_assigned"
  },
  "read_at": null,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Payload schema (IDs-only):**

| Field | Allowed |
| --- | --- |
| `task_id` | UUID |
| `comment_id` | UUID |
| `reminder_id` | UUID |
| `actor_user_id` | UUID |
| `action` | string enum |

**Forbidden in payload:** task title, description, comment body, AI text, transcript.

**Status codes:** `200`, `401`.

---

### 17.2 PATCH /api/notifications/:id/read

**Policy:** `canViewNotification`.

**Request:**

```json
{
  "read": true
}
```

**Response:** Updated `NotificationResponse`.

**Status codes:** `200`, `401`, `404`, `403`.

---

### 17.3 DELETE /api/notifications/:id

**Policy:** `canViewNotification`.

**Status codes:** `204`, `401`, `404`, `403`.

---

## 18. Audit API

### 18.1 GET /api/audit/auth

**Policy:** `canViewAuthAuditEvent` — Workspace Owner tech audit.

**Query:** pagination; `event_type`, `from`, `to`.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "event_type": "login_failed",
      "user_id": null,
      "ip_address": "192.168.1.1",
      "created_at": "2026-01-01T00:00:00.000Z",
      "metadata": {}
    }
  ],
  "page": { "limit": 50, "next_cursor": null, "has_more": false }
}
```

- No passwords/tokens in metadata.

**Status codes:** `200`, `401`, `403`.

---

### 18.2 GET /api/audit/ai

**Policy:** Workspace Owner tech audit — **redacted mode only**.

**Response:** Paginated `AIClassificationLogResponseRedacted[]`.

**Status codes:** `200`, `401`, `403`.

---

### 18.3 GET /api/tasks/:id/events

**Policy:** `canViewTask` + `canViewTaskEvent` per event.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "event_type": "task_updated",
      "user_id": "uuid",
      "old_value": { "status": "planned" },
      "new_value": { "status": "in_progress" },
      "metadata": {},
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ],
  "page": { "limit": 50, "next_cursor": null, "has_more": false }
}
```

- `comment_added` → metadata `{ "comment_id": "uuid" }` only.
- No raw AI prompt in metadata.

**Status codes:** `200`, `401`, `404`.

---

## 19. API Validation Rules

| Field | Rules |
| --- | --- |
| `email` | RFC 5322 practical subset; max 320; lowercase trim; unique per workspace |
| `password` | 8–128 chars; MVP: no complexity enforced (recommend min 1 upper + digit — future) |
| `name` | 1–200 chars; trim; no control chars |
| `UUID` | RFC 4122; invalid → `422` |
| `title` | 1–500 chars; trim; required on task create |
| `description` | max 50000; nullable |
| `status` (task) | enum `task_status` |
| `visibility` | enum `task_visibility` |
| `importance_score` | integer 1–5 |
| `urgency_score` | integer 1–5 |
| `due_at`, `scheduled_for`, `remind_at` | ISO-8601 timestamptz |
| `timezone` | IANA tz database string; non-empty |
| `locale` | BCP-47; e.g. `ru`, `en-US` |
| `ai_confidence_threshold` | number 0.00–1.00 |
| `share permission` | enum `read`, `comment`, `complete` |
| `reminder channel` | MVP: `in_app` only enforced |
| `audio upload` | max 10 MB; MIME whitelist; max 120s duration |
| `tag_ids` | array max 50 UUIDs |
| `notification_preferences` | JSON object max 16 KB |

**Cross-field validation:**

| Rule | Error |
| --- | --- |
| `project_id` set → project.space_id must equal `space_id` | `422` |
| `assignee_id` → must be member of space/project context | `422` / `403` |
| `expires_at` on share → must be future | `422` |
| `parent_task_id` → same workspace; visible to user | `404` / `422` |
| `completed_at` without complete endpoint | reject in PATCH (`422`) |
| scores provided → recompute or validate `eisenhower_quadrant` consistency | domain service |

---

## 20. Mass Assignment Protection

### 20.1 Globally forbidden client fields

| Field | Reason |
| --- | --- |
| `id` | Server-generated UUID |
| `workspace_id` | Server-derived from session/workspace context |
| `created_by` | Session user on create |
| `owner_id` | Session user on create; transfer — future explicit endpoint |
| `shared_by_user_id` | Session user on TaskShare create |
| `revoked_by` | Session user on revoke |
| `sent_at`, `canceled_at` | Worker/system lifecycle |
| `completed_at` | Only via complete endpoint |
| `deleted_at` | Only via delete endpoint |
| `ai_confidence`, `ai_classification_status` | AI system fields |
| Raw AI / encrypted fields | System only |
| Auth audit fields | System only |
| Worker lock / delivery fields | Worker only |
| `password_hash` | Never accepted from client |

### 20.2 Per-endpoint allowlists

Every request DTO MUST be explicit allowlist (Zod `.strict()` or equivalent). Extra fields → `422 validation_error` with `details.fields._unknown`.

| Endpoint | Allowed request fields |
| --- | --- |
| `POST /api/tasks` | §9.3 CreateTaskRequest table |
| `PATCH /api/tasks/:id` | §9.5 UpdateTaskRequest table |
| `POST /api/tasks/:id/shares` | `shared_with_user_id`, `permission`, `expires_at` |
| `POST /api/reminders` | `task_id`, `remind_at`, `channel`, `user_id` (conditional) |
| `POST /api/users` | `email`, `name`, `password`, `status`, `role` |
| `POST /api/ai/classify-task` | `text`, `locale` |

**PATCH behavior for forbidden fields:** reject with `422` (preferred over silent ignore) — ACL-T28.

---

## 21. Event and Audit Side Effects

| Action | Side effects (same transaction where noted) |
| --- | --- |
| Task create | `TaskEvent` `task_created` |
| Task patch | `TaskEvent` `task_updated` (+ specific types) |
| Task complete | `TaskEvent` `task_completed`; cancel pending reminders |
| Task reschedule | `TaskEvent` `task_rescheduled` |
| Task delegate | `TaskEvent` `task_delegated`; notification IDs-only |
| Task delete | `TaskEvent` `task_deleted` |
| Comment create | Comment row + `TaskEvent` `comment_added` (`comment_id` only) |
| Reminder create | Reminder row + optional `TaskEvent` `reminder_created` |
| TaskShare create | Share row + TaskEvent/audit for provenance |
| TaskShare revoke | Update share + optional audit |
| Login success/fail | `AuthAuditEvent` |
| Logout | `AuthAuditEvent` |
| User create/invite | `AuthAuditEvent` `user_invited` |
| AI classify | `AIClassificationLog`; link `ai_classified` when task created |
| AI reclassify apply | `ai_classification_corrected` |
| Voice capture | `VoiceCapture` row; link to task on confirm |
| Reminder sent (worker) | `TaskEvent` `reminder_sent`; notification IDs-only |

**Rules:**

- Task mutation + TaskEvent **same DB transaction** (ADR-009).
- TaskEvent metadata **must not** contain comment body or raw AI prompt.
- Notifications created with IDs-only payload at event time.

---

## 22. API Contract Test Plan

### 22.1 Test categories

| # | Category | Scope |
| --- | --- | --- |
| 1 | Auth tests | login, logout, me, rate limit, audit events |
| 2 | CRUD happy paths | users, spaces, projects, tasks, comments |
| 3 | Validation tests | §19 rules, invalid UUID → 422, malformed JSON → 400 |
| 4 | Access control tests | ACL-T01..ACL-T31 |
| 5 | Mass assignment tests | forbidden fields rejected |
| 6 | Field-level DTO filtering | guest vs owner task responses |
| 7 | Notification privacy tests | payload IDs-only |
| 8 | AI context/privacy tests | accessible context only |
| 9 | Voice transcript/privacy tests | owner-only full transcript |
| 10 | Reminder policy tests | guest cannot create |
| 11 | Event side-effect tests | mutation creates TaskEvent |
| 12 | Analytics privacy tests | no titles, private excluded |

### 22.2 ACL test mapping (from ACCESS_CONTROL.md)

| ACL ID | API test assertion |
| --- | --- |
| ACL-T01 | `GET /api/tasks/:id` → 404 cross-user private |
| ACL-T20 | Not in list → `GET` by id → 404 |
| ACL-T25 | ProjectMember `GET` private task in project → 404 |
| ACL-T26 | ProjectMember `GET` non-private project task → 200 |
| ACL-T27 | Notification payload has no title/body |
| ACL-T28 | `PATCH /api/tasks/:id` with `owner_id` → 422 reject |
| ACL-T30 | Invalid TaskShare provenance → 404 |
| ACL-T31 | TaskShare guest `POST /api/reminders` → 403 |

### 22.3 Specific API integration tests

| Test ID | Description |
| --- | --- |
| API-T01 | ProjectMember cannot GET private task inside project |
| API-T02 | Invalid TaskShare provenance returns 404 |
| API-T03 | TaskShare guest cannot create reminder |
| API-T04 | Notification payload has no title/body |
| API-T05 | PATCH task with owner_id is rejected (422) |
| API-T06 | GET /api/tasks and GET /api/tasks/:id consistency |
| API-T07 | Filter invisible space_id returns empty list not 404 |
| API-T08 | Login does not reveal email existence |
| API-T09 | AI classify response does not include inaccessible space_ids |
| API-T10 | Task delete creates task_deleted event in same transaction |
| API-T11 | Comment create event has comment_id only |
| API-T12 | Analytics users endpoint returns counts without titles |
| API-T13 | POST TaskShare sets shared_by_user_id from session |
| API-T14 | Add project member without space membership → 403 |
| API-T15 | Malformed JSON → 400 bad_request |
| API-T16 | Invalid path UUID → 422 validation_error |

### 22.4 Recommended test layout

```
tests/
  integration/
    auth.test.ts
    tasks.test.ts
    task-share.test.ts
    reminders.test.ts
    notifications.test.ts
    analytics.test.ts
  access-control/
    acl-t01-t31.test.ts
  api-contract/
    validation.test.ts
    mass-assignment.test.ts
    dto-filtering.test.ts
```

---

## 23. Open Questions

| # | Question | MVP decision in this doc | Target document |
| --- | --- | --- | --- |
| 1 | Session strategy: JWT vs server-side sessions | API assumes HttpOnly cookie session; storage TBD | `ADR/0001-project-architecture.md` |
| 2 | Exact API error code naming | Codes in §4.2 — stable snake_case | This doc (v0.1); refine in Codex review |
| 3 | Validation error status: 422 vs 400 | **422** field validation; **400** malformed JSON | **Closed in this doc** |
| 4 | Family admin scope details | Admin manages non-private family tasks; private excluded | `ACCESS_CONTROL.md` v0.4 if needed |
| 5 | AI log promotion after task confirmation | Recommend update `task_id` on confirm | `AI_CONTRACTS.md` |
| 6 | User directory emails visibility | **Admin-only** directory (`GET /api/users`) | **Closed in this doc** |
| 7 | Voice upload: multipart vs binary endpoint | **multipart/form-data** for MVP | **Closed in this doc** (binary endpoint post-MVP) |
| 8 | Unknown JSON fields: reject vs strip | **Reject** with 422 (strict DTO) | Implementation note |
| 9 | Categories/Tags CRUD endpoints | Out of MVP API surface; workspace seed + inline task refs | Future API_CONTRACTS v0.2 |
| 10 | Recurrence API endpoints | Worker-driven; no public recurrence CRUD in MVP | Phase 6+ doc |

---

## 24. API_CONTRACTS Acceptance Criteria

| # | Criterion | Status |
| --- | --- | --- |
| AC-01 | `docs/API_CONTRACTS.md` created | ✅ |
| AC-02 | All MVP endpoint groups covered | ✅ |
| AC-03 | All request DTOs described | ✅ |
| AC-04 | All response DTOs described | ✅ |
| AC-05 | Error format defined | ✅ |
| AC-06 | Status codes defined | ✅ |
| AC-07 | Pagination/filtering defined | ✅ |
| AC-08 | Auth/session endpoints defined | ✅ |
| AC-09 | Task API fully specified | ✅ |
| AC-10 | TaskShare provenance reflected | ✅ |
| AC-11 | Reminder creation policy reflected | ✅ |
| AC-12 | Notification payload IDs-only reflected | ✅ |
| AC-13 | AI context/access reflected | ✅ |
| AC-14 | Voice transcript privacy reflected | ✅ |
| AC-15 | Analytics privacy reflected | ✅ |
| AC-16 | Mass assignment blocked | ✅ |
| AC-17 | Event side effects defined | ✅ |
| AC-18 | API tests listed | ✅ |
| AC-19 | No code/migrations created | ✅ |
| AC-20 | Ready for Codex review | ✅ |

---

*Конец документа API_CONTRACTS.md v0.2*
