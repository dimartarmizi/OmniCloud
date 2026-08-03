import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { selectBestAccount } from '../services/spaceAllocator.js';
import { createUploadSession } from '../services/uploadSessionService.js';
import { handleUpload } from '../services/uploadService.js';
import { ciphertextSize } from '../utils/fileEncryption.js';

const router = Router();

router.use(requireAppUser);

router.post('/uploads/initiate', (req, res) => {
	const { file_name, size, mime_type, virtual_path = '/', remote_parent_id = null, is_hidden = false } = req.body;

	if (!file_name || size === undefined || size === null) {
		return res.status(400).json({ error: 'file_name and size are required' });
	}

	const isHidden = is_hidden === true || is_hidden === 'true' || is_hidden === 1 || is_hidden === '1';
	const plaintextSize = Number(size);
	// Allocate space by the bytes the provider will actually store (ciphertext).
	const effectiveSize = isHidden ? ciphertextSize(plaintextSize) : plaintextSize;

	const allocation = selectBestAccount(req.user.id, effectiveSize);
	const session = createUploadSession({
		user_id: req.user.id,
		file_name,
		size: plaintextSize,
		effective_size: effectiveSize,
		mime_type,
		virtual_path,
		remote_parent_id,
		is_hidden: isHidden,
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
});

router.post('/uploads/:uploadId/stream', async (req, res, next) => {
	try {
		const metadata = await handleUpload(req, req.params.uploadId);
		res.status(201).json({ data: metadata });
	} catch (error) {
		next(error);
	}
});

export default router;
