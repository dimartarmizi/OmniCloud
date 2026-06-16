import { randomUUID } from 'crypto';
import { db } from '../config/database.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const insertStmt = db.prepare(`
	INSERT INTO upload_sessions (
		id, user_id, token, file_name, size, mime_type, virtual_path,
		remote_parent_id, cloud_account_id, fallback_chain, status, expires_at
	) VALUES (
		@id, @user_id, @token, @file_name, @size, @mime_type, @virtual_path,
		@remote_parent_id, @cloud_account_id, @fallback_chain, @status, @expires_at
	)
`);
const selectStmt = db.prepare('SELECT * FROM upload_sessions WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM upload_sessions WHERE id = ?');
const sweepStmt = db.prepare('DELETE FROM upload_sessions WHERE expires_at <= ?');

const sweepTimer = setInterval(() => {
	sweepStmt.run(Date.now());
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

// Rehydrate the DB row into the shape the upload pipeline expects: fallback_chain
// as an array, status/token/createdAt fields present. Returns null for a missing
// or already-expired session.
function hydrate(row) {
	if (!row) return null;
	if (Number(row.expires_at) <= Date.now()) {
		deleteStmt.run(row.id);
		return null;
	}
	let fallbackChain = [];
	try {
		const parsed = JSON.parse(row.fallback_chain || '[]');
		fallbackChain = Array.isArray(parsed) ? parsed : [];
	} catch {
		fallbackChain = [];
	}
	return {
		id: row.id,
		user_id: row.user_id,
		token: row.token,
		file_name: row.file_name,
		size: Number(row.size || 0),
		mime_type: row.mime_type,
		virtual_path: row.virtual_path,
		remote_parent_id: row.remote_parent_id,
		cloud_account_id: row.cloud_account_id,
		fallback_chain: fallbackChain,
		status: row.status,
		createdAt: row.created_at,
	};
}

export function createUploadSession(payload) {
	const id = randomUUID();
	const record = {
		id,
		user_id: payload.user_id,
		token: randomUUID(),
		file_name: payload.file_name,
		size: Number(payload.size || 0),
		mime_type: payload.mime_type ?? null,
		virtual_path: payload.virtual_path || '/',
		remote_parent_id: payload.remote_parent_id ?? null,
		cloud_account_id: payload.cloud_account_id,
		fallback_chain: JSON.stringify(Array.isArray(payload.fallback_chain) ? payload.fallback_chain : []),
		status: 'pending',
		expires_at: Date.now() + SESSION_TTL_MS,
	};

	insertStmt.run(record);
	return hydrate(selectStmt.get(id));
}

export function getUploadSessionForUser(userId, id) {
	const session = hydrate(selectStmt.get(id));
	if (!session || session.user_id !== userId) return null;
	return session;
}

export function updateUploadSession(id, patch = {}) {
	const existing = selectStmt.get(id);
	if (!existing) return null;

	const allowed = ['status', 'cloud_account_id'];
	const assignments = [];
	const params = { id };
	for (const key of allowed) {
		if (patch[key] !== undefined) {
			assignments.push(`${key} = @${key}`);
			params[key] = patch[key];
		}
	}
	if (!assignments.length) return hydrate(existing);

	db.prepare(`UPDATE upload_sessions SET ${assignments.join(', ')} WHERE id = @id`).run(params);
	return hydrate(selectStmt.get(id));
}

export function removeUploadSession(id) {
	deleteStmt.run(id);
}
