import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { upsertCloudAccount } from './accountService.js';
import { syncAccount } from './syncService.js';
import { saveOAuthState, consumeOAuthState } from './oauthStateStore.js';

function getAuthorityBase() {
	return `https://login.microsoftonline.com/${encodeURIComponent(env.onedriveTenantId)}/oauth2/v2.0`;
}

function assertOneDriveConfigured() {
	if (!env.onedriveClientId || !env.onedriveClientSecret) {
		throw new Error('OneDrive OAuth is not configured. Set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET.');
	}
}

async function exchangeCodeForTokens(code) {
	const response = await fetch(`${getAuthorityBase()}/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: env.onedriveClientId,
			client_secret: env.onedriveClientSecret,
			code,
			redirect_uri: env.onedriveRedirectUri,
			grant_type: 'authorization_code',
			scope: 'offline_access openid profile email Files.ReadWrite.All User.Read',
		}),
	});

	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error_description || payload.error || 'Failed to exchange OneDrive OAuth code');
	}

	return payload;
	}

async function fetchGraphProfile(accessToken) {
	const [meResponse, driveResponse] = await Promise.all([
		fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		}),
		fetch('https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType,quota', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		}),
	]);

	const me = await meResponse.json();
	const drive = await driveResponse.json();

	if (!meResponse.ok) {
		throw new Error(me.error?.message || 'Unable to read OneDrive user profile');
	}

	if (!driveResponse.ok) {
		throw new Error(drive.error?.message || 'Unable to read OneDrive drive profile');
	}

	return {
		email: me.mail || me.userPrincipalName || null,
		displayName: me.displayName || null,
		driveId: drive.id || null,
		driveType: drive.driveType || 'personal',
		totalSpace: Number(drive.quota?.total || 0),
		usedSpace: Number(drive.quota?.used || 0),
	};
}

export function getOneDriveIntegrationStatus() {
	return {
		configured: Boolean(env.onedriveClientId && env.onedriveClientSecret),
		clientId: env.onedriveClientId ? '[configured]' : '[missing]',
		tenantId: env.onedriveTenantId,
		redirectUri: env.onedriveRedirectUri,
	};
}

export function createOneDriveAuthorizationRequest(userId) {
	assertOneDriveConfigured();

	const state = randomUUID();
	saveOAuthState(state, 'onedrive', userId);

	const authorizationUrl = new URL(`${getAuthorityBase()}/authorize`);
	authorizationUrl.searchParams.set('client_id', env.onedriveClientId);
	authorizationUrl.searchParams.set('response_type', 'code');
	authorizationUrl.searchParams.set('redirect_uri', env.onedriveRedirectUri);
	authorizationUrl.searchParams.set('response_mode', 'query');
	authorizationUrl.searchParams.set('scope', 'offline_access openid profile email Files.ReadWrite.All User.Read');
	authorizationUrl.searchParams.set('state', state);

	return {
		authorizationUrl: authorizationUrl.toString(),
		state,
		redirectUri: env.onedriveRedirectUri,
	};
}

export async function completeOneDriveAccountLink({ code, state }) {
	assertOneDriveConfigured();

	if (!code || !state) {
		throw new Error('Missing OneDrive OAuth code or state');
	}

	const authState = consumeOAuthState(state, 'onedrive');
	if (!authState) {
		throw new Error('Invalid or expired OneDrive OAuth state');
	}

	const tokens = await exchangeCodeForTokens(code);
	const profile = await fetchGraphProfile(tokens.access_token);

	if (!profile.email) {
		throw new Error('Unable to read OneDrive account email');
	}

	const account = upsertCloudAccount({
		userId: authState.userId,
		id: randomUUID(),
		email: profile.email,
		provider: 'onedrive',
		credentials: {
			provider: 'onedrive',
			clientId: env.onedriveClientId,
			clientSecret: env.onedriveClientSecret,
			redirectUri: env.onedriveRedirectUri,
			tenantId: env.onedriveTenantId,
			refreshToken: tokens.refresh_token || null,
			accessToken: tokens.access_token || null,
			expiresIn: tokens.expires_in || null,
			scope: tokens.scope || null,
			tokenType: tokens.token_type || null,
			driveId: profile.driveId,
			driveType: profile.driveType,
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