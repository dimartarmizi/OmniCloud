import { randomUUID } from 'crypto';
import { db } from '../config/database.js';
import { resolveMimeType } from '../utils/mime.js';
import { getProviderCapabilities } from './adapterRegistry.js';

// Single source of truth for the file_metadata insertable column set, so the
// several INSERT statements below can never drift out of sync with each other
// or with the schema. Column order here is the contract for the matching
// `@named` placeholders used by every insert.
const FILE_METADATA_COLUMNS = [
	'id',
	'user_id',
	'virtual_path',
	'file_name',
	'is_folder',
	'is_starred',
	'size',
	'mime_type',
	'cloud_account_id',
	'remote_file_id',
	'remote_parent_id',
	'remote_created_time',
	'remote_modified_time',
];
const FILE_METADATA_COLUMN_LIST = FILE_METADATA_COLUMNS.join(', ');
const FILE_METADATA_VALUE_PLACEHOLDERS = FILE_METADATA_COLUMNS.map((column) => `@${column}`).join(', ');
const FILE_METADATA_INSERT = `INSERT INTO file_metadata (${FILE_METADATA_COLUMN_LIST}) VALUES (${FILE_METADATA_VALUE_PLACEHOLDERS})`;

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const cleaned = input.startsWith('/') ? input : `/${input}`;
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

function buildDisplayNames(rows) {
	return rows.map((row) => ({
		...row,
		createdTime: row.remote_created_time || null,
		modifiedTime: row.remote_modified_time || null,
		// The adapter layer is the single source of truth for provider
		// capabilities; do not hardcode per-provider assumptions here.
		capabilities: getProviderCapabilities(row.provider),
	}));
}

export function listFilesByPath(userId, virtualPath = '/') {
	const normalized = normalizePath(virtualPath);
	const rows = db
		.prepare(`
      SELECT
        fm.*, ca.provider, ca.email
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ?
				AND fm.virtual_path = ?
				AND ca.status = 'active'
      ORDER BY fm.is_folder DESC, fm.file_name COLLATE NOCASE ASC
    `)
		.all(userId, normalized);

	return buildDisplayNames(rows);
}

export function searchFiles(userId, term = '', limit = 50) {
	const normalizedTerm = String(term || '').trim();
	if (!normalizedTerm) return [];

	const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
	const rows = db
		.prepare(`
      SELECT
        fm.*, ca.provider, ca.email
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ?
				AND ca.status = 'active'
				AND fm.file_name LIKE ? COLLATE NOCASE
      ORDER BY
				CASE WHEN fm.file_name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
				fm.is_folder DESC,
				COALESCE(fm.remote_created_time, fm.created_at) DESC,
				fm.file_name COLLATE NOCASE ASC
			LIMIT ?
    `)
		.all(userId, `%${normalizedTerm}%`, `${normalizedTerm}%`, safeLimit);

	return buildDisplayNames(rows);
}

export function createFileMetadata(record) {
	const payload = {
		id: randomUUID(),
		user_id: record.user_id,
		virtual_path: normalizePath(record.virtual_path),
		file_name: record.file_name,
		is_folder: record.is_folder ? 1 : 0,
		is_starred: record.is_starred ? 1 : 0,
		size: record.size,
		mime_type: resolveMimeType(record),
		cloud_account_id: record.cloud_account_id,
		remote_file_id: record.remote_file_id,
		remote_parent_id: record.remote_parent_id || null,
		remote_created_time: record.remote_created_time || null,
		remote_modified_time: record.remote_modified_time || null,
	};

	db.prepare(FILE_METADATA_INSERT).run(payload);

	return getFileById(payload.user_id, payload.id);
}

