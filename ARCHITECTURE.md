# Architecture

## Layers

```
src/
  server.ts          process entry: config, database, migrations, HTTP listener, shutdown
  config.ts          environment parsing and validation (zod)
  money.ts           integer-cent money helpers
  db/                connection, migration runner, migration modules
  auth/              users, passwords, sessions, roles, audit log (no HTTP knowledge)
  catalog/           category lookups and per-category upload rules
  artists/           artist profiles, approval state machine, tiers
  reviews/           verified-purchase reviews, rating math, report moderation
  support/           support tickets and the help center
  takedowns/         copyright notice and counter-notice flow
  notifications/     in-app outbox
  requests/          request board: state machine, repository, service
  ledger/            double-entry ledger, wallet operations, reconciliation
  orders/            order repository, escrow service, commission pricing
  royalties/         artist royalty statements
  licenses/          license types, price multipliers and allowed-use matrix (pure functions)
  listings/          listing repository (queries, views) and service (create, edit, publish, remove)
  assets/            magic-byte detection, image processing, local storage, upload service, asset repository
  errors.ts          DomainError: business failures carrying a code the HTTP layer maps to a status
  http/              Express app, middleware, error handling, route modules
  scripts/           operational commands (migrate, create-admin)
tests/               Vitest suites; HTTP tests use supertest against an in-memory database
```

Dependencies point one way: `http` depends on `auth` and `db`; `auth` depends on `db`; `db` depends on nothing in the app. Domain modules take a `Db` as an argument rather than importing a global, so tests build an isolated in-memory database per case.

## Request flow

`securityHeaders` -> JSON body parser (16 kb limit) -> `sameOriginGuard` -> `authenticate` (attaches `req.user` from the session cookie, never rejects) -> router -> `requireAuth` / `requireRole` -> handler -> `errorHandler`.

Authorization is declared where routes are mounted. The admin router applies `requireRole("admin")` to every route it owns, so a new admin route cannot be added without protection.

## Data

SQLite with `foreign_keys = ON` and WAL. Schema changes are TypeScript migration modules applied in order and checksummed (ADR 0003). Tables so far: `users`, `sessions`, `audit_log`, `schema_migrations`, `categories` (seeded), `artist_profiles`, `assets`, `listings`, `listing_licenses`, `listing_tags`, `orders`, `accounts`, `journal_entries`, `ledger_lines`, `requests`, `proposals`, `request_deliveries`, `request_events`, `reviews`, `review_flags`, `tickets`, `ticket_messages`, `takedown_notices`, `notifications`. Timestamps are ISO-8601 UTC strings. Money will be integer cents (ADR 0001).

## Validation and errors

All untrusted input is parsed with zod at the boundary through `parse()`, which throws a 400 `HttpError` listing every problem. Handlers throw `HttpError` for expected failures; anything else becomes a generic 500 and is logged, never echoed.

## Artist profiles

A profile starts `pending`. Moderators or admins move it `pending -> approved | rejected`, `approved -> rejected`, `rejected -> approved`; anything else is a 409. An artist editing a rejected profile resubmits it as `pending`. Only approved profiles of active users appear in public listings. Tier changes are admin-only. Every transition is audited.

## Listings and licenses

A listing wraps one owned asset (the category comes from the asset) with a title, base price, enabled license types and tags. Status moves `draft <-> published`, and `draft | published -> removed`; removed is terminal and only moderators can cause it. A listing is publicly visible only while it is published and its artist is approved and active, so approving, rejecting or disabling an artist immediately changes what the public sees. Publishing requires an approved artist profile. Drafts and removed listings are visible only to the owner, moderators and admins; everyone else gets 404. An asset cannot be deleted while a listing references it. See ADR 0005.

## Orders and the ledger

Every movement of money is a journal entry whose lines sum to zero; an account's balance is the sum of its lines, and the ledger tables reject UPDATE and DELETE. Accounts are: one `external` source, one `platform_revenue`, a wallet per user and an escrow per order. Buying moves price from the buyer's wallet into the order's escrow (refused if the wallet is short). Releasing moves it from escrow to the artist's wallet (payout) and platform revenue (commission). Refunding moves it back to the buyer. Orders move `escrow -> completed | refunded | disputed` and `disputed -> completed | refunded`; completed and refunded are terminal. Every order snapshots price, commission rate, commission and payout at purchase, so later listing or tier changes never rewrite history. `verifyLedger` re-checks all of this from the stored rows. See ADR 0006.

## Request board

A client posts a request; approved artists bid; the client accepts one bid, which funds an escrow account for that request. Status follows a transition table in `requests/machine.ts`: `open <-> proposed -> accepted -> in_progress -> delivered <-> revised`, then `completed`; `disputed` can be entered from any funded state; `cancelled` (before acceptance) and `refunded` and `completed` are terminal. The table says which moves exist; the service adds who may make them (for example only the client approves, only staff resolve a dispute). Every move goes through one function that updates the status and appends to `request_events`, an append-only history. The accepted proposal's price, commission and revision allowance are snapshotted on the request. Delivered files are versioned, stay private to the parties (staff only during a dispute) and cannot be deleted. Unanswered deliveries are approved automatically after `REQUEST_AUTO_APPROVE_DAYS`. See ADR 0007.

## Reviews, support and takedowns

Reviews are gated by completion: only the buyer of a completed order or the client of a completed commission can review, once each (partial unique indexes). Ratings are computed from counts per star with integer arithmetic (no float drift); hidden reviews never count and reported ones count until staff decide. Support tickets and takedown notices each have a small tested transition table, ticket messages are append-only, and internal staff notes are filtered out for requesters. A successful takedown counter-notice is the only way a removed listing returns, and it returns as a draft. Business events write to the notifications outbox inside the same transaction as the change that caused them. The help center's numbers (commission rates, license multiples, upload limits) are generated from the same constants the code uses. See ADR 0008.

## Upload pipeline

`uploadAsset` runs cheap checks first and writes to disk last: known category, non-empty, size limit (the lower of the category cap and `MAX_UPLOAD_MB`), format from magic bytes, format allowed for the category, full image decode with a pixel cap, duplicate hash per owner, per-user quota. Files are stored under generated names only (`<32 hex>.<ext>`); the client filename is sanitized and kept for display. If the database insert fails the written files are removed. See ADR 0004.

## Planned

Orders and double-entry ledger, request board state machine, reviews, support desk, search, React UI. Each will follow the same layering.
