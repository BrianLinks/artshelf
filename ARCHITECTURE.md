# Architecture

## Layers

```
src/
  server.ts          process entry: config, database, migrations, HTTP listener, shutdown
  config.ts          environment parsing and validation (zod)
  money.ts           integer-cent money helpers
  db/                connection, migration runner, migration modules
  auth/              users, passwords, sessions, roles, audit log (no HTTP knowledge)
  http/              Express app, middleware, error handling, route modules
  scripts/           operational commands (migrate, create-admin)
tests/               Vitest suites; HTTP tests use supertest against an in-memory database
```

Dependencies point one way: `http` depends on `auth` and `db`; `auth` depends on `db`; `db` depends on nothing in the app. Domain modules take a `Db` as an argument rather than importing a global, so tests build an isolated in-memory database per case.

## Request flow

`securityHeaders` -> JSON body parser (16 kb limit) -> `sameOriginGuard` -> `authenticate` (attaches `req.user` from the session cookie, never rejects) -> router -> `requireAuth` / `requireRole` -> handler -> `errorHandler`.

Authorization is declared where routes are mounted. The admin router applies `requireRole("admin")` to every route it owns, so a new admin route cannot be added without protection.

## Data

SQLite with `foreign_keys = ON` and WAL. Schema changes are TypeScript migration modules applied in order and checksummed (ADR 0003). Tables so far: `users`, `sessions`, `audit_log`, `schema_migrations`. Timestamps are ISO-8601 UTC strings. Money will be integer cents (ADR 0001).

## Validation and errors

All untrusted input is parsed with zod at the boundary through `parse()`, which throws a 400 `HttpError` listing every problem. Handlers throw `HttpError` for expected failures; anything else becomes a generic 500 and is logged, never echoed.

## Planned

Artist profiles and uploads, license engine, orders and double-entry ledger, request board state machine, reviews, support desk, search, React UI. Each will follow the same layering.
