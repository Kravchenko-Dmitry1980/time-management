# ADR-0001 — Project Architecture and Stack Baseline

## Status

Accepted

## Date

2026-06-13

## Context

Проект AI Task Assistant / Time Management System завершил Phase 0: monorepo skeleton, tooling baseline и CI no-secrets smoke. Контрактные документы в `docs/` определяют MVP scope, data model, ACL, API, AI и worker policy, но не фиксируют окончательный выбор ORM, migration workflow и границы Stage 1.1.

Mega Audit Phase 0 выявил отсутствие ADR-0001 как блокер перед `STAGE 1.1 — DB Schema Initial`. Без явно зафиксированных решений по stack, ORM, migrations, DB client и test DB strategy Stage 1.1 может начаться с неоднозначными допущениями и scope creep.

Данный ADR закрывает обязательный gap из `docs/IMPLEMENTATION_PLAN.md` (Prerequisite 3, ADR-0001) и согласуется с вектором из `docs/ARCHITECTURE_BASELINE.md`.

## Decision

Принять следующий architecture and stack baseline для MVP и Stage 1.1:

1. **Modular monolith** на TypeScript strict monorepo (pnpm workspaces, ESM, Node.js 20).
2. **Self-hosted web-first** приложение без микросервисов на MVP.
3. **Tooling и CI** — зафиксированный Phase 0 baseline (ESLint, Prettier, Vitest, GitHub Actions).
4. **Database** — PostgreSQL + Drizzle ORM + drizzle-kit + `pg` для Stage 1.1.
5. **Security/privacy** — no-secrets repo, CI без real keys/DB/Docker/external services.
6. **Stage 1.1 scope** — только `packages/db` schema/migrations; без API, auth, ACL, AI, worker jobs.

Изменение этих решений в рамках MVP требует нового ADR или patch контрактных документов до кода.

## Consequences

### Положительные

- Единый source of truth для stack до начала DB schema.
- Снижение риска смешения persistence approaches (один ORM — Drizzle).
- CI и local gates остаются стабильными без DB на Phase 0/начале Stage 1.1.
- Явные границы Stage 1.1 упрощают Codex review и предотвращают premature features.

### Отрицательные / trade-offs

- Drizzle требует дисциплины в review migration SQL; нет «batteries-included» admin UI как у Prisma.
- Отложены test DB containers и DB integration tests — schema review без live DB на раннем Stage 1.1.
- Deferred decisions (Docker, deployment, observability) переносятся на последующие фазы.

### Операционные

- `package.json` `packageManager` остаётся `pnpm@11.1.3`.
- README и CI должны ссылаться на pinned pnpm, не `@latest`.
- Stage 1.1 PR diff ожидается преимущественно в `packages/db/**`.

## Phase 0 Confirmed Decisions

### Архитектура проекта

| Решение | Значение |
| --- | --- |
| Архитектурный стиль | Modular monolith |
| Язык | TypeScript strict |
| Monorepo | pnpm workspaces |
| Module format | ESM |
| Runtime | Node.js 20+ |
| Deployment model (MVP) | Self-hosted web-first application |

Микросервисы **не используются** на MVP. Modular monolith выбран для снижения operational complexity при сохранении чётких границ через `apps/` и `packages/`.

### Структура репозитория

```text
apps/web          — будущий web/PWA frontend/API boundary; сейчас skeleton (health stub)
apps/worker       — будущие background jobs; сейчас skeleton (worker stub)
packages/shared   — shared primitives, types, utilities
packages/core     — future domain/business rules
packages/db       — database schema, client, migrations
packages/auth     — future auth/session boundary
packages/ai       — future AI classification/STT boundary
```

### Tooling baseline

| Компонент | Решение |
| --- | --- |
| Package manager | pnpm@11.1.3 (Corepack) |
| TypeScript | strict (`tsconfig.base.json`) |
| Lint | ESLint flat config |
| Format | Prettier |
| Tests | Vitest (node environment, skeleton placeholders) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

**CI gates (Phase 0):**

- install (`--frozen-lockfile`)
- lint
- typecheck
- test
- format
- secret-pattern scan
- forbidden scope scan

### Security and privacy baseline

- Реальные секреты **запрещены** в репозитории; только `.env.example` с placeholders.
- CI **не требует** real AI/STT provider keys, database, Docker или external app services.
- Secret scan: `git grep -l` (filenames only, не matching lines).
- `.github/**` **сканируется**, не исключается целиком; self-match предотвращается dynamic/split literals в workflow.
- `docs/**` и `.env.example` **исключены** из secret scan — содержат безопасные примеры и placeholder terms.
- RG-36 (`docs/TESTING_STRATEGY.md`): default tests/CI — no secrets, no real provider, no external network except package install.

