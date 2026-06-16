import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { selectBestAccount } from '../services/spaceAllocator.js';
import { createUploadSession } from '../services/uploadSessionService.js';
import { handleUpload } from '../services/uploadService.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

router.use(requireAppUser);

router.post('/uploads/initiate', (req, res, next) => {
	try {
		const { file_name, size, mime_type, virtual_path = '/', remote_parent_id = null } = req.body;

		if (!file_name || size === undefined || size === null) {
			throw new AppError('file_name and size are required', 400, 'INVALID_UPLOAD_REQUEST');
		}

		const numericSize = Number(size);
		if (!Number.isFinite(numericSize) || numericSize < 0) {
			throw new AppError('size must be a non-negative number', 400, 'INVALID_UPLOAD_SIZE');
		}

		const allocation = selectBestAccount(req.user.id, numericSize);
		const session = createUploadSession({
			user_id: req.user.id,
			file_name,
			size: numericSize,
			mime_type,
			virtual_path,
			remote_parent_id,
			cloud_account_id: allocation.selected.id,
			fallback_chain: allocation.fallbackChain.map((account) => account.id),
		});

		return res.status(201).json({
			data: {
				upload_id: session.id,
				session_token: session.token,
				target_account: {
					id: allocation.selected.id,
					provider: allocation.selected.provider,
					email: allocation.selected.email,
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

router.post('/uploads/:uploadId/stream', async (req, res, next) => {
	try {
		const providedToken = req.get('x-upload-token') || req.query.token || null;
		const metadata = await handleUpload(req, req.params.uploadId, providedToken);
		res.status(201).json({ data: metadata });
	} catch (error) {
		next(error);
	}
});

export default router;
