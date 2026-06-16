import { env } from '../config/env.js';
import { createOAuthStateStore } from '../utils/oauthStateStore.js';
import { beginOAuthFlow, completeOAuthLink } from '../utils/oauthFlowHelper.js';

const oauthStates = createOAuthStateStore();
const DROPBOX_SCOPES = [
	'account_info.read',
	'files.metadata.read',
	'files.content.read',
	'files.content.write',
];

function assertDropboxConfigured() {
	if (!env.dropboxClientId || !env.dropboxClientSecret) {
		throw new Error('Dropbox OAuth is not configured. Set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET.');
	}
}

function parseDropboxError(payload, fallback) {
	return payload?.error_description || payload?.error_summary || payload?.error || fallback;
}

async function exchangeCodeForTokens(code) {
	const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: env.dropboxClientId,
			client_secret: env.dropboxClientSecret,
			code,
			redirect_uri: env.dropboxRedirectUri,
			grant_type: 'authorization_code',
		}),
	});

	const payload = await response.json();
	if (!response.ok) {
		throw new Error(parseDropboxError(payload, 'Failed to exchange Dropbox OAuth code'));
	}

	return payload;
}

async function dropboxRpc(accessToken, path, body = {}) {
	const response = await fetch(`https://api.dropboxapi.com/2${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(parseDropboxError(payload, 'Dropbox API request failed'));
	}

	return payload;
}

async function fetchDropboxProfile(accessToken) {
	const [account, space] = await Promise.all([
		dropboxRpc(accessToken, '/users/get_current_account'),
		dropboxRpc(accessToken, '/users/get_space_usage'),
	]);

	return {
		email: account.email || null,
		displayName: account.name?.display_name || account.name?.familiar_name || null,
		accountId: account.account_id || null,
		totalSpace: Number(space.allocation?.allocated || space.allocation?.individual?.allocated || space.allocation?.team?.allocated || 0),
		usedSpace: Number(space.used || 0),
	};
}

export function getDropboxIntegrationStatus() {
	return {
		configured: Boolean(env.dropboxClientId && env.dropboxClientSecret),
		clientId: env.dropboxClientId ? '[configured]' : '[missing]',
		redirectUri: env.dropboxRedirectUri,
	};
}

export function createDropboxAuthorizationRequest(userId) {
	assertDropboxConfigured();

	const state = beginOAuthFlow(oauthStates, userId);

	const authorizationUrl = new URL('https://www.dropbox.com/oauth2/authorize');
	authorizationUrl.searchParams.set('client_id', env.dropboxClientId);
	authorizationUrl.searchParams.set('response_type', 'code');
	authorizationUrl.searchParams.set('redirect_uri', env.dropboxRedirectUri);
	authorizationUrl.searchParams.set('token_access_type', 'offline');
	authorizationUrl.searchParams.set('scope', DROPBOX_SCOPES.join(' '));
	authorizationUrl.searchParams.set('state', state);

	return {
		authorizationUrl: authorizationUrl.toString(),
		state,
		redirectUri: env.dropboxRedirectUri,
	};
}

export async function completeDropboxAccountLink({ code, state }) {
	assertDropboxConfigured();

	return completeOAuthLink({
		store: oauthStates,
		provider: 'dropbox',
		providerLabel: 'Dropbox',
		code,
		state,
		exchange: async (authorizationCode) => {
			const tokens = await exchangeCodeForTokens(authorizationCode);
			const profile = await fetchDropboxProfile(tokens.access_token);

			if (!tokens.refresh_token) {
				throw new Error('Dropbox did not return a refresh token. Reconnect with offline access enabled.');
			}

			return {
				account: {
					email: profile.email,
					credentials: {
						provider: 'dropbox',
						clientId: env.dropboxClientId,
						clientSecret: env.dropboxClientSecret,
						redirectUri: env.dropboxRedirectUri,
						refreshToken: tokens.refresh_token,
						accessToken: tokens.access_token || null,
						expiresIn: tokens.expires_in || null,
						scope: tokens.scope || DROPBOX_SCOPES.join(' '),
						tokenType: tokens.token_type || 'bearer',
						accountId: profile.accountId,
						displayName: profile.displayName,
					},
					total_space: profile.totalSpace,
					used_space: profile.usedSpace,
				},
				profile,
			};
		},
	});
}
