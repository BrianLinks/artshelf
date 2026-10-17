# 0001: Money is stored and computed as integer cents

## Status
Accepted

## Context
The marketplace will hold escrow, take commissions and produce royalty statements. Floating point cannot represent most decimal amounts exactly, so repeated arithmetic drifts and totals stop adding up.

## Decision
Every monetary value is an integer count of cents, typed as a branded `Cents` in TypeScript and stored in `INTEGER` columns. Percentages are basis points (1 bps = 0.01%). `percentOf` uses BigInt and rounds half up. `splitCommission` computes the commission once and derives the payout by subtraction, so the two parts always sum to the total.

## Consequences
- Totals are exact and auditable.
- Every boundary that accepts a decimal string must go through `parseDollars`.
- Multi-currency support would need a currency column alongside each amount; it is out of scope for now.
