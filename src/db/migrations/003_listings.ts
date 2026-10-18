import type { Migration } from "../migrate.js";

export const migration003: Migration = {
  id: 3,
  name: "listings_licenses_tags",
  sql: `
    CREATE TABLE listings (
      id               INTEGER PRIMARY KEY,
      artist_user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      asset_id         INTEGER NOT NULL UNIQUE REFERENCES assets (id),
      category_id      INTEGER NOT NULL REFERENCES categories (id),
      title            TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 100 AND base_price_cents <= 10000000),
      status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'removed')),
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX idx_listings_browse ON listings (status, category_id, base_price_cents);
    CREATE INDEX idx_listings_artist ON listings (artist_user_id);

    CREATE TABLE listing_licenses (
      listing_id   INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
      license_type TEXT NOT NULL CHECK (license_type IN ('non_commercial', 'commercial', 'broadcast')),
      PRIMARY KEY (listing_id, license_type)
    );

    CREATE TABLE listing_tags (
      listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      PRIMARY KEY (listing_id, tag)
    );
    CREATE INDEX idx_listing_tags_tag ON listing_tags (tag);
  `,
};
