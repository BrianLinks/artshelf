# 0006: Escrow orders on an append-only double-entry ledger

## Status
Accepted

## Context
The marketplace holds buyer funds until a sale is accepted, takes a commission and pays artists. Mutable balance columns make it easy to lose or invent money without anyone noticing, and the platform needs a trail it can audit and reconcile.

## Decision
- Money moves only through journal entries with signed lines that sum to zero. There is no stored balance: a balance is the sum of an account's lines.
- Accounts: `external` (where simulated deposits come from), `platform_revenue`, one wallet per user, and one escrow account per order. A wallet may never go negative; the check and the debit happen in one transaction.
- Ledger tables are append-only, enforced by triggers, so corrections are new entries, never edits.
- An order records price, commission rate, commission and payout when it is placed. Commission is by artist tier (standard 15%, premium 10%) and is computed once with `splitCommission`, so commission and payout always add up to the price (also enforced by a database CHECK).
- Escrow lifecycle: `escrow -> completed | refunded | disputed`, `disputed -> completed | refunded`. The buyer confirms or disputes; the artist may refund; unconfirmed orders auto-release after `ESCROW_HOLD_DAYS`; only moderators or admins settle disputes. Disputed orders never auto-release.
- A purchase is unique per buyer, listing and license while it is not refunded, enforced by a partial unique index.
- `verifyLedger` checks that every entry balances, no wallet is overdrawn, each order's escrow matches its status, and platform revenue equals the commission of completed orders.

## Consequences
- Any future money feature (commission payments for the request board, withdrawals, royalties from other sources) is a new entry kind plus tests, not new balance logic.
- Real payments would plug in at the `external` account with idempotency keys; the simulated deposit endpoint would then be removed.
- Balances are computed with SUM queries, which is fine at this scale; a materialised balance could be added later without changing the entries.
