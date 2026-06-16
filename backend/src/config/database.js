import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In hosted (multi-user) mode the database must live on an explicit, persistent
// path — never defaulted next to the source tree where it is easy to lose or
// accidentally commit. Fail fast so a misconfigured production deploy is caught
// at boot instead of silently writing to backend/omnicloud.db.
if (process.env.APP_MODE === 'hosted' && !process.env.DATABASE_PATH) {
	throw new Error(
		'DATABASE_PATH is required when APP_MODE=hosted. Set it to a persistent location (e.g. /app/data/omnicloud.db).',
	);
}

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../omnicloud.db');

export const LOCAL_USER_ID = 'local-default-user';
export const LOCAL_USER_EMAIL = 'local@omnicloud.local';

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema migrations in order. Replaces the previous inline CREATE TABLE
// IF NOT EXISTS block, giving a real path to evolve the schema on existing
// databases. A migration failure throws here and aborts boot by design.
runMigrations(db);

db.prepare(`
  INSERT OR IGNORE INTO users (id, email, password_hash, is_local)
  VALUES (?, ?, '', 1)
`).run(LOCAL_USER_ID, LOCAL_USER_EMAIL);
