import crypto from 'crypto';
import { Transform } from 'stream';
import { env } from '../config/env.js';

export const CHUNK_SIZE = 1024 * 1024;
export const HEADER_SIZE = 20;
export const ENCRYPTED_MAGIC = 'OMNICLD1';

// Per-chunk overhead: 12-byte IV + 16-byte GCM auth tag.
const PER_CHUNK_OVERHEAD = 28;

function indexBuffer(index) {
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(BigInt(index));
	return buffer;
}

/**
 * Deterministic ciphertext size for a given plaintext size.
 * Format: 20-byte header + for each chunk (iv[12] || tag[16] || ciphertext).
 * This is computed BEFORE streaming so adapters that set Content-Length or
 * reserve space (OneDrive, S3 multipart, MEGA, pCloud) get a correct size.
 */
export function ciphertextSize(plaintextSize, chunkSize = CHUNK_SIZE) {
	const plain = Number(plaintextSize);
	if (!Number.isFinite(plain) || plain < 0) {
		throw new TypeError('plaintextSize must be a non-negative number');
	}
	if (plain === 0) return HEADER_SIZE;
	const chunks = Math.ceil(plain / chunkSize);
	return HEADER_SIZE + plain + chunks * PER_CHUNK_OVERHEAD;
}

export function generateDataKey() {
	return crypto.randomBytes(32);
}

// Wrap the per-file Data Encryption Key under a KEK. Defaults to the server
// master key (env.encryptionKey) for legacy usage; the vault passes kekWrap(KEK).
// Layout matches crypto.js: base64(iv[12] || authTag[16] || ciphertext).
export function wrapDataKey(dataKey, kek = env.encryptionKey) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
	const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function unwrapDataKey(value, kek = env.encryptionKey) {
	const raw = Buffer.from(value, 'base64');
	const iv = raw.subarray(0, 12);
	const authTag = raw.subarray(12, 28);
	const encrypted = raw.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function encryptBlock(dataKey, block, index) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
	// AAD = chunk index binds each chunk to its position (blocks reordering).
	cipher.setAAD(indexBuffer(index));
	const encrypted = Buffer.concat([cipher.update(block), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Streaming plaintext -> ciphertext.
 * Emits the 20-byte header once, then per-chunk frames (iv | tag | ciphertext).
 * Empty input produces exactly the 20-byte header (ciphertextSize(0) === 20).
 */
export function createEncryptStream(dataKey, plaintextSize, chunkSize = CHUNK_SIZE) {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write(ENCRYPTED_MAGIC, 0, 'utf8');
	header.writeUInt32BE(chunkSize, 8);
	header.writeBigUInt64BE(BigInt(plaintextSize), 12);

	let headerWritten = false;
	let buffered = Buffer.alloc(0);
	let chunkIndex = 0;

	return new Transform({
		transform(chunk, _encoding, callback) {
			buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
			const out = [];
			if (!headerWritten) {
				out.push(header);
				headerWritten = true;
			}
			while (buffered.length >= chunkSize) {
				const block = buffered.subarray(0, chunkSize);
				buffered = Buffer.from(buffered.subarray(chunkSize));
				out.push(encryptBlock(dataKey, block, chunkIndex));
				chunkIndex += 1;
			}
			callback(null, Buffer.concat(out));
		},
		flush(callback) {
			const out = [];
			if (!headerWritten) {
				out.push(header);
				headerWritten = true;
			}
			if (buffered.length) {
				out.push(encryptBlock(dataKey, buffered, chunkIndex));
				buffered = Buffer.alloc(0);
			}
			callback(null, Buffer.concat(out));
		},
	});
}

/**
 * Streaming ciphertext -> plaintext.
 * Reads chunkSize/plaintextSize from the header; verifies every chunk's auth tag
 * (wrong key / tampering -> throws) and errors on truncation or trailing bytes.
 */
export function createDecryptStream(dataKey) {
	let headerParsed = false;
	let buffered = Buffer.alloc(0);
	let chunkSize = CHUNK_SIZE;
	let remaining = 0;
	let chunkIndex = 0;

	const parseHeader = () => {
		if (buffered.length < HEADER_SIZE) return false;
		const header = buffered.subarray(0, HEADER_SIZE);
		if (header.subarray(0, ENCRYPTED_MAGIC.length).toString('utf8') !== ENCRYPTED_MAGIC) {
			throw new Error('Not an OmniCloud encrypted file (bad magic)');
		}
		chunkSize = header.readUInt32BE(8);
		remaining = Number(header.readBigUInt64BE(12));
		buffered = Buffer.from(buffered.subarray(HEADER_SIZE));
		headerParsed = true;
		return true;
	};

	return new Transform({
		transform(chunk, _encoding, callback) {
			try {
				buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
				if (!headerParsed) {
					if (!parseHeader()) {
						callback(null);
						return;
					}
				}
				const out = [];
				while (buffered.length > 0 && remaining > 0) {
					const blockLen = Math.min(chunkSize, remaining);
					const frameLen = PER_CHUNK_OVERHEAD + blockLen;
					if (buffered.length < frameLen) break;
					const frame = buffered.subarray(0, frameLen);
					buffered = Buffer.from(buffered.subarray(frameLen));
					const iv = frame.subarray(0, 12);
					const authTag = frame.subarray(12, PER_CHUNK_OVERHEAD);
					const encrypted = frame.subarray(PER_CHUNK_OVERHEAD);
					const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, iv);
					decipher.setAAD(indexBuffer(chunkIndex));
					decipher.setAuthTag(authTag);
					out.push(Buffer.concat([decipher.update(encrypted), decipher.final()]));
					remaining -= blockLen;
					chunkIndex += 1;
				}
				callback(null, Buffer.concat(out));
			} catch (error) {
				callback(error);
			}
		},
		flush(callback) {
			try {
				if (!headerParsed && buffered.length) {
					callback(new Error('Truncated encrypted file: missing header'));
					return;
				}
				if (remaining !== 0) {
					callback(new Error('Truncated encrypted file'));
					return;
				}
				if (buffered.length > 0) {
					callback(new Error('Trailing data after encrypted file'));
					return;
				}
				callback();
			} catch (error) {
				callback(error);
			}
		},
	});
}
