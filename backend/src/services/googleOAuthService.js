import { google } from 'googleapis';
import { env } from '../config/env.js';
import { createOAuthStateStore } from '../utils/oauthStateStore.js';
import { beginOAuthFlow, completeOAuthLink } from '../utils/oauthFlowHelper.js';

const oauthStates = createOAuthStateStore();


function readGoogleCredentials() {
	if (!env.googleClientId || !env.googleClientSecret) {
		throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env');
	}

	return {
		client_id: env.googleClientId,
		client_secret: env.googleClientSecret,
	};
}

function createOAuthClient() {
	const config = readGoogleCredentials();
	return new google.auth.OAuth2(config.client_id, config.client_secret, env.googleRedirectUri);
}

async function fetchDriveProfile(oauthClient) {
	const drive = google.drive({ version: 'v3', auth: oauthClient });
	const about = await drive.about.get({
		fields: 'user(emailAddress,displayName),storageQuota(limit,usage)',
	});

	const user = about.data.user || {};
	const quota = about.data.storageQuota || {};

	return {
		email: user.emailAddress,
		displayName: user.displayName,
		totalSpace: Number(quota.limit || 0),
		usedSpace: Number(quota.usage || 0),
	};
}

export function getGoogleIntegrationStatus() {
	return {
		configured: Boolean(env.googleClientId && env.googleClientSecret),
		redirectUri: env.googleRedirectUri,
	};
}

export function createGoogleAuthorizationRequest(userId) {
	const oauthClient = createOAuthClient();
	const state = beginOAuthFlow(oauthStates, userId);

	const authorizationUrl = oauthClient.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [
			'openid',
			'email',
			'profile',
			'https://www.googleapis.com/auth/drive',
			'https://www.googleapis.com/auth/drive.metadata',
		],
		state,
	});

	return {
		authorizationUrl,
		state,
		redirectUri: env.googleRedirectUri,
	};
}

export async function completeGoogleAccountLink({ code, state }) {
	return completeOAuthLink({
		store: oauthStates,
		provider: 'google_drive',
		providerLabel: 'Google',
		code,
		state,
		exchange: async (authorizationCode) => {
			const oauthClient = createOAuthClient();
			const { tokens } = await oauthClient.getToken(authorizationCode);
			oauthClient.setCredentials(tokens);

			const profile = await fetchDriveProfile(oauthClient);

			return {
				account: {
					email: profile.email,
					credentials: {
						provider: 'google_drive',
						clientId: oauthClient._clientId,
						clientSecret: oauthClient._clientSecret,
						redirectUri: env.googleRedirectUri,
						refreshToken: tokens.refresh_token || null,
						accessToken: tokens.access_token || null,
						expiryDate: tokens.expiry_date || null,
						scope: tokens.scope || null,
						tokenType: tokens.token_type || null,
					},
					total_space: profile.totalSpace,
					used_space: profile.usedSpace,
				},
				profile,
			};
		},
	});
}
