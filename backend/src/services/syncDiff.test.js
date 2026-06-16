import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// Throwaway on-disk DB so the real schema/migrations are exercised. Must be set
// before importing anything that opens the db singleton.
const TEMP_DB = path.join(os.tmpdir(), `oc_syncdiff_${randomUUID()}.db`);
process.env.DATABASE_PATH = TEMP_DB;
process.env.APP_MODE = 'local';

vi.mock('./adapterRegistry.js', () => ({
	getProviderCapabilities: () => ({}),
}));

const { db, LOCAL_USER_ID } = await import('../config/database.js');
const { syncFilesForAccount, applyDeltaChanges, listFilesByPath, getFileByRemoteId } =
	await import('./fileService.js');

const ACCOUNT_ID = 'acc-sync-1';

function seedAccount() {
	db.prepare(
		`INSERT OR IGNORE INTO cloud_accounts
			(id, user_id, email, provider, encrypted_credentials, total_space, used_space, status)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
	).run(ACCOUNT_ID, LOCAL_USER_ID, 'sync@x', 's3', '{}', 1000, 0);
}

function record({ remoteId, name, virtualPath = '/', isFolder = false, size = 0, modified = null, starred = 0 }) {
	return {
		remote_file_id: remoteId,
		file_name: name,
		virtual_path: virtualPath,
		is_folder: isFolder,
		size,
		mime_type: isFolder ? null : 'text/plain',
		remote_parent_id: virtualPath,
		remote_modified_time: modified,
		is_starred: starred,
	};
}

beforeEach(() => {
	db.prepare('DELETE FROM file_metadata WHERE user_id = ?').run(LOCAL_USER_ID);
	db.prepare('DELETE FROM cloud_accounts WHERE id = ?').run(ACCOUNT_ID);
	seedAccount();
});

afterAll(() => {
	db.close();
	for (const suffix of ['', '-wal', '-shm']) {
		fs.rmSync(`${TEMP_DB}${suffix}`, { force: true });
	}
});

describe('syncFilesForAccount (diff-and-upsert)', () => {
	it('inserts new rows on first sync', () => {
		const summary = syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [
			record({ remoteId: 'r1', name: 'a.txt' }),
			record({ remoteId: 'r2', name: 'b.txt' }),
		]);
		expect(summary.inserted).toBe(2);
		expect(listFilesByPath(LOCAL_USER_ID, '/').length).toBe(2);
	});

	it('reports unchanged rows and writes nothing when structure is identical', () => {
		const rows = [record({ remoteId: 'r1', name: 'a.txt', modified: '2024-01-01T00:00:00Z' })];
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, rows);
		const summary = syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, rows);
		expect(summary).toMatchObject({ inserted: 0, updated: 0, deleted: 0, unchanged: 1 });
	});

	it('updates only changed rows', () => {
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [
			record({ remoteId: 'r1', name: 'a.txt', size: 10, modified: '2024-01-01T00:00:00Z' }),
			record({ remoteId: 'r2', name: 'b.txt', size: 20, modified: '2024-01-01T00:00:00Z' }),
		]);
		const summary = syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [
			record({ remoteId: 'r1', name: 'a-renamed.txt', size: 10, modified: '2024-02-01T00:00:00Z' }),
			record({ remoteId: 'r2', name: 'b.txt', size: 20, modified: '2024-01-01T00:00:00Z' }),
		]);
		expect(summary).toMatchObject({ inserted: 0, updated: 1, unchanged: 1, deleted: 0 });
		expect(getFileByRemoteId(LOCAL_USER_ID, ACCOUNT_ID, 'r1').file_name).toBe('a-renamed.txt');
	});

	it('deletes rows that vanished from the remote structure', () => {
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [
			record({ remoteId: 'r1', name: 'a.txt' }),
			record({ remoteId: 'r2', name: 'b.txt' }),
		]);
		const summary = syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [record({ remoteId: 'r1', name: 'a.txt' })]);
		expect(summary.deleted).toBe(1);
		expect(getFileByRemoteId(LOCAL_USER_ID, ACCOUNT_ID, 'r2')).toBeFalsy();
	});

	it('preserves the starred flag when preserveStarred is set', () => {
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [record({ remoteId: 'r1', name: 'a.txt', starred: 1 })]);
		// Provider does not own starred state; incoming starred is 0 but local is 1.
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [record({ remoteId: 'r1', name: 'a.txt', starred: 0 })], {
			preserveStarred: true,
		});
		expect(getFileByRemoteId(LOCAL_USER_ID, ACCOUNT_ID, 'r1').is_starred).toBe(1);
	});
});

describe('applyDeltaChanges', () => {
	it('upserts and deletes per change list', () => {
		syncFilesForAccount(LOCAL_USER_ID, ACCOUNT_ID, [record({ remoteId: 'r1', name: 'a.txt' })]);
		const summary = applyDeltaChanges(LOCAL_USER_ID, ACCOUNT_ID, [
			{ type: 'upsert', record: record({ remoteId: 'r2', name: 'new.txt' }) },
			{ type: 'delete', record: record({ remoteId: 'r1', name: 'a.txt' }) },
		]);
		expect(summary).toMatchObject({ upserted: 1, deleted: 1 });
		expect(getFileByRemoteId(LOCAL_USER_ID, ACCOUNT_ID, 'r1')).toBeFalsy();
		expect(getFileByRemoteId(LOCAL_USER_ID, ACCOUNT_ID, 'r2').file_name).toBe('new.txt');
	});
});
