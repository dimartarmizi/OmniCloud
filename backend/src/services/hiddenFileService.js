import { db } from '../config/database.js';

const INSERT_COLUMNS = `
  INSERT INTO file_encryption (cloud_account_id, remote_file_id, real_name, plaintext_size, mime_type, wrapped_key)
  VALUES (@cloud_account_id, @remote_file_id, @real_name, @plaintext_size, @mime_type, @wrapped_key)
  ON CONFLICT(cloud_account_id, remote_file_id) DO UPDATE SET
    real_name = excluded.real_name,
    plaintext_size = excluded.plaintext_size,
    mime_type = excluded.mime_type,
    wrapped_key = excluded.wrapped_key,
    updated_at = CURRENT_TIMESTAMP
`;

export function storeHiddenFile({ cloud_account_id, remote_file_id, real_name, plaintext_size, mime_type, wrapped_key }) {
	db.prepare(INSERT_COLUMNS).run({
		cloud_account_id,
		remote_file_id,
		real_name,
		plaintext_size: Number(plaintext_size || 0),
		mime_type: mime_type || 'application/octet-stream',
		wrapped_key,
	});
}

export function getHiddenFile(cloudAccountId, remoteFileId) {
	return db
		.prepare('SELECT * FROM file_encryption WHERE cloud_account_id = ? AND remote_file_id = ?')
		.get(cloudAccountId, remoteFileId);
}

/**
 * Batch fetch for listing decoration. Groups pairs by cloud_account_id and runs
 * one `IN (...)` query per account, avoiding N+1 on every folder listing.
 */
export function getHiddenFilesForBatch(pairs) {
	if (!pairs || !pairs.length) return [];

	const groups = new Map();
	for (const pair of pairs) {
		if (!pair || !pair.cloud_account_id || !pair.remote_file_id) continue;
		const list = groups.get(pair.cloud_account_id) || [];
		list.push(pair.remote_file_id);
		groups.set(pair.cloud_account_id, list);
	}

	const results = [];
	for (const [accountId, remoteIds] of groups) {
		const unique = [...new Set(remoteIds)];
		if (!unique.length) continue;
		const placeholders = unique.map(() => '?').join(',');
		const rows = db
			.prepare(`
        SELECT * FROM file_encryption
        WHERE cloud_account_id = ? AND remote_file_id IN (${placeholders})
      `)
			.all(accountId, ...unique);
		results.push(...rows);
	}
	return results;
}

export function updateHiddenFileName(cloudAccountId, remoteFileId, realName) {
	return db
		.prepare(`
      UPDATE file_encryption
      SET real_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE cloud_account_id = ? AND remote_file_id = ?
    `)
		.run(realName, cloudAccountId, remoteFileId);
}

export function deleteHiddenFile(cloudAccountId, remoteFileId) {
	return db
		.prepare('DELETE FROM file_encryption WHERE cloud_account_id = ? AND remote_file_id = ?')
		.run(cloudAccountId, remoteFileId);
}

export function clearHiddenForAccount(cloudAccountId) {
	return db.prepare('DELETE FROM file_encryption WHERE cloud_account_id = ?').run(cloudAccountId);
}
