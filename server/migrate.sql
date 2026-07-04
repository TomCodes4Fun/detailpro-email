-- Run once against your Render Postgres database.
-- psql "$DATABASE_URL" -f migrate.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL DEFAULT 'My Detailing Business',
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'staff'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One JSON blob per account holding everything the frontend used to keep in
-- localStorage (customers, appointments, invoices, services, settings...).
-- This is intentionally simple (not normalized into relational tables) so it
-- maps 1:1 onto the existing frontend data model. Normalizing into real
-- `customers` / `appointments` / `invoices` tables is the natural next step
-- once you need server-side reporting, search, or to enforce data integrity
-- — see SAAS_READINESS.md.
CREATE TABLE IF NOT EXISTS account_data (
  account_id  UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);
