import Busboy from 'busboy';
import { PassThrough } from 'stream';
import { randomUUID } from 'crypto';
import { createAdapter } from './adapterRegistry.js';
import { getAccountById, markAccountStatus, updateAccountUsage } from './accountService.js';
import { createFileMetadata, getFileByRemoteId } from './fileService.js';
import { emitUploadEvent } from './websocketHub.js';
import { getUploadSessionForUser, updateUploadSession, removeUploadSession } from './uploadSessionService.js';
import { syncAccount } from './syncService.js';
import { isAuthError } from '../utils/providerErrors.js';
import { createEncryptStream, generateDataKey, wrapDataKey } from '../utils/fileEncryption.js';
import { storeHiddenFile } from './hiddenFileService.js';

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

			// Hidden uploads encrypt the stream once, upstream of the shared
			// PassThrough, so fallback-retry semantics stay byte-for-byte the same
			// as today (never rebuild the encrypt stream or DEK per attempt).
			const obfuscatedName = session.is_hidden ? randomUUID() : null;
			const dataKey = session.is_hidden ? generateDataKey() : null;
			const wrappedKey = session.is_hidden ? wrapDataKey(dataKey) : null;
			const effectiveSize = session.effective_size ?? session.size;

			const streamBuffer = new PassThrough();
			if (session.is_hidden) {
				file.pipe(createEncryptStream(dataKey, session.size)).pipe(streamBuffer);
			} else {
				file.pipe(streamBuffer);
			}

			let activeAccountId = session.cloud_account_id;
			const tried = new Set();

			const attemptUpload = async (accountId) => {
				tried.add(accountId);
				const account = getAccountById(session.user_id, accountId);
				if (!account) {
					throw new Error('Target upload account not found');
				}
				const adapter = createAdapter(account);

				const result = await adapter.uploadStream({
					stream: streamBuffer,
					size: effectiveSize,
					fileName: session.is_hidden ? obfuscatedName : info.filename,
					mimeType: session.is_hidden ? 'application/octet-stream' : info.mimeType,
					virtualPath: session.virtual_path,
					remoteParentId: session.remote_parent_id,
					onProgress: (bytes) => {
						const percent = Math.min(100, Math.round((bytes / effectiveSize) * 100));
						emitUploadEvent(session.id, {
							type: 'upload:progress',
							uploadId: session.id,
							bytes,
							percent,
							status: 'uploading',
						});
					},
				});

				return { result, account };
			};

			try {
				let uploadResponse;
				let account;

				try {
					({ result: uploadResponse, account } = await attemptUpload(activeAccountId));
				} catch (error) {
					if (isAuthError(error)) {
						markAccountStatus(session.user_id, activeAccountId, 'invalid_token');
					}
					const fallbackId = session.fallback_chain.find((id) => !tried.has(id));
					if (!fallbackId) {
						throw error;
					}
					activeAccountId = fallbackId;
					({ result: uploadResponse, account } = await attemptUpload(activeAccountId));
				}

				const usedSpace = Number(account.used_space) + Number(effectiveSize);
				updateAccountUsage(session.user_id, account.id, usedSpace);

				// Persist the wrapped key BEFORE sync: if the provider snapshot lags
				// and drops the file_metadata row, the encryption row (keyed by
				// cloud_account_id + remote_file_id) survives and re-decorates the
				// file on the next sync that lists it.
				if (session.is_hidden) {
					storeHiddenFile({
						cloud_account_id: account.id,
						remote_file_id: uploadResponse.remoteFileId,
						real_name: info.filename,
						plaintext_size: session.size,
						mime_type: info.mimeType,
						wrapped_key: wrappedKey,
					});
				}

				let metadata = createFileMetadata({
					user_id: session.user_id,
					virtual_path: session.virtual_path,
					file_name: session.is_hidden ? obfuscatedName : info.filename,
					is_folder: false,
					size: effectiveSize,
					mime_type: session.is_hidden ? 'application/octet-stream' : info.mimeType,
					cloud_account_id: account.id,
					remote_file_id: uploadResponse.remoteFileId,
					remote_parent_id: uploadResponse.remoteParentId,
				});

				await syncAccount(session.user_id, account);
				metadata = getFileByRemoteId(session.user_id, account.id, uploadResponse.remoteFileId) || metadata;

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

export async function handleUpload(req, uploadId) {
	const session = getUploadSessionForUser(req.user.id, uploadId);

	if (!session) {
		throw new Error('Upload session not found');
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
