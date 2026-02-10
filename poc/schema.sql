-- ════════════════════════════════════════════════════════════
-- poc/schema.sql — Minimal Postgres schema for flight tracking
-- ════════════════════════════════════════════════════════════
-- Compatible with Postgres 14+.
-- For the current SQLite-based system, see server/database/db.js.
-- This schema is the target for a future Postgres migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Search Runs ────────────────────────────────────────────
-- One row per scheduled or manual execution.
CREATE TABLE IF NOT EXISTS search_runs (
  run_id       TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(6), 'hex'),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  routes_checked INT DEFAULT 0,
  results_found  INT DEFAULT 0,
  blocked_count  INT DEFAULT 0,
  duration_ms    INT,
  status       TEXT CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running',
  metadata     JSONB DEFAULT '{}'
);

-- ── Itineraries ────────────────────────────────────────────
-- One row per unique itinerary found in a search run.
CREATE TABLE IF NOT EXISTS itineraries (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT REFERENCES search_runs(run_id) ON DELETE SET NULL,
  route_key       TEXT NOT NULL,        -- e.g. 'MAD-EZE'
  origin          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  search_date     DATE NOT NULL,
  search_ts       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT DEFAULT 'puppeteer',
  price           NUMERIC(10,2) NOT NULL,
  currency        TEXT DEFAULT 'EUR',
  airline         TEXT,
  stops           INT,
  duration_min    INT,
  departure_time  TEXT,
  arrival_time    TEXT,
  ticket_type     TEXT DEFAULT 'oneway',
  url             TEXT,
  raw_payload     JSONB,
  normalized_hash TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Alert History ──────────────────────────────────────────
-- Idempotency: track what deals we already alerted.
CREATE TABLE IF NOT EXISTS alert_history (
  id              BIGSERIAL PRIMARY KEY,
  route_key       TEXT NOT NULL,
  price           NUMERIC(10,2) NOT NULL,
  normalized_hash TEXT NOT NULL,
  alerted_at      TIMESTAMPTZ DEFAULT NOW(),
  alert_type      TEXT DEFAULT 'historical_low'
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_itin_route_date    ON itineraries(route_key, search_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_itin_hash   ON itineraries(normalized_hash, search_date);
CREATE INDEX IF NOT EXISTS idx_itin_route_price   ON itineraries(route_key, price);
CREATE INDEX IF NOT EXISTS idx_itin_ts            ON itineraries(search_ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_hash  ON alert_history(normalized_hash, alert_type);

-- ════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ════════════════════════════════════════════════════════════

-- Historical minimum per route
CREATE OR REPLACE FUNCTION get_historical_min(p_route_key TEXT)
RETURNS TABLE(min_price NUMERIC, first_seen TIMESTAMPTZ, occurrences BIGINT) AS $$
  SELECT MIN(price), MIN(search_ts), COUNT(*)
  FROM itineraries
  WHERE route_key = p_route_key;
$$ LANGUAGE sql STABLE;

-- Check if a price is a new historical low for a route
CREATE OR REPLACE FUNCTION is_new_historical_low(p_route_key TEXT, p_price NUMERIC)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM itineraries
    WHERE route_key = p_route_key AND price <= p_price
  );
$$ LANGUAGE sql STABLE;

-- Deduplicated upsert: insert only if normalized_hash + date doesn't exist
CREATE OR REPLACE FUNCTION upsert_itinerary(
  p_run_id TEXT, p_route_key TEXT, p_origin TEXT, p_destination TEXT,
  p_search_date DATE, p_source TEXT, p_price NUMERIC, p_currency TEXT,
  p_airline TEXT, p_stops INT, p_duration_min INT,
  p_departure_time TEXT, p_arrival_time TEXT,
  p_ticket_type TEXT, p_url TEXT, p_raw JSONB, p_hash TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO itineraries (
    run_id, route_key, origin, destination, search_date, source,
    price, currency, airline, stops, duration_min, departure_time,
    arrival_time, ticket_type, url, raw_payload, normalized_hash
  ) VALUES (
    p_run_id, p_route_key, p_origin, p_destination, p_search_date, p_source,
    p_price, p_currency, p_airline, p_stops, p_duration_min, p_departure_time,
    p_arrival_time, p_ticket_type, p_url, p_raw, p_hash
  )
  ON CONFLICT (normalized_hash, search_date) DO NOTHING;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Was this deal already alerted?
CREATE OR REPLACE FUNCTION was_already_alerted(p_hash TEXT, p_type TEXT DEFAULT 'historical_low')
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM alert_history
    WHERE normalized_hash = p_hash AND alert_type = p_type
  );
$$ LANGUAGE sql STABLE;

-- Record an alert (idempotent)
CREATE OR REPLACE FUNCTION record_alert(
  p_route_key TEXT, p_price NUMERIC, p_hash TEXT, p_type TEXT DEFAULT 'historical_low'
) RETURNS VOID AS $$
  INSERT INTO alert_history (route_key, price, normalized_hash, alert_type)
  VALUES (p_route_key, p_price, p_hash, p_type)
  ON CONFLICT (normalized_hash, alert_type) DO NOTHING;
$$ LANGUAGE sql;

-- Price history for a route (last N days)
CREATE OR REPLACE FUNCTION get_price_history(p_route_key TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(price NUMERIC, airline TEXT, stops INT, search_ts TIMESTAMPTZ) AS $$
  SELECT price, airline, stops, search_ts
  FROM itineraries
  WHERE route_key = p_route_key
    AND search_ts >= NOW() - (p_days || ' days')::INTERVAL
  ORDER BY search_ts DESC;
$$ LANGUAGE sql STABLE;
