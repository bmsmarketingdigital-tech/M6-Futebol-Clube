CREATE TABLE IF NOT EXISTS whatsapp_organization_connections (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expected_phone TEXT,
  updated_at BIGINT NOT NULL
);

ALTER TABLE whatsapp_organization_connections DROP COLUMN IF EXISTS confirmed_phone;
ALTER TABLE whatsapp_organization_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE whatsapp_organization_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE whatsapp_organization_connections TO service_role;
