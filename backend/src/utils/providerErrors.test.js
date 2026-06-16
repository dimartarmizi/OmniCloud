import { describe, it, expect, vi } from 'vitest';
import { isAuthError, isTransientError, withRetry } from './providerErrors.js';

describe('isAuthError', () => {
	it('treats 401/403 status as auth errors', () => {
		expect(isAuthError({ status: 401 })).toBe(true);
		expect(isAuthError({ statusCode: 403 })).toBe(true);
	});

	it('matches common auth message patterns', () => {
		expect(isAuthError(new Error('invalid_grant'))).toBe(true);
		expect(isAuthError(new Error('refresh token expired'))).toBe(true);
		expect(isAuthError(new Error('wrong password'))).toBe(true);
	});

	it('does not flag generic transient/network errors', () => {
		expect(isAuthError(new Error('ETIMEDOUT'))).toBe(false);
		expect(isAuthError(new Error('rate limit exceeded'))).toBe(false);
	});
});

describe('isTransientError', () => {
	it('flags 429 and 5xx as transient', () => {
		expect(isTransientError({ status: 429 })).toBe(true);
		expect(isTransientError({ status: 503 })).toBe(true);
	});

	it('never treats an auth error as transient', () => {
		expect(isTransientError({ status: 401 })).toBe(false);
		expect(isTransientError(new Error('invalid_grant'))).toBe(false);
	});

	it('matches transient message patterns', () => {
		expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
		expect(isTransientError(new Error('temporarily unavailable'))).toBe(true);
	});
});

describe('withRetry', () => {
	it('returns the result on first success without retrying', async () => {
		const task = vi.fn().mockResolvedValue('ok');
		await expect(withRetry(task, { retries: 3, baseDelayMs: 1 })).resolves.toBe('ok');
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('does NOT retry auth errors', async () => {
		const task = vi.fn().mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
		await expect(withRetry(task, { retries: 5, baseDelayMs: 1 })).rejects.toThrow();
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('retries transient errors up to the cap, then throws', async () => {
		const task = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
		await expect(withRetry(task, { retries: 2, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow('ETIMEDOUT');
		// Initial attempt + 2 retries.
		expect(task).toHaveBeenCalledTimes(3);
	});

	it('recovers if a transient failure later succeeds', async () => {
		const task = vi
			.fn()
			.mockRejectedValueOnce(new Error('503 service unavailable'))
			.mockResolvedValue('recovered');
		await expect(withRetry(task, { retries: 3, baseDelayMs: 1, maxDelayMs: 2 })).resolves.toBe('recovered');
		expect(task).toHaveBeenCalledTimes(2);
	});
});
