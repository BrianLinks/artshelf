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
- No secrets are committed. Configuration comes from the environment and is validated at startup.

## Known limitations

- Registration returns 409 for an existing email, which reveals that the email is registered.
- Rate limiting is in-process and per IP. Behind a reverse proxy, configure Express `trust proxy` before relying on it.
- There is no password reset, email verification, or multi-factor authentication yet.
