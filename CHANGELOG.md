# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog.

## [Unreleased]

## [1.1.0]

### Added
- Staff console (`#/staff`) for moderators and admins: approve or reject artist profiles, resolve disputed sales and commissions, hide, dismiss or restore reported reviews, and decide copyright notices and counter-notices.
- `GET /api/moderation/orders` and `GET /api/moderation/requests`, which list cases by status (disputed by default).
- A regression test that fails if any link points at a page that does not exist, or if a React effect returns a value.
- Error boundary: a page that fails shows its error instead of a blank screen, and recovers on the next navigation.
- `npm run app` builds the UI and starts the server in one terminal.

### Fixed
- Every link click crashed with "n is not a function": an effect returned the result of `window.scrollTo`, which newer browsers return as a Promise, and React called it as a cleanup function.
- Button-style links in the header (Create account) had dark text on a dark button.
- A lint error and a wrong test expectation from milestone 6.

## [1.0.0] - Milestone 9

### Added
- Artist dashboard: profile, uploads, listing creation, publish and unpublish, earnings.
- Request Board screens: board with filters, posting a request, proposals, accepting, work, delivery, revisions, approval, disputes, withdrawal, history, and reviews of finished commissions.
- Support screens: tickets, replies and a staff queue; a copyright notice form on listings; inbox links for requests and tickets.
- `npm run seed`: demo accounts, procedurally generated artwork, sales, reviews and a request with proposals. It refuses to run in production and is safe to run twice.
- Consolidated API reference in `docs/API.md`.

### Changed
- The order review form is shared with commissions.

## [0.8.0] - Milestone 8

### Added
- React web app (`web/`): home, browse and search (text, color, filters, paging), listing detail with licenses and purchase, login and registration, wallet, orders (confirm, dispute, refund, download, license grant, reviews), inbox and help center.
- Pure, tested client logic: API client, hash router, search state, formatters.
- The API server can serve the built app, with a content security policy and a single-page fallback.
- CI builds the web app.

### Changed
- `Cache-Control: no-store` now applies to API responses only.
- `npm run typecheck` also checks the web project.

## [0.7.0] - Milestone 7

### Added
- Full-text search over listings with SQLite FTS5: prefix matching, accent and case folding, BM25 ranking weighted toward titles and tags, artist and category search.
- Color search ("search by inspiration"): deterministic five-color palettes for every uploaded image, CIELAB palette similarity, search by a wanted color or by similarity to another listing.
- Palettes on listing views, a `reindex` script to rebuild the index and backfill palettes, and a single `/api/search` endpoint combining text, color and the browse filters.

### Fixed
- The migration test no longer assumes exactly one migration follows the table-rebuild migration.

## [0.6.0] - Milestone 6

### Added
- Verified-purchase reviews for completed orders and commissions (one each), editing with an edited marker, abuse reports and a moderator queue (hide, dismiss, restore).
- Integer-only rating summaries with distributions, on listings and per artist.
- Support desk: tickets with a status workflow, internal staff notes, assignment, queue, and a searchable help center whose numbers come from the code's constants.
- Copyright takedown notices with sworn statements, staff decisions, counter-notices and reinstatement.
- In-app notification outbox, with events from orders, commissions, reviews, support and takedowns.

### Changed
- Listings expose a `rating` summary. Removed listings can return to draft only through a successful counter-notice; artists can no longer unpublish a removed listing.

## [0.5.0] - Milestone 5

### Added
- Request Board: clients post paid commission requests, approved artists bid, the client accepts one proposal.
- Commission state machine (open, proposed, accepted, in progress, delivered, revised, completed, disputed, plus cancelled and refunded) with an append-only event history.
- Escrow for commissions on the existing ledger: funding on acceptance, release on approval, refund on withdrawal or dispute resolution.
- Versioned deliveries, revision limits from the accepted proposal, automatic approval after a review period, disputes resolved by moderators and admins.
- Commissions on royalty statements next to listing sales; ledger reconciliation covers request escrow.

### Changed
- The migration runner can rebuild tables safely (foreign keys off, foreign_key_check before commit); migration 5 uses it to let escrow accounts belong to requests.
- Delivered assets can no longer be deleted.

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
