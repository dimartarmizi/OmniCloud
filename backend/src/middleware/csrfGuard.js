import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedOrigins() {
	// Both the CORS origin and the frontend URL are legitimate first-party origins.
	return new Set([env.corsOrigin, env.frontendUrl].filter(Boolean));
}

function originOf(value) {
	if (!value) return null;
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * CSRF defense via strict Origin/Referer validation on state-changing requests.
 *
 * The session cookie is SameSite=lax, which blocks cross-site form posts but not
 * every cross-site request shape, so cookie-authenticated mutations still need a
 * same-origin check. For POST/PATCH/PUT/DELETE we require the request's Origin
 * (or, as a fallback, Referer) to match an allowed first-party origin.
 *
 * Only enforced in hosted mode — local mode has no auth/cookies and is a
 * single-user desktop-style deployment, so there is no cross-site session to
 * forge. OAuth provider callbacks are GET (safe) and unaffected.
 */
export function csrfGuard(req, res, next) {
	if (env.appMode !== 'hosted') return next();
	if (SAFE_METHODS.has(req.method)) return next();

	const allowed = allowedOrigins();
	const requestOrigin = originOf(req.headers.origin) || originOf(req.headers.referer);

	if (requestOrigin && allowed.has(requestOrigin)) {
		return next();
	}

	return res.status(403).json({
		data: null,
		error: {
			code: 'CSRF_ORIGIN_REJECTED',
			message: 'Request origin is not allowed.',
		},
		meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
	});
}
