import { createHash, randomBytes } from "node:crypto";
import { CATEGORY_RULES } from "../catalog/rules.js";
import { findCategoryBySlug } from "../catalog/categories.js";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import type { PaletteColor } from "../search/color.js";
import { savePalette } from "../search/palettes.js";
import { processImage } from "./images.js";
import { findAssetByHash, insertAsset, storageUsedBy, type AssetRecord } from "./repo.js";
import { detectFormat, FORMAT_INFO } from "./signatures.js";
import { sanitizeFilename, type LocalStorage } from "./storage.js";

const MB = 1024 * 1024;

export interface UploadDeps {
  db: Db;
  storage: LocalStorage;
  config: Pick<Config, "MAX_UPLOAD_MB" | "USER_QUOTA_MB">;
}

export interface UploadInput {
  ownerId: number;
  categorySlug: string;
  filename: string;
  data: Buffer;
}

/**
 * Validates and stores one upload. Order matters: cheap checks first, content checks next,
 * then quota and duplicates, and only then anything is written to disk.
 */
export async function uploadAsset({ db, storage, config }: UploadDeps, input: UploadInput): Promise<AssetRecord> {
  const category = findCategoryBySlug(db, input.categorySlug);
  const rule = category ? CATEGORY_RULES[category.slug] : undefined;
  if (!category || !rule) throw new DomainError("unknown_category", "Unknown category");

  if (input.data.length === 0) throw new DomainError("empty_file", "File is empty");
  const limit = Math.min(rule.maxBytes, config.MAX_UPLOAD_MB * MB);
  if (input.data.length > limit) {
    throw new DomainError("too_large", `File exceeds the ${Math.floor(limit / MB)} MB limit for this category`);
  }

  const format = detectFormat(input.data);
  if (!format) throw new DomainError("unsupported_type", "Unrecognized or unsupported file type");
  if (!rule.formats.includes(format)) {
    throw new DomainError("type_not_allowed", `${category.name} accepts: ${rule.formats.join(", ")}`);
  }
  const info = FORMAT_INFO[format];

  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Buffer | null = null;
  let palette: PaletteColor[] = [];
  if (info.image) {
    try {
      const processed = await processImage(input.data);
      width = processed.width;
      height = processed.height;
      thumbnail = processed.thumbnail;
      palette = processed.palette;
    } catch {
      throw new DomainError("invalid_image", "The image could not be decoded");
    }
  }

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  if (findAssetByHash(db, input.ownerId, sha256)) {
    throw new DomainError("duplicate_asset", "You already uploaded this file");
  }
  if (storageUsedBy(db, input.ownerId) + input.data.length > config.USER_QUOTA_MB * MB) {
    throw new DomainError("quota_exceeded", "Storage quota exceeded");
  }

  const id = randomBytes(16).toString("hex");
  const storedName = `${id}.${info.ext}`;
  const thumbName = thumbnail ? `${id}.thumb.webp` : null;
  await storage.write(storedName, input.data);
  if (thumbName && thumbnail) await storage.write(thumbName, thumbnail);

  try {
    return db.transaction(() => {
      const record = insertAsset(db, {
        ownerUserId: input.ownerId,
        categoryId: category.id,
        originalName: sanitizeFilename(input.filename),
        storedName,
        thumbName,
        mime: info.mime,
        sizeBytes: input.data.length,
        width,
        height,
        sha256,
      });
      savePalette(db, record.id, palette);
      return record;
    })();
  } catch (error) {
    await storage.remove(storedName);
    if (thumbName) await storage.remove(thumbName);
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new DomainError("duplicate_asset", "You already uploaded this file");
    }
    throw error;
  }
}
