# 0008: Gated reviews, staff-visible support, takedown flow and a transactional outbox

## Status
Accepted

## Context
Trust features need to resist abuse without becoming a moderation burden: fake reviews, review bombing, harassment through support, and false copyright claims. They also need an audit trail and must not leak private data.

## Decision
- Reviews exist only for completed orders or commissions, enforced by partial unique indexes (one per order, one per commission) and service checks, so a review is always a verified purchase.
- Ratings are summarized from per-star counts using integer arithmetic and half-up rounding; the same summary type is used for artists and listings. Reported reviews stay visible and counted until staff decide, so reports alone cannot silence or distort a rating; hidden reviews are excluded.
- Review moderation, support tickets and takedown notices are each a small explicit transition table with tests. Public review views omit moderation state.
- Support ticket messages are append-only, and internal staff notes are filtered in the query for requesters, not only in the UI.
- A takedown notice needs sworn good-faith and accuracy statements and a signature. Upholding removes the listing; the artist may file a signed counter-notice; staff then reinstate (as a draft) or close the case. Removal stays terminal everywhere else, and `unpublish` is now limited to published listings.
- Notifications are rows in an outbox table written in the same transaction as the event, so they cannot be lost or sent for a rolled-back change. No mail provider is used.
- Help articles are generated from the same constants as the code (commission rates, license multipliers, upload limits) and a test checks the numbers.

## Consequences
- Adding a notification means one `notify` call inside the service transaction.
- Email delivery could later be a worker that reads unsent outbox rows; nothing else would change.
- A claimant with repeated rejected notices is not penalised yet; a repeat-offender policy would build on the notice history.
