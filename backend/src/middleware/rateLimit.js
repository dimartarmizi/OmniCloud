/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Intended for protecting auth endpoints (login/register) against brute-force
 * and CPU-exhaustion (scrypt) attacks without adding a dependency. Keyed by
 * client IP. State is per-process; for multi-instance deployments this should
 * be backed by a shared store (Redis), but it still meaningfully throttles each
 * instance. Buckets are swept lazily and on a bounded timer to cap memory.
 */
const buckets = new Map();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sweepTimer = setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of buckets) {
		if (entry.resetAt <= now) {
			buckets.delete(key);
		}
	}
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

function clientKey(req) {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded.length) {
		return forwarded.split(',')[0].trim();
	}
	return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, message } = {}) {
	return function rateLimit(req, res, next) {
		const key = `${req.method}:${req.baseUrl}${req.path}:${clientKey(req)}`;
		const now = Date.now();
		const entry = buckets.get(key);

		if (!entry || entry.resetAt <= now) {
			buckets.set(key, { count: 1, resetAt: now + windowMs });
			return next();
		}

		entry.count += 1;
		if (entry.count > max) {
			const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
			res.setHeader('Retry-After', String(retryAfterSec));
			return res.status(429).json({
				error: message || 'Too many requests. Please wait a moment and try again.',
			});
		}

		return next();
	};
}
