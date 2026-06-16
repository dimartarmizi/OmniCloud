const AUTH_ERROR_PATTERN =
	/invalid_grant|invalid_token|invalid or expired (?!user session)|unauthorized_client|token (?:has been )?(?:expired|revoked)|refresh token|reauth|\b401\b|\b403\b|AADSTS\d+|expired_token|wrong password|invalid (?:email|password)|authentication failed|credentials are incomplete/i;


const TRANSIENT_ERROR_PATTERN =
	/\b(429|500|502|503|504|408)\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EAGAIN|ECONNREFUSED|EPIPE|ESID|socket hang up|network|fetch failed|rate.?limit|too many requests|temporar(?:y|ily)|busy|congestion|server malfunction|try again|timeout|utype/i;

function errorMessage(error) {
	if (!error) return '';
	if (typeof error === 'string') return error;
	return error.message || String(error);
}

function errorStatus(error) {
	if (!error || typeof error !== 'object') return undefined;
	const status =
		error.status ??
		error.statusCode ??
		error.code ??
		error.response?.status ??
		error.cause?.status;
	const numeric = Number(status);
	return Number.isFinite(numeric) ? numeric : undefined;
}

export function isAuthError(error) {
	const status = errorStatus(error);
	if (status === 401 || status === 403) return true;
	return AUTH_ERROR_PATTERN.test(errorMessage(error));
}

export function isTransientError(error) {
	const status = errorStatus(error);
	if (status === 429 || (status >= 500 && status <= 599) || status === 408) {
		return true;
	}
	if (isAuthError(error)) return false;
	return TRANSIENT_ERROR_PATTERN.test(errorMessage(error));
}

/**
 * Canonical name for the transient-error check, used uniformly across the
 * backend (sync backoff, upload fallback, the server-level safety net, and
 * provider-specific connect retries) so "is this safe to retry / log-and-
 * continue?" has exactly one implementation. `isTransientError` is kept as an
 * alias for existing callers/tests.
 */
export const isTransientProviderError = isTransientError;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(task, options = {}) {
	const {
		retries = 3,
		baseDelayMs = 500,
		maxDelayMs = 8000,
		onRetry,
	} = options;

	let attempt = 0;
	while (true) {
		try {
			return await task();
		} catch (error) {
			if (isAuthError(error)) {
				throw error;
			}

			attempt += 1;
			if (attempt > retries) {
				throw error;
			}

			const exponential = baseDelayMs * 2 ** (attempt - 1);
			const capped = Math.min(exponential, maxDelayMs);
			const jitter = Math.random() * capped * 0.25;
			const delay = capped + jitter;

			if (typeof onRetry === 'function') {
				onRetry(error, attempt);
			}

			await sleep(delay);
		}
	}
}
