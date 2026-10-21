import type { LocalStorage } from "../assets/storage.js";
import { processImage } from "../assets/images.js";
import type { Db } from "../db/connection.js";
import { savePalette } from "./palettes.js";

interface IndexRow {
  title: string;
  description: string;
  tags: string | null;
  artist: string;
  category: string;
}

/** Rewrites one listing's search entry. Call it inside the transaction that changes the listing. */
export function indexListing(db: Db, listingId: number): void {
  const row = db
    .prepare(
      `SELECT l.title, l.description,
              (SELECT group_concat(t.tag, ' ') FROM listing_tags t WHERE t.listing_id = l.id) AS tags,
              u.display_name AS artist, c.name || ' ' || c.slug AS category
       FROM listings l
       JOIN users u ON u.id = l.artist_user_id
       JOIN categories c ON c.id = l.category_id
       WHERE l.id = ?`,
    )
    .get(listingId) as IndexRow | undefined;
  db.prepare("DELETE FROM listing_search WHERE rowid = ?").run(listingId);
  if (!row) return;
  db.prepare("INSERT INTO listing_search (rowid, title, description, tags, artist, category) VALUES (?, ?, ?, ?, ?, ?)").run(
    listingId,
    row.title,
    row.description,
    row.tags ?? "",
    row.artist,
    row.category,
  );
}

/** Rebuilds the whole search index from the listings table. */
export function rebuildSearchIndex(db: Db): number {
  const ids = db.prepare("SELECT id FROM listings ORDER BY id").all() as { id: number }[];
  db.transaction(() => {
    db.prepare("DELETE FROM listing_search").run();
    for (const { id } of ids) indexListing(db, id);
  })();
  return ids.length;
}

/** Computes palettes for stored images that do not have one yet. Returns how many were added. */
export async function backfillPalettes(db: Db, storage: LocalStorage): Promise<number> {
  const rows = db
    .prepare(
      `SELECT a.id, a.stored_name FROM assets a
       WHERE a.mime LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM asset_colors c WHERE c.asset_id = a.id)
       ORDER BY a.id`,
    )
    .all() as { id: number; stored_name: string }[];
  let added = 0;
  for (const row of rows) {
    try {
      const { palette } = await processImage(await storage.read(row.stored_name));
      savePalette(db, row.id, palette);
      added += 1;
    } catch {
      // A missing or unreadable file is skipped; the asset simply has no palette.
    }
  }
  return added;
}
