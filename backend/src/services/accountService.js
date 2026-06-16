import { db } from '../config/database.js';
import { encryptJson } from '../utils/crypto.js';

export function listAccounts(userId) {
	return db
		.prepare(`
      SELECT id, user_id, email, provider, total_space, used_space, status, created_at, updated_at
      FROM cloud_accounts
      WHERE user_id = ?
      ORDER BY provider, email
    `)
		.all(userId);
}

export function getAccountById(userId, id) {
	return db.prepare('SELECT * FROM cloud_accounts WHERE user_id = ? AND id = ?').get(userId, id);
}

export function getActiveAccounts(userId) {
	return db.prepare("SELECT * FROM cloud_accounts WHERE user_id = ? AND status = 'active'").all(userId);
}

export function listUserIdsWithActiveAccounts() {
	return db
		.prepare("SELECT DISTINCT user_id FROM cloud_accounts WHERE status = 'active'")
		.all()
		.map((row) => row.user_id);
}

export function updateAccountUsage(userId, id, usedSpace) {
	db.prepare(
		'UPDATE cloud_accounts SET used_space = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?'
	).run(usedSpace, userId, id);
}

export function adjustAccountUsage(userId, id, deltaBytes) {
	const delta = Number(deltaBytes) || 0;
	if (!delta) return;
	db.prepare(
		`UPDATE cloud_accounts
     SET used_space = MAX(0, used_space + ?), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`
	).run(delta, userId, id);
}

export function updateAccountStorage(userId, id, totalSpace, usedSpace) {
	db.prepare(
		`UPDATE cloud_accounts
     SET total_space = ?, used_space = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`
	).run(totalSpace, usedSpace, userId, id);
}

export function markAccountStatus(userId, id, status) {
	db.prepare('UPDATE cloud_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?').run(
		status,
		userId,
		id,
	);
}

export function updateAccountCredentials(userId, id, credentials) {
	const encrypted_credentials =
		typeof credentials === 'string' ? credentials : encryptJson(credentials);

	db.prepare(
		'UPDATE cloud_accounts SET encrypted_credentials = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?',
	).run(encrypted_credentials, userId, id);
}

export function deleteAccount(userId, id) {
	db.prepare('DELETE FROM cloud_accounts WHERE user_id = ? AND id = ?').run(userId, id);
}

export function upsertCloudAccount({
	userId,
	id,
	email,
	provider,
	credentials,
	total_space,
	used_space,
	status = 'active',
}) {
	const encrypted_credentials = typeof credentials === 'string' ? credentials : encryptJson(credentials);

	db.prepare(`
    INSERT INTO cloud_accounts (
			id, user_id, email, provider, encrypted_credentials, total_space, used_space, status
    ) VALUES (
			@id, @user_id, @email, @provider, @encrypted_credentials, @total_space, @used_space, @status
    )
		ON CONFLICT(user_id, provider, email) DO UPDATE SET
      encrypted_credentials = excluded.encrypted_credentials,
      total_space = excluded.total_space,
      used_space = excluded.used_space,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `).run({
		id,
		user_id: userId,
		email,
		provider,
		encrypted_credentials,
		total_space,
		used_space,
		status,
	});

	return db.prepare('SELECT * FROM cloud_accounts WHERE user_id = ? AND provider = ? AND email = ?').get(userId, provider, email);
}
