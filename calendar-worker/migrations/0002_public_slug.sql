-- Add public_slug column for shareable booking page paths
ALTER TABLE settings ADD COLUMN public_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_public_slug ON settings(public_slug);
