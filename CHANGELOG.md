# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog.

## [Unreleased]

## [0.4.0] - Milestone 4

### Added
- Double-entry ledger with append-only tables, simulated wallet top-ups and a reconciliation report.
- Orders with escrow: purchase, buyer confirmation, automatic release after the hold period, artist refund, buyer dispute and moderator resolution.
- Tier-based platform commission, snapshotted on every order, with exact split arithmetic.
- Buyer downloads of the original file and a license grant document per order.
- Royalty statements with date ranges and pending-escrow totals.

## [0.3.0] - Milestone 3

### Added
- License engine: Non-Commercial, Commercial and Broadcast definitions with price multipliers and an allowed-use matrix that never permits reselling the artwork as-is.
- Listings with tags, per-license computed prices, publish and unpublish, owner editing and moderator takedown.
- Public browsing with category, license, price range, tag and artist filters, sorting and pagination, plus a public WebP preview.
- License-check endpoint and a public license definitions endpoint.
- `multiplyBps` for exact multiplier pricing above 100%.

### Changed
- Assets referenced by a listing can no longer be deleted.
- Migration tests no longer hard-code migration ids.

## [0.2.0] - Milestone 2

### Added
- Category taxonomy (eight categories) with per-category upload rules.
- Artist profiles with a moderator approval state machine, resubmission after rejection, and admin-controlled tiers.
- Upload pipeline: magic-byte format detection, per-category formats and size caps, full image decoding, WebP thumbnails, duplicate detection, per-user quotas and safe generated storage names.
- Asset endpoints with owner, moderator and admin access, and deletion that removes files.
- Domain errors mapped to HTTP statuses; 413 handling for oversized request bodies.

## [0.1.0] - Milestone 1

### Added
- TypeScript, ESLint, Vitest, GitHub Actions CI and Dependabot configuration.
- Versioned, checksummed SQLite migrations.
- Accounts with client, artist, moderator and admin roles.
- Server-side sessions with hashed tokens, login, logout and rate limiting.
- Admin endpoints for listing users, changing roles and disabling accounts, with an audit log.
- Integer-cent money helpers with half-up commission rounding.
