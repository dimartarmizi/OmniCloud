import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { env } from '../config/env.js';
import { upsertCloudAccount } from './accountService.js';
import { syncAccount } from './syncService.js';
import { saveOAuthState, consumeOAuthState } from './oauthStateStore.js';


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
	const state = randomUUID();
	saveOAuthState(state, 'google_drive', userId);

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
	if (!code || !state) {
		throw new Error('Missing Google OAuth code or state');
	}

	const authState = consumeOAuthState(state, 'google_drive');
	if (!authState) {
		throw new Error('Invalid or expired Google OAuth state');
	}

	const oauthClient = createOAuthClient();
	const { tokens } = await oauthClient.getToken(code);
	oauthClient.setCredentials(tokens);

	const profile = await fetchDriveProfile(oauthClient);
	if (!profile.email) {
		throw new Error('Unable to read Google account email');
	}

	const account = upsertCloudAccount({
		userId: authState.userId,
		id: randomUUID(),
		email: profile.email,
		provider: 'google_drive',
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
		status: 'active',
	});

	await syncAccount(authState.userId, account);

	return {
		account,
		profile,
	};
}
