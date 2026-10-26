import { describe, expect, it } from "vitest";
import { canMoveReview, REVIEW_STATUSES, REVIEW_TRANSITIONS } from "../src/reviews/machine.js";
import { canMoveTicket, TICKET_STATUSES, TICKET_TRANSITIONS } from "../src/support/tickets.js";
import { ACTIVE_NOTICE_STATUSES, canMoveNotice, NOTICE_STATUSES, NOTICE_TRANSITIONS } from "../src/takedowns/machine.js";

describe("review moderation states", () => {
  it("only lets a reported review be hidden or cleared, and a hidden one be restored", () => {
    expect(canMoveReview("visible", "flagged")).toBe(true);
    expect(canMoveReview("flagged", "visible")).toBe(true);
    expect(canMoveReview("flagged", "hidden")).toBe(true);
    expect(canMoveReview("hidden", "visible")).toBe(true);
    expect(canMoveReview("hidden", "flagged")).toBe(false);
    expect(canMoveReview("visible", "visible")).toBe(false);
  });

  it("covers every status", () => {
    expect(Object.keys(REVIEW_TRANSITIONS).sort()).toEqual([...REVIEW_STATUSES].sort());
  });
});

describe("support ticket states", () => {
  it("never leaves the closed state", () => {
    for (const target of TICKET_STATUSES) expect(canMoveTicket("closed", target)).toBe(false);
  });

  it("lets a resolved ticket be reopened or closed but not marked waiting", () => {
    expect(canMoveTicket("resolved", "open")).toBe(true);
    expect(canMoveTicket("resolved", "closed")).toBe(true);
    expect(canMoveTicket("resolved", "pending_user")).toBe(false);
  });

  it("covers every status and only known targets", () => {
    expect(Object.keys(TICKET_TRANSITIONS).sort()).toEqual([...TICKET_STATUSES].sort());
    for (const targets of Object.values(TICKET_TRANSITIONS)) for (const t of targets) expect(TICKET_STATUSES).toContain(t);
  });
});

describe("takedown notice states", () => {
  it("follows notice, counter-notice and decision in order", () => {
    expect(canMoveNotice("received", "upheld")).toBe(true);
    expect(canMoveNotice("received", "rejected")).toBe(true);
    expect(canMoveNotice("upheld", "counter_noticed")).toBe(true);
    expect(canMoveNotice("counter_noticed", "reinstated")).toBe(true);
    expect(canMoveNotice("counter_noticed", "closed")).toBe(true);
  });

  it("does not let a notice skip a step", () => {
    expect(canMoveNotice("received", "reinstated")).toBe(false);
    expect(canMoveNotice("received", "counter_noticed")).toBe(false);
    expect(canMoveNotice("upheld", "reinstated")).toBe(false);
    expect(canMoveNotice("rejected", "upheld")).toBe(false);
  });

  it("has three terminal states and treats the others as active", () => {
    const terminal = NOTICE_STATUSES.filter((status) => NOTICE_TRANSITIONS[status].length === 0);
    expect([...terminal].sort()).toEqual(["closed", "reinstated", "rejected"]);
    expect([...ACTIVE_NOTICE_STATUSES].sort()).toEqual(["counter_noticed", "received", "upheld"]);
  });
});
