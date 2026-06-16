import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

const tempFiles = [];

function freshDb() {
	const file = path.join(os.tmpdir(), `oc_migrations_${randomUUID()}.db`);
	tempFiles.push(file);
	const db = new Database(file);
	db.pragma('foreign_keys = ON');
	return db;
}

afterEach(() => {
	for (const file of tempFiles.splice(0)) {
		for (const suffix of ['', '-wal', '-shm']) {
			fs.rmSync(`${file}${suffix}`, { force: true });
		}
	}
});

describe('runMigrations', () => {
	it('applies every migration on a fresh database and records versions', () => {
		const db = freshDb();
		const applied = runMigrations(db);
		expect(applied).toEqual([1, 2]);

		const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
		expect(versions).toEqual([1, 2]);

		// Core tables exist.
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.all()
			.map((r) => r.name);
		expect(tables).toContain('users');
		expect(tables).toContain('file_metadata');
		expect(tables).toContain('account_sync_state');
		db.close();
	});

	it('is idempotent — a second run applies nothing', () => {
		const db = freshDb();
		runMigrations(db);
		const second = runMigrations(db);
		expect(second).toEqual([]);
		db.close();
	});

	it('only applies missing migrations on a partially-migrated database', () => {
		const db = freshDb();
		// Simulate a DB that only has migration 1 recorded.
		db.exec(`
			CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
			CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL DEFAULT '', is_local INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
			INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_schema');
		`);
		const applied = runMigrations(db);
		expect(applied).toEqual([2]);
		db.close();
	});
});
