const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL
	|| API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '/ws/uploads');

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
		const payload = await response.json().catch(() => ({ error: 'Unknown API error' }));
		const error = new Error(payload.error || 'API request failed');
		error.status = response.status;
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
			body: formData,
			signal: options.signal,
		});

		if (!response.ok) {
			const payload = await response.json().catch(() => ({ error: 'Upload failed' }));
			throw new Error(payload.error || 'Upload failed');
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
	getVaultStatus() {
		return request('/vault/status');
	},
	setupVault(pin) {
		return request('/vault/setup', {
			method: 'POST',
			body: JSON.stringify({ pin }),
		});
	},
	unlockVault(pin) {
		return request('/vault/unlock', {
			method: 'POST',
			body: JSON.stringify({ pin }),
		});
	},
	resetVaultPin(words, new_pin) {
		return request('/vault/reset-pin', {
			method: 'POST',
			body: JSON.stringify({ words, new_pin }),
		});
	},
	lockVault() {
		return request('/vault/lock', { method: 'POST' });
	},
	listHiddenFiles() {
		return request('/files?hidden=1');
	},
};
