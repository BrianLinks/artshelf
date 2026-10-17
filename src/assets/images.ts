import sharp from "sharp";

export const MAX_PIXELS = 40_000_000;
export const THUMBNAIL_SIZE = 320;

export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Buffer;
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
  return { width, height, thumbnail };
}
