import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { tsImport } from "tsx/esm/api";

const root = new URL("../", import.meta.url);
const migrationPath = new URL("supabase/migrations/0002_whatsapp_organization_connections.sql", root);
const migration = await readFile(migrationPath, "utf8");
const storeSource = await readFile(new URL("app/api/check-in/whatsapp-organization-store.ts", root), "utf8");
const store = await tsImport("../app/api/check-in/whatsapp-organization-store-core.ts", import.meta.url);

test("migration protege a tabela e não guarda telefone confirmado sem writer", () => {
  assert.match(migration, /ALTER TABLE whatsapp_organization_connections ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE whatsapp_organization_connections FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT ALL ON TABLE whatsapp_organization_connections TO service_role/i);
  assert.doesNotMatch(migration, /CREATE POLICY/i);
  assert.doesNotMatch(migration, /confirmed_phone\s+TEXT/i);
  assert.doesNotMatch(storeSource, /confirmedPhone|setWhatsAppConfirmedPhone/);
  assert.doesNotMatch(storeSource, /SELECT[^`]*confirmed_phone|INSERT[^`]*confirmed_phone/is);
  assert.match(storeSource, /WHERE organization_id=/);
  assert.match(storeSource, /WHERE organization_id=\?/);
});

const testUrl = process.env.WHATSAPP_TEST_POSTGRES_URL;
test("Postgres temporário aplica 0001→0002 e bloqueia acesso direto por tenant", {
  skip: !testUrl ? "defina WHATSAPP_TEST_POSTGRES_URL apontando para Postgres descartável" : false,
}, async () => {
  const parsed = new URL(testUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "o teste só aceita Postgres local");
  assert.match(databaseName, /test|temp|tmp/i, "o nome do banco precisa indicar que é descartável");

  const sql = postgres(testUrl, { max: 1, prepare: false });
  const schema = `whatsapp_gate_${randomUUID().replaceAll("-", "")}`;
  try {
    await sql`CREATE SCHEMA ${sql(schema)}`;
    const existingRoles = await sql`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
    const names = new Set(existingRoles.map((row) => row.rolname));
    if (!names.has("anon")) await sql.unsafe("CREATE ROLE anon NOLOGIN");
    if (!names.has("authenticated")) await sql.unsafe("CREATE ROLE authenticated NOLOGIN");
    if (!names.has("service_role")) await sql.unsafe("CREATE ROLE service_role NOLOGIN BYPASSRLS");
    const [serviceRole] = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'`;
    assert.equal(serviceRole?.rolbypassrls, true, "service_role precisa bypassar RLS");
    await sql`GRANT USAGE ON SCHEMA ${sql(schema)} TO anon, authenticated, service_role`;
    await sql`SET search_path TO ${sql(schema)}, public`;

    const initialSchema = await readFile(new URL("supabase/migrations/0001_initial_schema.sql", root), "utf8");
    await sql.unsafe(initialSchema);
    await sql.unsafe(migration);
    await sql.unsafe(migration);

    const [table] = await sql`
      SELECT c.relrowsecurity AS rls_enabled
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=${schema} AND c.relname='whatsapp_organization_connections'
    `;
    assert.equal(table?.rls_enabled, true);

    const [key] = await sql`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
      WHERE n.nspname=${schema} AND t.relname='whatsapp_organization_connections' AND i.indisprimary
    `;
    assert.equal(key?.attname, "organization_id");

    const [foreignKey] = await sql`
      SELECT confdeltype
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=${schema} AND t.relname='whatsapp_organization_connections' AND c.contype='f'
    `;
    assert.equal(foreignKey?.confdeltype, "c");

    const orgA = randomUUID();
    const orgB = randomUUID();
    await sql`INSERT INTO ${sql(schema)}.organizations (id,name,slug,created_at) VALUES (${orgA},'A',${`wa-${orgA}`},1),(${orgB},'B',${`wa-${orgB}`},1)`;
    const executeStoreQuery = (query, parameters) => sql.unsafe(query, parameters);
    await store.setExpectedWhatsAppPhone(executeStoreQuery, orgA, "5511999990001", 1);
    await store.setExpectedWhatsAppPhone(executeStoreQuery, orgB, "5511999990002", 1);
    assert.equal(await store.getExpectedWhatsAppPhone(executeStoreQuery, orgA), "5511999990001");
    assert.equal(await store.getExpectedWhatsAppPhone(executeStoreQuery, orgB), "5511999990002");

    await assert.rejects(sql`INSERT INTO ${sql(schema)}.whatsapp_organization_connections (organization_id,expected_phone,updated_at) VALUES (${orgA},'5511999990003',2)`);
    await assert.rejects(sql`INSERT INTO ${sql(schema)}.whatsapp_organization_connections (organization_id,expected_phone,updated_at) VALUES (${randomUUID()},'5511999990003',2)`);

    for (const role of ["anon", "authenticated"]) {
      await sql`SET ROLE ${sql(role)}`;
      await assert.rejects(sql`SELECT * FROM ${sql(schema)}.whatsapp_organization_connections`);
      await assert.rejects(sql`INSERT INTO ${sql(schema)}.whatsapp_organization_connections (organization_id,expected_phone,updated_at) VALUES (${orgA},'5511999990003',2)`);
      await assert.rejects(sql`UPDATE ${sql(schema)}.whatsapp_organization_connections SET expected_phone='5511999990003' WHERE organization_id=${orgB}`);
      await assert.rejects(sql`DELETE FROM ${sql(schema)}.whatsapp_organization_connections WHERE organization_id=${orgB}`);
      await sql`RESET ROLE`;
    }

    await sql`SET ROLE service_role`;
    const rows = await sql`SELECT organization_id,expected_phone FROM ${sql(schema)}.whatsapp_organization_connections ORDER BY organization_id`;
    assert.equal(rows.length, 2);
    await store.setExpectedWhatsAppPhone(executeStoreQuery, orgB, "5511999990012", 2);
    await sql`RESET ROLE`;

    const [updatedB] = await sql`SELECT expected_phone FROM ${sql(schema)}.whatsapp_organization_connections WHERE organization_id=${orgB}`;
    const [unchangedA] = await sql`SELECT expected_phone FROM ${sql(schema)}.whatsapp_organization_connections WHERE organization_id=${orgA}`;
    assert.equal(updatedB.expected_phone, "5511999990012");
    assert.equal(unchangedA.expected_phone, "5511999990001");
    await sql`DELETE FROM ${sql(schema)}.organizations WHERE id=${orgA}`;
    const [remaining] = await sql`SELECT count(*)::int AS count FROM ${sql(schema)}.whatsapp_organization_connections`;
    assert.equal(remaining.count, 1);
  } finally {
    await sql`RESET ROLE`.catch(() => {});
    await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`.catch(() => {});
    await sql.end();
  }
});
