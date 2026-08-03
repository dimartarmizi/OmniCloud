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

  CREATE TABLE IF NOT EXISTS file_encryption (
    cloud_account_id TEXT NOT NULL,
    remote_file_id TEXT NOT NULL,
    real_name TEXT NOT NULL,
    plaintext_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT,
    wrapped_key TEXT NOT NULL,
    enc_meta TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cloud_account_id, remote_file_id),
    FOREIGN KEY(cloud_account_id) REFERENCES cloud_accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vault (
    user_id TEXT PRIMARY KEY,
    salt_pin TEXT NOT NULL,
    kek_wrapped_by_pin TEXT NOT NULL,
    salt_seed TEXT NOT NULL,
    kek_wrapped_by_seed TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migration: add enc_meta to file_encryption for databases created before the
// vault feature (the table's plaintext real_name/plaintext_size/mime_type
// columns stay but become unused — real metadata now lives encrypted in enc_meta).
if (!db.pragma('table_info(file_encryption)').some((column) => column.name === 'enc_meta')) {
	db.exec('ALTER TABLE file_encryption ADD COLUMN enc_meta TEXT');
}

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
  CREATE INDEX IF NOT EXISTS idx_file_encryption_account
    ON file_encryption(cloud_account_id);
`);
