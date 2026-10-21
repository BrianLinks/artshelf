import sharp from "sharp";
import { extractPalette, type PaletteColor } from "../search/color.js";

export const MAX_PIXELS = 40_000_000;
export const THUMBNAIL_SIZE = 320;
const PALETTE_SAMPLE_SIZE = 32;

export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Buffer;
  /** Up to five dominant colors, used for "search by inspiration". */
  palette: PaletteColor[];
}

/**
 * Decodes the image fully (so corrupt files fail here, not later) and produces a WebP thumbnail.
 * Output depends only on the input bytes and fixed settings, so repeated runs match.
 */
export async function processImage(data: Buffer): Promise<ProcessedImage> {
  const image = sharp(data, { limitInputPixels: MAX_PIXELS });
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error("Image has no dimensions");
  const thumbnail = await image
    .clone()
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const sample = await image
    .clone()
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(PALETTE_SAMPLE_SIZE, PALETTE_SAMPLE_SIZE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width, height, thumbnail, palette: extractPalette(sample.data, sample.info.channels) };
}
