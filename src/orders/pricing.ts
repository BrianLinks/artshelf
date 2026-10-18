import type { Tier } from "../artists/profiles.js";
import { splitCommission, type Cents } from "../money.js";

/** Platform commission by artist tier, in basis points. Premium artists keep more of each sale. */
export const COMMISSION_BPS: Record<Tier, number> = {
  standard: 1_500,
  premium: 1_000,
};

export function priceOrder(price: Cents, tier: Tier): { commissionBps: number; commission: Cents; payout: Cents } {
  const commissionBps = COMMISSION_BPS[tier];
  return { commissionBps, ...splitCommission(price, commissionBps) };
}
