# 0007: Commission requests as an explicit state machine on the shared escrow ledger

## Status
Accepted

## Context
Custom commissions have a longer, branching lifecycle than buying a listing: bids, acceptance, work, delivery, revisions, disputes and several ways to end. Ad-hoc status updates scattered across handlers would make illegal combinations (approving frozen work, paying twice) easy to introduce.

## Decision
- The lifecycle is a pure transition table (`requests/machine.ts`) with its own tests: terminal states have no exits, only `delivered` and `disputed` can lead to `completed`, and funding happens only on acceptance of a proposal.
- A single `move` function in the service performs every status change. It checks the table, updates the row and appends an event, all inside the caller's transaction. Actor rules sit on top in each operation (the table alone would let the client approve a disputed request).
- Money reuses the ledger from ADR 0006. A request has its own escrow account; funding, release and refund are the same kinds of entries as for orders. `accounts` gained a nullable `request_id`, with a CHECK that an escrow account belongs to exactly one of an order or a request.
- SQLite cannot alter a CHECK constraint, so migration 5 rebuilds `accounts` using the documented procedure. The runner now supports a `rebuildsTables` flag: foreign keys are switched off around the migration, `foreign_key_check` must be empty before commit, and foreign keys are switched back on even on failure.
- The accepted proposal's price, commission and revision allowance are copied onto the request, so later profile or tier changes cannot alter an agreed deal.
- History is append-only (triggers), mirroring the ledger.

## Consequences
- New states or transitions are a change to the table plus tests, and the service cannot bypass them.
- Orders and requests duplicate a little release and refund code; a shared escrow helper is a possible later refactor.
- Auto-approval protects artists from unresponsive clients; disputes stop that clock.
