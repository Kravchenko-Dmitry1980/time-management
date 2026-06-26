# ADR-0002 - Auth Session Strategy

## Status

Accepted

## Date

2026-06-26

## Context

STAGE 2.1 добавляет auth foundation для modular monolith без HTTP/API adapter.
В существующих контрактах session strategy оставалась открытым решением, поэтому этот ADR фиксирует
минимальный auth/session контракт до реализации login routes, cookies, CSRF handling и UI.

Границы Stage 2.1:

- `packages/auth` отвечает за framework-agnostic auth application logic.
- `packages/db` отвечает за Drizzle schema и repository adapters.
- HTTP routes, cookies, route middleware, frontend login UI, ACL, OAuth, SSO и external auth
  providers откладываются на будущие stages.

## Decision

1. Использовать server-side DB sessions как source of truth.
2. Возвращать plaintext session token только один раз из `AuthService.login`.
3. Хранить в `auth_sessions` только SHA-256 `token_hash`.
4. Использовать встроенный Node.js `crypto.scrypt` для password hashing и verification.
5. Не добавлять `bcrypt`, `argon2`, JWT, OAuth, SSO, LDAP, magic links или external auth providers
   в Stage 2.1.
6. Не реализовывать auth HTTP adapters, cookie adapters, CSRF wiring или route/API handlers в
   Stage 2.1.
7. Ввести таблицы `auth_sessions` и `auth_audit_events`.
8. Ограничить `auth_audit_events.metadata` безопасными IDs/metadata: без password, plaintext token,
   `token_hash` и raw secret.
9. Сохранить default CI независимым от DB, secrets, Docker и external services.

## Consequences

### Positive

- Session revocation выполняется напрямую через `revoked_at` в server-side session row.
- JWT revocation complexity не появляется в MVP foundation.
- `packages/auth` тестируется через fake repositories без DB.
- DB adapters остаются infrastructure-only и не создают import-time DB connection.

### Trade-offs

- Будущий authenticated request должен проверять session token через session store.
- Horizontal scaling требует общей PostgreSQL DB или будущего shared session store.
- Cookie и CSRF детали сознательно отложены, поэтому Stage 2.1 не является end-user login flow.

## Risks

- Будущий HTTP adapter не должен логировать plaintext session token.
- Audit metadata не должен принимать raw auth context или secret-like fields.
- Default CI не должен дрейфовать к DB-required auth tests.

## Auth audit schema note

Stage 2.1 `auth_audit_events` намеренно использует implementation-focused audit shape:
`email_normalized`, `success`, `reason`, `metadata`, `retention_until`.
`workspace_id` не добавлен, потому что authentication здесь account/session-level,
а не workspace-scoped. Это принято для Stage 2.1 и должно быть синхронизировано
обратно в `DATA_MODEL.md` отдельным documentation alignment patch до production hardening.

## Acceptance Criteria

1. `packages/auth` не импортирует `packages/db`.
2. `packages/auth` не импортирует HTTP или cookie framework.
3. `auth_sessions.token_hash` unique и хранит только hash.
4. Password hashing использует `node:crypto` `scrypt`.
5. Unit tests используют fake repositories и не требуют DB.
6. DB migration добавляет только auth session/audit scope.
