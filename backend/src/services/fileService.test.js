import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// Use a throwaway on-disk SQLite file so the real schema (FKs, indexes) is
// exercised. Must be set BEFORE importing anything that opens the db singleton.
const TEMP_DB = path.join(os.tmpdir(), `oc_fileservice_${randomUUID()}.db`);
process.env.DATABASE_PATH = TEMP_DB;
process.env.APP_MODE = 'local';

// rename/delete path logic does not touch provider capabilities; stub the
// registry so importing fileService doesn't pull in every cloud adapter.
vi.mock('./adapterRegistry.js', () => ({
	getProviderCapabilities: () => ({}),
}));

const { db, LOCAL_USER_ID } = await import('../config/database.js');
const {
	createFileMetadata,
	renameFileMetadata,
	deleteFileMetadataById,
	listFilesByPath,
	getFileById,
} = await import('./fileService.js');

const ACCOUNT_ID = 'acc-test-1';

function seedAccount() {
	db.prepare(
		`INSERT OR IGNORE INTO cloud_accounts
			(id, user_id, email, provider, encrypted_credentials, total_space, used_space, status)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
	).run(ACCOUNT_ID, LOCAL_USER_ID, 'test@x', 's3', '{}', 1000, 0);
}

function addFile({ virtualPath, name, isFolder = false, size = 0, remoteId }) {
	return createFileMetadata({
		user_id: LOCAL_USER_ID,
		virtual_path: virtualPath,
		file_name: name,
		is_folder: isFolder,
		size,
		cloud_account_id: ACCOUNT_ID,
		remote_file_id: remoteId || randomUUID(),
		mime_type: isFolder ? null : 'text/plain',
	});
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

describe('renameFileMetadata', () => {
	it('renames a leaf file in place', () => {
		const file = addFile({ virtualPath: '/', name: 'old.txt' });
		renameFileMetadata(LOCAL_USER_ID, file.id, 'new.txt');
		expect(getFileById(LOCAL_USER_ID, file.id).file_name).toBe('new.txt');
	});

	it('rewrites descendant virtual_path prefixes when a folder is renamed', () => {
		const folder = addFile({ virtualPath: '/', name: 'docs', isFolder: true });
		addFile({ virtualPath: '/docs/', name: 'a.txt' });
		addFile({ virtualPath: '/docs/sub/', name: 'b.txt' });

		renameFileMetadata(LOCAL_USER_ID, folder.id, 'papers');

		expect(listFilesByPath(LOCAL_USER_ID, '/docs/').length).toBe(0);
		expect(listFilesByPath(LOCAL_USER_ID, '/papers/').map((f) => f.file_name)).toContain('a.txt');
		expect(listFilesByPath(LOCAL_USER_ID, '/papers/sub/').map((f) => f.file_name)).toContain('b.txt');
	});

	it('does not remap sibling folders that share a name prefix', () => {
		// "/docs/" and "/docs-archive/" share the literal prefix "docs" but are
		// distinct folders; the trailing-slash self-path prevents bleed-over.
		const docs = addFile({ virtualPath: '/', name: 'docs', isFolder: true });
		addFile({ virtualPath: '/docs/', name: 'inside.txt' });
		addFile({ virtualPath: '/', name: 'docs-archive', isFolder: true });
		addFile({ virtualPath: '/docs-archive/', name: 'archived.txt' });

		renameFileMetadata(LOCAL_USER_ID, docs.id, 'documents');

		expect(listFilesByPath(LOCAL_USER_ID, '/docs-archive/').map((f) => f.file_name)).toContain('archived.txt');
		expect(listFilesByPath(LOCAL_USER_ID, '/documents/').map((f) => f.file_name)).toContain('inside.txt');
	});

	it('treats SQL LIKE wildcards in folder names literally (% and _)', () => {
		// substr-based prefix matching must NOT interpret % or _ as wildcards.
		const folder = addFile({ virtualPath: '/', name: '50%_off', isFolder: true });
		addFile({ virtualPath: '/50%_off/', name: 'coupon.txt' });
		// A decoy folder that a LIKE '50%_off%' query could wrongly match.
		addFile({ virtualPath: '/', name: '5000XXoff', isFolder: true });
		addFile({ virtualPath: '/5000XXoff/', name: 'decoy.txt' });

		renameFileMetadata(LOCAL_USER_ID, folder.id, 'sale');

		expect(listFilesByPath(LOCAL_USER_ID, '/sale/').map((f) => f.file_name)).toContain('coupon.txt');
		// The decoy must be untouched.
		expect(listFilesByPath(LOCAL_USER_ID, '/5000XXoff/').map((f) => f.file_name)).toContain('decoy.txt');
	});
});

describe('deleteFileMetadataById', () => {
	it('deletes a leaf file and reports its freed size', () => {
		const file = addFile({ virtualPath: '/', name: 'big.bin', size: 2048 });
		const result = deleteFileMetadataById(LOCAL_USER_ID, file.id);
		expect(result.deletedSize).toBe(2048);
		expect(result.cloudAccountId).toBe(ACCOUNT_ID);
		expect(getFileById(LOCAL_USER_ID, file.id)).toBeFalsy();
	});

	it('deletes a folder with all descendants and sums their sizes', () => {
		const folder = addFile({ virtualPath: '/', name: 'bundle', isFolder: true });
		addFile({ virtualPath: '/bundle/', name: 'one.txt', size: 100 });
		addFile({ virtualPath: '/bundle/nested/', name: 'two.txt', size: 250 });

		const result = deleteFileMetadataById(LOCAL_USER_ID, folder.id);

		// 0 (folder) + 100 + 250
		expect(result.deletedSize).toBe(350);
		expect(listFilesByPath(LOCAL_USER_ID, '/bundle/').length).toBe(0);
		expect(listFilesByPath(LOCAL_USER_ID, '/bundle/nested/').length).toBe(0);
	});

	it('does not delete a sibling folder sharing a name prefix', () => {
		const photos = addFile({ virtualPath: '/', name: 'photos', isFolder: true });
		addFile({ virtualPath: '/photos/', name: 'a.jpg', size: 10 });
		addFile({ virtualPath: '/', name: 'photos-backup', isFolder: true });
		addFile({ virtualPath: '/photos-backup/', name: 'b.jpg', size: 20 });

		deleteFileMetadataById(LOCAL_USER_ID, photos.id);

		expect(listFilesByPath(LOCAL_USER_ID, '/photos-backup/').map((f) => f.file_name)).toContain('b.jpg');
	});

	it('returns zero size and null account for a non-existent id', () => {
		const result = deleteFileMetadataById(LOCAL_USER_ID, 'does-not-exist');
		expect(result).toEqual({ deletedSize: 0, cloudAccountId: null });
	});
});
