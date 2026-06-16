/**
 * Minimal, dependency-free migration runner for the SQLite database.
 *
 * Each migration has a unique, monotonically increasing integer `version` and an
 * `up(db)` function that performs the schema change. Applied versions are
 * recorded in `schema_migrations`, so every migration runs exactly once and in
 * order, on a fresh database or an existing one. This replaces the previous
 * "CREATE TABLE IF NOT EXISTS only" approach, which had no path to alter columns
 * or add constraints/indexes on databases that already existed.
 *
 * Rules for adding a migration:
 *  - Append a new entry with the next version number; never edit or reorder a
 *    shipped migration (that would change history for existing databases).
 *  - Keep each migration idempotent where practical (IF NOT EXISTS) so a partial
 *    failure can be re-run safely.
 *  - Each migration runs inside a transaction; a throw rolls it back and aborts
 *    boot, so a bad deploy is caught at startup instead of corrupting state.
 */

const migrations = [
	{
		version: 1,
		name: 'initial_schema',
		up(db) {
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

				CREATE TABLE IF NOT EXISTS oauth_states (
					state TEXT PRIMARY KEY,
					payload TEXT NOT NULL,
					expires_at INTEGER NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);

				CREATE TABLE IF NOT EXISTS upload_sessions (
					id TEXT PRIMARY KEY,
					user_id TEXT NOT NULL,
					token TEXT NOT NULL,
					file_name TEXT NOT NULL,
					size INTEGER NOT NULL DEFAULT 0,
					mime_type TEXT,
					virtual_path TEXT NOT NULL DEFAULT '/',
					remote_parent_id TEXT,
					cloud_account_id TEXT NOT NULL,
					fallback_chain TEXT NOT NULL DEFAULT '[]',
					status TEXT NOT NULL DEFAULT 'pending',
					expires_at INTEGER NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
				);

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
				CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
				CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_id ON upload_sessions(user_id);
				CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);
			`);
		},
	},
	{
		version: 2,
		name: 'sync_state_for_delta',
		up(db) {
			// Per-account sync cursor/token storage for incremental ("delta") sync.
			// `delta_token` holds the provider change token/cursor; `last_full_sync_at`
			// records when a full structure walk last happened so we can fall back to
			// a full sync if a token is lost or a provider does not support deltas.
			db.exec(`
				CREATE TABLE IF NOT EXISTS account_sync_state (
					cloud_account_id TEXT PRIMARY KEY,
					user_id TEXT NOT NULL,
					delta_token TEXT,
					last_full_sync_at TEXT,
					last_delta_sync_at TEXT,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY(cloud_account_id) REFERENCES cloud_accounts(id) ON DELETE CASCADE,
					FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
				);

				CREATE INDEX IF NOT EXISTS idx_account_sync_state_user_id
					ON account_sync_state(user_id);
			`);
		},
	},
];

/**
 * Apply every migration whose version has not yet been recorded, in ascending
 * order, each inside its own transaction. Returns the list of versions applied
 * during this run (empty when the database is already current).
 */
export function runMigrations(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`);

	const appliedVersions = new Set(
		db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
	);

	const recordStmt = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
	const ordered = [...migrations].sort((a, b) => a.version - b.version);
	const appliedNow = [];

	for (const migration of ordered) {
		if (appliedVersions.has(migration.version)) continue;

		const apply = db.transaction(() => {
			migration.up(db);
			recordStmt.run(migration.version, migration.name);
		});
		apply();
		appliedNow.push(migration.version);
	}

	return appliedNow;
}
