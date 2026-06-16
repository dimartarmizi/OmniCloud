import { getAccountById, getActiveAccounts } from './accountService.js';
import { createAdapter, getProviderCapabilities } from './adapterRegistry.js';
import { getFileByRemoteId, getLocalFilesByRemoteId } from './fileService.js';

/**
 * Aggregation and resolution for "shared with me" items, which are served live
 * from each provider rather than mirrored in SQLite. Extracted from fileRoutes
 * so the route layer stays HTTP-only.
 */

export function encodeSharedFileId(accountId, remoteFileId) {
	return `shared:${accountId}:${Buffer.from(String(remoteFileId)).toString('base64url')}`;
}

export function decodeSharedFileId(fileId) {
	if (!fileId?.startsWith('shared:')) return null;
	const [, accountId, encodedRemoteFileId] = fileId.split(':');
	if (!accountId || !encodedRemoteFileId) return null;
	return {
		accountId,
		remoteFileId: Buffer.from(encodedRemoteFileId, 'base64url').toString('utf8'),
	};
}

export function mapSharedItem(
	userId,
	account,
	item,
	localFile = getFileByRemoteId(userId, account.id, item.remote_file_id),
) {
	return {
		...(localFile || {}),
		...item,
		id: encodeSharedFileId(account.id, item.remote_file_id),
		cloud_account_id: account.id,
		provider: localFile?.provider || account.provider,
		email: item.owner_email || localFile?.email || account.email,
		createdTime: item.createdTime,
		modifiedTime: item.modifiedTime,
		capabilities: {
			starred: Boolean(
				item.capabilities?.starred ??
					localFile?.capabilities?.starred ??
					getProviderCapabilities(account.provider).starred,
			),
			rename: Boolean(item.capabilities?.rename ?? localFile?.capabilities?.rename ?? false),
			delete: Boolean(item.capabilities?.delete ?? localFile?.capabilities?.delete ?? false),
		},
	};
}

export async function getSharedFileContext(userId, fileId) {
	const parsed = decodeSharedFileId(fileId);
	if (!parsed) {
		return { file: null, account: null, adapter: null };
	}

	const account = getAccountById(userId, parsed.accountId);
	if (!account) {
		return { file: null, account: null, adapter: null };
	}

	const adapter = createAdapter(account);
	const sharedItems = await adapter.listSharedWithMe();
	let file = sharedItems.find((item) => item.remote_file_id === parsed.remoteFileId);
	if (!file) {
		try {
			const details = await adapter.getFileDetails({ remote_file_id: parsed.remoteFileId });
			if (details?.remote_file_id) {
				file = {
					file_name: details.file_name || details.name,
					is_folder: Boolean(details.is_folder),
					is_starred: 0,
					size: Number(details.size || 0),
					mime_type: details.mime_type || details.mimeType || null,
					remote_file_id: details.remote_file_id,
					remote_parent_id: details.remote_parent_id || null,
					remote_drive_id: details.remote_drive_id || null,
					createdTime: details.createdTime || null,
					modifiedTime: details.modifiedTime || null,
					owner_name: details.owner_name || null,
					owner_email: details.owner_email || account.email,
				};
			}
		} catch {
			file = null;
		}
	}
	if (!file) {
		return { file: null, account, adapter };
	}

	return {
		file: {
			...file,
			id: fileId,
			cloud_account_id: account.id,
			provider: account.provider,
			email: file.owner_email || account.email,
			capabilities: {
				starred: Boolean(file.capabilities?.starred ?? getProviderCapabilities(account.provider).starred),
				rename: Boolean(file.capabilities?.rename ?? false),
				delete: Boolean(file.capabilities?.delete ?? false),
			},
		},
		account,
		adapter,
	};
}

async function computeSharedWithMeFiles(userId) {
	const accounts = getActiveAccounts(userId);
	const settled = await Promise.allSettled(
		accounts.map(async (account) => {
			const adapter = createAdapter(account);
			const items = await adapter.listSharedWithMe();

			const localByRemoteId = getLocalFilesByRemoteId(userId, account.id);
			return items
				.map((item) =>
					mapSharedItem(userId, account, item, localByRemoteId.get(item.remote_file_id) || null),
				)
				.filter((item) => Boolean(item.remote_file_id));
		}),
	);

	const seenIds = new Set();
	return settled
		.filter((result) => result.status === 'fulfilled')
		.flatMap((result) => result.value)
		.filter((item) => Boolean(item.remote_file_id))
		.filter((item) => {
			if (seenIds.has(item.id)) return false;
			seenIds.add(item.id);
			return true;
		})
		.sort((left, right) => {
			const leftTime = new Date(left.modifiedTime || left.createdTime || 0).getTime();
			const rightTime = new Date(right.modifiedTime || right.createdTime || 0).getTime();
			if (leftTime !== rightTime) return rightTime - leftTime;
			return (left.file_name || '').localeCompare(right.file_name || '', 'id');
		});
}

// Short-lived per-user cache for the "shared with me" aggregation. Each call
// fans out to every connected provider's share API, and the Shared view
// auto-refreshes on a timer, so without a cache one open tab multiplies external
// API calls by account count every 30s. A small TTL keeps the view fresh while
// collapsing bursts (re-renders, multiple tabs) into one upstream fetch.
const SHARED_CACHE_TTL_MS = 30 * 1000;
const sharedWithMeCache = new Map();

export async function listSharedWithMeFiles(userId, { forceRefresh = false } = {}) {
	const cached = sharedWithMeCache.get(userId);
	if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	// De-duplicate concurrent requests for the same user onto one in-flight
	// promise so parallel calls don't each fan out to every provider.
	if (cached?.promise) {
		return cached.promise;
	}

	const promise = computeSharedWithMeFiles(userId)
		.then((value) => {
			sharedWithMeCache.set(userId, { value, expiresAt: Date.now() + SHARED_CACHE_TTL_MS });
			return value;
		})
		.catch((error) => {
			sharedWithMeCache.delete(userId);
			throw error;
		});

	sharedWithMeCache.set(userId, { ...(cached || {}), promise });
	return promise;
}
