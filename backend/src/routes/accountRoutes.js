import { Router } from 'express';
import { deleteAccount, getAccountById, listAccounts } from '../services/accountService.js';
import { env } from '../config/env.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { AppError } from '../utils/AppError.js';
import {
	createGoogleAuthorizationRequest,
	completeGoogleAccountLink,
	getGoogleIntegrationStatus,
} from '../services/googleOAuthService.js';
import {
	createOneDriveAuthorizationRequest,
	completeOneDriveAccountLink,
	getOneDriveIntegrationStatus,
} from '../services/oneDriveOAuthService.js';
import {
	createDropboxAuthorizationRequest,
	completeDropboxAccountLink,
	getDropboxIntegrationStatus,
} from '../services/dropboxOAuthService.js';
import { connectMegaAccount, getMegaIntegrationStatus } from '../services/megaAccountService.js';
import {
	createYandexAuthorizationRequest,
	completeYandexAccountLink,
	getYandexIntegrationStatus,
} from '../services/yandexOAuthService.js';
import { connectS3Account, connectPCloudAccount } from '../services/externalAccountService.js';
import { clearFilesForAccount } from '../services/fileService.js';
import { createAdapter } from '../services/adapterRegistry.js';

const router = Router();

// OAuth provider callbacks are top-level cross-site GET redirects from the
// provider back to us. They MUST NOT sit behind requireAppUser: relying on the
// session cookie during a cross-site redirect is fragile (and wrong in hosted
// mode). Instead they are authenticated strictly by the signed, single-use
// `state` persisted in oauth_states, which already binds the originating
// user_id. So these routes are registered BEFORE the requireAppUser guard below.
router.get('/accounts/google/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/quota';

	try {
		const { code, state, error } = req.query;

		if (error) {
			frontendUrl.searchParams.set('google', 'error');
			frontendUrl.searchParams.set('message', String(error));
			return res.redirect(frontendUrl.toString());
		}

		await completeGoogleAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('google', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (error) {
		frontendUrl.searchParams.set('google', 'error');
		frontendUrl.searchParams.set('message', error.message);
		return res.redirect(frontendUrl.toString());
	}
});

router.get('/accounts/onedrive/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/quota';

	try {
		const { code, state, error } = req.query;

		if (error) {
			frontendUrl.searchParams.set('onedrive', 'error');
			frontendUrl.searchParams.set('message', String(error));
			return res.redirect(frontendUrl.toString());
		}

		await completeOneDriveAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('onedrive', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (error) {
		frontendUrl.searchParams.set('onedrive', 'error');
		frontendUrl.searchParams.set('message', error.message);
		return res.redirect(frontendUrl.toString());
	}
});

router.get('/accounts/dropbox/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/quota';

	try {
		const { code, state, error, error_description } = req.query;

		if (error) {
			frontendUrl.searchParams.set('dropbox', 'error');
			frontendUrl.searchParams.set('message', String(error_description || error));
			return res.redirect(frontendUrl.toString());
		}

		await completeDropboxAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('dropbox', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (error) {
		frontendUrl.searchParams.set('dropbox', 'error');
		frontendUrl.searchParams.set('message', error.message);
		return res.redirect(frontendUrl.toString());
	}
});

router.get('/accounts/yandex/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/quota';

	try {
		const { code, state, error, error_description } = req.query;

		if (error) {
			frontendUrl.searchParams.set('yandex', 'error');
			frontendUrl.searchParams.set('message', String(error_description || error));
			return res.redirect(frontendUrl.toString());
		}

		await completeYandexAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('yandex', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (error) {
		console.error('[yandex] callback failed:', error);
		frontendUrl.searchParams.set('yandex', 'error');
		frontendUrl.searchParams.set('message', error.message);
		return res.redirect(frontendUrl.toString());
	}
});

// Everything below requires an authenticated app user.
router.use(requireAppUser);

router.get('/accounts', (req, res) => {
	const accounts = listAccounts(req.user.id).map((account) => ({
		...account,
		free_space: Number(account.total_space) - Number(account.used_space),
	}));

	res.json({ data: accounts });
});

router.get('/accounts/google/status', (_req, res) => {
	res.json({ data: getGoogleIntegrationStatus() });
});

router.get('/accounts/onedrive/status', (_req, res) => {
	res.json({ data: getOneDriveIntegrationStatus() });
});

router.get('/accounts/dropbox/status', (_req, res) => {
	res.json({ data: getDropboxIntegrationStatus() });
});

router.get('/accounts/yandex/status', (_req, res) => {
	res.json({ data: getYandexIntegrationStatus() });
});

router.get('/accounts/mega/status', (_req, res) => {
	res.json({ data: getMegaIntegrationStatus() });
});

router.get('/accounts/google/connect', (req, res, next) => {
	try {
		const data = createGoogleAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/accounts/onedrive/connect', (req, res, next) => {
	try {
		const data = createOneDriveAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/accounts/dropbox/connect', (req, res, next) => {
	try {
		const data = createDropboxAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.post('/accounts/mega/connect', async (req, res, next) => {
	try {
		const data = await connectMegaAccount(req.user.id, req.body || {});
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.post('/accounts/s3/connect', async (req, res, next) => {
	try {
		const data = await connectS3Account(req.user.id, req.body || {});
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.post('/accounts/pcloud/connect', async (req, res, next) => {
	try {
		const data = await connectPCloudAccount(req.user.id, req.body || {});
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/accounts/yandex/connect', (req, res, next) => {
	try {
		const data = createYandexAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.delete('/accounts/:id', async (req, res, next) => {
	try {
		const account = getAccountById(req.user.id, req.params.id);
		if (!account) {
			throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
		}

		// Best-effort: revoke the provider-side token before we drop the local
		// credentials, so disconnecting also severs OAuth access where supported.
		// Never block disconnect on a provider revoke failure.
		try {
			await createAdapter(account).revokeAccess();
		} catch (error) {
			console.warn(`Token revoke failed during disconnect of ${account.email}:`, error?.message || error);
		}

		clearFilesForAccount(req.user.id, account.id);
		deleteAccount(req.user.id, account.id);

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

export default router;
