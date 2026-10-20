import type { Migration } from "../migrate.js";

export const migration006: Migration = {
  id: 6,
  name: "reviews_support_takedowns_notifications",
  sql: `
    CREATE TABLE reviews (
      id               INTEGER PRIMARY KEY,
      reviewer_user_id INTEGER NOT NULL REFERENCES users (id),
      artist_user_id   INTEGER NOT NULL REFERENCES users (id),
      order_id         INTEGER REFERENCES orders (id),
      request_id       INTEGER REFERENCES requests (id),
      rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment          TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'flagged', 'hidden')),
      moderation_note  TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      edited_at        TEXT,
      CHECK ((order_id IS NOT NULL) <> (request_id IS NOT NULL)),
      CHECK (reviewer_user_id <> artist_user_id)
    );
    CREATE UNIQUE INDEX uq_reviews_order ON reviews (order_id) WHERE order_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_reviews_request ON reviews (request_id) WHERE request_id IS NOT NULL;
    CREATE INDEX idx_reviews_artist ON reviews (artist_user_id, status);
    CREATE INDEX idx_reviews_status ON reviews (status);

    CREATE TABLE review_flags (
      id               INTEGER PRIMARY KEY,
      review_id        INTEGER NOT NULL REFERENCES reviews (id),
      reporter_user_id INTEGER NOT NULL REFERENCES users (id),
      reason           TEXT NOT NULL CHECK (reason IN ('spam', 'abusive', 'off_topic', 'other')),
      note             TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL,
      resolved_at      TEXT,
      UNIQUE (review_id, reporter_user_id)
    );

    CREATE TABLE tickets (
      id                INTEGER PRIMARY KEY,
      requester_user_id INTEGER NOT NULL REFERENCES users (id),
      category          TEXT NOT NULL CHECK (category IN ('account', 'payment', 'order', 'technical', 'other')),
      subject           TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_user', 'resolved', 'closed')),
      assignee_user_id  INTEGER REFERENCES users (id),
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_tickets_requester ON tickets (requester_user_id, status);
    CREATE INDEX idx_tickets_queue ON tickets (status, updated_at);

    CREATE TABLE ticket_messages (
      id             INTEGER PRIMARY KEY,
      ticket_id      INTEGER NOT NULL REFERENCES tickets (id),
      author_user_id INTEGER NOT NULL REFERENCES users (id),
      body           TEXT NOT NULL,
      internal       INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
      created_at     TEXT NOT NULL
    );
    CREATE INDEX idx_ticket_messages_ticket ON ticket_messages (ticket_id);
    CREATE TRIGGER ticket_messages_no_update BEFORE UPDATE ON ticket_messages
    BEGIN SELECT RAISE(ABORT, 'ticket messages are append-only'); END;
    CREATE TRIGGER ticket_messages_no_delete BEFORE DELETE ON ticket_messages
    BEGIN SELECT RAISE(ABORT, 'ticket messages are append-only'); END;

    CREATE TABLE takedown_notices (
      id               INTEGER PRIMARY KEY,
      listing_id       INTEGER NOT NULL REFERENCES listings (id),
      claimant_user_id INTEGER NOT NULL REFERENCES users (id),
      work_description TEXT NOT NULL,
      original_url     TEXT,
      signature        TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'received' CHECK (status IN
        ('received', 'upheld', 'rejected', 'counter_noticed', 'reinstated', 'closed')),
      resolution_note  TEXT,
      counter_statement TEXT,
      counter_signature TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE UNIQUE INDEX uq_takedown_active ON takedown_notices (listing_id, claimant_user_id)
      WHERE status IN ('received', 'upheld', 'counter_noticed');
    CREATE INDEX idx_takedown_status ON takedown_notices (status);

    CREATE TABLE notifications (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users (id),
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      ref_type   TEXT,
      ref_id     INTEGER,
      read_at    TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, id);
  `,
};
