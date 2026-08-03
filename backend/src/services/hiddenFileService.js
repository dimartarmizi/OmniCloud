import { db } from '../config/database.js';
import { unwrapDataKey, wrapDataKey } from '../utils/fileEncryption.js';
import { kekWrap, kekMeta, encryptMeta } from '../utils/vaultCrypto.js';

// The real identity lives encrypted in enc_meta; the plaintext columns keep
// empty placeholders (they're NOT NULL in the original schema) and are unused.
export function storeHiddenFile({ cloud_account_id, remote_file_id, wrapped_key, enc_meta }) {
	db.prepare(`
    INSERT INTO file_encryption (cloud_account_id, remote_file_id, real_name, plaintext_size, mime_type, wrapped_key, enc_meta)
    VALUES (@cloud_account_id, @remote_file_id, '', 0, NULL, @wrapped_key, @enc_meta)
    ON CONFLICT(cloud_account_id, remote_file_id) DO UPDATE SET
      wrapped_key = excluded.wrapped_key,
      enc_meta = excluded.enc_meta,
      updated_at = CURRENT_TIMESTAMP
  `).run({ cloud_account_id, remote_file_id, wrapped_key, enc_meta });
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

export function updateHiddenFileMeta(cloudAccountId, remoteFileId, encMeta) {
	return db
		.prepare(`
      UPDATE file_encryption
      SET enc_meta = ?, updated_at = CURRENT_TIMESTAMP
      WHERE cloud_account_id = ? AND remote_file_id = ?
    `)
		.run(encMeta, cloudAccountId, remoteFileId);
}

export function deleteHiddenFile(cloudAccountId, remoteFileId) {
	return db
		.prepare('DELETE FROM file_encryption WHERE cloud_account_id = ? AND remote_file_id = ?')
		.run(cloudAccountId, remoteFileId);
}

export function clearHiddenForAccount(cloudAccountId) {
	return db.prepare('DELETE FROM file_encryption WHERE cloud_account_id = ?').run(cloudAccountId);
}

// Legacy rows (enc_meta IS NULL) were wrapped under env.encryptionKey with
// plaintext metadata columns. Re-key them under the vault KEK so they appear in
// the Hidden section after vault setup. Rows that fail to decrypt under the
// current server key are left untouched (they stay hidden everywhere).
export function migrateLegacyHiddenFiles(userId, kek) {
	const accounts = db.prepare('SELECT id FROM cloud_accounts WHERE user_id = ?').all(userId);
	const wrapKey = kekWrap(kek);
	const metaKey = kekMeta(kek);
	let migrated = 0;

	for (const account of accounts) {
		const legacy = db
			.prepare('SELECT * FROM file_encryption WHERE cloud_account_id = ? AND enc_meta IS NULL')
			.all(account.id);
		for (const row of legacy) {
			try {
				const dek = unwrapDataKey(row.wrapped_key); // legacy scheme: server master key
				const newWrapped = wrapDataKey(dek, wrapKey);
				const newMeta = encryptMeta(
					{
						real_name: row.real_name || '',
						plaintext_size: Number(row.plaintext_size || 0),
						mime_type: row.mime_type || 'application/octet-stream',
					},
					metaKey,
				);
				db.prepare(`
          UPDATE file_encryption
          SET wrapped_key = ?, enc_meta = ?, real_name = '', plaintext_size = 0, mime_type = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE cloud_account_id = ? AND remote_file_id = ?
        `).run(newWrapped, newMeta, account.id, row.remote_file_id);
				migrated += 1;
			} catch {
				// not decryptable under the current server key — skip
			}
		}
	}

	return migrated;
}
