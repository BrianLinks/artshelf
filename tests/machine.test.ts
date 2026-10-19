import { describe, expect, it } from "vitest";
import {
  BOARD_STATUSES,
  canTransition,
  ESCROWED_STATUSES,
  isTerminal,
  REQUEST_STATUSES,
  TRANSITIONS,
  type RequestStatus,
} from "../src/requests/machine.js";

describe("request state machine", () => {
  it("defines transitions for every status, and only to known statuses", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...REQUEST_STATUSES].sort());
    for (const targets of Object.values(TRANSITIONS)) {
      for (const target of targets) expect(REQUEST_STATUSES).toContain(target);
    }
  });

  it("has exactly three terminal statuses", () => {
    expect(REQUEST_STATUSES.filter(isTerminal).sort()).toEqual(["cancelled", "completed", "refunded"]);
    for (const status of ["completed", "cancelled", "refunded"] as const) {
      for (const target of REQUEST_STATUSES) expect(canTransition(status, target)).toBe(false);
    }
  });

  it("lets every non-terminal status reach a terminal one", () => {
    for (const start of REQUEST_STATUSES) {
      const seen = new Set<RequestStatus>([start]);
      const queue: RequestStatus[] = [start];
      while (queue.length > 0) {
        const current = queue.shift() as RequestStatus;
        for (const next of TRANSITIONS[current]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].some(isTerminal)).toBe(true);
    }
  });

  it("only funds a request on acceptance of a proposal", () => {
    for (const status of REQUEST_STATUSES) {
      if (status !== "proposed") expect(canTransition(status, "accepted")).toBe(false);
    }
    expect(canTransition("proposed", "accepted")).toBe(true);
  });

  it("releases money to the artist only from delivered or disputed", () => {
    const into = REQUEST_STATUSES.filter((status) => canTransition(status, "completed"));
    expect(into.sort()).toEqual(["delivered", "disputed"]);
  });

  it("never allows skipping straight from acceptance to delivery", () => {
    expect(canTransition("accepted", "delivered")).toBe(false);
    expect(canTransition("accepted", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "delivered")).toBe(true);
    expect(canTransition("delivered", "revised")).toBe(true);
    expect(canTransition("revised", "delivered")).toBe(true);
  });

  it("holds client money in escrow exactly while work is funded", () => {
    expect([...ESCROWED_STATUSES].sort()).toEqual(["accepted", "delivered", "disputed", "in_progress", "revised"]);
    for (const status of ["open", "proposed", "cancelled", "completed", "refunded"] as const) {
      expect(ESCROWED_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it("shows only open and proposed requests on the board", () => {
    expect([...BOARD_STATUSES]).toEqual(["open", "proposed"]);
  });
});
