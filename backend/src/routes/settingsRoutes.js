import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

router.use(requireAppUser);

router.get('/settings', (req, res, next) => {
	try {
		const settings = getSettings(req.user.id);
		res.json({ data: settings });
	} catch (error) {
		next(error);
	}
});

router.patch('/settings', (req, res, next) => {
	try {
		const settings = req.body;
		// Invalid setting keys are a client error; surface as a typed 400.
		const updated = updateSettings(req.user.id, settings);
		res.json({ data: updated });
	} catch (error) {
		next(error instanceof AppError ? error : new AppError(error.message, 400, 'INVALID_SETTINGS'));
	}
});

export default router;
