import { describe, it, expect } from 'vitest';
import { getProviderCapabilities } from './adapterRegistry.js';

describe('getProviderCapabilities', () => {
	it('reports Google Drive as supporting starred (from the adapter, not a hardcode)', () => {
		const caps = getProviderCapabilities('google_drive');
		expect(caps.starred).toBe(true);
		expect(caps.rename).toBe(true);
		expect(caps.delete).toBe(true);
	});

	it('reports providers without starred support as starred:false', () => {
		// OneDrive, Dropbox, S3, etc. do not implement provider-side starring.
		expect(getProviderCapabilities('onedrive').starred).toBe(false);
		expect(getProviderCapabilities('s3').starred).toBe(false);
	});

	it('returns a safe default for an unknown provider', () => {
		expect(getProviderCapabilities('does_not_exist')).toEqual({
			starred: false,
			rename: false,
			delete: false,
		});
	});

	it('always returns the three capability flags for every known provider', () => {
		for (const provider of ['google_drive', 'onedrive', 'dropbox', 'mega', 's3', 'pcloud', 'yandex']) {
			const caps = getProviderCapabilities(provider);
			expect(caps).toHaveProperty('starred');
			expect(caps).toHaveProperty('rename');
			expect(caps).toHaveProperty('delete');
		}
	});
});
