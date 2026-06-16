import { GoogleDriveAdapter } from '../adapters/GoogleDriveAdapter.js';
import { OneDriveAdapter } from '../adapters/OneDriveAdapter.js';
import { DropboxAdapter } from '../adapters/DropboxAdapter.js';
import { MegaAdapter } from '../adapters/MegaAdapter.js';
import { S3Adapter } from '../adapters/S3Adapter.js';
import { PCloudAdapter } from '../adapters/PCloudAdapter.js';
import { YandexAdapter } from '../adapters/YandexAdapter.js';

const adapters = {
	google_drive: GoogleDriveAdapter,
	onedrive: OneDriveAdapter,
	dropbox: DropboxAdapter,
	mega: MegaAdapter,
	s3: S3Adapter,
	pcloud: PCloudAdapter,
	yandex: YandexAdapter,
};

export function createAdapter(account) {
	const Adapter = adapters[account.provider];

	if (!Adapter) {
		throw new Error(`Unsupported provider: ${account.provider}`);
	}

	return new Adapter(account);
}

// Per-provider capability map, computed once from each adapter's own
// getCapabilities(). The adapter is the single source of truth for what a
// provider supports (starred/rename/delete); callers that only have a provider
// string (e.g. the local metadata mirror in fileService) read it from here
// instead of hardcoding provider-specific assumptions. getCapabilities() does
// not depend on instance/account state, so a throwaway instance is safe.
const capabilitiesByProvider = Object.fromEntries(
	Object.entries(adapters).map(([provider, Adapter]) => {
		const capabilities = new Adapter({ provider }).getCapabilities();
		return [provider, { starred: false, rename: false, delete: false, ...capabilities }];
	}),
);

const DEFAULT_CAPABILITIES = { starred: false, rename: false, delete: false };

export function getProviderCapabilities(provider) {
	return capabilitiesByProvider[provider] || DEFAULT_CAPABILITIES;
}
