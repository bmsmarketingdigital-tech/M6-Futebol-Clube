PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS organization_members_org_email_unique;
DROP INDEX IF EXISTS organization_members_email_idx;
DELETE FROM local_auth_sessions;
DROP TABLE local_auth_sessions;
CREATE TABLE organization_members_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);
INSERT INTO organization_members_v2(id, organization_id, user_id, display_name, role, created_at)
SELECT m.id, m.organization_id, u.id, m.display_name, m.role, m.created_at
FROM organization_members m
INNER JOIN local_users u ON lower(u.email) = lower(m.email);
DROP TABLE organization_members;
ALTER TABLE organization_members_v2 RENAME TO organization_members;
CREATE UNIQUE INDEX organization_members_org_user_unique ON organization_members(organization_id, user_id);
CREATE INDEX organization_members_user_idx ON organization_members(user_id);
CREATE TABLE local_auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX local_auth_sessions_user_idx ON local_auth_sessions(user_id);
CREATE INDEX local_auth_sessions_organization_idx ON local_auth_sessions(organization_id);
CREATE TRIGGER organization_members_keep_last_admin_delete
BEFORE DELETE ON organization_members
WHEN OLD.role IN ('owner', 'admin') AND
  (SELECT COUNT(*) FROM organization_members WHERE organization_id=OLD.organization_id AND role IN ('owner','admin')) <= 1
BEGIN SELECT RAISE(ABORT, 'A organização precisa manter pelo menos um administrador.'); END;
CREATE TRIGGER organization_members_keep_last_admin_update
BEFORE UPDATE OF role, organization_id, user_id ON organization_members
WHEN OLD.role IN ('owner','admin') AND
  (NEW.organization_id<>OLD.organization_id OR NEW.role NOT IN ('owner','admin')) AND
  (SELECT COUNT(*) FROM organization_members WHERE organization_id=OLD.organization_id AND role IN ('owner','admin')) <= 1
BEGIN SELECT RAISE(ABORT, 'A organização precisa manter pelo menos um administrador.'); END;
COMMIT;
