import { Router } from 'express';
import { listFilesByPath, getFileById, getFileByRemoteId, getFileParts, listRecentFiles, listStarredFiles, searchFiles, setFileStarred, updateFileStarredByRemoteId } from '../services/fileService.js';
import { getAccountById, getActiveAccounts, updateAccountUsage } from '../services/accountService.js';
import { createAdapter } from '../services/adapterRegistry.js';
import { selectBestAccount } from '../services/spaceAllocator.js';
import { syncAccount } from '../services/syncService.js';
import { requireAppUser } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAppUser);

function encodeSharedFileId(accountId, remoteFileId) {
	return `shared:${accountId}:${Buffer.from(String(remoteFileId)).toString('base64url')}`;
}

function mapSharedItem(userId, account, item, localFile = getFileByRemoteId(userId, account.id, item.remote_file_id)) {
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
			starred: Boolean(item.capabilities?.starred ?? localFile?.capabilities?.starred ?? account.provider === 'google_drive'),
			rename: Boolean(item.capabilities?.rename ?? localFile?.capabilities?.rename ?? false),
			delete: Boolean(item.capabilities?.delete ?? localFile?.capabilities?.delete ?? false),
		},
	};
}

function decodeSharedFileId(fileId) {
	if (!fileId?.startsWith('shared:')) return null;
	const [, accountId, encodedRemoteFileId] = fileId.split(':');
	if (!accountId || !encodedRemoteFileId) return null;
	return {
		accountId,
		remoteFileId: Buffer.from(encodedRemoteFileId, 'base64url').toString('utf8'),
	};
}

async function getSharedFileContext(userId, fileId) {
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
				starred: Boolean(file.capabilities?.starred ?? account.provider === 'google_drive'),
				rename: Boolean(file.capabilities?.rename ?? false),
				delete: Boolean(file.capabilities?.delete ?? false),
			},
		},
		account,
		adapter,
	};
}

async function getFileContext(userId, fileId) {
	const file = getFileById(userId, fileId);
	if (!file) {
		return getSharedFileContext(userId, fileId);
	}

	let account = getAccountById(userId, file.cloud_account_id);
	let useReplica = false;
	let replicaPart = null;

	if (!account || account.status !== 'active') {
		const parts = getFileParts(file.id);
		for (const part of parts) {
			const candidateAccount = getAccountById(userId, part.cloud_account_id);
			if (candidateAccount && candidateAccount.status === 'active') {
				account = candidateAccount;
				replicaPart = part;
				useReplica = true;
				break;
			}
		}
	}

	if (!account) {
		return { file, account: null, adapter: null };
	}

	const fileWithReplica = useReplica ? {
		...file,
		cloud_account_id: replicaPart.cloud_account_id,
		remote_file_id: replicaPart.remote_file_id,
		remote_parent_id: replicaPart.remote_parent_id,
	} : file;

	return {
		file: fileWithReplica,
		account,
		adapter: createAdapter(account),
	};
}

function ensureFileContext(context, res) {
	if (!context.file) {
		res.status(404).json({ error: 'File not found' });
		return false;
	}

	if (!context.account || context.account.status !== 'active' || !context.adapter) {
		res.status(409).json({ error: 'The file account is no longer connected' });
		return false;
	}

	return true;
}

async function deleteContextFile(userId, context, rawId = context?.file?.id, options = {}) {
	const { sync = true } = options;
	const parts = getFileParts(rawId);

	for (const part of parts) {
		const account = getAccountById(userId, part.cloud_account_id);
		if (account && account.status === 'active') {
			try {
				const adapter = createAdapter(account);
				await adapter.deleteFile({
					...context.file,
					remote_file_id: part.remote_file_id,
					remote_parent_id: part.remote_parent_id,
				});

				const nextUsedSpace = Math.max(0, Number(account.used_space) - Number(part.part_size));
				updateAccountUsage(userId, account.id, nextUsedSpace);

				if (sync) {
					await syncAccount(userId, account);
				}
			} catch (error) {
				console.error(`Failed to delete replica on account ${account.email}:`, error);
			}
		}
	}
}

async function listSharedWithMeFiles(userId) {
	const accounts = getActiveAccounts(userId);
	const settled = await Promise.allSettled(accounts.map(async (account) => {
		const adapter = createAdapter(account);
		const items = await adapter.listSharedWithMe();

		return items
			.map((item) => mapSharedItem(userId, account, item))
			.filter((item) => Boolean(item.remote_file_id));
	}));

	return settled
		.filter((result) => result.status === 'fulfilled')
		.flatMap((result) => result.value)
		.filter((item) => Boolean(item.remote_file_id))
		.filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
		.sort((left, right) => {
			const leftTime = new Date(left.modifiedTime || left.createdTime || 0).getTime();
			const rightTime = new Date(right.modifiedTime || right.createdTime || 0).getTime();
			if (leftTime !== rightTime) return rightTime - leftTime;
			return (left.file_name || '').localeCompare(right.file_name || '', 'id');
		});
}

