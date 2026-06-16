import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { AppError } from '../utils/AppError.js';
import {
	ALLOCATION_STRATEGIES,
	getAllocationConfig,
	getOrderedActiveAccounts,
	setAllocationConfig,
} from '../services/allocationService.js';

const router = Router();

router.use(requireAppUser);

function serializeAccount(account) {
	const total = Number(account.total_space) || 0;
	const used = Number(account.used_space) || 0;
	return {
		id: account.id,
		email: account.email,
		provider: account.provider,
		total_space: total,
		used_space: used,
		free_space: Math.max(0, total - used),
	};
}

router.get('/allocation', (req, res, next) => {
	try {
		const config = getAllocationConfig(req.user.id);
		res.json({
			data: {
				strategy: config.strategy,
				strategies: ALLOCATION_STRATEGIES,
				accounts: getOrderedActiveAccounts(req.user.id).map(serializeAccount),
			},
		});
	} catch (error) {
		next(error);
	}
});

router.patch('/allocation', (req, res, next) => {
	try {
		const { strategy, order } = req.body || {};
		// Validation errors from setAllocationConfig are client errors (400).
		const updated = setAllocationConfig(req.user.id, { strategy, order });
		res.json({
			data: {
				strategy: updated.strategy,
				strategies: ALLOCATION_STRATEGIES,
				accounts: getOrderedActiveAccounts(req.user.id).map(serializeAccount),
			},
		});
	} catch (error) {
		next(error instanceof AppError ? error : new AppError(error.message, 400, 'INVALID_ALLOCATION'));
	}
});

export default router;