/**
 * Resolve which cloud account already owns a given virtual folder path, so a
 * newly created nested folder inherits its parent's provider instead of being
 * allocated independently (which would let a single virtual subtree span
 * multiple providers — the confusing "cross-provider tree" problem).
 *
 * Strategy: look for any item that lives directly inside `virtualPath`; its
 * cloud_account_id is the account backing that folder. Falls back to the folder
 * row that represents the path itself. Returns null for root or an empty/unknown
 * path so the caller can allocate normally.
 */
export function getAccountIdForPath(userId, virtualPath = '/') {
	const normalized = normalizePath(virtualPath);
	if (normalized === '/') return null;

	// 1) Any child already inside this folder shares its account.
	const child = db
		.prepare('SELECT cloud_account_id FROM file_metadata WHERE user_id = ? AND virtual_path = ? LIMIT 1')
		.get(userId, normalized);
	if (child?.cloud_account_id) return child.cloud_account_id;

	// 2) Otherwise locate the folder row representing this path itself
	//    (parent path + folder name).
	const trimmed = normalized.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	const parentPath = lastSlash <= 0 ? '/' : `${trimmed.slice(0, lastSlash)}/`;
	const folderName = trimmed.slice(lastSlash + 1);
	const folder = db
		.prepare(
			'SELECT cloud_account_id FROM file_metadata WHERE user_id = ? AND virtual_path = ? AND file_name = ? AND is_folder = 1 LIMIT 1',
		)
		.get(userId, parentPath, folderName);
	return folder?.cloud_account_id || null;
}

export function getFileById(userId, id) {
	const row = db
		.prepare(`
      SELECT fm.*, ca.provider, ca.email
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND fm.id = ? AND ca.status = 'active'
    `)
		.get(userId, id);

	if (!row) return row;
	return buildDisplayNames([row])[0];
}

export function getFileByRemoteId(userId, cloudAccountId, remoteFileId) {
	const row = db
		.prepare(`
      SELECT fm.*, ca.provider, ca.email
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND fm.cloud_account_id = ? AND fm.remote_file_id = ? AND ca.status = 'active'
    `)
		.get(userId, cloudAccountId, remoteFileId);

	if (!row) return row;
	return buildDisplayNames([row])[0];
}

/**
 * Batch-load every locally synced file for an account, keyed by its
 * remote_file_id. Used to resolve "shared with me" items against local
 * metadata in O(1) per item instead of issuing one query per remote item
 * (avoids an N+1 query pattern). Backed by idx_file_user_account_id.
 */
export function getLocalFilesByRemoteId(userId, cloudAccountId) {
	const rows = db
		.prepare(`
      SELECT fm.*, ca.provider, ca.email
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND fm.cloud_account_id = ? AND ca.status = 'active'
    `)
		.all(userId, cloudAccountId);

	const byRemoteId = new Map();
	for (const file of buildDisplayNames(rows)) {
		if (file.remote_file_id != null && !byRemoteId.has(file.remote_file_id)) {
			byRemoteId.set(file.remote_file_id, file);
		}
	}
	return byRemoteId;
}

export function listStarredFiles(userId) {
	const rows = db
		.prepare(`
			SELECT fm.*, ca.provider, ca.email
			FROM file_metadata fm
			INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND COALESCE(fm.is_starred, 0) = 1 AND ca.status = 'active'
			ORDER BY COALESCE(fm.remote_modified_time, fm.remote_created_time) DESC,
				fm.updated_at DESC,
				fm.file_name COLLATE NOCASE ASC
		`)
		.all(userId);

	return buildDisplayNames(rows);
}

export function listRecentFiles(userId) {
	const rows = db
		.prepare(`
			SELECT fm.*, ca.provider, ca.email
			FROM file_metadata fm
			INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ?
				AND fm.is_folder = 0
				AND ca.status = 'active'
			ORDER BY COALESCE(fm.remote_modified_time, fm.remote_created_time) DESC,
				fm.updated_at DESC,
				fm.file_name COLLATE NOCASE ASC
		`)
		.all(userId);

	return buildDisplayNames(rows);
}

