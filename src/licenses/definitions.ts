import { multiplyBps, type Cents } from "../money.js";

export const LICENSE_TYPES = ["non_commercial", "commercial", "broadcast"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const USES = ["personal_use", "social_media", "product_packaging", "advertising", "broadcast", "resale_as_is"] as const;
export type Use = (typeof USES)[number];

export interface LicenseDefinition {
  name: string;
  /** Price as a multiple of the listing's base price, in basis points (10000 = 1x). */
  priceMultiplierBps: number;
  allowedUses: readonly Use[];
}

const NON_COMMERCIAL_USES: readonly Use[] = ["personal_use", "social_media"];
const COMMERCIAL_USES: readonly Use[] = [...NON_COMMERCIAL_USES, "product_packaging", "advertising"];

/** "resale_as_is" is deliberately absent everywhere: no license lets a buyer resell the artwork itself. */
export const LICENSES: Record<LicenseType, LicenseDefinition> = {
  non_commercial: { name: "Non-Commercial", priceMultiplierBps: 10_000, allowedUses: NON_COMMERCIAL_USES },
  commercial: { name: "Commercial", priceMultiplierBps: 25_000, allowedUses: COMMERCIAL_USES },
  broadcast: { name: "Broadcast", priceMultiplierBps: 50_000, allowedUses: [...COMMERCIAL_USES, "broadcast"] },
};

export function isUseAllowed(license: LicenseType, use: Use): boolean {
  return LICENSES[license].allowedUses.includes(use);
}

export function licensePrice(basePriceCents: Cents, license: LicenseType): Cents {
  return multiplyBps(basePriceCents, LICENSES[license].priceMultiplierBps);
}
