import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import vaultRoutes from './routes/vaultRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import allocationRoutes from './routes/allocationRoutes.js';
import { env } from './config/env.js';
import { attachAuthContext } from './middleware/authMiddleware.js';

export function createApp() {
	const app = express();

	app.use(
		cors({
			origin: env.corsOrigin,
			credentials: true,
		}),
	);
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
	app.use(express.json());
	app.use(attachAuthContext);

	app.use('/api', healthRoutes);
	app.use('/api', authRoutes);
	app.use('/api', accountRoutes);
	app.use('/api', fileRoutes);
	app.use('/api', uploadRoutes);
	app.use('/api', vaultRoutes);
	app.use('/api', settingsRoutes);
	app.use('/api', allocationRoutes);

	app.use((error, _req, res, _next) => {
		console.error(error);
		const status = /Authentication required/.test(error?.message || '') ? 401 : /Invalid|required|already|available|not found|unsupported|failed|Unable|Password|email/i.test(error?.message || '') ? 400 : 500;
		res.status(status).json({
			error: error.message || 'Internal server error',
		});
	});

	return app;
}