export function updateFileStarredByRemoteId(userId, cloudAccountId, remoteFileId, isStarred) {
	return db.prepare(`
		UPDATE file_metadata
		SET is_starred = ?, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND cloud_account_id = ? AND remote_file_id = ?
	`).run(isStarred ? 1 : 0, userId, cloudAccountId, remoteFileId);
}

export function setFileStarred(userId, fileId, isStarred) {
	return db.prepare(`
		UPDATE file_metadata
		SET is_starred = ?, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND id = ?
	`).run(isStarred ? 1 : 0, userId, fileId);
}

export function replaceFilesForAccount(userId, cloudAccountId, records, options = {}) {
	const { preserveStarred = false } = options;

	const existingStarredByRemoteId = preserveStarred
		? new Map(
			db
				.prepare(
					'SELECT remote_file_id, is_starred FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?',
				)
				.all(userId, cloudAccountId)
				.map((row) => [row.remote_file_id, row.is_starred ? 1 : 0]),
		)
		: null;

	const normalizedRecords = records.map((record) => {
		const incomingStarred = record.is_starred ? 1 : 0;
		const preservedStarred = preserveStarred
			? incomingStarred || existingStarredByRemoteId.get(record.remote_file_id) || 0
			: incomingStarred;

		return {
			id: record.id || randomUUID(),
			user_id: userId,
			virtual_path: normalizePath(record.virtual_path),
			file_name: record.file_name,
			is_folder: record.is_folder ? 1 : 0,
			is_starred: preservedStarred,
			size: Number(record.size || 0),
			mime_type: resolveMimeType(record),
			cloud_account_id: cloudAccountId,
			remote_file_id: record.remote_file_id,
			remote_parent_id: record.remote_parent_id || null,
			remote_created_time: record.remote_created_time || null,
			remote_modified_time: record.remote_modified_time || null,
		};
	});

	const replace = db.transaction(() => {
		db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?').run(userId, cloudAccountId);

		if (!normalizedRecords.length) {
			return;
		}

		const insert = db.prepare(FILE_METADATA_INSERT);

		normalizedRecords.forEach((record) => insert.run(record));
	});

	replace();
}

/**
 * Move a single mirrored item to a new virtual folder path within the SAME
 * account. For a folder, every descendant's virtual_path prefix is rewritten in
 * the same transaction so the local tree stays consistent. `targetPath` is the
 * destination folder (e.g. "/photos/"); the item keeps its own name. Exact
 * substr prefix matching avoids LIKE wildcard pitfalls for names with % or _.
 * No-ops for items not mirrored locally.
 */
export function moveFileMetadata(userId, id, targetPath) {
	const row = db.prepare('SELECT * FROM file_metadata WHERE user_id = ? AND id = ?').get(userId, id);
	if (!row) return;

	const destination = normalizePath(targetPath);

	const move = db.transaction(() => {
		if (row.is_folder) {
			const oldPath = folderSelfPath(row.virtual_path, row.file_name);
			const newPath = folderSelfPath(destination, row.file_name);
			db.prepare(`
				UPDATE file_metadata
				SET virtual_path = ? || substr(virtual_path, length(?) + 1),
					updated_at = CURRENT_TIMESTAMP
				WHERE user_id = ?
					AND cloud_account_id = ?
					AND substr(virtual_path, 1, length(?)) = ?
			`).run(newPath, oldPath, userId, row.cloud_account_id, oldPath, oldPath);
		}

		db.prepare(`
			UPDATE file_metadata
			SET virtual_path = ?, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = ? AND id = ?
		`).run(destination, userId, id);
	});

	move();
}

export function clearFilesForAccount(userId, cloudAccountId) {
	db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?').run(userId, cloudAccountId);
}

