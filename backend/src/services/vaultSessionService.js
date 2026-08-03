// In-memory vault unlock state. The KEK lives ONLY here while a user has the
// vault unlocked — it is never persisted and is lost on server restart (re-lock).
// Mirrors the uploadSessionService pattern (in-memory Map, per-user).

const sessions = new Map(); // userId -> { kek: Buffer, expiresAt: number }
const pinAttempts = new Map(); // userId -> { count: number, lockedUntil: number }

const TTL_MS = 30 * 60 * 1000; // sliding inactivity timeout
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

export function getKek(userId) {
	const session = sessions.get(userId);
	if (!session) return null;
	if (Date.now() > session.expiresAt) {
		sessions.delete(userId);
		return null;
	}
	session.expiresAt = Date.now() + TTL_MS; // sliding refresh
	return session.kek;
}

export function isUnlocked(userId) {
	return Boolean(getKek(userId));
}

export function setSession(userId, kek) {
	sessions.set(userId, { kek, expiresAt: Date.now() + TTL_MS });
}

export function lock(userId) {
	sessions.delete(userId);
}

// Online PIN brute-force mitigation — check BEFORE running scrypt (scrypt is
// expensive; we must not let an unauthenticated caller burn CPU/memory).
export function canAttemptPin(userId) {
	const attempt = pinAttempts.get(userId);
	return !attempt || Date.now() >= attempt.lockedUntil;
}

export function recordPinFailure(userId) {
	const attempt = pinAttempts.get(userId) || { count: 0, lockedUntil: 0 };
	attempt.count += 1;
	if (attempt.count >= MAX_ATTEMPTS) {
		attempt.lockedUntil = Date.now() + LOCKOUT_MS;
		attempt.count = 0;
	}
	pinAttempts.set(userId, attempt);
}

export function clearPinFailures(userId) {
	pinAttempts.delete(userId);
}
