import cron from 'node-cron';
import { env } from '../config/env.js';
import { LOCAL_USER_ID } from '../config/database.js';
import { getActiveAccounts, listUserIdsWithActiveAccounts, markAccountStatus, updateAccountStorage } from './accountService.js';
import { createAdapter } from './adapterRegistry.js';
import { clearFilesForAccount, syncFilesForAccount } from './fileService.js';
import { isAuthError, withRetry } from '../utils/providerErrors.js';
import { purgeExpiredSessions } from './authService.js';
import {
	clearDeltaToken,
	getDeltaToken,
	recordDeltaSync,
	recordFullSync,
} from './syncStateService.js';

async function fetchAccountSnapshot(account) {
	return withRetry(
		async () => {
			const adapter = createAdapter(account);
			const remoteFiles = await adapter.fetchStructure();
			const storage = await adapter.getStorageSummary();
			const providerStarred = Boolean(adapter.getCapabilities?.().starred);
			return { remoteFiles, storage, providerStarred };
		},
		{
			retries: 3,
			onRetry: (error, attempt) => {
				console.warn(
					`Transient sync error for ${account.email} (attempt ${attempt}), retrying:`,
					error?.message || error,
				);
			},
		},
	);
}

function handleSyncFailure(account, error) {
	if (isAuthError(error)) {
		clearFilesForAccount(account.user_id, account.id);
		markAccountStatus(account.user_id, account.id, 'invalid_token');
		console.error(`Auth error for account ${account.email}, marked invalid_token:`, error.message);
		return;
	}

	console.error(
		`Transient sync failure for account ${account.email} (kept connected):`,
		error.message,
	);
}

/**
 * Synchronize one account into the local mirror.
 *
 * For delta-capable providers with a stored change token, first ask the provider
 * whether anything changed since last time. If nothing changed, skip the
 * expensive full structure walk entirely (the common case for periodic syncs)
 * and only refresh the storage summary. Otherwise (changes present, no token, or
 * an expired token) do a full structure walk and diff it against the mirror so
 * only changed rows are written, then re-seed the delta token.
 *
 * Returns the number of remote items considered (for the legacy "changesDetected"
 * report field) — 0 when a delta check let us skip the walk.
 */
async function synchronizeAccount(userId, account) {
	const adapter = createAdapter(account);
	const supportsDelta = typeof adapter.supportsDeltaSync === 'function' && adapter.supportsDeltaSync();
	const providerStarred = Boolean(adapter.getCapabilities?.().starred);

	if (supportsDelta) {
		const token = getDeltaToken(account.id);
		if (token) {
			try {
				const delta = await withRetry(() => adapter.getDeltaChanges(token), { retries: 3 });
				if (delta && !delta.expired && !delta.hasChanges) {
					// Nothing changed remotely: avoid the full walk, just refresh quota.
					const storage = await adapter.getStorageSummary();
					updateAccountStorage(userId, account.id, storage.totalSpace, storage.usedSpace);
					// Advance the token so the window does not grow unbounded.
					if (delta.nextToken) {
						recordDeltaSync(userId, account.id, delta.nextToken);
					}
					return 0;
				}
				if (delta?.expired) {
					clearDeltaToken(account.id);
				}
			} catch (error) {
				// Delta probe failed transiently; fall through to a full walk.
				console.warn(`Delta probe failed for ${account.email}, doing full sync:`, error?.message || error);
			}
		}
	}

	// Full structure walk + diff-and-upsert (writes only changed rows).
	const { remoteFiles, storage } = await fetchAccountSnapshot(account);
	syncFilesForAccount(userId, account.id, remoteFiles, { preserveStarred: !providerStarred });
	updateAccountStorage(userId, account.id, storage.totalSpace, storage.usedSpace);

	// Re-seed the delta token so the next sync can be incremental.
	if (supportsDelta) {
		try {
			const nextToken = await adapter.getInitialDeltaToken();
			recordFullSync(userId, account.id, nextToken);
		} catch (error) {
			console.warn(`Could not seed delta token for ${account.email}:`, error?.message || error);
			recordFullSync(userId, account.id, null);
		}
	}

	return remoteFiles.length;
}

let lastSyncReport = {
	lastRunAt: null,
	userId: null,
	scannedAccounts: 0,
	changesDetected: 0,
};

const activeSyncPromises = new Map();

export async function runDeltaSync(userId) {
	const inFlight = activeSyncPromises.get(userId);
	if (inFlight) {
		return inFlight;
	}

	const syncPromise = (async () => {
		const accounts = getActiveAccounts(userId);

		// Each account is an independent provider round-trip. Fetching them in
		// parallel turns total sync latency from the sum of all account times
		// into the slowest single account's time. The per-account local DB
		// writes (replace/update) are synchronous in better-sqlite3 and touch
		// disjoint rows keyed by cloud_account_id, so concurrent resolution is
		// safe. Each task captures its own failure so one bad account never
		// rejects the batch.
		const perAccountChanges = await Promise.all(
			accounts.map(async (account) => {
				try {
					return await synchronizeAccount(userId, account);
				} catch (error) {
					handleSyncFailure(account, error);
					return 0;
				}
			}),
		);

		const changesDetected = perAccountChanges.reduce((sum, count) => sum + count, 0);

		lastSyncReport = {
			lastRunAt: new Date().toISOString(),
			userId,
			scannedAccounts: accounts.length,
			changesDetected,
		};

		return lastSyncReport;
	})();

	activeSyncPromises.set(userId, syncPromise);

	try {
		return await syncPromise;
	} finally {
		activeSyncPromises.delete(userId);
	}
}

export function scheduleSync() {
	const interval = Math.max(1, env.syncIntervalMinutes);
	return cron.schedule(`*/${interval} * * * *`, () => {
		if (env.appMode === 'local') {
			runDeltaSync(LOCAL_USER_ID).catch((error) => {
				console.error('Delta sync failed:', error);
			});
			return;
		}

		for (const userId of listUserIdsWithActiveAccounts()) {
			runDeltaSync(userId).catch((error) => {
				console.error(`Delta sync failed for user ${userId}:`, error);
			});
		}
	});
}

/**
 * Schedule a daily job that deletes expired auth sessions. resolveSession only
 * removes a session lazily when its exact token is presented again, so sessions
 * for users who never return would accumulate indefinitely. Runs at 03:00 server
 * time. Returns the cron task so the caller can stop it on shutdown.
 */
export function scheduleSessionCleanup() {
	return cron.schedule('0 3 * * *', () => {
		try {
			const removed = purgeExpiredSessions();
			if (removed > 0) {
				console.log(`Session cleanup removed ${removed} expired session(s).`);
			}
		} catch (error) {
			console.error('Session cleanup failed:', error?.message || error);
		}
	});
}

export function getLastSyncReport() {
	return {
		...lastSyncReport,
		isRunning: activeSyncPromises.size > 0,
	};
}

export async function syncAccount(userId, account) {
	try {
		const filesSynced = await synchronizeAccount(userId, account);
		const refreshed = getActiveAccounts(userId).find((item) => item.id === account.id) || account;

		return {
			accountId: account.id,
			filesSynced,
			totalSpace: Number(refreshed.total_space || 0),
			usedSpace: Number(refreshed.used_space || 0),
		};
	} catch (error) {
		handleSyncFailure(account, error);
		throw error;
	}
}
