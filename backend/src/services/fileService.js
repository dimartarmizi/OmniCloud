import { randomUUID } from 'crypto';
import { db } from '../config/database.js';
import { resolveMimeType } from '../utils/mime.js';

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const cleaned = input.startsWith('/') ? input : `/${input}`;
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

export function getFileParts(fileMetadataId) {
	return db.prepare('SELECT * FROM file_parts WHERE file_metadata_id = ? ORDER BY part_index ASC').all(fileMetadataId);
}

/**
 * Compute effective usable storage for a user.
 *
 * Formula (accurate):
 *   usable = rawTotal - replicaOverhead
 *
 * Where:
 *   rawTotal      = SUM of total_space across all active accounts
 *   totalPartsUsed = SUM of part_size across all file_parts on active accounts
 *   primaryUsed   = SUM of size across all non-folder files (the "real" data)
 *   replicaOverhead = totalPartsUsed - primaryUsed  (extra space consumed by replicas)
 *   usable = rawTotal - replicaOverhead
 *          = rawTotal - (totalPartsUsed - primaryUsed)
 *          = rawTotal - totalPartsUsed + primaryUsed
 */
export function getUsableCapacity(userId) {
	const rawTotal = db
		.prepare(`SELECT COALESCE(SUM(total_space), 0) as total FROM cloud_accounts WHERE user_id = ? AND status = 'active'`)
		.get(userId)?.total || 0;

	// Total space consumed by ALL parts (primary + replicas) on active accounts
	const totalPartsUsed = db
		.prepare(`
			SELECT COALESCE(SUM(fp.part_size), 0) as total
			FROM file_parts fp
			INNER JOIN cloud_accounts ca ON ca.id = fp.cloud_account_id
			WHERE ca.user_id = ? AND ca.status = 'active'
		`)
		.get(userId)?.total || 0;

	// Space of the actual files (primary data) = used_space tracked per account
	const primaryUsed = db
		.prepare(`SELECT COALESCE(SUM(size), 0) as total FROM file_metadata WHERE user_id = ? AND is_folder = 0`)
		.get(userId)?.total || 0;

	// Get replication factor
	const rawRepFactor = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'replication_factor'").get(userId)?.value;
	const replicationFactor = Math.min(3, Math.max(1, Number(rawRepFactor || 1)));

	// Replica overhead = extra bytes consumed beyond primary files
	const replicaOverhead = Math.max(0, Number(totalPartsUsed) - Number(primaryUsed));

	// Usable capacity = rawTotal / replicationFactor
	const usableCapacity = Math.max(0, Math.floor(Number(rawTotal) / replicationFactor));

	return {
		rawTotal: Number(rawTotal),
		totalPartsUsed: Number(totalPartsUsed),
		primaryUsed: Number(primaryUsed),
		replicaOverhead,
		usableCapacity,
		replicationFactor,
	};
}

function buildDisplayNames(rows) {
	return rows.map((row) => ({
		...row,
		createdTime: row.remote_created_time || null,
		modifiedTime: row.remote_modified_time || null,
		capabilities: {
			starred: row.provider === 'google_drive',
			rename: true,
			delete: true,
		},
	}));
}

