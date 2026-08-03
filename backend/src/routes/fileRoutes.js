import { Router } from 'express';
import { listFilesByPath, getFileById, getFileByRemoteId, listRecentFiles, listStarredFiles, searchFiles, setFileStarred, updateFileStarredByRemoteId, listHiddenFiles } from '../services/fileService.js';
import { getAccountById, getActiveAccounts } from '../services/accountService.js';
import { createAdapter } from '../services/adapterRegistry.js';
import { selectBestAccount } from '../services/spaceAllocator.js';
import { syncAccount } from '../services/syncService.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getHiddenFile, updateHiddenFileMeta, deleteHiddenFile } from '../services/hiddenFileService.js';
import { unwrapDataKey, createDecryptStream } from '../utils/fileEncryption.js';
import { decryptMeta, encryptMeta, kekWrap, kekMeta } from '../utils/vaultCrypto.js';
import * as vaultSessionService from '../services/vaultSessionService.js';

const router = Router();

router.use(requireAppUser);

// Real file names are arbitrary user content (quotes, non-ASCII) — emit an
// ASCII fallback plus an RFC 5987 UTF-8 filename*.
function buildContentDisposition(type, filename) {
	const ascii = String(filename).replace(/[^\x20-\x7E]/g, '?').replace(/["\\]/g, '_');
	return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(String(filename))}`;
}

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

// Hidden routes resolve the file context first (404 for missing), THEN require
// the vault (403 VAULT_LOCKED). Returns the KEK or null (response already sent).
function requireVaultKek(res, userId) {
	const kek = vaultSessionService.getKek(userId);
	if (!kek) {
		res.status(403).json({ error: 'VAULT_LOCKED' });
		return null;
	}
	return kek;
}

// Builds the user-facing object for a hidden file from its decrypted enc_meta.
// file_name stays the obfuscated UUID (display uses display_name; adapters rely
// on file_name for remote-path fallbacks).
function decorateHidden(row, meta) {
	return {
		...row,
		display_name: meta.real_name,
		name: meta.real_name,
		size: Number(meta.plaintext_size),
		mime_type: meta.mime_type || 'application/octet-stream',
		is_hidden: true,
		capabilities: { starred: false, rename: true, delete: true },
		createdTime: row.remote_created_time || null,
		modifiedTime: row.remote_modified_time || null,
	};
}

async function deleteContextFile(userId, context, rawId = context?.file?.id, options = {}) {
	const { sync = true } = options;
	await context.adapter.deleteFile(context.file);

	if (context.file.is_hidden) {
		deleteHiddenFile(context.account.id, context.file.remote_file_id);
	}

	if (sync && context.account) {
		await syncAccount(userId, context.account);
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
		if (req.query.hidden === '1') {
			const kek = requireVaultKek(res, req.user.id);
			if (!kek) return;
			const metaKey = kekMeta(kek);
			const files = listHiddenFiles(req.user.id)
				.map((row) => {
					try {
						return decorateHidden(row, decryptMeta(row.enc_meta, metaKey));
					} catch (error) {
						// Corrupt/tampered enc_meta — skip the row rather than fail the list.
						console.error('Failed to decrypt hidden file meta', row.cloud_account_id, row.remote_file_id, error.message);
						return null;
					}
				})
				.filter(Boolean);
			return res.json({ data: files });
		}

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
		const data = {
			...context.file,
			...details,
		};

		// Adapter details would re-leak the obfuscated name + ciphertext size; for
		// hidden files, decrypt enc_meta and re-assert the real identity.
		if (context.file.is_hidden) {
			const kek = requireVaultKek(res, req.user.id);
			if (!kek) return;
			const enc = getHiddenFile(context.account.id, context.file.remote_file_id);
			if (!enc || !enc.enc_meta) {
				return res.status(500).json({ error: 'Encryption metadata for this file is missing' });
			}
			const meta = decryptMeta(enc.enc_meta, kekMeta(kek));
			data.name = meta.real_name;
			data.file_name = meta.real_name;
			data.display_name = meta.real_name;
			data.size = Number(meta.plaintext_size);
			data.mime_type = meta.mime_type || 'application/octet-stream';
			data.mimeType = data.mime_type;
		}

		return res.json({ data });
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

		if (context.file.is_hidden) {
			const kek = requireVaultKek(res, req.user.id);
			if (!kek) return;
			const enc = getHiddenFile(context.account.id, context.file.remote_file_id);
			if (!enc || !enc.enc_meta) {
				return res.status(500).json({ error: 'Encryption metadata for this file is missing' });
			}
			// Decrypt meta BEFORE setting headers — content-length must be the
			// plaintext size, not the ciphertext size.
			const meta = decryptMeta(enc.enc_meta, kekMeta(kek));
			const stream = await context.adapter.getDownloadStream(context.file);
			res.setHeader('Content-Disposition', buildContentDisposition('attachment', meta.real_name));
			res.setHeader('Content-Type', meta.mime_type || 'application/octet-stream');
			res.setHeader('Content-Length', String(meta.plaintext_size));
			stream.pipe(createDecryptStream(unwrapDataKey(enc.wrapped_key, kekWrap(kek)))).pipe(res);
			return;
		}

		const stream = await context.adapter.getDownloadStream(context.file);
		res.setHeader('Content-Disposition', buildContentDisposition('attachment', context.file.file_name));
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

		let mimeType = context.file.mime_type || 'application/octet-stream';
		let displayName = context.file.file_name;
		let contentLength = context.file.size;
		let dataKey = null;

		// For hidden files, decrypt enc_meta FIRST so the previewability check and
		// Content-Type/Length reflect the real file, not the octet-stream blob.
		if (context.file.is_hidden) {
			const kek = requireVaultKek(res, req.user.id);
			if (!kek) return;
			const enc = getHiddenFile(context.account.id, context.file.remote_file_id);
			if (!enc || !enc.enc_meta) {
				return res.status(500).json({ error: 'Encryption metadata for this file is missing' });
			}
			const meta = decryptMeta(enc.enc_meta, kekMeta(kek));
			mimeType = meta.mime_type || 'application/octet-stream';
			displayName = meta.real_name;
			contentLength = Number(meta.plaintext_size);
			dataKey = unwrapDataKey(enc.wrapped_key, kekWrap(kek));
		}

		const isPreviewable = /^(image|video|audio|text)\//.test(mimeType)
			|| mimeType === 'application/pdf'
			|| mimeType === 'application/json';

		if (!isPreviewable) {
			return res.status(415).json({ error: 'Preview is not supported for this file type' });
		}

		const stream = await context.adapter.getDownloadStream(context.file);

		res.setHeader('Content-Disposition', buildContentDisposition('inline', displayName));
		res.setHeader('Content-Type', mimeType);
		if (contentLength) {
			res.setHeader('Content-Length', String(contentLength));
		}

		if (dataKey) {
			stream.pipe(createDecryptStream(dataKey)).pipe(res);
		} else {
			stream.pipe(res);
		}
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

		// Hidden files rename locally only — the provider object must keep its
		// obfuscated UUID name; we decrypt enc_meta, change real_name, re-encrypt.
		if (context.file.is_hidden) {
			const kek = requireVaultKek(res, req.user.id);
			if (!kek) return;
			const enc = getHiddenFile(context.account.id, context.file.remote_file_id);
			if (!enc || !enc.enc_meta) {
				return res.status(500).json({ error: 'Encryption metadata for this file is missing' });
			}
			const meta = decryptMeta(enc.enc_meta, kekMeta(kek));
			updateHiddenFileMeta(
				context.account.id,
				context.file.remote_file_id,
				encryptMeta(
					{ real_name: name.trim(), plaintext_size: meta.plaintext_size, mime_type: meta.mime_type },
					kekMeta(kek),
				),
			);
			return res.json({ data: { success: true, local_only: true } });
		}

		await context.adapter.renameFile(context.file, name.trim());
		await syncAccount(req.user.id, context.account);

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
