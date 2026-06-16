/**
 * Helpers for building HTTP response headers that must safely carry
 * provider-supplied, user-controlled values (e.g. file names from a cloud
 * account). Header values in Node may only contain latin1 characters and must
 * not contain control characters or a stray quote/backslash, otherwise
 * res.setHeader throws ERR_INVALID_CHAR. Cloud file names routinely contain
 * non-latin1 characters (CJK, Cyrillic, emoji) and quotes, so the raw name can
 * never be interpolated directly into a header.
 */

// Strip characters that would either corrupt the header or be rejected by Node:
// control chars, CR/LF (header injection), quotes and backslashes (which break
// the quoted-string form of the filename parameter).
function toAsciiFallback(fileName) {
	const cleaned = String(fileName || '')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\uffff]/g, '_')
		.replace(/["\\]/g, '_')
		.trim();
	return cleaned || 'download';
}

/**
 * Build an RFC 6266 / RFC 5987 compliant Content-Disposition header value.
 *
 * Produces a latin1-safe ASCII `filename="..."` for legacy/simple clients and,
 * when the original name contains characters outside that set, additionally
 * emits `filename*=UTF-8''<percent-encoded>` so modern clients recover the
 * exact original name. ASCII-only names yield the same simple header as before,
 * preserving existing behavior for the common case.
 *
 * @param {'attachment'|'inline'} disposition
 * @param {string} fileName
 * @returns {string}
 */
export function contentDispositionHeader(disposition, fileName) {
	const type = disposition === 'inline' ? 'inline' : 'attachment';
	const original = String(fileName || '');
	const asciiName = toAsciiFallback(original);

	const header = `${type}; filename="${asciiName}"`;

	// Only add the extended form when the original differs from the ASCII
	// fallback (i.e. it contained characters that needed sanitizing).
	if (original && original !== asciiName) {
		const encoded = encodeURIComponent(original).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
		return `${header}; filename*=UTF-8''${encoded}`;
	}

	return header;
}

/**
 * Parse a single-range HTTP `Range` header against a known total size.
 *
 * Supports the byte-range forms the browser media element and download managers
 * actually send:
 *   - `bytes=START-END`   explicit closed range
 *   - `bytes=START-`      from START to end of file
 *   - `bytes=-SUFFIX`     the last SUFFIX bytes
 *
 * Multi-range requests (comma-separated) are intentionally not supported; we
 * return null so the caller falls back to a normal 200 full-body response,
 * which is a valid choice per the spec.
 *
 * @param {string|undefined} rangeHeader Raw header value (e.g. "bytes=0-1023").
 * @param {number} totalSize Total resource size in bytes (must be a positive finite number).
 * @returns {{ start: number, end: number, length: number } | null | { unsatisfiable: true }}
 *   - A range object when a satisfiable single range was parsed.
 *   - `{ unsatisfiable: true }` when the range is syntactically valid but lies
 *     outside the resource (caller should respond 416).
 *   - `null` when there is no usable range (no header, malformed, multi-range,
 *     or unknown total size) and the caller should serve the full body.
 */
export function parseRangeHeader(rangeHeader, totalSize) {
	const size = Number(totalSize);
	if (!rangeHeader || !Number.isFinite(size) || size <= 0) {
		return null;
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
	if (!match) {
		// Malformed or multi-range — let the caller serve the full body.
		return null;
	}

	const startRaw = match[1];
	const endRaw = match[2];

	if (startRaw === '' && endRaw === '') {
		return null;
	}

	let start;
	let end;

	if (startRaw === '') {
		// Suffix range: last N bytes.
		const suffixLength = Number(endRaw);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
			return null;
		}
		start = Math.max(0, size - suffixLength);
		end = size - 1;
	} else {
		start = Number(startRaw);
		end = endRaw === '' ? size - 1 : Number(endRaw);
	}

	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
		return { unsatisfiable: true };
	}

	if (start >= size) {
		return { unsatisfiable: true };
	}

	// Clamp the end to the last valid byte.
	end = Math.min(end, size - 1);

	return { start, end, length: end - start + 1 };
}
