# Security Policy

## Reporting a vulnerability

Please do not open a public issue. Email the maintainer (see the GitHub profile on this repository) with steps to reproduce. Expect an acknowledgement within a few days.

## What is in place

- Passwords hashed with bcrypt (cost configurable, at least 10 enforced in production), 12 to 72 bytes accepted.
- Session tokens are 256-bit random values. Only their SHA-256 hash is stored.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- State-changing requests carrying a foreign `Origin` header are rejected.
- Login and registration are rate limited per IP.
- Login responses do not reveal whether an email exists, and a dummy hash is compared for unknown emails to even out timing.
- Role and account changes are audited. Admins cannot demote or disable themselves.
- Privileged roles cannot be chosen at registration.
- Uploads are identified by content (magic bytes), never by filename or client MIME type, and must be allowed for the chosen category. SVG, HTML and GIF are not accepted.
- Images are fully decoded with a pixel cap before being stored, so files that only start with an image header are rejected.
- Stored files get generated names; the storage layer rejects any name outside that pattern, so path traversal is not possible. Client filenames are sanitized for display only.
- Per-upload size limits and per-user quotas are enforced; duplicate uploads are rejected.
- Uploaded files are visible only to their owner, moderators and admins, and other users receive 404.
- Listing prices are validated integer cents within fixed bounds, and license prices are computed server-side, never accepted from the client.
- Draft and removed listings are hidden behind 404 for everyone except the owner, moderators and admins.
- Ledger tables are append-only (database triggers) and every entry must balance to zero; an admin endpoint reconciles the ledger against orders and reports any drift.
- Orders, purchased files and license grants are visible only to the people involved (plus moderators and admins for order detail); everyone else gets 404.
- Purchases, escrow moves and refunds run inside single database transactions together with their ledger entries and audit records, so a failure leaves nothing half-done.
- Commission state changes go through a single transition function backed by a tested state machine, with actor checks on top, so a client cannot approve disputed work and an artist cannot withdraw frozen funds.
- Request history is append-only (database triggers). Delivered files are visible to the two parties, and to staff only while a request is disputed.
- No secrets are committed. Configuration comes from the environment and is validated at startup.

## Known limitations

- Payments are simulated: any signed-in client or artist can top up their own wallet. Real payments would need a provider, webhooks and idempotency keys.
- Statements are not paginated yet.
- Zip, PDF, audio and video files are checked by signature only, not parsed. Treat them as untrusted downloads; they are served as attachments.
- Registration returns 409 for an existing email, which reveals that the email is registered.
- Rate limiting is in-process and per IP. Behind a reverse proxy, configure Express `trust proxy` before relying on it.
- There is no password reset, email verification, or multi-factor authentication yet.
