import type { Migration } from "../migrate.js";

export const migration002: Migration = {
  id: 2,
  name: "catalog_artist_profiles_assets",
  sql: `
    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    INSERT INTO categories (slug, name, sort_order) VALUES
      ('character-illustration', 'Character Illustration', 1),
      ('illustration', 'Illustration', 2),
      ('live2d', 'Live2D', 3),
      ('virtual-3d', 'Virtual 3D', 4),
      ('design', 'Design', 5),
      ('video', 'Video', 6),
      ('sound', 'Sound', 7),
      ('webtoon-comic', 'Webtoon / Comic', 8);

    CREATE TABLE artist_profiles (
      user_id     INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      bio         TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories (id),
      tier        TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'premium')),
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_artist_profiles_listing ON artist_profiles (status, category_id, tier);

    CREATE TABLE assets (
      id            INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      category_id   INTEGER NOT NULL REFERENCES categories (id),
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL UNIQUE,
      thumb_name    TEXT,
      mime          TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
      width         INTEGER,
      height        INTEGER,
      sha256        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      UNIQUE (owner_user_id, sha256)
    );
  `,
};
