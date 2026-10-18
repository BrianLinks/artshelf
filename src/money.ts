/**
 * Money is always an integer number of cents. Floats never represent money.
 * See docs/adr/0001-money-in-integer-cents.md.
 */
export type Cents = number & { readonly __brand: "Cents" };

export const BPS_DENOMINATOR = 10_000;

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Cents must be a safe integer, got ${value}`);
  }
  return value as Cents;
}

/** Parses a decimal dollar string such as "500", "500.5" or "500.05" into cents. */
export function parseDollars(input: string): Cents {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    throw new RangeError(`Invalid dollar amount: "${input}"`);
  }
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  const total = whole * 100 + fraction;
  return cents(match[1] && total !== 0 ? -total : total);
}

export function formatCents(value: Cents): string {
  const abs = Math.abs(value);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${value < 0 ? "-" : ""}$${dollars}.${remainder}`;
}

/** Returns amount * bps / 10000, rounded half up. Uses BigInt so large amounts cannot overflow. */
export function percentOf(amount: Cents, bps: number): Cents {
  if (amount < 0) throw new RangeError("percentOf requires a non-negative amount");
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new RangeError(`bps must be an integer from 0 to ${BPS_DENOMINATOR}, got ${bps}`);
  }
  const half = BigInt(BPS_DENOMINATOR / 2);
  const result = (BigInt(amount) * BigInt(bps) + half) / BigInt(BPS_DENOMINATOR);
  return cents(Number(result));
}

/** Splits a total into a platform commission and an artist payout. The parts always sum to the total. */
export function splitCommission(total: Cents, commissionBps: number): { commission: Cents; payout: Cents } {
  const commission = percentOf(total, commissionBps);
  return { commission, payout: cents(total - commission) };
}

export const MAX_MULTIPLIER_BPS = 1_000_000;

/** Returns amount * bps / 10000 rounded half up, for multipliers above 100% (for example 25000 bps = 2.5x). */
export function multiplyBps(amount: Cents, bps: number): Cents {
  if (amount < 0) throw new RangeError("multiplyBps requires a non-negative amount");
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_MULTIPLIER_BPS) {
    throw new RangeError(`bps must be an integer from 0 to ${MAX_MULTIPLIER_BPS}, got ${bps}`);
  }
  const half = BigInt(BPS_DENOMINATOR / 2);
  return cents(Number((BigInt(amount) * BigInt(bps) + half) / BigInt(BPS_DENOMINATOR)));
}
