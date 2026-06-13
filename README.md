# AI Task Assistant / Time Management System

Contract-first MVP for a self-hosted personal/family/work task management system with Eisenhower matrix, reminders, AI-assisted classification, voice input, strict access control, privacy-safe audit, and worker-based background jobs.

## Current stage

STAGE 0.4 — CI no-secrets smoke

Application business logic is not implemented yet.

## CI

Stage 0.4 adds a no-secrets smoke workflow.

The CI checks:

- install
- lint
- typecheck
- test
- format
- secret-pattern scan
- forbidden scope scan

The default CI must not require real AI/STT provider keys, databases, Docker, or external services.

The secret scan reports only filenames, not matching lines, to avoid printing secret-like values in CI logs.

## Developer tooling

This repository uses pnpm via Corepack.

Recommended setup:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
corepack pnpm install
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

If `pnpm` is available directly in your shell, the `corepack` prefix can be omitted.

Current commands:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm format`

## Documentation

Core contract documents are stored in `docs/`:

- `TZ_MVP.md`
- `ARCHITECTURE_BASELINE.md`
- `DATA_MODEL.md`
- `ACCESS_CONTROL.md`
- `API_CONTRACTS.md`
- `AI_CONTRACTS.md`
- `TESTING_STRATEGY.md`
- `WORKER_REMINDER_POLICY.md`
- `IMPLEMENTATION_PLAN.md`
- `CURSOR_SYSTEM_PROMPT.md`
- `CODEX_REVIEW_PROMPT.md`

## Implementation rule

All implementation must follow the contract documents first. Any deviation must be documented before code changes.

## Security note

Do not commit secrets, API keys, `.env` files, local databases, generated artifacts, or private runtime data.
