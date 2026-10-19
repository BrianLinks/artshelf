/** The Request Board lifecycle as a pure transition table. No database access here. */
export const REQUEST_STATUSES = [
  "open",
  "proposed",
  "accepted",
  "in_progress",
  "delivered",
  "revised",
  "completed",
  "disputed",
  "cancelled",
  "refunded",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  open: ["proposed", "cancelled"],
  proposed: ["open", "accepted", "cancelled"],
  accepted: ["in_progress", "disputed", "refunded"],
  in_progress: ["delivered", "disputed", "refunded"],
  delivered: ["revised", "completed", "disputed"],
  revised: ["delivered", "disputed", "refunded"],
  disputed: ["completed", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

/** Statuses in which the client's payment sits in escrow. */
export const ESCROWED_STATUSES = ["accepted", "in_progress", "delivered", "revised", "disputed"] as const;

/** Statuses shown on the public board. */
export const BOARD_STATUSES = ["open", "proposed"] as const;

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
