import type { Format } from "../assets/signatures.js";

const MB = 1024 * 1024;
const IMAGES: readonly Format[] = ["png", "jpeg", "webp"];

export interface CategoryRule {
  formats: readonly Format[];
  maxBytes: number;
}

/** Per-category upload rules, keyed by category slug. The effective size limit is also capped by MAX_UPLOAD_MB. */
export const CATEGORY_RULES: Record<string, CategoryRule> = {
  "character-illustration": { formats: IMAGES, maxBytes: 10 * MB },
  illustration: { formats: IMAGES, maxBytes: 10 * MB },
  live2d: { formats: ["zip", "png"], maxBytes: 50 * MB },
  "virtual-3d": { formats: ["zip", "png", "jpeg"], maxBytes: 50 * MB },
  design: { formats: [...IMAGES, "pdf"], maxBytes: 20 * MB },
  video: { formats: ["mp4"], maxBytes: 100 * MB },
  sound: { formats: ["wav", "mp3"], maxBytes: 30 * MB },
  "webtoon-comic": { formats: [...IMAGES, "pdf"], maxBytes: 20 * MB },
};
