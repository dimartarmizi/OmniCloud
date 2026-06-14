import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { getUsableCapacity } from '../services/fileService.js';
import { db } from '../config/database.js';

const router = Router();

router.use(requireAppUser);

router.get('/settings', (req, res) => {
	try {
		const settings = getSettings(req.user.id);
		res.json({ data: settings });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

router.patch('/settings', (req, res) => {
	try {
		const settings = req.body;
		const updated = updateSettings(req.user.id, settings);
		res.json({ data: updated });
	} catch (error) {
		res.status(400).json({ error: error.message });
	}
});

/**
 * GET /api/capacity
 * Returns current effective usable capacity for the authenticated user.
 * Used by the sidebar storage indicator.
 */
router.get('/capacity', (req, res) => {
	try {
		const capacity = getUsableCapacity(req.user.id);
		res.json({ data: capacity });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/capacity-preview?replication_factor=N
 * Simulates what usable capacity and protection coverage would look like
 * if the user were to switch to a given replication_factor.
 * Used by QuotaView to show warning dialog before RAID setting change.
 */
router.get('/capacity-preview', (req, res) => {
	try {
		const userId = req.user.id;
		const targetFactor = Math.min(3, Math.max(1, Number(req.query.replication_factor) || 1));

		const capacity = getUsableCapacity(userId);

		// Count files that currently have fewer parts than the target replication factor
		const filesUnderRisk = db
			.prepare(`
				SELECT COUNT(*) as count
				FROM file_metadata fm
				WHERE fm.user_id = ?
					AND fm.is_folder = 0
					AND (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) < ?
			`)
			.get(userId, targetFactor)?.count || 0;

		// Sum up sizes of files that are under-replicated — how much extra space would be needed
		const spaceNeededForFullReplication = db
			.prepare(`
				SELECT COALESCE(SUM(fm.size * (? - (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id))), 0) as total
				FROM file_metadata fm
				WHERE fm.user_id = ?
					AND fm.is_folder = 0
					AND (SELECT COUNT(*) FROM file_parts WHERE file_metadata_id = fm.id) < ?
			`)
			.get(targetFactor, userId, targetFactor)?.total || 0;

		// Estimated usable capacity for the new factor: rawTotal / targetFactor (simplified preview)
		const projectedUsable = targetFactor <= 1
			? capacity.rawTotal
			: Math.max(0, capacity.rawTotal - capacity.primaryUsed * (targetFactor - 1));

		// Can we fully replicate? Check if there's enough free space across accounts
		const totalFreeSpace = db
			.prepare(`SELECT COALESCE(SUM(total_space - used_space), 0) as total FROM cloud_accounts WHERE user_id = ? AND status = 'active'`)
			.get(userId)?.total || 0;

		const canFullyReplicate = Number(totalFreeSpace) >= Number(spaceNeededForFullReplication);

		res.json({
			data: {
				rawTotal: capacity.rawTotal,
				replicationFactor: targetFactor,
				currentUsedPrimary: capacity.primaryUsed,
				replicaOverhead: capacity.replicaOverhead,
				usableCapacity: capacity.usableCapacity,
				projectedUsable,
				filesUnderRisk: Number(filesUnderRisk),
				spaceNeededForFullReplication: Number(spaceNeededForFullReplication),
				totalFreeSpace: Number(totalFreeSpace),
				canFullyReplicate,
			},
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

export default router;
