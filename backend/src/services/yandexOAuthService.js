import { env } from '../config/env.js';
import { createOAuthStateStore } from '../utils/oauthStateStore.js';
import { beginOAuthFlow, completeOAuthLink } from '../utils/oauthFlowHelper.js';

const oauthStates = createOAuthStateStore();

function assertYandexConfigured() {
	if (!env.yandexClientId || !env.yandexClientSecret) {
		throw new Error('Yandex OAuth is not configured. Set YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET.');
	}
}

async function exchangeCodeForTokens(code) {
	const response = await fetch('https://oauth.yandex.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: env.yandexClientId,
			client_secret: env.yandexClientSecret,
		}),
	});

	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload?.access_token) {
		throw new Error(payload?.error_description || payload?.error || 'Failed to exchange Yandex OAuth code');
	}

	return payload;
}

async function fetchYandexProfile(accessToken) {
	const response = await fetch('https://cloud-api.yandex.net/v1/disk/', {
		headers: { Authorization: `OAuth ${accessToken}` },
	});
	const disk = await response.json().catch(() => null);
	if (!response.ok || !disk) {
		throw new Error(disk?.message || 'Unable to read Yandex Disk profile');
	}

	const login = disk.user?.login || disk.user?.display_name || 'yandex-user';
	return {
		email: disk.user?.email || `${login}@yandex`,
		displayName: disk.user?.display_name || login,
		totalSpace: Number(disk.total_space || 0),
		usedSpace: Number(disk.used_space || 0),
	};
}

export function getYandexIntegrationStatus() {
	return {
		configured: Boolean(env.yandexClientId && env.yandexClientSecret),
		clientId: env.yandexClientId ? '[configured]' : '[missing]',
		redirectUri: env.yandexRedirectUri,
	};
}

export function createYandexAuthorizationRequest(userId) {
	assertYandexConfigured();

	const state = beginOAuthFlow(oauthStates, userId);

	const authorizationUrl = new URL('https://oauth.yandex.com/authorize');
	authorizationUrl.searchParams.set('response_type', 'code');
	authorizationUrl.searchParams.set('client_id', env.yandexClientId);
	authorizationUrl.searchParams.set('redirect_uri', env.yandexRedirectUri);
	authorizationUrl.searchParams.set('scope', 'cloud_api:disk.read cloud_api:disk.write cloud_api:disk.info');
	authorizationUrl.searchParams.set('state', state);

	return {
		authorizationUrl: authorizationUrl.toString(),
		state,
		redirectUri: env.yandexRedirectUri,
	};
}

export async function completeYandexAccountLink({ code, state }) {
	assertYandexConfigured();

	return completeOAuthLink({
		store: oauthStates,
		provider: 'yandex',
		providerLabel: 'Yandex',
		code,
		state,
		syncOptional: true,
		exchange: async (authorizationCode) => {
			const tokens = await exchangeCodeForTokens(authorizationCode);
			const profile = await fetchYandexProfile(tokens.access_token);

			return {
				account: {
					email: profile.email,
					credentials: {
						provider: 'yandex',
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token || null,
						clientId: env.yandexClientId,
						clientSecret: env.yandexClientSecret,
						expiresIn: tokens.expires_in || null,
						tokenType: tokens.token_type || 'bearer',
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
