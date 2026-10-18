import { describe, expect, it } from "vitest";
import { isUseAllowed, LICENSE_TYPES, LICENSES, licensePrice, USES } from "../src/licenses/definitions.js";
import { cents } from "../src/money.js";

describe("license pricing", () => {
  it("prices each license as a multiple of the base price", () => {
    expect(licensePrice(cents(50_000), "non_commercial")).toBe(50_000);
    expect(licensePrice(cents(50_000), "commercial")).toBe(125_000);
    expect(licensePrice(cents(50_000), "broadcast")).toBe(250_000);
  });

  it("rounds half up and always returns whole cents", () => {
    expect(licensePrice(cents(101), "commercial")).toBe(253);
    for (const base of [100, 199, 1_001, 9_999, 10_000_000]) {
      for (const license of LICENSE_TYPES) expect(Number.isInteger(licensePrice(cents(base), license))).toBe(true);
    }
  });

  it("never prices a broader license below a narrower one", () => {
    for (const base of [100, 101, 999, 12_345]) {
      const prices = LICENSE_TYPES.map((license) => licensePrice(cents(base), license));
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    }
  });
});

describe("allowed uses", () => {
  it("allows personal and social media use under every license", () => {
    for (const license of LICENSE_TYPES) {
      expect(isUseAllowed(license, "personal_use")).toBe(true);
      expect(isUseAllowed(license, "social_media")).toBe(true);
    }
  });

  it("reserves advertising and packaging for commercial licenses", () => {
    expect(isUseAllowed("non_commercial", "advertising")).toBe(false);
    expect(isUseAllowed("non_commercial", "product_packaging")).toBe(false);
    expect(isUseAllowed("commercial", "advertising")).toBe(true);
    expect(isUseAllowed("commercial", "product_packaging")).toBe(true);
  });

  it("reserves broadcast for the broadcast license", () => {
    expect(isUseAllowed("commercial", "broadcast")).toBe(false);
    expect(isUseAllowed("broadcast", "broadcast")).toBe(true);
  });

  it("never lets a buyer resell the artwork as-is", () => {
    for (const license of LICENSE_TYPES) expect(isUseAllowed(license, "resale_as_is")).toBe(false);
  });

  it("nests: each broader license includes everything the narrower one allows", () => {
    for (const use of USES) {
      if (isUseAllowed("non_commercial", use)) expect(isUseAllowed("commercial", use)).toBe(true);
      if (isUseAllowed("commercial", use)) expect(isUseAllowed("broadcast", use)).toBe(true);
    }
    expect(LICENSES.broadcast.allowedUses.length).toBeGreaterThan(LICENSES.commercial.allowedUses.length);
  });
});
