import { Router } from 'express';
import {
	listFilesByPath,
	listRecentFiles,
	listStarredFiles,
	searchFiles,
	setFileStarred,
	updateFileStarredByRemoteId,
	renameFileMetadata,
	upsertFileByRemoteId,
	getAccountIdForPath,
	moveFileMetadata,
	getLocalFilesByRemoteId,
} from '../services/fileService.js';
import { getAccountById } from '../services/accountService.js';
import { createAdapter } from '../services/adapterRegistry.js';
import { selectBestAccount } from '../services/spaceAllocator.js';
import { syncAccount } from '../services/syncService.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { contentDispositionHeader, parseRangeHeader } from '../utils/httpHeaders.js';
import { AppError } from '../utils/AppError.js';
import {
	getFileContext,
	ensureFileContext,
	deleteContextFile,
} from '../services/fileContextService.js';
import {
	decodeSharedFileId,
	mapSharedItem,
	listSharedWithMeFiles,
} from '../services/sharedFileService.js';
import { pipeDownloadStream } from '../services/fileDownloadService.js';

const router = Router();

router.use(requireAppUser);

router.get('/files', async (req, res, next) => {
	try {
		const files = req.query.search
			? searchFiles(req.user.id, req.query.search, req.query.limit)
			: req.query.starred === '1'
			? listStarredFiles(req.user.id)
			: req.query.recent === '1'
				? listRecentFiles(req.user.id)
				: req.query.shared === '1'
					? await listSharedWithMeFiles(req.user.id, { forceRefresh: req.query.refresh === '1' })
					: listFilesByPath(req.user.id, req.query.path || '/');
		res.json({ data: files });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id/shared-children', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		if (!context.file.is_folder) {
			throw new AppError('Only folders can be opened', 400, 'NOT_A_FOLDER');
		}

		const items = await context.adapter.listSharedFolderChildren(context.file);
		const localByRemoteId = getLocalFilesByRemoteId(req.user.id, context.account.id);
		return res.json({
			data: items
				.map((item) =>
					mapSharedItem(req.user.id, context.account, item, localByRemoteId.get(item.remote_file_id) || null),
				)
				.filter((item) => Boolean(item.remote_file_id)),
		});
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:id/star', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		const isStarred = Boolean(req.body?.is_starred ?? req.body?.isStarred ?? true);
		const supportsStarred = Boolean(context.adapter.getCapabilities?.().starred);

		if (supportsStarred) {
			await context.adapter.setFileStarred(context.file, isStarred);
			// The provider is the source of truth for starred state, but a single
			// flag flip does not warrant a full account re-walk: update the local
			// mirror directly. Shared items have no local row, so this no-ops.
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
			throw new AppError('At least one file id is required', 400, 'NO_FILE_IDS');
		}

		const contexts = await Promise.all(
			ids.map(async (id) => ({ id, ...(await getFileContext(req.user.id, id)) })),
		);
		const invalid = contexts.find(
			(context) =>
				!context.file || !context.account || context.account.status !== 'active' || !context.adapter,
		);
		if (invalid) {
			throw invalid.file
				? new AppError('One or more file accounts are no longer connected', 409, 'ACCOUNT_DISCONNECTED')
				: new AppError('One or more files were not found', 404, 'FILE_NOT_FOUND');
		}

		for (const context of contexts) {
			await deleteContextFile(req.user.id, context);
		}

		return res.json({ data: { success: true, count: contexts.length } });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
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
		if (!ensureFileContext(context)) {
			return;
		}

		const totalSize = !context.file.is_folder ? Number(context.file.size || 0) : 0;
		const range = parseRangeHeader(req.headers.range, totalSize);

		if (range?.unsatisfiable) {
			res.setHeader('Content-Range', `bytes */${totalSize}`);
			throw new AppError('Requested range not satisfiable', 416, 'RANGE_NOT_SATISFIABLE');
		}

		const stream = await context.adapter.getDownloadStream(context.file, range ? { range } : {});

		res.setHeader('Content-Disposition', contentDispositionHeader('attachment', context.file.file_name));
		res.setHeader('Content-Type', context.file.mime_type || 'application/octet-stream');
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Accept-Ranges', 'bytes');

		if (range) {
			// Partial content: advertise the served byte window so clients can
			// resume/scrub. Content-Length is the slice length, not the whole file.
			res.status(206);
			res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
			res.setHeader('Content-Length', String(range.length));
		} else if (totalSize) {
			res.setHeader('Content-Length', String(totalSize));
		}
		pipeDownloadStream(stream, res, next);
	} catch (error) {
		next(error);
	}
});

