# 0002: Server-side sessions with opaque tokens

## Status
Accepted

## Context
Sessions must be revocable (disabling an account, logout) and role changes must take effect immediately. Signed stateless tokens (such as JWTs) make both harder.

## Decision
On login the server generates a random 256-bit token, stores only its SHA-256 hash with an expiry, and sends the token in an `HttpOnly`, `SameSite=Lax` cookie. Each request resolves the cookie by joining `sessions` to `users`, so the current role and disabled state are always read fresh.

## Consequences
- Revocation is a single DELETE; disabling a user deletes all of their sessions.
- A database leak does not yield usable cookies.
- Every authenticated request costs one indexed query, which is acceptable for SQLite on a single node.
- Expired rows are purged hourly by the server.
