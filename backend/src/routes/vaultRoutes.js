import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getVault, createVault, unlockVault, resetVaultPin } from '../services/vaultService.js';
import * as vaultSessionService from '../services/vaultSessionService.js';
import { isValidWords } from '../utils/vaultCrypto.js';

const router = Router();
router.use(requireAppUser);

// Inline 400 (the shared error handler would map unknown messages to 500).
const pinError = { error: 'PIN must be exactly 6 digits' };
const isPin = (pin) => /^\d{6}$/.test(String(pin || ''));

router.get('/vault/status', (req, res) => {
	res.json({
		data: {
			has_vault: Boolean(getVault(req.user.id)),
			unlocked: vaultSessionService.isUnlocked(req.user.id),
		},
	});
});

router.post('/vault/setup', (req, res) => {
	if (!isPin(req.body?.pin)) {
		return res.status(400).json(pinError);
	}
	if (getVault(req.user.id)) {
		return res.status(409).json({ error: 'Vault already exists' });
	}
	const words = createVault(req.user.id, req.body.pin);
	return res.status(201).json({ data: { words } });
});

router.post('/vault/unlock', (req, res) => {
	if (!isPin(req.body?.pin)) {
		return res.status(400).json(pinError);
	}
	// Rate-limit BEFORE running scrypt — an unlocked endpoint must not let an
	// unauthenticated caller burn ~256 MiB / ~0.5 s per request.
	if (!vaultSessionService.canAttemptPin(req.user.id)) {
		return res.status(429).json({ error: 'Too many attempts. Try again later.' });
	}
	if (!getVault(req.user.id)) {
		return res.status(404).json({ error: 'No vault' });
	}
	try {
		unlockVault(req.user.id, req.body.pin);
		vaultSessionService.clearPinFailures(req.user.id);
	} catch {
		vaultSessionService.recordPinFailure(req.user.id);
		return res.status(401).json({ error: 'Invalid PIN' });
	}
	return res.json({ data: { unlocked: true } });
});

router.post('/vault/reset-pin', (req, res) => {
	if (!isPin(req.body?.new_pin)) {
		return res.status(400).json(pinError);
	}
	if (!isValidWords(req.body?.words)) {
		return res.status(400).json({ error: 'Invalid recovery phrase' });
	}
	try {
		resetVaultPin(req.user.id, req.body.words, req.body.new_pin);
	} catch {
		// Same message for malformed and wrong words — no oracle.
		return res.status(400).json({ error: 'Invalid recovery phrase' });
	}
	return res.json({ data: { unlocked: true } });
});

router.post('/vault/lock', (req, res) => {
	vaultSessionService.lock(req.user.id);
	return res.json({ data: { unlocked: false } });
});

export default router;