router.get('/files/:id/preview', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		if (context.file.is_folder) {
			throw new AppError('Folder preview is not supported', 400, 'PREVIEW_UNSUPPORTED');
		}

		const mimeType = context.file.mime_type || 'application/octet-stream';
		const isPreviewable = /^(image|video|audio|text)\//.test(mimeType)
			|| mimeType === 'application/pdf'
			|| mimeType === 'application/json';

		if (!isPreviewable) {
			throw new AppError('Preview is not supported for this file type', 415, 'PREVIEW_UNSUPPORTED');
		}

		const totalSize = Number(context.file.size || 0);
		const range = parseRangeHeader(req.headers.range, totalSize);
		if (range?.unsatisfiable) {
			res.setHeader('Content-Range', `bytes */${totalSize}`);
			throw new AppError('Requested range not satisfiable', 416, 'RANGE_NOT_SATISFIABLE');
		}

		const stream = await context.adapter.getDownloadStream(context.file, range ? { range } : {});

		res.setHeader('Content-Disposition', contentDispositionHeader('inline', context.file.file_name));
		res.setHeader('Content-Type', mimeType);
		// Prevent MIME sniffing and neutralize active content: previewed bytes are
		// untrusted user/provider data served from our own origin, so an HTML/SVG
		// file masquerading as another type must not be able to execute scripts.
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
		res.setHeader('Accept-Ranges', 'bytes');
		if (range) {
			res.status(206);
			res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
			res.setHeader('Content-Length', String(range.length));
		} else if (totalSize) {
			res.setHeader('Content-Length', String(totalSize));
		}

		pipeDownloadStream(stream, res, next);
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:id/rename', async (req, res, next) => {
	try {
		const { name } = req.body;
		if (!name?.trim()) {
			throw new AppError('New name is required', 400, 'NAME_REQUIRED');
		}

		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		await context.adapter.renameFile(context.file, name.trim());
		// Rename in the local mirror in place (and remap descendant paths for
		// folders) rather than re-walking the entire provider account.
		renameFileMetadata(req.user.id, context.file.id, name.trim());

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:id/move', async (req, res, next) => {
	try {
		const targetPath = req.body?.target_path ?? req.body?.virtual_path;
		if (typeof targetPath !== 'string' || !targetPath.trim()) {
			throw new AppError('target_path is required', 400, 'TARGET_PATH_REQUIRED');
		}

		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		// Shared ("shared with me") items are served live from the provider and
		// have no local row to move.
		if (decodeSharedFileId(context.file.id)) {
			throw new AppError('Shared items cannot be moved', 400, 'CANNOT_MOVE_SHARED');
		}

		const normalizedTarget = targetPath.trim();

		// Cross-provider moves require a full download/re-upload pipeline and are
		// out of scope: restrict moves to within the same account. If the target
		// folder already belongs to a different account, reject clearly.
		const targetAccountId = getAccountIdForPath(req.user.id, normalizedTarget);
		if (targetAccountId && targetAccountId !== context.account.id) {
			throw new AppError(
				'Moving across provider accounts is not supported yet',
				400,
				'CROSS_PROVIDER_MOVE_UNSUPPORTED',
			);
		}

		// No-op guard: moving into the folder it already lives in.
		const currentPath = context.file.virtual_path || '/';
		const destPath = normalizedTarget.endsWith('/') ? normalizedTarget : `${normalizedTarget}/`;
		if (currentPath === destPath) {
			return res.json({ data: { success: true, unchanged: true } });
		}

		await context.adapter.moveFile(context.file, normalizedTarget);
		moveFileMetadata(req.user.id, context.file.id, normalizedTarget);

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

router.delete('/files/:id', async (req, res, next) => {
	try {
		const context = await getFileContext(req.user.id, req.params.id);
		if (!ensureFileContext(context)) {
			return;
		}

		await deleteContextFile(req.user.id, context);

		return res.json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

router.post('/files/folders', async (req, res, next) => {
	try {
		const { name, virtual_path = '/' } = req.body;

		if (!name?.trim()) {
			throw new AppError('Folder name is required', 400, 'NAME_REQUIRED');
		}

		// A nested folder must live on the SAME provider account as the folder
		// that contains it, otherwise a single virtual subtree would span multiple
		// providers. Inherit the parent path's account when one exists; only fall
		// back to the allocator for top-level folders (empty parent).
		const inheritedAccountId = getAccountIdForPath(req.user.id, virtual_path);
		const selected = inheritedAccountId
			? { id: inheritedAccountId }
			: selectBestAccount(req.user.id, 0).selected;
		const account = getAccountById(req.user.id, selected.id);
		if (!account || account.status !== 'active') {
			throw new AppError('The destination account is no longer connected', 409, 'ACCOUNT_DISCONNECTED');
		}
		const adapter = createAdapter(account);

		const created = await adapter.createFolder({
			name: name.trim(),
			virtualPath: virtual_path,
		});

		// Mirror just the new folder instead of re-walking the whole account.
		if (created?.remoteFileId) {
			upsertFileByRemoteId({
				user_id: req.user.id,
				virtual_path: virtual_path,
				file_name: created.fileName || name.trim(),
				is_folder: true,
				size: 0,
				mime_type: null,
				cloud_account_id: account.id,
				remote_file_id: created.remoteFileId,
				remote_parent_id: created.remoteParentId,
				remote_created_time: new Date().toISOString(),
				remote_modified_time: new Date().toISOString(),
			});
		} else {
			// Adapter could not report a stable remote id; fall back to a full
			// resync so the folder still appears.
			await syncAccount(req.user.id, account);
		}

		return res.status(201).json({ data: { success: true } });
	} catch (error) {
		next(error);
	}
});

export default router;
