import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// The credential-encryption key is derived only from a stable, operator-supplied
// secret — never from machine attributes (hostname/platform/arch). A container's
// hostname changes on every recreation, so folding it into the key meant every
// stored provider credential became undecryptable after a Docker redeploy even
// though the SQLite volume persisted. Prefer a dedicated OMNICLOUD_ENCRYPTION_KEY;
// fall back to OMNICLOUD_SECRET_HALF for backward compatibility.
//
// NOTE: changing this derivation invalidates credentials encrypted with the old
// machine-bound key. Affected accounts simply need to be reconnected once.
const encryptionSecret =
	process.env.OMNICLOUD_ENCRYPTION_KEY ||
	process.env.OMNICLOUD_SECRET_HALF ||
	'omnicloud-dev-secret-half';
const encryptionKey = crypto.createHash('sha256').update(encryptionSecret).digest();

export const env = {
	port: Number(process.env.PORT || 8787),
	appMode: process.env.APP_MODE === 'hosted' ? 'hosted' : 'local',
	corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
	syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES || 5),
	authCookieName: process.env.AUTH_COOKIE_NAME || 'omnicloud_session',
	authSessionTtlHours: Number(process.env.AUTH_SESSION_TTL_HOURS || 24 * 14),
	authCookieSecure:
		process.env.AUTH_COOKIE_SECURE !== undefined
			? process.env.AUTH_COOKIE_SECURE === 'true'
			: process.env.APP_MODE === 'hosted',
	authSecret: process.env.AUTH_SECRET || process.env.OMNICLOUD_SECRET_HALF || 'omnicloud-dev-auth-secret',
	encryptionKey,
	frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173',
	googleClientId: process.env.GOOGLE_CLIENT_ID || '',
	googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
	googleRedirectUri:
		process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8787/api/accounts/google/callback',
	onedriveClientId: process.env.ONEDRIVE_CLIENT_ID || '',
	onedriveClientSecret: process.env.ONEDRIVE_CLIENT_SECRET || '',
	onedriveTenantId: process.env.ONEDRIVE_TENANT_ID || 'common',
	onedriveRedirectUri:
		process.env.ONEDRIVE_REDIRECT_URI || 'http://localhost:8787/api/accounts/onedrive/callback',
	dropboxClientId: process.env.DROPBOX_CLIENT_ID || '',
	dropboxClientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
	dropboxRedirectUri:
		process.env.DROPBOX_REDIRECT_URI || 'http://localhost:8787/api/accounts/dropbox/callback',
	yandexClientId: process.env.YANDEX_CLIENT_ID || '',
	yandexClientSecret: process.env.YANDEX_CLIENT_SECRET || '',
	yandexRedirectUri:
		process.env.YANDEX_REDIRECT_URI || 'http://localhost:8787/api/accounts/yandex/callback',
};

export function redactEnv() {
	return {
		port: env.port,
		appMode: env.appMode,
		corsOrigin: env.corsOrigin,
		syncIntervalMinutes: env.syncIntervalMinutes,
		authCookieName: env.authCookieName,
		authSessionTtlHours: env.authSessionTtlHours,
		frontendUrl: env.frontendUrl,
		googleClientId: env.googleClientId ? '[configured]' : '[missing]',
		googleRedirectUri: env.googleRedirectUri,
		onedriveClientId: env.onedriveClientId ? '[configured]' : '[missing]',
		onedriveTenantId: env.onedriveTenantId,
		onedriveRedirectUri: env.onedriveRedirectUri,
		dropboxClientId: env.dropboxClientId ? '[configured]' : '[missing]',
		dropboxRedirectUri: env.dropboxRedirectUri,
		yandexClientId: env.yandexClientId ? '[configured]' : '[missing]',
		yandexRedirectUri: env.yandexRedirectUri,
	};
}
