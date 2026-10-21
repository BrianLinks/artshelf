import type { Db } from "../db/connection.js";
import type { PaletteColor } from "./color.js";

export function savePalette(db: Db, assetId: number, palette: readonly PaletteColor[]): void {
  db.prepare("DELETE FROM asset_colors WHERE asset_id = ?").run(assetId);
  const insert = db.prepare("INSERT INTO asset_colors (asset_id, rank, r, g, b, weight_bps) VALUES (?, ?, ?, ?, ?, ?)");
  palette.forEach((color, index) => insert.run(assetId, index + 1, color.r, color.g, color.b, color.weightBps));
}

/** Palettes for many assets. Assets without colors (audio, archives) are simply absent from the result. */
export function loadPalettes(db: Db, assetIds: readonly number[]): Map<number, PaletteColor[]> {
  const result = new Map<number, PaletteColor[]>();
  const BATCH = 500;
  for (let start = 0; start < assetIds.length; start += BATCH) {
    const batch = assetIds.slice(start, start + BATCH);
    const rows = db
      .prepare(
        `SELECT asset_id, r, g, b, weight_bps FROM asset_colors
         WHERE asset_id IN (${batch.map(() => "?").join(",")}) ORDER BY asset_id, rank`,
      )
      .all(...batch) as { asset_id: number; r: number; g: number; b: number; weight_bps: number }[];
    for (const row of rows) {
      const colors = result.get(row.asset_id) ?? [];
      colors.push({ r: row.r, g: row.g, b: row.b, weightBps: row.weight_bps });
      result.set(row.asset_id, colors);
    }
  }
  return result;
}