export function listFilesByPath(userId, virtualPath = '/') {
	const normalized = normalizePath(virtualPath);
	const rows = db
		.prepare(`
      SELECT
        fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
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
        fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
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

	if (!payload.is_folder) {
		db.prepare(`
			INSERT OR IGNORE INTO file_parts (
				id, file_metadata_id, cloud_account_id, remote_file_id, remote_parent_id, part_index, part_size
			) VALUES (
				lower(hex(randomblob(16))), ?, ?, ?, ?, 0, ?
			)
		`).run(payload.id, payload.cloud_account_id, payload.remote_file_id, payload.remote_parent_id, payload.size);
	}

	return getFileById(payload.user_id, payload.id);
}

export function getFileById(userId, id) {
	const row = db
		.prepare(`
      SELECT fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
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
      SELECT fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
      FROM file_metadata fm
      INNER JOIN cloud_accounts ca ON ca.id = fm.cloud_account_id
			WHERE fm.user_id = ? AND fm.cloud_account_id = ? AND fm.remote_file_id = ? AND ca.status = 'active'
    `)
		.get(userId, cloudAccountId, remoteFileId);

	if (!row) return row;
	return buildDisplayNames([row])[0];
}

export function listAllFiles(userId) {
	return db.prepare('SELECT * FROM file_metadata WHERE user_id = ?').all(userId);
}

export function listStarredFiles(userId) {
	const rows = db
		.prepare(`
			SELECT fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
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
			SELECT fm.*, ca.provider,
        COALESCE((SELECT GROUP_CONCAT(caa.email, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.email) as email,
        COALESCE((SELECT GROUP_CONCAT(caa.provider, ', ') FROM file_parts fpp INNER JOIN cloud_accounts caa ON caa.id = fpp.cloud_account_id WHERE fpp.file_metadata_id = fm.id AND caa.status = 'active'), ca.provider) as providers,
        (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) as parts_count
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
export function replaceFilesForAccount(userId, cloudAccountId, records) {
	// Get all remote_file_id on this cloudAccountId that registered as replica (not main file)
	const replicaRemoteIds = db.prepare(`
		SELECT fp.remote_file_id
		FROM file_parts fp
		INNER JOIN file_metadata fm ON fm.id = fp.file_metadata_id
		WHERE fp.cloud_account_id = ?
			AND fm.cloud_account_id != ?
	`).all(cloudAccountId, cloudAccountId).map(r => r.remote_file_id);

	// Filter so that replicas are not inserted as new files in file_metadata
	const filteredRecords = records.filter((record) => !replicaRemoteIds.includes(record.remote_file_id));

	const replace = db.transaction(() => {
		// 1. Get current files in metadata for this account
		const currentFiles = db.prepare(`
			SELECT id, remote_file_id FROM file_metadata 
			WHERE user_id = ? AND cloud_account_id = ?
		`).all(userId, cloudAccountId);

		const currentFilesMap = new Map(currentFiles.map(f => [f.remote_file_id, f.id]));
		const remoteFileIds = new Set(filteredRecords.map(r => r.remote_file_id));

		// 2. Delete files that no longer exist on remote
		const filesToDelete = currentFiles.filter(f => !remoteFileIds.has(f.remote_file_id));
		if (filesToDelete.length > 0) {
			const deleteMetadata = db.prepare('DELETE FROM file_metadata WHERE id = ?');
			for (const file of filesToDelete) {
				deleteMetadata.run(file.id);
			}
		}

		// Delete replica parts on this account that no longer exist on the cloud provider
		const currentRemoteIds = records.map((r) => r.remote_file_id);
		if (currentRemoteIds.length > 0) {
			db.prepare(`
				DELETE FROM file_parts
				WHERE cloud_account_id = ?
					AND remote_file_id NOT IN (${currentRemoteIds.map(() => '?').join(',')})
					AND file_metadata_id IN (
						SELECT id FROM file_metadata WHERE cloud_account_id != ?
					)
			`).run(cloudAccountId, ...currentRemoteIds, cloudAccountId);
		} else {
			db.prepare(`
				DELETE FROM file_parts
				WHERE cloud_account_id = ?
					AND file_metadata_id IN (
						SELECT id FROM file_metadata WHERE cloud_account_id != ?
					)
			`).run(cloudAccountId, cloudAccountId);
		}

		if (!filteredRecords.length) {
			return;
		}

		const insertMetadata = db.prepare(`
			INSERT INTO file_metadata (
				id, user_id, virtual_path, file_name, is_folder, is_starred, size, mime_type,
				cloud_account_id, remote_file_id, remote_parent_id, remote_created_time, remote_modified_time
			) VALUES (
				?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			)
		`);

		const updateMetadata = db.prepare(`
			UPDATE file_metadata SET
				virtual_path = ?,
				file_name = ?,
				is_folder = ?,
				is_starred = ?,
				size = ?,
				mime_type = ?,
				remote_parent_id = ?,
				remote_created_time = ?,
				remote_modified_time = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`);

		const insertPart = db.prepare(`
			INSERT OR IGNORE INTO file_parts (
				id, file_metadata_id, cloud_account_id, remote_file_id, remote_parent_id, part_index, part_size
			) VALUES (
				lower(hex(randomblob(16))), ?, ?, ?, ?, 0, ?
			)
		`);

		const updatePart = db.prepare(`
			UPDATE file_parts SET
				remote_parent_id = ?,
				part_size = ?
			WHERE file_metadata_id = ? AND cloud_account_id = ? AND part_index = 0
		`);

		filteredRecords.forEach((record) => {
			const existingId = currentFilesMap.get(record.remote_file_id);
			if (record.is_folder) {
				if (existingId) {
					updateMetadata.run(
						normalizePath(record.virtual_path),
						record.file_name,
						1,
						record.is_starred ? 1 : 0,
						0,
						null,
						record.remote_parent_id || null,
						record.remote_created_time || null,
						record.remote_modified_time || null,
						existingId
					);
				} else {
					insertMetadata.run(
						record.id || randomUUID(),
						userId,
						normalizePath(record.virtual_path),
						record.file_name,
						1,
						record.is_starred ? 1 : 0,
						0,
						null,
						cloudAccountId,
						record.remote_file_id,
						record.remote_parent_id || null,
						record.remote_created_time || null,
						record.remote_modified_time || null
					);
				}
			} else {
				// Search for existing file with same path and name in file_metadata owned by this user
				const existing = db.prepare(`
					SELECT id FROM file_metadata
					WHERE user_id = ? AND virtual_path = ? AND file_name = ? AND is_folder = 0
				`).get(userId, normalizePath(record.virtual_path), record.file_name);

				const fileMetadataId = existing?.id || existingId || record.id || randomUUID();
				const isNew = !existing && !existingId;

				if (isNew) {
					insertMetadata.run(
						fileMetadataId,
						userId,
						normalizePath(record.virtual_path),
						record.file_name,
						0,
						record.is_starred ? 1 : 0,
						Number(record.size || 0),
						resolveMimeType(record),
						cloudAccountId,
						record.remote_file_id,
						record.remote_parent_id || null,
						record.remote_created_time || null,
						record.remote_modified_time || null
					);
					insertPart.run(
						fileMetadataId,
						cloudAccountId,
						record.remote_file_id,
						record.remote_parent_id,
						Number(record.size || 0)
					);
				} else {
					updateMetadata.run(
						normalizePath(record.virtual_path),
						record.file_name,
						0,
						record.is_starred ? 1 : 0,
						Number(record.size || 0),
						resolveMimeType(record),
						record.remote_parent_id || null,
						record.remote_created_time || null,
						record.remote_modified_time || null,
						fileMetadataId
					);
					updatePart.run(
						record.remote_parent_id || null,
						Number(record.size || 0),
						fileMetadataId,
						cloudAccountId
					);
					// Fallback insert if somehow the part entry is missing
					insertPart.run(
						fileMetadataId,
						cloudAccountId,
						record.remote_file_id,
						record.remote_parent_id,
						Number(record.size || 0)
					);
				}
			}
		});
	});

	replace();
}

export function clearFilesForAccount(userId, cloudAccountId) {
	db.prepare('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?').run(userId, cloudAccountId);
	db.prepare('DELETE FROM file_parts WHERE cloud_account_id = ?').run(cloudAccountId);
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

	if (!record.is_folder) {
		db.prepare(`
			INSERT INTO file_parts (
				id, file_metadata_id, cloud_account_id, remote_file_id, remote_parent_id, part_index, part_size
			) VALUES (
				lower(hex(randomblob(16))), ?, ?, ?, ?, 0, ?
			)
			ON CONFLICT(file_metadata_id, cloud_account_id, part_index) DO UPDATE SET
				remote_file_id = excluded.remote_file_id,
				remote_parent_id = excluded.remote_parent_id,
				part_size = excluded.part_size
		`).run(record.id, record.cloud_account_id, record.remote_file_id, record.remote_parent_id, record.size);
	}
}

export function listDirectoryTree(userId) {
	return db
		.prepare(`
      SELECT id, virtual_path, file_name, is_folder, cloud_account_id
      FROM file_metadata
      WHERE user_id = ?
      ORDER BY virtual_path, is_folder DESC, file_name
    `)
		.all(userId);
}
