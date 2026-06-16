/**
 * Pipe a provider download stream to the HTTP response with end-to-end failure
 * handling. Errors before the first byte are surfaced via `next` (so the central
 * error handler can produce a JSON error). Once streaming has started the headers
 * are already flushed, so a later upstream error can only be handled by destroying
 * the response. The client-disconnect handler tears down the upstream provider
 * stream to avoid leaking that connection.
 *
 * Extracted from fileRoutes so the route layer stays HTTP-orchestration-only.
 */
export function pipeDownloadStream(stream, res, next) {
	let streamingStarted = false;

	const destroyStream = () => {
		if (typeof stream.destroy === 'function') {
			stream.destroy();
		}
	};

	stream.on('data', () => {
		streamingStarted = true;
	});

	stream.on('error', (error) => {
		if (streamingStarted || res.headersSent) {
			// Headers are already flushed, so we cannot send a JSON error. Log the
			// upstream cause for diagnostics and abort the response socket. We do
			// not pass the error to res.destroy to avoid emitting an unhandled
			// 'error' event on the response.
			console.error('Download stream failed after streaming started:', error?.message || error);
			destroyStream();
			res.destroy();
			return;
		}
		next(error);
	});

	res.on('close', () => {
		if (!res.writableEnded) {
			destroyStream();
		}
	});

	stream.pipe(res);
}
