import { describe, it, expect } from 'vitest';
import { AppError, notFound, conflict, badRequest } from './AppError.js';

describe('AppError', () => {
	it('carries status and code', () => {
		const err = new AppError('nope', 404, 'FILE_NOT_FOUND');
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(404);
		expect(err.statusCode).toBe(404);
		expect(err.code).toBe('FILE_NOT_FOUND');
		expect(err.expose).toBe(true);
	});

	it('defaults to a 400 BAD_REQUEST', () => {
		const err = new AppError('bad');
		expect(err.status).toBe(400);
		expect(err.code).toBe('BAD_REQUEST');
	});

	it('factories set the expected status/code', () => {
		expect(notFound().status).toBe(404);
		expect(conflict('x').status).toBe(409);
		expect(badRequest('x', 'CUSTOM').code).toBe('CUSTOM');
	});
});
