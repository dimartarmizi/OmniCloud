import { randomUUID } from 'crypto';
import { db, LOCAL_USER_EMAIL, LOCAL_USER_ID } from '../config/database.js';

function mapUser(row) {
	if (!row) return null;
	return {
		...row,
		is_local: Boolean(row.is_local),
	};
}

export function getUserById(id) {
	return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getUserByEmail(email) {
	return mapUser(db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email));
}

export function createUser({ email, passwordHash, isLocal = false, id = randomUUID() }) {
	db.prepare(`
		INSERT INTO users (id, email, password_hash, is_local)
		VALUES (?, ?, ?, ?)
	`).run(id, email.trim().toLowerCase(), passwordHash, isLocal ? 1 : 0);

	return getUserById(id);
}

export function updateUserPassword(userId, passwordHash) {
	db.prepare(
		'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
	).run(passwordHash, userId);
	return getUserById(userId);
}

/**
 * Hard-delete a user. The cloud_accounts, file_metadata, auth_sessions and
 * user_settings tables all declare ON DELETE CASCADE against users(id), so a
 * single delete here removes every owned row. Returns true when a row was
 * removed.
 */
export function deleteUser(userId) {
	const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
	return result.changes > 0;
}

export function getOrCreateLocalUser() {
	const existing = getUserById(LOCAL_USER_ID);
	if (existing) return existing;

	return createUser({
		id: LOCAL_USER_ID,
		email: LOCAL_USER_EMAIL,
		passwordHash: '',
		isLocal: true,
	});
}

export function serializeUser(user) {
	if (!user) return null;
	return {
		id: user.id,
		email: user.email,
		isLocal: Boolean(user.is_local),
	};
}