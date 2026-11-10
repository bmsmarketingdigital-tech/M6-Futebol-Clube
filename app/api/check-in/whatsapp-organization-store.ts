import { ensureDatabase, getD1 } from "../../../db";
import { ensurePostgresSchema, getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { getExpectedWhatsAppPhone, setExpectedWhatsAppPhone as setExpectedWhatsAppPhonePostgres } from "./whatsapp-organization-store-core";

export type WhatsAppOrganizationPhones = {
  expectedPhone: string | null;
};

let postgresTableReady: Promise<void> | null = null;

async function ensureWhatsAppOrganizationTable() {
  if (postgresConfigured()) {
    if (!postgresTableReady) {
      postgresTableReady = (async () => {
        await ensurePostgresSchema();
        const sql = getPostgresClient();
        await sql`
          CREATE TABLE IF NOT EXISTS whatsapp_organization_connections (
            organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            expected_phone TEXT,
            updated_at BIGINT NOT NULL
          )
        `;
        await sql`ALTER TABLE whatsapp_organization_connections DROP COLUMN IF EXISTS confirmed_phone`;
        await sql`ALTER TABLE whatsapp_organization_connections ENABLE ROW LEVEL SECURITY`;
        await sql`REVOKE ALL ON TABLE whatsapp_organization_connections FROM PUBLIC, anon, authenticated`;
        await sql`GRANT ALL ON TABLE whatsapp_organization_connections TO service_role`;
      })().catch((error) => {
        postgresTableReady = null;
        throw error;
      });
    }
    await postgresTableReady;
    return;
  }

  await ensureDatabase();
  await getD1().prepare(`
        CREATE TABLE IF NOT EXISTS whatsapp_organization_connections (
      organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      expected_phone TEXT,
      updated_at INTEGER NOT NULL
    )
  `).run();
}
export async function getWhatsAppOrganizationPhones(organizationId: string): Promise<WhatsAppOrganizationPhones> {
  await ensureWhatsAppOrganizationTable();
  if (postgresConfigured()) {
    const expectedPhone = await getExpectedWhatsAppPhone(
      (query, parameters) => getPostgresClient().unsafe(query, parameters),
      organizationId,
    );
    return { expectedPhone };
  }
  const row = await getD1().prepare(`
      SELECT expected_phone AS expectedPhone
    FROM whatsapp_organization_connections WHERE organization_id=? LIMIT 1
  `).bind(organizationId).first<WhatsAppOrganizationPhones>();
  return row ?? { expectedPhone: null };
}

export async function setWhatsAppExpectedPhone(organizationId: string, phone: string) {
  await ensureWhatsAppOrganizationTable();
  const now = Date.now();
  if (postgresConfigured()) {
    await setExpectedWhatsAppPhonePostgres(
      (query, parameters) => getPostgresClient().unsafe(query, parameters),
      organizationId,
      phone,
      now,
    );
    return;
  }
  await getD1().prepare(`
      INSERT INTO whatsapp_organization_connections (organization_id, expected_phone, updated_at)
      VALUES (?, ?, ?)
    ON CONFLICT (organization_id) DO UPDATE SET
        expected_phone=excluded.expected_phone, updated_at=excluded.updated_at
  `).bind(organizationId, phone, now).run();
}
