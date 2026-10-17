import { describe, expect, it } from "vitest";
import { processImage, THUMBNAIL_SIZE } from "../src/assets/images.js";
import { detectFormat } from "../src/assets/signatures.js";
import { makePng } from "./helpers.js";

describe("processImage", () => {
  it("reads dimensions and makes a WebP thumbnail that fits the bounding box", async () => {
    const result = await processImage(await makePng(10, 20, 30, 1000, 500));
    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
    expect(detectFormat(result.thumbnail)).toBe("webp");
    const { default: sharp } = await import("sharp");
    const meta = await sharp(result.thumbnail).metadata();
    expect(meta.width).toBe(THUMBNAIL_SIZE);
    expect(meta.height).toBe(THUMBNAIL_SIZE / 2);
  });

  it("does not enlarge small images", async () => {
    const result = await processImage(await makePng(1, 2, 3, 40, 30));
    const { default: sharp } = await import("sharp");
    const meta = await sharp(result.thumbnail).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });

  it("is deterministic for the same input", async () => {
    const png = await makePng(90, 90, 200, 300, 200);
    const [a, b] = await Promise.all([processImage(png), processImage(png)]);
    expect(a.thumbnail.equals(b.thumbnail)).toBe(true);
  });

  it("rejects data that only pretends to be a PNG", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really an image")]);
    await expect(processImage(fake)).rejects.toThrow();
  });
});
