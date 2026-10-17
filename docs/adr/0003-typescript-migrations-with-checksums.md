# 0003: Migrations are TypeScript modules with checksums

## Status
Accepted

## Context
The schema must be versioned and reproducible. Reading `.sql` files at runtime needs extra build steps to copy them into `dist/`.

## Decision
Each migration is a TypeScript module exporting `{ id, name, sql }`, registered in order in `src/db/migrations/index.ts`. The runner applies each pending migration in its own transaction and records a SHA-256 checksum of its SQL in `schema_migrations`. On later runs an applied migration whose SQL changed causes an error.

## Consequences
- Applied migrations are immutable; fixes go in a new migration.
- A failing migration rolls back completely and leaves no partial schema.
- Migrations compile with the rest of the code, so no asset copying is needed.
