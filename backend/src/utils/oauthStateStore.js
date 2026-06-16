import { db } from '../config/database.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const insertStmt = db.prepare(
	'INSERT OR REPLACE INTO oauth_states (state, payload, expires_at) VALUES (?, ?, ?)',
);
const selectStmt = db.prepare('SELECT payload, expires_at FROM oauth_states WHERE state = ?');
const deleteStmt = db.prepare('DELETE FROM oauth_states WHERE state = ?');
const sweepStmt = db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?');

// A single shared sweeper keeps the table bounded regardless of how many stores
// are created. State rows are also validated against expires_at on read, so a
// missed sweep can never resurrect an expired state.
const sweepTimer = setInterval(() => {
	sweepStmt.run(Date.now());
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

/**
 * Persistent store for short-lived OAuth `state` values used during provider
 * account linking. Backed by the `oauth_states` SQLite table so the
 * connect→callback round-trip survives a process restart. (Real-time upload
 * progress still pins OmniCloud to a single backend instance — see
 * websocketHub.js — so cross-instance OAuth is not currently exercised, but
 * persisting state here keeps the flow robust across restarts and removes a
 * per-process memory dependency.) Entries expire after STATE_TTL_MS.
 */
export function createOAuthStateStore() {
	return {
		set(state, value) {
			insertStmt.run(state, JSON.stringify(value ?? {}), Date.now() + STATE_TTL_MS);
		},
		get(state) {
			const row = selectStmt.get(state);
			if (!row) return undefined;
			if (Number(row.expires_at) <= Date.now()) {
				deleteStmt.run(state);
				return undefined;
			}
			try {
				return JSON.parse(row.payload);
			} catch {
				deleteStmt.run(state);
				return undefined;
			}
		},
		delete(state) {
			deleteStmt.run(state);
		},
	};
}
