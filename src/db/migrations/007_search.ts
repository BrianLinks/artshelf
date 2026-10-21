import type { Migration } from "../migrate.js";

export const migration007: Migration = {
  id: 7,
  name: "listing_search_and_asset_palettes",
  sql: `
    CREATE VIRTUAL TABLE listing_search USING fts5(
      title, description, tags, artist, category,
      tokenize = 'unicode61 remove_diacritics 2',
      prefix = '2 3'
    );
    INSERT INTO listing_search (rowid, title, description, tags, artist, category)
    SELECT l.id, l.title, l.description,
           COALESCE((SELECT group_concat(t.tag, ' ') FROM listing_tags t WHERE t.listing_id = l.id), ''),
           u.display_name, c.name || ' ' || c.slug
    FROM listings l
    JOIN users u ON u.id = l.artist_user_id
    JOIN categories c ON c.id = l.category_id;

    CREATE TABLE asset_colors (
      asset_id   INTEGER NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
      rank       INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 5),
      r          INTEGER NOT NULL CHECK (r BETWEEN 0 AND 255),
      g          INTEGER NOT NULL CHECK (g BETWEEN 0 AND 255),
      b          INTEGER NOT NULL CHECK (b BETWEEN 0 AND 255),
      weight_bps INTEGER NOT NULL CHECK (weight_bps BETWEEN 1 AND 10000),
      PRIMARY KEY (asset_id, rank)
    );
  `,
};
