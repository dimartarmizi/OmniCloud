import { env } from '../config/env.js';
import { getCookieOptions, getFallbackLocalUser, resolveSession } from '../services/authService.js';

function parseCookies(cookieHeader = '') {
	return Object.fromEntries(
		String(cookieHeader || '')
			.split(';')
			.map((item) => item.trim())
			.filter(Boolean)
			.map((item) => {
				const separator = item.indexOf('=');
				if (separator === -1) return [item, ''];
				return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
			}),
	);
}

export function resolveUserFromRequest(req) {
	if (env.appMode === 'local') {
		return getFallbackLocalUser();
	}

	const cookies = parseCookies(req.headers?.cookie || '');
	const token = cookies[env.authCookieName] || '';
	return resolveSession(token);
}

export function attachAuthContext(req, res, next) {
	res.locals.authCookieOptions = getCookieOptions();
	req.appMode = env.appMode;
	req.user = resolveUserFromRequest(req);
	return next();
}

export function requireAppUser(req, res, next) {
	if (req.user) {
		return next();
	}

	return res.status(401).json({ error: 'Authentication required' });
}