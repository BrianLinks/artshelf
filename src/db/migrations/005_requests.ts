import type { Migration } from "../migrate.js";

/**
 * Adds the Request Board and lets escrow accounts belong to a request as well as an order.
 * SQLite cannot change a CHECK constraint in place, so `accounts` is rebuilt (the documented
 * create-copy-drop-rename procedure); the runner disables foreign keys for this migration
 * and runs foreign_key_check before committing.
 */
export const migration005: Migration = {
  id: 5,
  name: "request_board_and_request_escrow",
  rebuildsTables: true,
  sql: `
    CREATE TABLE requests (
      id                   INTEGER PRIMARY KEY,
      client_user_id       INTEGER NOT NULL REFERENCES users (id),
      category_id          INTEGER NOT NULL REFERENCES categories (id),
      title                TEXT NOT NULL,
      description          TEXT NOT NULL,
      budget_cents         INTEGER NOT NULL CHECK (budget_cents BETWEEN 100 AND 10000000),
      status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN
        ('open', 'proposed', 'accepted', 'in_progress', 'delivered', 'revised', 'completed', 'disputed', 'cancelled', 'refunded')),
      artist_user_id       INTEGER REFERENCES users (id),
      accepted_proposal_id INTEGER,
      price_cents          INTEGER,
      commission_bps       INTEGER,
      commission_cents     INTEGER,
      payout_cents         INTEGER,
      max_revisions        INTEGER,
      revisions_used       INTEGER NOT NULL DEFAULT 0,
      due_at               TEXT,
      delivered_at         TEXT,
      auto_approve_at      TEXT,
      completed_at         TEXT,
      dispute_reason       TEXT,
      resolution_note      TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      CHECK ((artist_user_id IS NULL) = (price_cents IS NULL)),
      CHECK (status IN ('open', 'proposed', 'cancelled') OR artist_user_id IS NOT NULL),
      CHECK (client_user_id <> artist_user_id),
      CHECK (price_cents IS NULL OR commission_cents + payout_cents = price_cents)
    );
    CREATE INDEX idx_requests_board ON requests (status, category_id, budget_cents);
    CREATE INDEX idx_requests_client ON requests (client_user_id);
    CREATE INDEX idx_requests_artist ON requests (artist_user_id, status);
    CREATE INDEX idx_requests_due ON requests (status, auto_approve_at);

    CREATE TABLE proposals (
      id             INTEGER PRIMARY KEY,
      request_id     INTEGER NOT NULL REFERENCES requests (id),
      artist_user_id INTEGER NOT NULL REFERENCES users (id),
      price_cents    INTEGER NOT NULL CHECK (price_cents BETWEEN 100 AND 10000000),
      message        TEXT NOT NULL,
      delivery_days  INTEGER NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
      max_revisions  INTEGER NOT NULL CHECK (max_revisions BETWEEN 0 AND 5),
      status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE (request_id, artist_user_id)
    );

    CREATE TABLE request_deliveries (
      id         INTEGER PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests (id),
      asset_id   INTEGER NOT NULL UNIQUE REFERENCES assets (id),
      version    INTEGER NOT NULL CHECK (version >= 1),
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (request_id, version)
    );

    CREATE TABLE request_events (
      id            INTEGER PRIMARY KEY,
      request_id    INTEGER NOT NULL REFERENCES requests (id),
      actor_user_id INTEGER REFERENCES users (id),
      kind          TEXT NOT NULL,
      from_status   TEXT,
      to_status     TEXT,
      note          TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX idx_request_events_request ON request_events (request_id);
    CREATE TRIGGER request_events_no_update BEFORE UPDATE ON request_events
    BEGIN SELECT RAISE(ABORT, 'request history is append-only'); END;
    CREATE TRIGGER request_events_no_delete BEFORE DELETE ON request_events
    BEGIN SELECT RAISE(ABORT, 'request history is append-only'); END;

    CREATE TABLE accounts_new (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('external', 'platform_revenue', 'user_wallet', 'escrow')),
      user_id    INTEGER REFERENCES users (id),
      order_id   INTEGER REFERENCES orders (id),
      request_id INTEGER REFERENCES requests (id),
      CHECK (
        (kind = 'user_wallet' AND user_id IS NOT NULL AND order_id IS NULL AND request_id IS NULL) OR
        (kind = 'escrow' AND user_id IS NULL AND ((order_id IS NOT NULL) <> (request_id IS NOT NULL))) OR
        (kind IN ('external', 'platform_revenue') AND user_id IS NULL AND order_id IS NULL AND request_id IS NULL)
      )
    );
    INSERT INTO accounts_new (id, kind, user_id, order_id) SELECT id, kind, user_id, order_id FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_new RENAME TO accounts;
    CREATE UNIQUE INDEX uq_accounts_wallet ON accounts (user_id) WHERE kind = 'user_wallet';
    CREATE UNIQUE INDEX uq_accounts_escrow_order ON accounts (order_id) WHERE kind = 'escrow' AND order_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_accounts_escrow_request ON accounts (request_id) WHERE kind = 'escrow' AND request_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_accounts_system ON accounts (kind) WHERE kind IN ('external', 'platform_revenue');

    ALTER TABLE journal_entries ADD COLUMN request_id INTEGER REFERENCES requests (id);
  `,
};
