# API reference

All endpoints live under `/api`, speak JSON, and are documented by route in the [README](../README.md#api). This page covers the conventions they share.

## Authentication

Sign in with `POST /api/auth/login` (or `register`). The server sets an `HttpOnly`, `SameSite=Lax` session cookie; send it back on later requests. There are no API keys or bearer tokens. State-changing requests that carry an `Origin` header for another host are refused.

Roles: `client`, `artist`, `moderator`, `admin`. Anyone may register as a client or an artist; moderators and admins are created by an administrator. A role check that fails returns `403`; a missing session returns `401`. Resources that belong to someone else usually answer `404`, so ids do not leak.

## Errors

Every failure has the same shape:

```json
{ "error": { "code": "insufficient_funds", "message": "Your wallet balance is too low", "details": [] } }
```

`code` is stable and meant for programs; `message` is for people; `details` appears on validation errors as a list of `{ "path", "message" }`.

| Status | Meaning | Example codes |
|---|---|---|
| 400 | The request is malformed or breaks a rule | `validation_error`, `unknown_category`, `invalid_asset`, `price_exceeds_budget`, `no_palette`, `license_not_offered` |
| 401 | Not signed in | `unauthenticated`, `invalid_credentials` |
| 402 | Wallet balance too low | `insufficient_funds` |
| 403 | Signed in but not allowed | `forbidden`, `cross_origin` |
| 404 | Missing, or not yours to see | `not_found` |
| 409 | The action is not valid in the current state | `invalid_order_state`, `invalid_request_state`, `already_purchased`, `already_reviewed`, `asset_in_use`, `profile_not_approved` |
| 413 | Too large | `too_large`, `quota_exceeded`, `payload_too_large` |
| 415 | Unsupported file type | `unsupported_type`, `type_not_allowed` |
| 422 | The file could not be decoded | `invalid_image` |
| 429 | Too many attempts | `rate_limited`, `too_many_tickets` |

## Money

Every amount is an integer number of cents, in fields named `...Cents`. There are no decimals anywhere in the API. Percentages are basis points (`1500` is 15%). Prices of the three licenses are the listing's base price times 1, 2.5 and 5, rounded half up. A platform commission (15% for standard artists, 10% for premium) is fixed on each order or commission when it is created.

## Lists and paging

List endpoints take `limit` (1 to 100, default 20) and `offset`, and return `total` where the full count is useful. Search and browse results are public and only ever include published listings by approved, active artists.

## Files

Upload with `POST /api/assets?category=<slug>&filename=<name>` and a raw `application/octet-stream` body. The type is decided from the file's content; the category decides which types and sizes are accepted (`GET /api/categories` lists them). Originals are private to their owner (and staff); the public sees a WebP preview. A buyer downloads a purchase through the order, and a client downloads a commission delivery through the request.

## Workflows

| Workflow | States |
|---|---|
| Artist profile | `pending` -> `approved` or `rejected`; `approved` -> `rejected`; `rejected` -> `approved`; editing a rejected profile resubmits it |
| Listing | `draft` <-> `published`; `draft` or `published` -> `removed`; `removed` -> `draft` only through a successful counter-notice |
| Order | `escrow` -> `completed`, `refunded` or `disputed`; `disputed` -> `completed` or `refunded` |
| Request | `open` <-> `proposed` -> `accepted` -> `in_progress` -> `delivered` <-> `revised` -> `completed`; `disputed` from any funded state; `cancelled` before acceptance; `refunded` on withdrawal or a refund decision |
| Review | `visible` -> `flagged` -> `visible` or `hidden`; `hidden` -> `visible` |
| Ticket | `open` <-> `pending_user`; either -> `resolved` or `closed`; `resolved` -> `open` or `closed` |
| Copyright notice | `received` -> `upheld` or `rejected`; `upheld` -> `counter_noticed` -> `reinstated` or `closed` |

## Staff endpoints

Moderators and admins use `/api/moderation/...` (approve or reject artist profiles, list disputed orders and requests, resolve disputes, handle review reports, decide copyright notices, remove listings), `/api/support/queue`, and admins also use `/api/admin/...` (users, roles, artist tiers, ledger verification). The web app's staff console (`#/staff`) covers artist approvals, disputes, review reports and copyright notices, and the support page has the ticket queue. Listing removal and user administration (roles, tiers, disabling accounts) are API-only.
