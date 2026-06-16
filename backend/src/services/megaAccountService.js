import { randomUUID } from 'crypto';
import { Storage } from 'megajs';
import { markAccountStatus, upsertCloudAccount } from './accountService.js';
import { syncAccount } from './syncService.js';
import { isTransientProviderError } from '../utils/providerErrors.js';

const MEGA_CONNECT_ATTEMPTS = 3;
const MEGA_RETRY_DELAYS = [3000, 8000];

// MEGA temporary failures (EAGAIN, congestion, server malfunction) are just a
// subset of the centralized transient-error classification, so delegate to it
// instead of maintaining a separate regex here.
function isMegaTemporaryError(error) {
	return isTransientProviderError(error);
}

function isMegaInvalidCredentialError(error) {
	return /wrong password|ENOENT \(-9\)|invalid password|invalid email|authentication failed/i.test(error?.message || '');
}

function normalizeMegaConnectError(error) {
	if (isMegaInvalidCredentialError(error)) {
		return new Error('Email atau password MEGA salah. Silakan periksa kembali kredensial Anda.');
	}

	return error;
}

function wait(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function createMegaTemporaryError() {
	return new Error('MEGA is temporarily busy or unavailable. No account data was changed. Please try connecting again in a few moments.');
}

export function getMegaIntegrationStatus() {
	return {
		configured: true,
		mode: 'email_password',
	};
}

export async function connectMegaAccount(userId, { email, password, secondFactorCode }) {
	if (!email || !password) {
		throw new Error('MEGA email and password are required');
	}

	let lastError = null;
	for (let attempt = 0; attempt < MEGA_CONNECT_ATTEMPTS; attempt += 1) {
		try {
			return await connectMegaAccountOnce(userId, { email, password, secondFactorCode });
		} catch (error) {
			lastError = error;
			if (!isMegaTemporaryError(error) || attempt === MEGA_CONNECT_ATTEMPTS - 1) break;
			await wait(MEGA_RETRY_DELAYS[attempt] || 10000);
		}
	}

	if (isMegaTemporaryError(lastError)) {
		throw createMegaTemporaryError();
	}

	throw normalizeMegaConnectError(lastError);
}

async function connectMegaAccountOnce(userId, { email, password, secondFactorCode }) {

	const storage = new Storage({
		email,
		password,
		secondFactorCode: secondFactorCode || undefined,
		autoload: true,
		keepalive: false,
	});

	try {
		await storage.ready;
		const accountInfo = await storage.getAccountInfo();
		const session = storage.toJSON();
		const accountEmail = storage.email || email;

		const account = upsertCloudAccount({
			userId,
			id: randomUUID(),
			email: accountEmail,
			provider: 'mega',
			credentials: {
				provider: 'mega',
				email: accountEmail,
				password,
				secondFactorCode: secondFactorCode || null,
				session,
			},
			total_space: Number(accountInfo.spaceTotal || 0),
			used_space: Number(accountInfo.spaceUsed || 0),
			status: 'active',
		});

		try {
			await syncAccount(userId, account);
		} catch (error) {
			if (!isMegaTemporaryError(error)) throw error;
			markAccountStatus(userId, account.id, 'active');
		}

		return {
			account,
			profile: {
				email: accountEmail,
				totalSpace: Number(accountInfo.spaceTotal || 0),
				usedSpace: Number(accountInfo.spaceUsed || 0),
			},
		};
	} finally {
		await storage.close().catch(() => {});
	}
}
