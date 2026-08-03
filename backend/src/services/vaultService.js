import crypto from 'crypto';
import { db } from '../config/database.js';
import {
	generateVaultKey,
	generateWords,
	derivePinKey,
	deriveRecoveryKey,
	aesGcmEncrypt,
	aesGcmDecrypt,
} from '../utils/vaultCrypto.js';
import * as vaultSessionService from './vaultSessionService.js';
import { migrateLegacyHiddenFiles } from './hiddenFileService.js';

export function getVault(userId) {
	return db.prepare('SELECT * FROM vault WHERE user_id = ?').get(userId);
}

// Creates the vault: generates the KEK + 12-word recovery phrase, stores only
// PIN-wrapped and seed-wrapped copies of the KEK (never plaintext), and unlocks.
// Returns the words — shown to the user exactly once, never stored.
export function createVault(userId, pin) {
	if (getVault(userId)) throw new Error('Vault already exists');

	const kek = generateVaultKey();
	const words = generateWords();
	const saltPin = crypto.randomBytes(16);
	const saltSeed = crypto.randomBytes(16);

	db.prepare(`
    INSERT INTO vault (user_id, salt_pin, kek_wrapped_by_pin, salt_seed, kek_wrapped_by_seed)
    VALUES (?, ?, ?, ?, ?)
  `).run(
		userId,
		saltPin.toString('base64'),
		aesGcmEncrypt(derivePinKey(pin, saltPin), kek),
		saltSeed.toString('base64'),
		aesGcmEncrypt(deriveRecoveryKey(words), kek),
	);

	vaultSessionService.setSession(userId, kek);

	// Re-key any legacy hidden files (pre-vault server-key format) under this
	// vault's KEK so they appear in the Hidden section after setup.
	migrateLegacyHiddenFiles(userId, kek);

	return words;
}

// Throws on wrong PIN (GCM auth failure) — the caller maps that to 401/attempt-tracking.
export function unlockVault(userId, pin) {
	const vault = getVault(userId);
	if (!vault) throw new Error('No vault');
	const salt = Buffer.from(vault.salt_pin, 'base64');
	const kek = aesGcmDecrypt(derivePinKey(pin, salt), vault.kek_wrapped_by_pin);
	vaultSessionService.setSession(userId, kek);
}

// Throws on wrong words. Re-wraps the SAME KEK under a new PIN, so existing
// hidden files stay readable (their DEKs/enc_meta are under the unchanged KEK).
export function resetVaultPin(userId, words, newPin) {
	const vault = getVault(userId);
	if (!vault) throw new Error('No vault');
	const kek = aesGcmDecrypt(deriveRecoveryKey(words), vault.kek_wrapped_by_seed);

	const saltPin = crypto.randomBytes(16);
	db.prepare(`
    UPDATE vault
    SET salt_pin = ?, kek_wrapped_by_pin = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(
		saltPin.toString('base64'),
		aesGcmEncrypt(derivePinKey(newPin, saltPin), kek),
		userId,
	);

	vaultSessionService.setSession(userId, kek); // auto-unlock after reset
}
