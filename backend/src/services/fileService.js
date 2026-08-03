import { randomUUID } from 'crypto';
import { db } from '../config/database.js';
import { resolveMimeType } from '../utils/mime.js';
import { getHiddenFilesForBatch, clearHiddenForAccount } from './hiddenFileService.js';

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const cleaned = input.startsWith('/') ? input : `/${input}`;
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

function buildDisplayNames(rows) {
	if (!rows.length) return [];

	const hidden = getHiddenFilesForBatch(
		rows.map((row) => ({ cloud_account_id: row.cloud_account_id, remote_file_id: row.remote_file_id })),
	);
	const byKey = new Map(hidden.map((h) => [`${h.cloud_account_id}:${h.remote_file_id}`, h]));

	return rows.map((row) => {
		const base = {
			...row,
			createdTime: row.remote_created_time || null,
			modifiedTime: row.remote_modified_time || null,
			capabilities: {
				starred: row.provider === 'google_drive',
				rename: true,
				delete: true,
			},
		};

		const enc = byKey.get(`${row.cloud_account_id}:${row.remote_file_id}`);
		if (enc) {
			// Hidden files are flagged (so download/preview routes know to decrypt)
			// but their real identity is encrypted in enc_meta — only the vault path
			// reveals it. Starring is disabled: hidden files never appear in Starred.
			base.is_hidden = true;
			base.capabilities = { starred: false, rename: true, delete: true };
		}

		return base;
	});
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
				AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
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
				AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
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
		size: record.size,
		mime_type: resolveMimeType(record),
		cloud_account_id: record.cloud_account_id,
		remote_file_id: record.remote_file_id,
		remote_parent_id: record.remote_parent_id || null,
		remote_created_time: record.remote_created_time || null,
		remote_modified_time: record.remote_modified_time || null,
	};

	db.prepare(`
    INSERT INTO file_metadata (
			id, user_id, virtual_path, file_name, is_folder, size, mime_type,
			cloud_account_id, remote_file_id, remote_parent_id, remote_created_time, remote_modified_time
    ) VALUES (
			@id, @user_id, @virtual_path, @file_name, @is_folder, @size, @mime_type,
			@cloud_account_id, @remote_file_id, @remote_parent_id, @remote_created_time, @remote_modified_time
    )
  `).run(payload);

	return getFileById(payload.user_id, payload.id);
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

export function listAllFiles(userId) {
	return db
		.prepare(`
			SELECT fm.* FROM file_metadata fm
			WHERE fm.user_id = ?
				AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
		`)
		.all(userId);
}

export function listStarredFiles(userId) {
	const rows = db
		.prepare(`
			SELECT fm.*, ca.provider, ca.email
			FROM file_metadata fm
			INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND COALESCE(fm.is_starred, 0) = 1 AND ca.status = 'active'
				AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
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
				AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
			ORDER BY COALESCE(fm.remote_modified_time, fm.remote_created_time) DESC,
				fm.updated_at DESC,
				fm.file_name COLLATE NOCASE ASC
		`)
		.all(userId);

	return buildDisplayNames(rows);
}

// Raw hidden rows (obfuscated name/size) joined to file_encryption. Real
// identity is inside enc_meta — decrypt it in the route with the vault KEK.
export function listHiddenFiles(userId) {
	return db
		.prepare(`
			SELECT fm.*, ca.provider, ca.email, fe.wrapped_key, fe.enc_meta
			FROM file_metadata fm
			INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			INNER JOIN file_encryption fe
				ON fe.cloud_account_id = fm.cloud_account_id AND fe.remote_file_id = fm.remote_file_id
			WHERE fm.user_id = ? AND fm.is_folder = 0 AND ca.status = 'active'
			ORDER BY COALESCE(fm.remote_modified_time, fm.remote_created_time) DESC,
				fm.updated_at DESC
		`)
		.all(userId);
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

export function replaceFilesForAccount(userId, cloudAccountId, records) {
	const normalizedRecords = records.map((record) => ({
		id: record.id || randomUUID(),
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

	const replace = db.transaction(() => {
		db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?').run(userId, cloudAccountId);

		if (!normalizedRecords.length) {
			return;
		}

		const insert = db.prepare(`
      INSERT INTO file_metadata (
				id, user_id, virtual_path, file_name, is_folder, is_starred, size, mime_type,
				cloud_account_id, remote_file_id, remote_parent_id, remote_created_time, remote_modified_time
      ) VALUES (
				@id, @user_id, @virtual_path, @file_name, @is_folder, @is_starred, @size, @mime_type,
				@cloud_account_id, @remote_file_id, @remote_parent_id, @remote_created_time, @remote_modified_time
      )
    `);

		normalizedRecords.forEach((record) => insert.run(record));
	});

	replace();
}

export function clearFilesForAccount(userId, cloudAccountId) {
	db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?').run(userId, cloudAccountId);
	clearHiddenForAccount(cloudAccountId);
}

export function upsertFileMetadata(record) {
	db.prepare(`
    INSERT INTO file_metadata (
			id, user_id, virtual_path, file_name, is_folder, is_starred, size, mime_type,
			cloud_account_id, remote_file_id, remote_parent_id, remote_created_time, remote_modified_time
    ) VALUES (
			@id, @user_id, @virtual_path, @file_name, @is_folder, @is_starred, @size, @mime_type,
			@cloud_account_id, @remote_file_id, @remote_parent_id, @remote_created_time, @remote_modified_time
    )
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

export function listDirectoryTree(userId) {
	return db
		.prepare(`
      SELECT fm.id, fm.virtual_path, fm.file_name, fm.is_folder, fm.cloud_account_id
      FROM file_metadata fm
      WHERE fm.user_id = ?
        AND NOT EXISTS (
					SELECT 1 FROM file_encryption fe
					WHERE fe.cloud_account_id = fm.cloud_account_id
						AND fe.remote_file_id = fm.remote_file_id
				)
      ORDER BY fm.virtual_path, fm.is_folder DESC, fm.file_name
    `)
		.all(userId);
}
