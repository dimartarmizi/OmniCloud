import { Readable } from 'stream';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { decryptJson } from '../utils/crypto.js';
import { updateAccountCredentials } from '../services/accountService.js';

const API_BASE = 'https://cloud-api.yandex.net/v1/disk';

function normalizeVirtualPath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function resourcePathToVirtual(resourcePath = '') {
	const clean = resourcePath.replace(/^disk:/, '');
	const trimmed = clean.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	if (lastSlash <= 0) return '/';
	return `${trimmed.slice(0, lastSlash)}/`;
}

function joinPath(parent = '/', name = '') {
	const base = parent === '/' ? '' : parent.replace(/\/+$/, '');
	return `${base}/${name}`;
}

export class YandexAdapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.tokenCache = null;
	}

	readCredentials() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		if (!credentials.accessToken && !credentials.refreshToken) {
			throw new Error('Yandex account credentials are incomplete');
		}
		return credentials;
	}

	async getAccessToken(forceRefresh = false) {
		const credentials = this.readCredentials();

		if (!forceRefresh && this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
			return this.tokenCache.token;
		}

		if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
			this.tokenCache = { token: credentials.accessToken, expiresAt: Date.now() + 3_600_000 };
			return credentials.accessToken;
		}

		if (!forceRefresh && credentials.accessToken && !this.tokenCache) {
			this.tokenCache = { token: credentials.accessToken, expiresAt: Date.now() + 60_000 };
			return credentials.accessToken;
		}

		const response = await fetch('https://oauth.yandex.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: credentials.refreshToken,
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
			}),
		});

		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.access_token) {
			throw new Error(payload?.error_description || payload?.error || 'Failed to refresh Yandex access token');
		}

		this.tokenCache = {
			token: payload.access_token,
			expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
		};

		try {
			updateAccountCredentials(this.account.user_id, this.account.id, {
				...credentials,
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token || credentials.refreshToken,
			});
		} catch {
			// Ignore errors from updating credentials; the new token is already in memory and will be used.
		}

		return this.tokenCache.token;
	}

	async request(path, { method = 'GET', query = {}, raw = false } = {}) {
		const makeRequest = async (token) => {
			const url = new URL(`${API_BASE}${path}`);
			Object.entries(query).forEach(([key, value]) => {
				if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
			});

			const response = await fetch(url.toString(), {
				method,
				headers: { Authorization: `OAuth ${token}` },
			});

			if (raw) return response;

			if (response.status === 204) return {};
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				const error = new Error(payload?.message || payload?.description || 'Yandex API request failed');
				error.status = response.status;
				throw error;
			}
			return payload;
		};

		let token = await this.getAccessToken();
		try {
			return await makeRequest(token);
		} catch (error) {
			if (error?.status !== 401) throw error;
			token = await this.getAccessToken(true);
			return makeRequest(token);
		}
	}

	async fetchStructure() {
		const records = [];
		const queue = ['/'];

		while (queue.length) {
			const current = queue.shift();
			let offset = 0;
			const limit = 200;

			while (true) {
				const payload = await this.request('/resources', {
					query: { path: current, limit, offset, sort: 'name' },
				});
				const items = payload?._embedded?.items || [];

				for (const item of items) {
					const isFolder = item.type === 'dir';
					const virtualPath = normalizeVirtualPath(resourcePathToVirtual(item.path));
					records.push({
						virtual_path: virtualPath,
						file_name: item.name,
						is_folder: isFolder,
						size: isFolder ? 0 : Number(item.size || 0),
						mime_type: isFolder ? null : item.mime_type || 'application/octet-stream',
						remote_file_id: item.path.replace(/^disk:/, ''),
						remote_parent_id: virtualPath,
						remote_created_time: item.created || null,
						remote_modified_time: item.modified || null,
					});

					if (isFolder) {
						queue.push(item.path.replace(/^disk:/, ''));
					}
				}

				if (items.length < limit) break;
				offset += limit;
			}
		}

		return records;
	}

	async getStorageSummary() {
		const payload = await this.request('/');
		return {
			totalSpace: Number(payload.total_space || this.account.total_space || 0),
			usedSpace: Number(payload.used_space || this.account.used_space || 0),
		};
	}

	async ensureFolder(virtualPath = '/') {
		const normalized = normalizeVirtualPath(virtualPath);
		if (normalized === '/') return;

		const segments = normalized.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = `${current}/${segment}`;
			try {
				await this.request('/resources', { method: 'PUT', query: { path: current } });
			} catch (error) {
				if (error?.status !== 409) throw error;
			}
		}
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', onProgress }) {
		await this.ensureFolder(virtualPath);
		const normalized = normalizeVirtualPath(virtualPath);
		const targetPath = joinPath(normalized === '/' ? '' : normalized.replace(/\/+$/, ''), fileName);

		const uploadInfo = await this.request('/resources/upload', {
			query: { path: targetPath, overwrite: 'true' },
		});
		if (!uploadInfo?.href) {
			throw new Error('Yandex did not return an upload URL');
		}

		const progressStream = this.createProgressStream(onProgress);
		const response = await fetch(uploadInfo.href, {
			method: uploadInfo.method || 'PUT',
			headers: {
				'Content-Type': mimeType || 'application/octet-stream',
				...(size ? { 'Content-Length': String(size) } : {}),
			},
			body: stream.pipe(progressStream),
			duplex: 'half',
		});

		if (!response.ok && response.status !== 201 && response.status !== 202) {
			throw new Error('Failed to upload file to Yandex Disk');
		}

		return {
			remoteFileId: targetPath,
			remoteParentId: normalized,
			size: Number(size || 0),
			fileName,
			mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/' }) {
		const normalized = normalizeVirtualPath(virtualPath);
		const base = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
		const path = `${base}/${name}`;
		await this.ensureFolder(virtualPath);
		try {
			await this.request('/resources', { method: 'PUT', query: { path } });
		} catch (error) {
			if (error?.status !== 409) throw error;
		}

		return {
			remoteFileId: path,
			remoteParentId: normalized,
			fileName: name,
		};
	}

	resolvePath(fileRecord) {
		return fileRecord.remote_file_id || joinPath(
			fileRecord.virtual_path === '/' ? '' : normalizeVirtualPath(fileRecord.virtual_path).replace(/\/+$/, ''),
			fileRecord.file_name,
		);
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const info = await this.request('/resources/download', {
			query: { path: this.resolvePath(fileRecord) },
		});
		if (!info?.href) {
			throw new Error('Yandex did not return a download URL');
		}

		const response = await fetch(info.href, {
			...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
		});
		if ((!response.ok && response.status !== 206) || !response.body) {
			throw new Error('Failed to download file from Yandex Disk');
		}
		return Readable.fromWeb(response.body);
	}

	async renameFile(fileRecord, nextName) {
		const from = this.resolvePath(fileRecord);
		const normalized = normalizeVirtualPath(fileRecord.virtual_path);
		const base = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
		const to = `${base}/${nextName}`;
		await this.request('/resources/move', {
			method: 'POST',
			query: { from, path: to, overwrite: 'false' },
		});
	}

	async deleteFile(fileRecord) {
		await this.request('/resources', {
			method: 'DELETE',
			query: { path: this.resolvePath(fileRecord), permanently: 'false' },
		});
	}

	async moveFile(fileRecord, targetVirtualPath) {
		await this.ensureFolder(targetVirtualPath);
		const from = this.resolvePath(fileRecord);
		const normalized = normalizeVirtualPath(targetVirtualPath);
		const base = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
		const to = `${base}/${fileRecord.file_name}`;
		await this.request('/resources/move', {
			method: 'POST',
			query: { from, path: to, overwrite: 'false' },
		});
		return { remoteFileId: to, remoteParentId: normalized };
	}

	async getFileDetails(fileRecord) {
		return {
			name: fileRecord.file_name,
			mime_type: fileRecord.mime_type,
			size: Number(fileRecord.size || 0),
			createdTime: fileRecord.remote_created_time,
			modifiedTime: fileRecord.remote_modified_time,
			webViewLink: null,
			owner_email: this.account.email,
			remote_parent_id: fileRecord.virtual_path,
			provider: 'yandex',
		};
	}
}
