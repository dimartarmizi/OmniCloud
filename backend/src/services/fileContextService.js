import { getAccountById, adjustAccountUsage } from './accountService.js';
import { createAdapter } from './adapterRegistry.js';
import { getFileById, deleteFileMetadataById } from './fileService.js';
import { AppError } from '../utils/AppError.js';
import { getSharedFileContext } from './sharedFileService.js';

/**
 * Resolves the {file, account, adapter} triple for a file id and centralizes the
 * delete-with-mirror-cleanup operation. Extracted from fileRoutes so the route
 * layer only handles HTTP concerns (routes → services rule).
 */

export async function getFileContext(userId, fileId) {
	const file = getFileById(userId, fileId);
	if (!file) {
		return getSharedFileContext(userId, fileId);
	}

	const account = getAccountById(userId, file.cloud_account_id);
	if (!account) {
		return { file, account: null, adapter: null };
	}

	return {
		file,
		account,
		adapter: createAdapter(account),
	};
}

/**
 * Throw a typed AppError (→ central error envelope) when a resolved context is
 * unusable. Returns true on success so existing `if (!ensureFileContext(...))`
 * call sites keep working.
 */
export function ensureFileContext(context) {
	if (!context.file) {
		throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
	}

	if (!context.account || context.account.status !== 'active' || !context.adapter) {
		throw new AppError('The file account is no longer connected', 409, 'ACCOUNT_DISCONNECTED');
	}

	return true;
}

/**
 * Delete a file via its provider adapter and surgically remove it (and any
 * descendants for folders) from the local mirror, adjusting cached account usage
 * by the freed bytes. Shared items are not mirrored locally, so the mirror
 * cleanup no-ops for them.
 */
export async function deleteContextFile(userId, context, options = {}) {
	const { adjustUsage = true } = options;
	await context.adapter.deleteFile(context.file);

	const { deletedSize, cloudAccountId } = deleteFileMetadataById(userId, context.file.id);

	if (adjustUsage && cloudAccountId && deletedSize) {
		adjustAccountUsage(userId, cloudAccountId, -deletedSize);
	}

	return { deletedSize, cloudAccountId };
}
