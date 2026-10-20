export const REVIEW_STATUSES = ["visible", "flagged", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** visible -> flagged when someone reports it; staff then hide it or dismiss the reports; hidden reviews can be restored. */
export const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  visible: ["flagged", "hidden"],
  flagged: ["visible", "hidden"],
  hidden: ["visible"],
};

export function canMoveReview(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}
