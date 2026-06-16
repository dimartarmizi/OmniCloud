import http from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { LOCAL_USER_ID } from './config/database.js';
import { resolveUserFromRequest } from './middleware/authMiddleware.js';
import { getUploadSessionForUser } from './services/uploadSessionService.js';
import { registerUploadSocket, unregisterUploadSocket } from './services/websocketHub.js';
import { runDeltaSync, scheduleSync, scheduleSessionCleanup } from './services/syncService.js';
import { db } from './config/database.js';
import { isTransientProviderError } from './utils/providerErrors.js';

// A last-resort net for provider errors that escaped their own try/catch in a
// background task (sync, token refresh). These are genuinely transient and safe
// to log-and-continue. Anything else is treated as a real fault: an unhandled
// rejection is logged, and an uncaught exception triggers a graceful shutdown
// because the process state can no longer be trusted.
function isBackgroundProviderError(error) {
	return isTransientProviderError(error);
}

process.on('unhandledRejection', (reason) => {
	if (isBackgroundProviderError(reason)) {
		console.warn('Ignored transient background provider rejection:', reason?.message || reason);
		return;
	}

	console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
	if (isBackgroundProviderError(error)) {
		console.warn('Ignored transient background provider exception:', error?.message || error);
		return;
	}

	console.error('Uncaught exception, shutting down:', error);
	shutdown('uncaughtException', 1);
});

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/uploads' });

wss.on('connection', (socket, request) => {
	const url = new URL(request.url, `http://${request.headers.host}`);
	const uploadId = url.searchParams.get('uploadId');

	// Reject cross-origin WebSocket upgrades. CORS does not apply to the WS
	// handshake, so without this a malicious page could open the upload socket
	// for a logged-in user if it guessed/observed an uploadId. Allow no-Origin
	// connections (non-browser clients) only in local mode; hosted mode requires
	// a matching first-party Origin.
	const allowedOrigins = new Set([env.corsOrigin, env.frontendUrl].filter(Boolean));
	const origin = request.headers.origin;
	if (env.appMode === 'hosted' && (!origin || !allowedOrigins.has(origin))) {
		socket.close(1008, 'Origin not allowed');
		return;
	}
	if (origin && !allowedOrigins.has(origin)) {
		socket.close(1008, 'Origin not allowed');
		return;
	}

	if (!uploadId) {
		socket.close(1008, 'uploadId is required');
		return;
	}

	const user = resolveUserFromRequest(request);
	if (!user) {
		socket.close(1008, 'Authentication required');
		return;
	}

	if (!getUploadSessionForUser(user.id, uploadId)) {
		socket.close(1008, 'Upload session not found');
		return;
	}

	registerUploadSocket(uploadId, socket);

	socket.send(
		JSON.stringify({
			type: 'socket:ready',
			uploadId,
			status: 'connected',
		}),
	);

	socket.on('close', () => {
		unregisterUploadSocket(uploadId, socket);
	});
});

const cronTask = scheduleSync();
const sessionCleanupTask = scheduleSessionCleanup();
if (env.appMode === 'local') {
	runDeltaSync(LOCAL_USER_ID).catch((error) => {
		console.error('Initial sync failed:', error);
	});
}

server.listen(env.port, () => {
	console.log(`OmniCloud API listening on http://localhost:${env.port}`);
});

// Graceful shutdown: stop the cron scheduler, stop accepting new connections,
// close active WebSockets, flush the SQLite WAL via db.close(), then exit. A
// hard timeout guards against a connection that never drains.
let isShuttingDown = false;
function shutdown(signal, exitCode = 0) {
	if (isShuttingDown) return;
	isShuttingDown = true;
	console.log(`Received ${signal}, shutting down gracefully...`);

	const forceTimer = setTimeout(() => {
		console.error('Graceful shutdown timed out, forcing exit.');
		process.exit(exitCode || 1);
	}, 10000);
	forceTimer.unref?.();

	try {
		cronTask?.stop?.();
	} catch (error) {
		console.warn('Failed to stop cron task during shutdown:', error?.message || error);
	}

	try {
		sessionCleanupTask?.stop?.();
	} catch (error) {
		console.warn('Failed to stop session cleanup task during shutdown:', error?.message || error);
	}

	for (const socket of wss.clients) {
		try {
			socket.close(1001, 'Server shutting down');
		} catch {
			// ignore individual socket close failures during shutdown
		}
	}

	wss.close(() => {
		server.close(() => {
			try {
				db.close();
			} catch (error) {
				console.warn('Failed to close database during shutdown:', error?.message || error);
			}
			clearTimeout(forceTimer);
			console.log('Shutdown complete.');
			process.exit(exitCode);
		});
	});
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
