import crypto from 'crypto';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { createUser, getUserByEmail, getUserById, getOrCreateLocalUser, serializeUser, updateUserPassword, deleteUser } from './userService.js';

const SESSION_BYTES = 32;
const PASSWORD_MIN_LENGTH = 8;

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
	return String(email || '').trim().toLowerCase();
}

export function hashPassword(password) {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
	if (!storedHash || !storedHash.includes(':')) return false;
	const [salt, expectedHash] = storedHash.split(':');
	const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
	return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function sessionExpiryDate() {
	const expiresAt = new Date();
	expiresAt.setHours(expiresAt.getHours() + Math.max(1, env.authSessionTtlHours));
	return expiresAt;
}

export function createSession(userId) {
	const token = crypto.randomBytes(SESSION_BYTES).toString('hex');
	const tokenHash = sha256(`${env.authSecret}:${token}`);
	const sessionId = crypto.randomUUID();
	const expiresAt = sessionExpiryDate();

	db.prepare(`
		INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
		VALUES (?, ?, ?, ?)
	`).run(sessionId, userId, tokenHash, expiresAt.toISOString());

	return {
		id: sessionId,
		token,
		expiresAt: expiresAt.toISOString(),
	};
}

export function resolveSession(token) {
	if (!token) return null;
	const tokenHash = sha256(`${env.authSecret}:${token}`);
	const row = db.prepare(`
		SELECT s.id as session_id, s.user_id, s.expires_at, u.*
		FROM auth_sessions s
		INNER JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ?
	`).get(tokenHash);

	if (!row) return null;
	if (new Date(row.expires_at).getTime() <= Date.now()) {
		db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
		return null;
	}

	db.prepare('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id);
	return getUserById(row.user_id);
}

export function destroySession(token) {
	if (!token) return;
	const tokenHash = sha256(`${env.authSecret}:${token}`);
	db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
}

export function clearUserSessions(userId) {
	db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}

/**
 * Delete all auth sessions whose expiry has passed. resolveSession already
 * deletes a session lazily when its exact token is presented, but abandoned
 * sessions (the user never returns) would otherwise accumulate forever. A daily
 * cron calls this to keep the table bounded. Returns the number of rows removed.
 */
export function purgeExpiredSessions() {
	const result = db
		.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?')
		.run(new Date().toISOString());
	return result.changes;
}

export function registerHostedUser({ email, password }) {
	if (env.appMode !== 'hosted') {
		throw new Error('Registration is only available in hosted mode');
	}

	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail || !normalizedEmail.includes('@')) {
		throw new Error('Valid email is required');
	}

	if (String(password || '').length < PASSWORD_MIN_LENGTH) {
		throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
	}

	if (getUserByEmail(normalizedEmail)) {
		throw new Error('Email is already registered');
	}

	const user = createUser({
		email: normalizedEmail,
		passwordHash: hashPassword(password),
	});

	return user;
}

export function loginHostedUser({ email, password }) {
	if (env.appMode !== 'hosted') {
		throw new Error('Login is only available in hosted mode');
	}

	const user = getUserByEmail(normalizeEmail(email));
	if (!user || !verifyPassword(password, user.password_hash)) {
		throw new Error('Invalid email or password');
	}

	return user;
}

export function getFallbackLocalUser() {
	return getOrCreateLocalUser();
}

/**
 * Change a hosted user's password after verifying the current one. Hosted mode
 * only — local mode has no credentials. All existing sessions are invalidated
 * so other devices must re-authenticate with the new password.
 */
export function changeHostedUserPassword(userId, { currentPassword, newPassword }) {
	if (env.appMode !== 'hosted') {
		throw new Error('Password change is only available in hosted mode');
	}

	const user = getUserById(userId);
	if (!user) {
		throw new Error('User not found');
	}

	if (!verifyPassword(currentPassword, user.password_hash)) {
		throw new Error('Current password is incorrect');
	}

	if (String(newPassword || '').length < PASSWORD_MIN_LENGTH) {
		throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
	}

	updateUserPassword(userId, hashPassword(newPassword));
	clearUserSessions(userId);
	return getUserById(userId);
}

/**
 * Permanently delete a hosted user's account. Verifies the password, then
 * cascade-deletes every owned row (cloud_accounts, file_metadata, sessions,
 * settings) via the users FK ON DELETE CASCADE. Caller is responsible for any
 * provider-side token revocation before invoking this.
 */
export function deleteHostedUserAccount(userId, { password }) {
	if (env.appMode !== 'hosted') {
		throw new Error('Account deletion is only available in hosted mode');
	}

	const user = getUserById(userId);
	if (!user) {
		throw new Error('User not found');
	}

	if (!verifyPassword(password, user.password_hash)) {
		throw new Error('Password is incorrect');
	}

	clearUserSessions(userId);
	return deleteUser(userId);
}

export function getCookieOptions() {
	return {
		httpOnly: true,
		sameSite: 'lax',
		secure: env.authCookieSecure,
		path: '/',
	};
}

export function getAuthSummary(user) {
	return {
		mode: env.appMode,
		requiresAuth: env.appMode === 'hosted',
		authenticated: Boolean(user),
		user: serializeUser(user),
	};
}