/**
 * Diff a freshly fetched full structure against the locally mirrored rows for an
 * account and apply only the changes (insert new, update modified, delete
 * vanished), instead of the previous delete-all-then-reinsert. For a stable
 * account where little changed, this writes a handful of rows instead of
 * rewriting every row on every sync.
 *
 * Keyed by `remote_file_id`. Returns a small change summary for observability.
 * The starred flag is preserved for providers that do not own starred state
 * (preserveStarred=true), matching replaceFilesForAccount's behavior.
 */
export function syncFilesForAccount(userId, cloudAccountId, records, options = {}) {
	const { preserveStarred = false } = options;

	const existingRows = db
		.prepare('SELECT * FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?')
		.all(userId, cloudAccountId);
	const existingByRemoteId = new Map(existingRows.map((row) => [row.remote_file_id, row]));

	const normalizedRecords = records
		.filter((record) => record.remote_file_id != null)
		.map((record) => ({
			user_id: userId,
			virtual_path: normalizePath(record.virtual_path),
			file_name: record.file_name,
			is_folder: record.is_folder ? 1 : 0,
			is_starred: record.is_starred ? 1 : 0,
			size: Number(record.size || 0),
			mime_type: resolveMimeType(record),
			cloud_account_id: cloudAccountId,
			remote_file_id: record.remote_file_id,
			remote_parent_id: record.remote_parent_id || null,
			remote_created_time: record.remote_created_time || null,
			remote_modified_time: record.remote_modified_time || null,
		}));

	const incomingIds = new Set(normalizedRecords.map((record) => record.remote_file_id));
	const summary = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };

	const insertStmt = db.prepare(
		`${FILE_METADATA_INSERT}
		ON CONFLICT(cloud_account_id, remote_file_id) DO UPDATE SET
			virtual_path = excluded.virtual_path,
			file_name = excluded.file_name,
			is_folder = excluded.is_folder,
			is_starred = excluded.is_starred,
			size = excluded.size,
			mime_type = excluded.mime_type,
			remote_parent_id = excluded.remote_parent_id,
			remote_created_time = excluded.remote_created_time,
			remote_modified_time = excluded.remote_modified_time,
			updated_at = CURRENT_TIMESTAMP`,
	);
	const deleteStmt = db.prepare(
		'DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ? AND remote_file_id = ?',
	);

	const apply = db.transaction(() => {
		for (const record of normalizedRecords) {
			const existing = existingByRemoteId.get(record.remote_file_id);
			const finalStarred = preserveStarred
				? record.is_starred || (existing?.is_starred ? 1 : 0)
				: record.is_starred;
			const payload = { id: existing?.id || randomUUID(), ...record, is_starred: finalStarred };

			if (!existing) {
				insertStmt.run(payload);
				summary.inserted += 1;
				continue;
			}

			const isUnchanged =
				existing.virtual_path === payload.virtual_path &&
				existing.file_name === payload.file_name &&
				existing.is_folder === payload.is_folder &&
				(existing.is_starred ? 1 : 0) === payload.is_starred &&
				Number(existing.size) === payload.size &&
				(existing.mime_type || null) === (payload.mime_type || null) &&
				(existing.remote_parent_id || null) === payload.remote_parent_id &&
				(existing.remote_modified_time || null) === payload.remote_modified_time;

			if (isUnchanged) {
				summary.unchanged += 1;
				continue;
			}

			insertStmt.run(payload);
			summary.updated += 1;
		}

		for (const row of existingRows) {
			if (!incomingIds.has(row.remote_file_id)) {
				deleteStmt.run(userId, cloudAccountId, row.remote_file_id);
				summary.deleted += 1;
			}
		}
	});

	apply();
	return summary;
}

/**
 * Apply an incremental set of provider delta changes to the mirror. Each change
 * is `{ type: 'upsert' | 'delete', record }`. Upserts use the remote-id upsert
 * path; deletes remove the row (and any descendants for folders). Returns a
 * change summary. Used by the delta-sync path when a provider supports change
 * tokens.
 */
