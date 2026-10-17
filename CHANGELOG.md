# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog.

## [Unreleased]

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