## Stage 1.1 Decisions

### Database и ORM

| Решение | Значение |
| --- | --- |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Migration tooling | drizzle-kit |
| Driver | `pg` |

**Причины выбора Drizzle:**

- TypeScript-first schema-as-code.
- Lightweight, без тяжёлого runtime framework.
- Подходит для modular monolith.
- Migration generation и reviewable SQL artifacts.
- Проще code review миграций, чем opaque binary/state-only подходы.

**Запрещённые альтернативы на MVP без нового ADR:**

- Prisma
- TypeORM
- Sequelize
- Kysely
- Custom raw SQL-only schema как primary approach

`Kysely` **не используется** параллельно с Drizzle на MVP — один persistence approach.

### Migration strategy

- Migrations генерируются и хранятся в `packages/db/migrations/`.
- Migration files должны быть **reviewable** (явный SQL/артефакты drizzle-kit).
- Destructive migration **запрещена** без explicit ADR или patch контракта.
- **Нет** automatic migration on import.
- Migration execution — только через **explicit command** (например, `pnpm db:migrate` — будет добавлен в Stage 1.1).
- Production DB connection **не требуется** для CI Phase 0 и local gates Stage 1.1 по умолчанию.

### DB client strategy

- `packages/db` может экспортировать schema definitions и client factory.
- **Запрещено:** DB connection at import time.
- **Запрещено:** `.env` parsing side effects at import time.
- `DATABASE_URL` читается только внутри explicit migration/client creation entrypoints.
- Отсутствие `DATABASE_URL` → clear error message **только** при intentional DB command execution.

### Testing strategy для Stage 1.1

Существующие local gates **должны продолжать проходить:**

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm format
```

- Stage 1.1 **не требует** running DB в default CI.
- DB integration tests **отложены** до explicit test DB stage.
- Schema/migration review допускается **без live DB**.

### Scope boundaries для STAGE 1.1

**Разрешено:**

```text
packages/db/**
packages/db/migrations/**
Drizzle config (в packages/db)
DB schema definitions
migration files
.env.example placeholder update (DATABASE_URL comment)
README DB note (минимально)
```

**Запрещено:**

```text
API routes
auth implementation
ACL implementation
AI provider
worker jobs
frontend implementation
Docker/deployment
real secrets
business logic вне DB schema/migration boundaries
```

## Deferred Decisions

Следующие решения **отложены** до отдельного ADR или последующих stages:

| Тема | Статус |
| --- | --- |
| Docker Compose | Deferred |
| Production deployment | Deferred |
| Real DB runtime environment (prod/staging) | Deferred |
| External AI provider integration | Deferred |
| STT provider integration | Deferred |
| Auth provider / session implementation | Deferred (Stage 2) |
| Mobile / PWA packaging | Deferred |
| Observability stack | Deferred |
| Outbox pattern | Deferred |
| Test DB containers | Deferred |
| Local LLM | Deferred |
| Vector DB / RAG | Deferred |
| Web framework (Next.js vs Vite+React) | Deferred до Phase 2+ |
| Validation library (Zod) | Deferred до DTO/API stage |

## Non-Goals

Данный ADR **не** определяет:

- конкретные table DDL для всех entities (см. `docs/DATA_MODEL.md`, Stage 1.1 implementation);
- API endpoint handlers;
- ACL predicates;
- AI provider selection (OpenAI vs local);
- worker scheduler implementation;
- E2E test tooling (Playwright);
- production backup/restore runbooks.

## Validation Gates

Перед merge Stage 1.1:

1. ADR-0001 принят (данный документ).
2. Phase 0 CI green на `main`.
3. Stage 1.1 diff ограничен `packages/db/**`, допустимыми updates `.env.example` и README DB note.
4. Forbidden scope scan CI не триггерится на разрешённые `packages/db/src/schema*` paths (schema — разрешён в Stage 1.1; premature paths вне scope).
5. Codex review против `docs/DATA_MODEL.md` Phase 1 scope.
6. Local gates pass без `DATABASE_URL`.

## References

- `docs/ARCHITECTURE_BASELINE.md`
- `docs/DATA_MODEL.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/TESTING_STRATEGY.md`
- `docs/AI_CONTRACTS.md`
- `docs/WORKER_REMINDER_POLICY.md`
- `docs/ACCESS_CONTROL.md`
- `docs/API_CONTRACTS.md`
