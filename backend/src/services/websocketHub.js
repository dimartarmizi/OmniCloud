/**
 * In-process registry of active upload WebSockets, keyed by uploadId.
 *
 * IMPORTANT — single-instance constraint: this map lives in the memory of one
 * process. Upload progress events are emitted by the same process that received
 * the `POST /uploads/:id/stream` request (see uploadService), but a client's
 * WebSocket may be connected to a DIFFERENT process behind a load balancer. With
 * more than one backend instance, progress events would not reach the client
 * even though the upload itself succeeds.
 *
 * OmniCloud therefore runs as a SINGLE backend instance (docker-compose ships
 * one `api` service). To scale horizontally, this hub must be backed by a shared
 * pub/sub (e.g. Redis) so progress fans out across instances; until then, do not
 * run multiple API replicas.
 */
const uploadSockets = new Map();

export function registerUploadSocket(uploadId, socket) {
	if (!uploadSockets.has(uploadId)) {
		uploadSockets.set(uploadId, new Set());
	}

	uploadSockets.get(uploadId).add(socket);
}

export function unregisterUploadSocket(uploadId, socket) {
	const sockets = uploadSockets.get(uploadId);
	if (!sockets) return;
	sockets.delete(socket);
	if (!sockets.size) {
		uploadSockets.delete(uploadId);
	}
}

export function emitUploadEvent(uploadId, event) {
	const sockets = uploadSockets.get(uploadId);
	if (!sockets) return;

	const payload = JSON.stringify(event);
	for (const socket of sockets) {
		if (socket.readyState !== 1) continue;
		try {
			socket.send(payload);
		} catch (error) {
			// A failed progress emit (e.g. a socket that closed mid-flight) must
			// never break the critical upload path that calls this hook.
			unregisterUploadSocket(uploadId, socket);
			console.warn(`Failed to emit upload event for ${uploadId}:`, error?.message || error);
		}
	}
}
