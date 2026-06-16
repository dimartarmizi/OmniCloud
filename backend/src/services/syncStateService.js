import { db } from '../config/database.js';

/**
 * Per-account sync bookkeeping for incremental ("delta") synchronization.
 *
 * Stores the provider change token/cursor and the timestamps of the last full
 * and delta syncs in `account_sync_state`. The sync service uses this to decide
 * whether it can ask a provider for "only what changed since last time" (delta)
 * or must fall back to a full structure walk (first sync, missing token, or a
 * provider that does not support deltas).
 */

const selectStmt = db.prepare('SELECT * FROM account_sync_state WHERE cloud_account_id = ?');

const upsertStmt = db.prepare(`
	INSERT INTO account_sync_state (cloud_account_id, user_id, delta_token, last_full_sync_at, last_delta_sync_at, updated_at)
	VALUES (@cloud_account_id, @user_id, @delta_token, @last_full_sync_at, @last_delta_sync_at, CURRENT_TIMESTAMP)
	ON CONFLICT(cloud_account_id) DO UPDATE SET
		delta_token = excluded.delta_token,
		last_full_sync_at = COALESCE(excluded.last_full_sync_at, account_sync_state.last_full_sync_at),
		last_delta_sync_at = COALESCE(excluded.last_delta_sync_at, account_sync_state.last_delta_sync_at),
		updated_at = CURRENT_TIMESTAMP
`);

export function getSyncState(cloudAccountId) {
	return selectStmt.get(cloudAccountId) || null;
}

export function getDeltaToken(cloudAccountId) {
	return getSyncState(cloudAccountId)?.delta_token || null;
}

/**
 * Record that a full structure walk just completed, storing the fresh delta
 * token (if the provider returned one) for the next incremental run.
 */
export function recordFullSync(userId, cloudAccountId, deltaToken = null) {
	upsertStmt.run({
		cloud_account_id: cloudAccountId,
		user_id: userId,
		delta_token: deltaToken,
		last_full_sync_at: new Date().toISOString(),
		last_delta_sync_at: null,
	});
}

/**
 * Record that an incremental delta sync just completed, advancing the stored
 * token to the provider's new cursor.
 */
export function recordDeltaSync(userId, cloudAccountId, deltaToken = null) {
	upsertStmt.run({
		cloud_account_id: cloudAccountId,
		user_id: userId,
		delta_token: deltaToken,
		last_full_sync_at: null,
		last_delta_sync_at: new Date().toISOString(),
	});
}

/**
 * Drop the stored token so the next sync is forced to do a full walk. Used when
 * a provider reports the token as expired/invalid.
 */
export function clearDeltaToken(cloudAccountId) {
	db.prepare('UPDATE account_sync_state SET delta_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE cloud_account_id = ?')
		.run(cloudAccountId);
}
