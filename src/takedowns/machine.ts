/**
 * DMCA-style notice and counter-notice flow.
 * received -> upheld (listing removed) or rejected; upheld -> counter_noticed (artist objects);
 * counter_noticed -> reinstated (listing restored as a draft) or closed (removal stands).
 */
export const NOTICE_STATUSES = ["received", "upheld", "rejected", "counter_noticed", "reinstated", "closed"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

export const NOTICE_TRANSITIONS: Record<NoticeStatus, readonly NoticeStatus[]> = {
  received: ["upheld", "rejected"],
  upheld: ["counter_noticed"],
  counter_noticed: ["reinstated", "closed"],
  rejected: [],
  reinstated: [],
  closed: [],
};

/** Statuses in which a notice still needs someone's attention. */
export const ACTIVE_NOTICE_STATUSES: readonly NoticeStatus[] = ["received", "upheld", "counter_noticed"];

export function canMoveNotice(from: NoticeStatus, to: NoticeStatus): boolean {
  return NOTICE_TRANSITIONS[from].includes(to);
}
