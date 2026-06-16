import { Router } from 'express';
import { env } from '../config/env.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { listAccounts, deleteAccount } from '../services/accountService.js';
import { createAdapter } from '../services/adapterRegistry.js';
import {
	changeHostedUserPassword,
	clearUserSessions,
	createSession,
	deleteHostedUserAccount,
	destroySession,
	getAuthSummary,
	loginHostedUser,
	registerHostedUser,
} from '../services/authService.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

// Throttle credential endpoints per-IP. Login/register run a CPU-bound scrypt
// hash, so this guards against both brute-force and resource-exhaustion DoS.
const authRateLimiter = createRateLimiter({
	windowMs: 15 * 60 * 1000,
	max: 10,
	message: 'Too many authentication attempts. Please wait a few minutes and try again.',
});

function setAuthCookie(res, token) {
	const options = res.locals.authCookieOptions || {};
	res.cookie(env.authCookieName, token, options);
}

function clearAuthCookie(res) {
	const options = res.locals.authCookieOptions || {};
	res.clearCookie(env.authCookieName, { ...options, maxAge: 0 });
}

router.get('/auth/me', (req, res) => {
	res.json({ data: getAuthSummary(req.user) });
});

router.post('/auth/register', authRateLimiter, (req, res, next) => {
	try {
		const user = registerHostedUser(req.body || {});
		clearUserSessions(user.id);
		const session = createSession(user.id);
		setAuthCookie(res, session.token);
		res.status(201).json({ data: getAuthSummary(user) });
	} catch (error) {
		next(error);
	}
});

router.post('/auth/login', authRateLimiter, (req, res, next) => {
	try {
		const user = loginHostedUser(req.body || {});
		const session = createSession(user.id);
		setAuthCookie(res, session.token);
		res.json({ data: getAuthSummary(user) });
	} catch (error) {
		next(error);
	}
});

router.post('/auth/logout', (req, res) => {
	const cookieHeader = req.headers.cookie || '';
	const token = cookieHeader
		.split(';')
		.map((item) => item.trim())
		.find((item) => item.startsWith(`${env.authCookieName}=`))
		?.slice(env.authCookieName.length + 1);

	if (token) {
		destroySession(decodeURIComponent(token));
	}

	clearAuthCookie(res);
	res.json({ data: getAuthSummary(env.appMode === 'local' ? req.user : null) });
});

// Change the current user's password (hosted mode). Verifies the current
// password and invalidates all sessions, then issues a fresh session cookie so
// the caller's own tab stays logged in.
router.post('/auth/change-password', requireAppUser, authRateLimiter, (req, res, next) => {
	try {
		const { current_password, new_password } = req.body || {};
		const user = changeHostedUserPassword(req.user.id, {
			currentPassword: current_password,
			newPassword: new_password,
		});
		const session = createSession(user.id);
		setAuthCookie(res, session.token);
		res.json({ data: getAuthSummary(user) });
	} catch (error) {
		next(error);
	}
});

// Permanently delete the current user's account (hosted mode). Best-effort
// revokes each connected provider's OAuth token, removes the local accounts,
// then cascade-deletes the user (files/sessions/settings) and clears the cookie.
router.post('/auth/delete-account', requireAppUser, async (req, res, next) => {
	try {
		const { password } = req.body || {};
		const userId = req.user.id;

		const accounts = listAccounts(userId);
		await Promise.allSettled(
			accounts.map(async (account) => {
				try {
					await createAdapter(account).revokeAccess();
				} catch (error) {
					console.warn(`Token revoke failed for ${account.email} during account deletion:`, error?.message || error);
				}
				deleteAccount(userId, account.id);
			}),
		);

		const deleted = deleteHostedUserAccount(userId, { password });
		if (!deleted) {
			throw new AppError('Account could not be deleted', 400, 'ACCOUNT_DELETE_FAILED');
		}

		clearAuthCookie(res);
		res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

export default router;