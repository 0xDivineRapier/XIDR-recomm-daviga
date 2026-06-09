-- Migration 001: create settlements table
-- Run with: psql $DATABASE_URL -f migrations/001_create_settlements.sql

CREATE TABLE IF NOT EXISTS settlements (
  id           UUID PRIMARY KEY,
  rail_id      TEXT        NOT NULL,
  rail_name    TEXT        NOT NULL,
  reference_id TEXT        NOT NULL,
  amount_idr   BIGINT      NOT NULL,
  recipient    TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','confirmed','failed','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settlements_reference_id_idx ON settlements (reference_id);
CREATE INDEX IF NOT EXISTS settlements_status_idx        ON settlements (status);
CREATE INDEX IF NOT EXISTS settlements_rail_name_idx     ON settlements (rail_name);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS settlements_updated_at ON settlements;
CREATE TRIGGER settlements_updated_at
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
