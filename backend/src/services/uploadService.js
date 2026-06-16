import Busboy from 'busboy';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import { createAdapter } from './adapterRegistry.js';
import { getAccountById, markAccountStatus, adjustAccountUsage } from './accountService.js';
import { upsertFileByRemoteId } from './fileService.js';
import { emitUploadEvent } from './websocketHub.js';
import { getUploadSessionForUser, updateUploadSession, removeUploadSession } from './uploadSessionService.js';
import { isAuthError } from '../utils/providerErrors.js';
import { AppError } from '../utils/AppError.js';

// Constant-time string compare that also tolerates unequal lengths without
// throwing (crypto.timingSafeEqual requires equal-length buffers). Returns false
// for any length mismatch after doing a fixed-cost comparison.
function timingSafeEqualStrings(a, b) {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	if (bufA.length !== bufB.length) {
		// Still run a compare against a same-length buffer to keep timing flat.
		crypto.timingSafeEqual(bufA, bufA);
		return false;
	}
	return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolve the account this upload will stream to BEFORE any bytes are read.
 *
 * The previous implementation re-piped the already-consumed source stream to a
 * fallback account on a mid-stream failure, which produced truncated/empty
 * uploads because a stream cannot be replayed. The realistic fallback case is a
 * primary account that became invalid/removed between `initiate` and `stream`;
 * that can be detected here, without touching the body. Once streaming begins
 * there is no safe retry, so the upload is attempted against exactly one account.
 */
function resolveUploadAccount(session) {
	const candidateIds = [session.cloud_account_id, ...(session.fallback_chain || [])];
	const seen = new Set();

	for (const accountId of candidateIds) {
		if (!accountId || seen.has(accountId)) continue;
		seen.add(accountId);
		const account = getAccountById(session.user_id, accountId);
		if (account && account.status === 'active') {
			return account;
		}
	}

	throw new Error('No connected account is available to receive this upload');
}

async function pipeUpload({ req, session }) {
	return new Promise((resolve, reject) => {
		const busboy = Busboy({ headers: req.headers });
		let settled = false;
		let fileReceived = false;

		const complete = (callback, value) => {
			if (settled) return;
			settled = true;
			removeUploadSession(session.id);
			callback(value);
		};

		busboy.on('file', async (_field, file, info) => {
			fileReceived = true;
			const streamBuffer = new PassThrough();
			file.pipe(streamBuffer);

			try {
				// Pick the destination account before consuming the stream so a
				// dead/removed primary account is handled without replaying bytes.
				const account = resolveUploadAccount(session);
				const adapter = createAdapter(account);

				let uploadResponse;
				try {
					uploadResponse = await adapter.uploadStream({
						stream: streamBuffer,
						size: session.size,
						fileName: info.filename,
						mimeType: info.mimeType,
						virtualPath: session.virtual_path,
						remoteParentId: session.remote_parent_id,
						onProgress: (bytes) => {
							const percent = session.size > 0
								? Math.min(100, Math.round((bytes / session.size) * 100))
								: 0;
							emitUploadEvent(session.id, {
								type: 'upload:progress',
								uploadId: session.id,
								bytes,
								percent,
								status: 'uploading',
							});
						},
					});
				} catch (error) {
					// An auth failure means this account's credentials are dead;
					// flag it so it is excluded from future allocation/sync. We do
					// NOT retry on another account here because the source stream is
					// already (partially) consumed and cannot be replayed safely.
					if (isAuthError(error)) {
						markAccountStatus(session.user_id, account.id, 'invalid_token');
					}
					throw error;
				}

				// Atomically credit the uploaded bytes against the account's usage.
				// A read-modify-write using the snapshot read at resolveUploadAccount
				// time would lose one update when two uploads to the same account
				// complete concurrently; the SQL-level delta avoids that race.
				adjustAccountUsage(session.user_id, account.id, Number(session.size) || 0);

				// Mirror only the freshly uploaded file into the local metadata
				// table (O(1)) rather than re-walking the whole account.
				const metadata = upsertFileByRemoteId({
					user_id: session.user_id,
					virtual_path: session.virtual_path,
					file_name: uploadResponse.fileName || info.filename,
					is_folder: false,
					size: Number(uploadResponse.size || session.size || 0),
					mime_type: uploadResponse.mimeType || info.mimeType,
					cloud_account_id: account.id,
					remote_file_id: uploadResponse.remoteFileId,
					remote_parent_id: uploadResponse.remoteParentId,
					remote_modified_time: new Date().toISOString(),
				});

				updateUploadSession(session.id, { status: 'completed', cloud_account_id: account.id });
				emitUploadEvent(session.id, {
					type: 'upload:complete',
					uploadId: session.id,
					percent: 100,
					status: 'completed',
					file: metadata,
				});
				complete(resolve, metadata);
			} catch (error) {
				// Drain any remaining source bytes so the request socket does not stall.
				streamBuffer.resume();
				updateUploadSession(session.id, { status: 'failed' });
				emitUploadEvent(session.id, {
					type: 'upload:error',
					uploadId: session.id,
					status: 'failed',
					message: error.message,
				});
				complete(reject, error);
			}
		});

		busboy.on('error', (error) => complete(reject, error));
		busboy.on('finish', () => {
			if (!fileReceived) {
				complete(reject, new Error('No file payload received'));
			}
		});

		req.pipe(busboy);
	});
}

export async function handleUpload(req, uploadId, providedToken) {
	const session = getUploadSessionForUser(req.user.id, uploadId);

	if (!session) {
		throw new AppError('Upload session not found', 404, 'UPLOAD_SESSION_NOT_FOUND');
	}

	// The single-use token issued by /uploads/initiate binds the streaming
	// request to the session that allocated a destination account. Without this
	// check, anyone who learned (or guessed) an uploadId could stream bytes into
	// another user's allocated slot. Use a length-safe constant-time compare to
	// avoid leaking token length/prefix via timing.
	if (!providedToken || !timingSafeEqualStrings(providedToken, session.token)) {
		throw new AppError('Invalid or missing upload token', 403, 'INVALID_UPLOAD_TOKEN');
	}

	updateUploadSession(uploadId, { status: 'uploading' });
	emitUploadEvent(uploadId, {
		type: 'upload:started',
		uploadId,
		percent: 0,
		status: 'uploading',
	});

	return pipeUpload({ req, session });
}