router.get('/files', async (req, res, next) => {
	try {
		const files = req.query.search
			? searchFiles(req.user.id, req.query.search, req.query.limit)
			: req.query.starred === '1'
			? listStarredFiles(req.user.id)
			: req.query.recent === '1'
				? listRecentFiles(req.user.id)
				: req.query.shared === '1'
					? await listSharedWithMeFiles(req.user.id)
					: listFilesByPath(req.user.id, req.query.path || '/');
		res.json({ data: files });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id/shared-children', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		if (!context.file.is_folder) {
			return res.status(400).json({ error: 'Only folders can be opened' });
		}

		const items = await context.adapter.listSharedFolderChildren(context.file);
		return res.json({
			data: items.map((item) => mapSharedItem(req.user.id, context.account, item)).filter((item) => Boolean(item.remote_file_id)),
		});
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:id/star', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		const isStarred = Boolean(req.body?.is_starred ?? req.body?.isStarred ?? true);
		const supportsStarred = Boolean(context.adapter.getCapabilities?.().starred);

		if (supportsStarred) {
			await context.adapter.setFileStarred(context.file, isStarred);
			await syncAccount(req.user.id, context.account);
			if (!decodeSharedFileId(context.file.id)) {
				updateFileStarredByRemoteId(req.user.id, context.account.id, context.file.remote_file_id, isStarred);
			}
		} else {
			setFileStarred(req.user.id, context.file.id, isStarred);
		}
		return res.json({ data: { success: true, is_starred: isStarred, provider_sync: supportsStarred } });
	} catch (error) {
		next(error);
	}
});

router.post('/files/bulk/delete', async (req, res, next) => {
	try {
		const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.filter(Boolean))] : [];
		if (!ids.length) {
			return res.status(400).json({ error: 'At least one file id is required' });
		}

		const contexts = await Promise.all(ids.map(async (id) => ({ id, ...await getFileContext(req.user.id, id) })));
		const invalid = contexts.find((context) => !context.file || !context.account || context.account.status !== 'active' || !context.adapter);
		if (invalid) {
			return res.status(invalid.file ? 409 : 404).json({ error: invalid.file ? 'One or more file accounts are no longer connected' : 'One or more files were not found' });
		}

		const touchedAccountIds = new Set();
		for (const context of contexts) {
			await deleteContextFile(req.user.id, context, context.id, { sync: false });
			touchedAccountIds.add(context.account.id);
		}

		for (const accountId of touchedAccountIds) {
			const account = getAccountById(req.user.id, accountId);
			if (account) {
				await syncAccount(req.user.id, account);
			}
		}

		return res.json({ data: { success: true, count: contexts.length } });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		const details = await context.adapter.getFileDetails(context.file);
		return res.json({
			data: {
				...context.file,
				...details,
			},
		});
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id/download', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}
		const stream = await context.adapter.getDownloadStream(context.file);

		res.setHeader('Content-Disposition', `attachment; filename="${context.file.file_name}"`);
		res.setHeader('Content-Type', context.file.mime_type || 'application/octet-stream');
		if (!context.file.is_folder && context.file.size) {
			res.setHeader('Content-Length', String(context.file.size));
		}
		stream.pipe(res);
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id/preview', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		if (context.file.is_folder) {
			return res.status(400).json({ error: 'Folder preview is not supported' });
		}

		const mimeType = context.file.mime_type || 'application/octet-stream';
		const isPreviewable = /^(image|video|audio|text)\//.test(mimeType)
			|| mimeType === 'application/pdf'
			|| mimeType === 'application/json';

		if (!isPreviewable) {
			return res.status(415).json({ error: 'Preview is not supported for this file type' });
		}

		const stream = await context.adapter.getDownloadStream(context.file);

		res.setHeader('Content-Disposition', `inline; filename="${context.file.file_name}"`);
		res.setHeader('Content-Type', mimeType);
		if (context.file.size) {
			res.setHeader('Content-Length', String(context.file.size));
		}

		stream.pipe(res);
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:id/rename', async (req, res, next) => {
	try {
		const { name } = req.body;
		if (!name?.trim()) {
			return res.status(400).json({ error: 'New name is required' });
		}

		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		const parts = getFileParts(req.params.id);
		for (const part of parts) {
			const account = getAccountById(req.user.id, part.cloud_account_id);
			if (account && account.status === 'active') {
				try {
					const adapter = createAdapter(account);
					await adapter.renameFile({
						...context.file,
						remote_file_id: part.remote_file_id,
						remote_parent_id: part.remote_parent_id,
					}, name.trim());
					await syncAccount(req.user.id, account);
				} catch (error) {
					console.error(`Failed to rename replica on account ${account.email}:`, error);
				}
			}
		}

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

router.delete('/files/:id', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context, res)) {
			return;
		}

		await deleteContextFile(req.user.id, context, req.params.id);

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

router.post('/files/folders', async (req, res, next) => {
	try {
		const { name, virtual_path = '/' } = req.body;

		if (!name?.trim()) {
			return res.status(400).json({ error: 'Folder name is required' });
		}

		const { selected } = selectBestAccount(req.user.id, 0);
		const account = getAccountById(req.user.id, selected.id);
		const adapter = createAdapter(account);

		await adapter.createFolder({
			name: name.trim(),
			virtualPath: virtual_path,
		});

		await syncAccount(req.user.id, account);

		return res.status(201).json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

export default router;
