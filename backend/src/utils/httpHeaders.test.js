import { describe, it, expect } from 'vitest';
import { contentDispositionHeader, parseRangeHeader } from './httpHeaders.js';

describe('contentDispositionHeader', () => {
	it('produces a simple ASCII filename for plain names', () => {
		const header = contentDispositionHeader('attachment', 'report.pdf');
		expect(header).toBe('attachment; filename="report.pdf"');
	});

	it('uses the inline disposition when requested', () => {
		expect(contentDispositionHeader('inline', 'a.txt')).toBe('inline; filename="a.txt"');
	});

	it('falls back to attachment for an unknown disposition', () => {
		expect(contentDispositionHeader('weird', 'a.txt')).toBe('attachment; filename="a.txt"');
	});

	it('adds an RFC 5987 extended form for non-ASCII (CJK) names', () => {
		const header = contentDispositionHeader('attachment', '报告.pdf');
		expect(header).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
		// The extended form must percent-encode the original name.
		expect(header).toContain(encodeURIComponent('报告.pdf').replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
	});

	it('adds an extended form for emoji names', () => {
		const header = contentDispositionHeader('attachment', '🎉party.png');
		expect(header).toMatch(/filename\*=UTF-8''/);
	});

	it('sanitizes quotes and backslashes out of the ASCII fallback (no header injection)', () => {
		const header = contentDispositionHeader('attachment', 'a"b\\c.txt');
		const asciiPart = header.match(/filename="([^"]*)"/)[1];
		expect(asciiPart).not.toContain('"');
		expect(asciiPart).not.toContain('\\');
	});

	it('strips control characters / CRLF (no response splitting)', () => {
		const header = contentDispositionHeader('attachment', 'a\r\nb.txt');
		expect(header).not.toMatch(/[\r\n]/);
	});

	it('never returns an empty filename', () => {
		expect(contentDispositionHeader('attachment', '')).toBe('attachment; filename="download"');
	});
});

describe('parseRangeHeader', () => {
	it('returns null when there is no range header', () => {
		expect(parseRangeHeader(undefined, 1000)).toBeNull();
		expect(parseRangeHeader('', 1000)).toBeNull();
	});

	it('returns null for an unknown/zero total size', () => {
		expect(parseRangeHeader('bytes=0-100', 0)).toBeNull();
		expect(parseRangeHeader('bytes=0-100', NaN)).toBeNull();
	});

	it('parses an explicit closed range', () => {
		expect(parseRangeHeader('bytes=0-1023', 5000)).toEqual({ start: 0, end: 1023, length: 1024 });
	});

	it('parses an open-ended range (start to EOF)', () => {
		expect(parseRangeHeader('bytes=1000-', 5000)).toEqual({ start: 1000, end: 4999, length: 4000 });
	});

	it('parses a suffix range (last N bytes)', () => {
		expect(parseRangeHeader('bytes=-500', 5000)).toEqual({ start: 4500, end: 4999, length: 500 });
	});

	it('clamps an end that exceeds the resource size', () => {
		expect(parseRangeHeader('bytes=4000-999999', 5000)).toEqual({ start: 4000, end: 4999, length: 1000 });
	});

	it('flags an unsatisfiable range whose start is beyond the size', () => {
		expect(parseRangeHeader('bytes=6000-7000', 5000)).toEqual({ unsatisfiable: true });
	});

	it('flags an unsatisfiable range where start > end', () => {
		expect(parseRangeHeader('bytes=200-100', 5000)).toEqual({ unsatisfiable: true });
	});

	it('returns null for a malformed or multi-range header', () => {
		expect(parseRangeHeader('items=0-100', 5000)).toBeNull();
		expect(parseRangeHeader('bytes=0-100,200-300', 5000)).toBeNull();
		expect(parseRangeHeader('bytes=-', 5000)).toBeNull();
	});

	it('ignores a non-positive suffix length', () => {
		expect(parseRangeHeader('bytes=-0', 5000)).toBeNull();
	});
});
