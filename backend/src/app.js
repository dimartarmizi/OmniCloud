import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import authRoutes from './routes/authRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import allocationRoutes from './routes/allocationRoutes.js';
import { env } from './config/env.js';
import { attachAuthContext } from './middleware/authMiddleware.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { csrfGuard } from './middleware/csrfGuard.js';
import { AppError } from './utils/AppError.js';

// Map a non-AppError to a status + code. AppError carries its own; this only
// handles errors thrown by libraries/legacy paths. Auth errors are 401; the
// other heuristics are a last resort until all throw sites use AppError.
function classifyError(error) {
	const explicitStatus = Number(error?.status ?? error?.statusCode);
	if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) {
		return { status: explicitStatus, code: error?.code };
	}
	const message = error?.message || '';
	if (/Authentication required/i.test(message)) return { status: 401, code: 'UNAUTHORIZED' };
	if (/Invalid|required|already|available|not found|unsupported|failed|Unable|Password|email/i.test(message)) {
		return { status: 400, code: 'BAD_REQUEST' };
	}
	return { status: 500, code: 'INTERNAL_ERROR' };
}

export function createApp() {
	const app = express();

	// Baseline security headers on every response (incl. error responses).
	app.use(securityHeaders);

	app.use(
		cors({
			origin: env.corsOrigin,
			credentials: true,
		}),
	);
	// Assign a correlation id to every request so a client-facing error can be
	// tied to a specific server log line without leaking internals to the client.
	app.use((req, res, next) => {
		const requestId = randomUUID();
		req.requestId = requestId;
		res.setHeader('X-Request-Id', requestId);
		next();
	});
	app.use((req, res, next) => {
		res.cookie ??= (name, value, options = {}) => {
			const directives = [`${name}=${encodeURIComponent(value)}`];
			if (options.httpOnly) directives.push('HttpOnly');
			if (options.sameSite) directives.push(`SameSite=${options.sameSite}`);
			if (options.secure) directives.push('Secure');
			directives.push(`Path=${options.path || '/'}`);
			if (options.maxAge === 0) directives.push('Max-Age=0');
			res.append('Set-Cookie', directives.join('; '));
		};
		res.clearCookie ??= (name, options = {}) => {
			res.cookie(name, '', { ...options, maxAge: 0 });
		};
		next();
	});
	app.use(express.json({ limit: '1mb' }));
	app.use(attachAuthContext);
	// CSRF: reject cross-origin state-changing requests in hosted mode.
	app.use(csrfGuard);

	app.use('/api', healthRoutes);
	app.use('/api', authRoutes);
	app.use('/api', accountRoutes);
	app.use('/api', fileRoutes);
	app.use('/api', uploadRoutes);
	app.use('/api', settingsRoutes);
	app.use('/api', allocationRoutes);

	app.use((error, req, res, _next) => {
		const isAppError = error instanceof AppError;
		const { status, code } = isAppError
			? { status: error.status, code: error.code }
			: classifyError(error);

		const requestId = req?.requestId;

		// Log a concise, sanitized line server-side (message + stack only) rather
		// than dumping the whole error object, which can carry tokens, auth
		// headers, request bodies, or internal URLs from provider SDKs.
		console.error(
			`[${requestId}] ${req?.method} ${req?.originalUrl} -> ${status}: ${error?.message || 'error'}`,
			error?.stack ? `\n${error.stack}` : '',
		);

		// AppError messages and 4xx messages are deliberate and safe to expose.
		// 5xx from non-AppError sources may embed internal/provider detail, so
		// they are replaced with a generic message plus the correlation id.
		const safeToExpose = isAppError || status < 500;
		const message = safeToExpose
			? error.message || 'Request failed'
			: 'An unexpected error occurred. Please try again.';

		// Single, consistent error envelope: { data: null, error: { code, message }, meta }.
		res.status(status).json({
			data: null,
			error: {
				code: code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
				message,
			},
			meta: { requestId, timestamp: new Date().toISOString() },
		});
	});

	return app;
}
