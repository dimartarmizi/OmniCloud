import { Router } from 'express';
import { redactEnv } from '../config/env.js';
import { getAuthSummary } from '../services/authService.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getLastSyncReport, runDeltaSync } from '../services/syncService.js';
import { db } from '../config/database.js';

const router = Router();

// Probe the database with a trivial query so /health reflects real readiness.
// Returns true only when the connection answers; any throw means the DB is
// unreachable/locked and the endpoint should report unhealthy.
function isDatabaseHealthy() {
	try {
		const row = db.prepare('SELECT 1 AS ok').get();
		return row?.ok === 1;
	} catch (error) {
		console.error('Health check database probe failed:', error?.message || error);
		return false;
	}
}

router.get('/health', (req, res) => {
	const databaseHealthy = isDatabaseHealthy();
	// Liveness vs readiness: the process is up, but if its only datastore is
	// unreachable it cannot serve real traffic, so surface 503 for orchestrators
	// and uptime checks instead of a misleading 200/ok.
	const status = databaseHealthy ? 'ok' : 'degraded';

	res.status(databaseHealthy ? 200 : 503).json({
		status,
		service: 'omnicloud-api',
		checks: {
			database: databaseHealthy ? 'ok' : 'unavailable',
		},
		config: redactEnv(),
		auth: getAuthSummary(req.user),
		sync: getLastSyncReport(),
		timestamp: new Date().toISOString(),
	});
});

// Lightweight sync-status endpoint for the client's periodic "did a sync just
// finish?" poll. Returns only the last-run timestamp + running flag so the
// 20s timer no longer downloads the full /health payload (env, auth summary,
// full sync report) every tick.
router.get('/health/sync', (_req, res) => {
	const report = getLastSyncReport();
	res.json({
		data: {
			lastRunAt: report.lastRunAt,
			isRunning: report.isRunning,
		},
	});
});

router.post('/sync/run', requireAppUser, async (req, res, next) => {
	try {
		const report = await runDeltaSync(req.user.id);
		res.json({ data: report });
	} catch (error) {
		next(error);
	}
});

export default router;
