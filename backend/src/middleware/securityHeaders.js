import { env } from '../config/env.js';

/**
 * Baseline security headers applied to every response. These are cheap,
 * universally-recommended defenses:
 *  - X-Content-Type-Options: stop MIME sniffing of responses.
 *  - X-Frame-Options: deny framing (clickjacking).
 *  - Referrer-Policy: don't leak full URLs cross-origin.
 *  - Strict-Transport-Security: force HTTPS — only sent when cookies are marked
 *    secure (i.e. the deployment is actually served over HTTPS), so local HTTP
 *    development is unaffected.
 */
export function securityHeaders(_req, res, next) {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	if (env.authCookieSecure) {
		res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	next();
}
