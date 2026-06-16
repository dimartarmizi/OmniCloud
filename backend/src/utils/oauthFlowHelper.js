import { randomUUID } from 'crypto';
import { upsertCloudAccount } from '../services/accountService.js';
import { syncAccount } from '../services/syncService.js';

/**
 * Shared OAuth account-linking flow.
 *
 * The four redirect-based providers (Google, OneDrive, Dropbox, Yandex) share
 * the same skeleton: generate + store a `state`, then on callback validate the
 * state, exchange the code, build a cloud-account record, upsert it, and trigger
 * an initial sync. Only the token exchange and the credential/profile shape are
 * provider-specific. This helper owns the skeleton so each service contributes
 * just its provider-specific pieces, eliminating four near-identical copies.
 */

/**
 * Generate a CSRF `state`, persist it in the given store, and return the value
 * the caller embeds in the provider authorization URL.
 */
export function beginOAuthFlow(store, userId) {
	const state = randomUUID();
	store.set(state, { userId, createdAt: Date.now() });
	return state;
}

/**
 * Complete an OAuth callback.
 *
 * @param {object} params
 * @param {object} params.store          OAuth state store (createOAuthStateStore()).
 * @param {string} params.provider       Canonical provider id (e.g. 'google_drive').
 * @param {string} params.providerLabel  Human label used in error messages (e.g. 'Google').
 * @param {string} params.code           Authorization code from the callback.
 * @param {string} params.state          State value from the callback.
 * @param {(code: string) => Promise<{ account: object, profile: object }>} params.exchange
 *        Provider-specific step: exchange the code and return the cloud-account
 *        payload (minus userId/id) and a profile object. `account.email` is
 *        required. Receives the authorization code.
 * @param {boolean} [params.syncOptional=false] When true, an initial-sync failure
 *        is logged and swallowed instead of rejecting (matches Yandex's prior behavior).
 * @returns {Promise<{ account: object, profile: object }>}
 */
export async function completeOAuthLink({
	store,
	provider,
	providerLabel,
	code,
	state,
	exchange,
	syncOptional = false,
}) {
	if (!code || !state) {
		throw new Error(`Missing ${providerLabel} OAuth code or state`);
	}

	const authState = store.get(state);
	if (!authState) {
		throw new Error(`Invalid or expired ${providerLabel} OAuth state`);
	}

	store.delete(state);

	const { account: accountPayload, profile } = await exchange(code);

	if (!accountPayload?.email) {
		throw new Error(`Unable to read ${providerLabel} account email`);
	}

	const account = upsertCloudAccount({
		userId: authState.userId,
		id: randomUUID(),
		provider,
		status: 'active',
		...accountPayload,
	});

	if (syncOptional) {
		await syncAccount(authState.userId, account).catch((error) => {
			console.warn(`[${provider}] initial sync failed:`, error.message);
		});
	} else {
		await syncAccount(authState.userId, account);
	}

	return { account, profile };
}
