import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../omnicloud.db');

export const LOCAL_USER_ID = 'local-default-user';
export const LOCAL_USER_EMAIL = 'local@omnicloud.local';

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    is_local INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cloud_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    total_space INTEGER NOT NULL,
    used_space INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'invalid_token')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS file_metadata (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    virtual_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    is_folder INTEGER NOT NULL DEFAULT 0,
	is_starred INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT,
    cloud_account_id TEXT NOT NULL,
    remote_file_id TEXT NOT NULL,
    remote_parent_id TEXT,
    remote_created_time TEXT,
    remote_modified_time TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cloud_account_id) REFERENCES cloud_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS file_parts (
    id TEXT PRIMARY KEY,
    file_metadata_id TEXT NOT NULL,
    cloud_account_id TEXT NOT NULL,
    remote_file_id TEXT NOT NULL,
    remote_parent_id TEXT,
    part_index INTEGER NOT NULL DEFAULT 0,
    part_size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(file_metadata_id) REFERENCES file_metadata(id) ON DELETE CASCADE,
    FOREIGN KEY(cloud_account_id) REFERENCES cloud_accounts(id) ON DELETE CASCADE
  );
`);

db.prepare(`
  INSERT OR IGNORE INTO users (id, email, password_hash, is_local)
  VALUES (?, ?, '', 1)
`).run(LOCAL_USER_ID, LOCAL_USER_EMAIL);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_accounts_user_provider_email
    ON cloud_accounts(user_id, provider, email);
  CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_id
    ON cloud_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_file_virtual_path ON file_metadata(user_id, virtual_path);
  CREATE INDEX IF NOT EXISTS idx_file_remote_id ON file_metadata(user_id, remote_file_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_file_account_remote_id
    ON file_metadata(cloud_account_id, remote_file_id);
  CREATE INDEX IF NOT EXISTS idx_file_user_account_id
    ON file_metadata(user_id, cloud_account_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_key
    ON user_settings(user_id, key);
  CREATE INDEX IF NOT EXISTS idx_file_parts_metadata ON file_parts(file_metadata_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_file_parts_unique ON file_parts(file_metadata_id, cloud_account_id, part_index);
`);

// Migration: check if there are files in file_metadata that are not in file_parts
const countParts = db.prepare("SELECT COUNT(*) as count FROM file_parts").get().count;
if (countParts === 0) {
	const files = db.prepare("SELECT id, cloud_account_id, remote_file_id, remote_parent_id, size FROM file_metadata WHERE is_folder = 0").all();
	if (files.length > 0) {
		const insertPart = db.prepare(`
			INSERT OR IGNORE INTO file_parts (id, file_metadata_id, cloud_account_id, remote_file_id, remote_parent_id, part_index, part_size)
			VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 0, ?)
		`);
		const runMigration = db.transaction(() => {
			for (const file of files) {
				insertPart.run(file.id, file.cloud_account_id, file.remote_file_id, file.remote_parent_id, file.size);
			}
		});
		runMigration();
		console.log(`[OmniCloud Migrator] Migrated ${files.length} existing files to file_parts.`);
	}
}

// Migration: add replication_status column to file_metadata if it does not exist
const hasReplicationStatus = db
	.prepare("SELECT COUNT(*) as count FROM pragma_table_info('file_metadata') WHERE name = 'replication_status'")
	.get().count > 0;

if (!hasReplicationStatus) {
	db.exec(`ALTER TABLE file_metadata ADD COLUMN replication_status TEXT NOT NULL DEFAULT 'not_protected'`);
	// Back-fill status for existing files based on how many parts they already have
	db.exec(`
		UPDATE file_metadata
		SET replication_status = CASE
			WHEN (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = file_metadata.id) >= 2 THEN 'fully_protected'
			WHEN (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = file_metadata.id) = 1 THEN 'not_protected'
			ELSE 'not_protected'
		END
		WHERE is_folder = 0
	`);
	console.log('[OmniCloud Migrator] Added replication_status column and back-filled existing files.');
}

