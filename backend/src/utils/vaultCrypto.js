import crypto from 'crypto';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// scrypt params: N=2^18 (~0.3-0.5 s, 256 MiB) — strong enough that a 6-digit PIN
// is expensive to brute-force offline. Node's default maxmem (32 MiB) would throw.
const SCRYPT_N = 1 << 18;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 512 * 1024 * 1024;

// Purpose labels give the HMAC/AAD domain separation: a blob encrypted for one
// purpose can never be accepted where another is expected.
const WRAP_LABEL = 'omnicloud:vault:wrap:v1';
const META_LABEL = 'omnicloud:vault:meta:v1';
const RECOVERY_LABEL = 'omnicloud:vault:recovery:v1';

export const generateVaultKey = () => crypto.randomBytes(32);
export const generateWords = () => generateMnemonic(wordlist, 128); // 12 words, 128-bit

function toPhrase(words) {
	const phrase = Array.isArray(words)
		? words.filter(Boolean).join(' ')
		: String(words || '');
	// BIP-39 wordlists are lowercase — normalize typed recovery words.
	return phrase.trim().toLowerCase();
}

export function isValidWords(words) {
	return validateMnemonic(toPhrase(words), wordlist);
}

// The 12-word phrase is the recovery secret: mnemonic -> 64-byte seed (PBKDF2,
// deterministic) -> HMAC -> 32-byte recovery key. Same words always -> same key.
export function deriveRecoveryKey(words) {
	return crypto
		.createHmac('sha256', Buffer.from(mnemonicToSeedSync(toPhrase(words))))
		.update(RECOVERY_LABEL)
		.digest();
}

export function derivePinKey(pin, salt) {
	return crypto.scryptSync(String(pin), salt, 32, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		maxmem: SCRYPT_MAXMEM,
	});
}

// Sub-keys derived from the vault KEK, one per purpose.
export const kekWrap = (kek) => crypto.createHmac('sha256', kek).update(WRAP_LABEL).digest();
export const kekMeta = (kek) => crypto.createHmac('sha256', kek).update(META_LABEL).digest();

// base64(iv[12] || authTag[16] || ciphertext) — same layout as crypto.js.
export function aesGcmEncrypt(key, plaintext, aad) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	if (aad) cipher.setAAD(Buffer.from(aad));
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function aesGcmDecrypt(key, blob, aad) {
	const raw = Buffer.from(blob, 'base64');
	const iv = raw.subarray(0, 12);
	const authTag = raw.subarray(12, 28);
	const encrypted = raw.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	if (aad) decipher.setAAD(Buffer.from(aad));
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export const encryptMeta = (meta, metaKey) =>
	aesGcmEncrypt(metaKey, Buffer.from(JSON.stringify(meta), 'utf8'), META_LABEL);

export function decryptMeta(blob, metaKey) {
	const decrypted = aesGcmDecrypt(metaKey, blob, META_LABEL).toString('utf8');
	return JSON.parse(decrypted);
}
