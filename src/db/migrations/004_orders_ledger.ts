import type { Migration } from "../migrate.js";

export const migration004: Migration = {
  id: 4,
  name: "orders_and_double_entry_ledger",
  sql: `
    CREATE TABLE orders (
      id               INTEGER PRIMARY KEY,
      buyer_user_id    INTEGER NOT NULL REFERENCES users (id),
      artist_user_id   INTEGER NOT NULL REFERENCES users (id),
      listing_id       INTEGER NOT NULL REFERENCES listings (id),
      listing_title    TEXT NOT NULL,
      license_type     TEXT NOT NULL CHECK (license_type IN ('non_commercial', 'commercial', 'broadcast')),
      price_cents      INTEGER NOT NULL CHECK (price_cents > 0),
      commission_bps   INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
      commission_cents INTEGER NOT NULL CHECK (commission_cents >= 0),
      payout_cents     INTEGER NOT NULL CHECK (payout_cents >= 0),
      status           TEXT NOT NULL DEFAULT 'escrow' CHECK (status IN ('escrow', 'disputed', 'completed', 'refunded')),
      hold_until       TEXT NOT NULL,
      dispute_reason   TEXT,
      resolution_note  TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      completed_at     TEXT,
      CHECK (commission_cents + payout_cents = price_cents),
      CHECK (buyer_user_id <> artist_user_id)
    );
    CREATE UNIQUE INDEX uq_orders_active_purchase ON orders (buyer_user_id, listing_id, license_type) WHERE status <> 'refunded';
    CREATE INDEX idx_orders_buyer ON orders (buyer_user_id);
    CREATE INDEX idx_orders_artist ON orders (artist_user_id, status);
    CREATE INDEX idx_orders_hold ON orders (status, hold_until);

    CREATE TABLE accounts (
      id       INTEGER PRIMARY KEY,
      kind     TEXT NOT NULL CHECK (kind IN ('external', 'platform_revenue', 'user_wallet', 'escrow')),
      user_id  INTEGER REFERENCES users (id),
      order_id INTEGER REFERENCES orders (id),
      CHECK (
        (kind = 'user_wallet' AND user_id IS NOT NULL AND order_id IS NULL) OR
        (kind = 'escrow' AND order_id IS NOT NULL AND user_id IS NULL) OR
        (kind IN ('external', 'platform_revenue') AND user_id IS NULL AND order_id IS NULL)
      )
    );
    CREATE UNIQUE INDEX uq_accounts_wallet ON accounts (user_id) WHERE kind = 'user_wallet';
    CREATE UNIQUE INDEX uq_accounts_escrow ON accounts (order_id) WHERE kind = 'escrow';
    CREATE UNIQUE INDEX uq_accounts_system ON accounts (kind) WHERE kind IN ('external', 'platform_revenue');
    INSERT INTO accounts (kind) VALUES ('external'), ('platform_revenue');

    CREATE TABLE journal_entries (
      id                 INTEGER PRIMARY KEY,
      kind               TEXT NOT NULL CHECK (kind IN ('deposit', 'escrow_hold', 'escrow_release', 'escrow_refund')),
      order_id           INTEGER REFERENCES orders (id),
      memo               TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES users (id),
      created_at         TEXT NOT NULL
    );

    CREATE TABLE ledger_lines (
      id           INTEGER PRIMARY KEY,
      entry_id     INTEGER NOT NULL REFERENCES journal_entries (id),
      account_id   INTEGER NOT NULL REFERENCES accounts (id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0)
    );
    CREATE INDEX idx_ledger_lines_entry ON ledger_lines (entry_id);
    CREATE INDEX idx_ledger_lines_account ON ledger_lines (account_id);

    CREATE TRIGGER ledger_lines_no_update BEFORE UPDATE ON ledger_lines
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER ledger_lines_no_delete BEFORE DELETE ON ledger_lines
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER journal_entries_no_update BEFORE UPDATE ON journal_entries
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `,
};
