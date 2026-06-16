const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787/api';

const UPLOAD_WS_PATH = '/ws/uploads';

// Resolve the upload WebSocket endpoint. The server mounts the socket at
// `/ws/uploads`, so an explicit VITE_WS_BASE_URL that only provides an origin
// (e.g. `ws://localhost:8787`, as documented in .env.example) must still be
// pointed at that path — otherwise the handshake never reaches the handler and
// upload progress silently stops.
function resolveUploadSocketUrl() {
	const explicit = import.meta.env.VITE_WS_BASE_URL;
	if (explicit) {
		const trimmed = explicit.replace(/\/+$/, '');
		return trimmed.includes(UPLOAD_WS_PATH) ? trimmed : `${trimmed}${UPLOAD_WS_PATH}`;
	}

	return API_BASE_URL.replace(/^http/, 'ws').replace(/\/api(\/.*)?$/, UPLOAD_WS_PATH);
}

const WS_BASE_URL = resolveUploadSocketUrl();

// Optional hook invoked when any API call returns 401 in hosted mode. The auth
// store registers this on bootstrap so a session that expires mid-use resets
// app state and redirects to /login, instead of surfacing scattered per-call
// error banners. Kept as a setter (not an import) to avoid a circular
// dependency between the api layer and the Pinia store/router.
let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
	unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

// Unpack the standard error envelope { data: null, error: { code, message }, meta }.
// Falls back gracefully to a legacy string `error` or a generic message, and
// preserves the machine-readable `code` and correlation `requestId` on the
// thrown Error for callers that want to branch on them.
function toApiError(payload, status) {
	const envelope = payload?.error;
	let message = 'API request failed';
	let code = null;

	if (envelope && typeof envelope === 'object') {
		message = envelope.message || message;
		code = envelope.code || null;
	} else if (typeof envelope === 'string') {
		message = envelope;
	}

	const error = new Error(message);
	error.status = status;
	error.code = code;
	error.requestId = payload?.meta?.requestId || null;
	return error;
}

async function request(path, options = {}) {
	const response = await fetch(`${API_BASE_URL}${path}`, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
		...options,
	});

	if (!response.ok) {
		const payload = await response.json().catch(() => null);
		const error = toApiError(payload, response.status);
		// A 401 means the session is gone/expired. Notify the registered handler
		// once so the app can reset auth and route to login centrally, rather than
		// every caller having to special-case it.
		if (response.status === 401 && unauthorizedHandler) {
			unauthorizedHandler();
		}
		throw error;
	}

	return response.json();
}

export const authApi = {
	me() {
		return request('/auth/me');
	},
	login(payload) {
		return request('/auth/login', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	register(payload) {
		return request('/auth/register', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	logout() {
		return request('/auth/logout', {
			method: 'POST',
		});
	},
	changePassword(payload) {
		return request('/auth/change-password', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	deleteAccount(payload) {
		return request('/auth/delete-account', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
};

export const settingsApi = {
	getSettings() {
		return request('/settings');
	},
	updateSettings(payload) {
		return request('/settings', {
			method: 'PATCH',
			body: JSON.stringify(payload),
		});
	},
};

export const api = {
	listFiles(virtualPath = '/') {
		const query = new URLSearchParams({ path: virtualPath }).toString();
		return request(`/files?${query}`);
	},
	searchFiles(term, limit = 50) {
		const query = new URLSearchParams({ search: term, limit: String(limit) }).toString();
		return request(`/files?${query}`);
	},
	listStarredFiles() {
		return request('/files?starred=1');
	},
	listRecentFiles() {
		return request('/files?recent=1');
	},
	listSharedWithMeFiles() {
		return request('/files?shared=1');
	},
	listSharedFolderChildren(fileId) {
		return request(`/files/${fileId}/shared-children`);
	},
	getFileDetails(fileId) {
		return request(`/files/${fileId}`);
	},
	createFolder(payload) {
		return request('/files/folders', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	renameFile(fileId, payload) {
		return request(`/files/${fileId}/rename`, {
			method: 'PATCH',
			body: JSON.stringify(payload),
		});
	},
	moveFile(fileId, targetPath) {
		return request(`/files/${fileId}/move`, {
			method: 'PATCH',
			body: JSON.stringify({ target_path: targetPath }),
		});
	},
	toggleStar(fileId, isStarred = true) {
		return request(`/files/${fileId}/star`, {
			method: 'PATCH',
			body: JSON.stringify({ is_starred: isStarred }),
		});
	},
	deleteFile(fileId) {
		return request(`/files/${fileId}`, {
			method: 'DELETE',
		});
	},
	deleteFiles(fileIds) {
		return request('/files/bulk/delete', {
			method: 'POST',
			body: JSON.stringify({ ids: fileIds }),
		});
	},
	getGoogleIntegrationStatus() {
		return request('/accounts/google/status');
	},
	getGoogleConnectUrl() {
		return request('/accounts/google/connect');
	},
	getOneDriveIntegrationStatus() {
		return request('/accounts/onedrive/status');
	},
	getOneDriveConnectUrl() {
		return request('/accounts/onedrive/connect');
	},
	getDropboxIntegrationStatus() {
		return request('/accounts/dropbox/status');
	},
	getDropboxConnectUrl() {
		return request('/accounts/dropbox/connect');
	},
	getMegaIntegrationStatus() {
		return request('/accounts/mega/status');
	},
	connectMegaAccount(payload) {
		return request('/accounts/mega/connect', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	connectS3Account(payload) {
		return request('/accounts/s3/connect', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	connectPCloudAccount(payload) {
		return request('/accounts/pcloud/connect', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	getYandexConnectUrl() {
		return request('/accounts/yandex/connect');
	},
	listAccounts() {
		return request('/accounts');
	},
	disconnectAccount(accountId) {
		return request(`/accounts/${accountId}`, {
			method: 'DELETE',
		});
	},
	getHealth() {
		return request('/health');
	},
	getSyncStatus() {
		return request('/health/sync');
	},
	runSync() {
		return request('/sync/run', {
			method: 'POST',
		});
	},
	initiateUpload(payload, options = {}) {
		return request('/uploads/initiate', {
			method: 'POST',
			body: JSON.stringify(payload),
			signal: options.signal,
		});
	},
	async uploadFile(uploadId, file, options = {}) {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(`${API_BASE_URL}/uploads/${uploadId}/stream`, {
			method: 'POST',
			credentials: 'include',
			headers: options.token ? { 'X-Upload-Token': options.token } : {},
			body: formData,
			signal: options.signal,
		});

		if (!response.ok) {
			const payload = await response.json().catch(() => null);
			throw toApiError(payload, response.status);
		}

		return response.json();
	},
	createUploadSocket(uploadId) {
		return new WebSocket(`${WS_BASE_URL}?uploadId=${encodeURIComponent(uploadId)}`);
	},
	downloadUrl(fileId) {
		return `${API_BASE_URL}/files/${fileId}/download`;
	},
	previewUrl(fileId) {
		return `${API_BASE_URL}/files/${fileId}/preview`;
	},
	getSettings() {
		return settingsApi.getSettings();
	},
	updateSettings(payload) {
		return settingsApi.updateSettings(payload);
	},
	getAllocation() {
		return request('/allocation');
	},
	updateAllocation(payload) {
		return request('/allocation', {
			method: 'PATCH',
			body: JSON.stringify(payload),
		});
	},
};