export function applyDeltaChanges(userId, cloudAccountId, changes = [], options = {}) {
	const { preserveStarred = false } = options;
	const summary = { upserted: 0, deleted: 0 };

	const existingStarred = preserveStarred
		? new Map(
			db
				.prepare('SELECT remote_file_id, is_starred FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?')
				.all(userId, cloudAccountId)
				.map((row) => [row.remote_file_id, row.is_starred ? 1 : 0]),
		)
		: null;

	const apply = db.transaction(() => {
		for (const change of changes) {
			if (!change?.record?.remote_file_id) continue;

			if (change.type === 'delete') {
				const row = db
					.prepare('SELECT id FROM file_metadata WHERE user_id = ? AND cloud_account_id = ? AND remote_file_id = ?')
					.get(userId, cloudAccountId, change.record.remote_file_id);
				if (row) {
					deleteFileMetadataById(userId, row.id);
					summary.deleted += 1;
				}
				continue;
			}

			const record = change.record;
			const preservedStarred = preserveStarred
				? (record.is_starred ? 1 : 0) || existingStarred.get(record.remote_file_id) || 0
				: record.is_starred
					? 1
					: 0;

			upsertFileByRemoteId({
				user_id: userId,
				virtual_path: record.virtual_path,
				file_name: record.file_name,
				is_folder: record.is_folder,
				is_starred: preservedStarred,
				size: record.size,
				mime_type: record.mime_type,
				cloud_account_id: cloudAccountId,
				remote_file_id: record.remote_file_id,
				remote_parent_id: record.remote_parent_id,
				remote_created_time: record.remote_created_time,
				remote_modified_time: record.remote_modified_time,
			});
			summary.upserted += 1;
		}
	});

	apply();
	return summary;
}

export function upsertFileMetadata(record) {
	db.prepare(`
    ${FILE_METADATA_INSERT}
    ON CONFLICT(id) DO UPDATE SET
			user_id = excluded.user_id,
      virtual_path = excluded.virtual_path,
      file_name = excluded.file_name,
      is_folder = excluded.is_folder,
			is_starred = excluded.is_starred,
      size = excluded.size,
      mime_type = excluded.mime_type,
      cloud_account_id = excluded.cloud_account_id,
      remote_file_id = excluded.remote_file_id,
      remote_parent_id = excluded.remote_parent_id,
	  remote_created_time = excluded.remote_created_time,
	  remote_modified_time = excluded.remote_modified_time,
      updated_at = CURRENT_TIMESTAMP
  `).run({
		...record,
		virtual_path: normalizePath(record.virtual_path),
		user_id: record.user_id,
		is_folder: record.is_folder ? 1 : 0,
		is_starred: record.is_starred ? 1 : 0,
	});
}

/**
 * Compute the full virtual path of a folder item (its own path, including a
 * trailing slash). For a folder named "b" living under "/a/", this returns
 * "/a/b/". Used to remap or remove descendants when a folder is renamed or
 * deleted without re-walking the whole provider account.
 */
function folderSelfPath(virtualPath, fileName) {
	const parent = normalizePath(virtualPath);
	return normalizePath(`${parent === '/' ? '' : parent}${fileName}`);
}

/**
 * Insert (or update on conflict) a single mirrored file row keyed by its
 * provider remote id. This replaces the previous "delete every row for the
 * account and re-insert the entire structure" behavior for upload and
 * create-folder, so a single mutation no longer re-walks the whole account.
 * The existing starred flag is preserved on conflict.
 */
