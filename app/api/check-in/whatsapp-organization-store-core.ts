export type WhatsAppOrganizationPhone = { expected_phone: string | null };
export type PostgresStoreExecutor = (query: string, parameters: unknown[]) => Promise<WhatsAppOrganizationPhone[]>;

export async function getExpectedWhatsAppPhone(
  execute: PostgresStoreExecutor,
  organizationId: string,
): Promise<string | null> {
  const rows = await execute(
    "SELECT expected_phone FROM whatsapp_organization_connections WHERE organization_id=$1 LIMIT 1",
    [organizationId],
  );
  return rows[0]?.expected_phone ?? null;
}

export async function setExpectedWhatsAppPhone(
  execute: PostgresStoreExecutor,
  organizationId: string,
  phone: string,
  updatedAt: number,
): Promise<void> {
  await execute(
    `INSERT INTO whatsapp_organization_connections (organization_id, expected_phone, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO UPDATE SET
       expected_phone=EXCLUDED.expected_phone, updated_at=EXCLUDED.updated_at`,
    [organizationId, phone, updatedAt],
  );
}
