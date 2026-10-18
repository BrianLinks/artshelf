# 0005: Multiplier-based license pricing and derived listing visibility

## Status
Accepted

## Context
Each artwork can be sold under several licenses (Non-Commercial, Commercial, Broadcast). Artists should not have to price every license by hand, a broader license must never cost less than a narrower one, and listings must disappear immediately when their artist is no longer in good standing.

## Decision
- An artist sets one base price in integer cents. Each license price is the base multiplied by a fixed platform multiplier in basis points (10000, 25000, 50000), rounded half up with BigInt arithmetic (`multiplyBps`). Prices are computed on read and never stored per license, so changing the base price updates every license.
- License definitions, including the allowed-use matrix, live in code as pure functions. Broader licenses are strict supersets of narrower ones, and `resale_as_is` is allowed under none.
- Public visibility is derived at query time from three facts: the listing is `published`, the artist profile is `approved`, and the artist account is not disabled. It is not stored as a flag, so it cannot drift.
- Removal by a moderator is terminal. Artists can unpublish and republish their own listings but cannot revive a removed one.
- Listings reference assets with a restrictive foreign key, and the delete endpoint reports `asset_in_use` instead of leaving a listing with a missing file.

## Consequences
- Orders (next milestone) must snapshot the computed license price at purchase time, because multipliers or base prices may change later.
- Changing a multiplier changes the price of every existing listing, which is acceptable at this stage and would need versioned price tables if it ever became a product decision.
- Browsing queries join four tables; the indexes on status, category and price keep this cheap for SQLite at this scale.