export function upsertFileByRemoteId(record) {
	if (!record.remote_file_id) {
		throw new Error('upsertFileByRemoteId: remote_file_id is required');
	}

	const payload = {
		id: record.id || randomUUID(),
		user_id: record.user_id,
		virtual_path: normalizePath(record.virtual_path),
		file_name: record.file_name,
		is_folder: record.is_folder ? 1 : 0,
		is_starred: record.is_starred ? 1 : 0,
		size: Number(record.size || 0),
		mime_type: resolveMimeType(record),
		cloud_account_id: record.cloud_account_id,
		remote_file_id: record.remote_file_id,
		remote_parent_id: record.remote_parent_id || null,
		remote_created_time: record.remote_created_time || null,
		remote_modified_time: record.remote_modified_time || null,
	};

	db.prepare(`
    ${FILE_METADATA_INSERT}
    ON CONFLICT(cloud_account_id, remote_file_id) DO UPDATE SET
      virtual_path = excluded.virtual_path,
      file_name = excluded.file_name,
      is_folder = excluded.is_folder,
      size = excluded.size,
      mime_type = excluded.mime_type,
      remote_parent_id = excluded.remote_parent_id,
      remote_modified_time = excluded.remote_modified_time,
      updated_at = CURRENT_TIMESTAMP
  `).run(payload);

	return getFileByRemoteId(payload.user_id, payload.cloud_account_id, payload.remote_file_id);
}

/**
 * Rename a single mirrored item in place. When the item is a folder, every
 * descendant's virtual_path prefix is rewritten in the same transaction so the
 * local tree stays consistent without a full account resync. Exact-prefix
 * matching via substr avoids the wildcard pitfalls of LIKE for names that
 * contain "%" or "_". No-ops when the row is not mirrored locally (e.g. a
 * "shared with me" item, which is served live from the provider).
 */
export function renameFileMetadata(userId, id, nextName) {
	const row = db.prepare('SELECT * FROM file_metadata WHERE user_id = ? AND id = ?').get(userId, id);
	if (!row) return;

	const rename = db.transaction(() => {
		if (row.is_folder) {
			const oldPath = folderSelfPath(row.virtual_path, row.file_name);
			const newPath = folderSelfPath(row.virtual_path, nextName);
			db.prepare(`
				UPDATE file_metadata
				SET virtual_path = ? || substr(virtual_path, length(?) + 1),
					updated_at = CURRENT_TIMESTAMP
				WHERE user_id = ?
					AND cloud_account_id = ?
					AND substr(virtual_path, 1, length(?)) = ?
			`).run(newPath, oldPath, userId, row.cloud_account_id, oldPath, oldPath);
		}

		db.prepare(`
			UPDATE file_metadata
			SET file_name = ?, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = ? AND id = ?
		`).run(nextName, userId, id);
	});

	rename();
}

/**
 * Delete a single mirrored item. For folders, all descendant rows (matched by
 * exact virtual_path prefix) are removed in the same transaction. Returns the
 * freed byte total and the owning account id so callers can adjust cached
 * usage without a full provider storage round-trip. No-ops for items that are
 * not mirrored locally.
 */
export function deleteFileMetadataById(userId, id) {
	const row = db.prepare('SELECT * FROM file_metadata WHERE user_id = ? AND id = ?').get(userId, id);
	if (!row) {
		return { deletedSize: 0, cloudAccountId: null };
	}

	const remove = db.transaction(() => {
		let deletedSize = Number(row.size || 0);

		if (row.is_folder) {
			const selfPath = folderSelfPath(row.virtual_path, row.file_name);
			const descendantSize = db
				.prepare(`
					SELECT COALESCE(SUM(size), 0) AS total
					FROM file_metadata
					WHERE user_id = ?
						AND cloud_account_id = ?
						AND substr(virtual_path, 1, length(?)) = ?
				`)
				.get(userId, row.cloud_account_id, selfPath, selfPath);
			deletedSize += Number(descendantSize.total || 0);

			db.prepare(`
				DELETE FROM file_metadata
				WHERE user_id = ?
					AND cloud_account_id = ?
					AND substr(virtual_path, 1, length(?)) = ?
			`).run(userId, row.cloud_account_id, selfPath, selfPath);
		}

		db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND id = ?').run(userId, id);
		return deletedSize;
	});

	return { deletedSize: remove(), cloudAccountId: row.cloud_account_id };
}
