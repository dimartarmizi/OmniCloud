import { Readable } from 'stream';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { guessMimeType } from '../utils/mime.js';
import { decryptJson } from '../utils/crypto.js';

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function joinDropboxPath(parentPath = '/', name = '') {
	const normalizedParent = parentPath === '/' ? '' : parentPath.replace(/\/+$/g, '');
	return `${normalizedParent}/${name}`;
}

function toVirtualPath(dropboxPath = '') {
	if (!dropboxPath || dropboxPath === '/') return '/';
	const withSlashes = dropboxPath.startsWith('/') ? dropboxPath : `/${dropboxPath}`;
	const parent = withSlashes.slice(0, withSlashes.lastIndexOf('/') + 1);
	return normalizePath(parent || '/');
}

function parseDropboxError(payload, fallback) {
	if (!payload) return fallback;
	if (typeof payload === 'string') return payload;
	return payload.error_summary || payload.error?.['.tag'] || payload.message || fallback;
}

async function parseDropboxContentErrorResponse(response, fallback) {
	const raw = await response.text().catch(() => '');
	if (!raw) {
		return fallback;
	}

	try {
		const parsed = JSON.parse(raw);
		return parseDropboxError(parsed, fallback);
	} catch {
		return raw;
	}
}

export class DropboxAdapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.accessTokenCache = null;
	}

	readCredentials() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
			throw new Error('Dropbox account credentials are incomplete');
		}
		return credentials;
	}

	async createAccessToken(forceRefresh = false) {
		if (!forceRefresh && this.accessTokenCache && this.accessTokenCache.expiresAt > Date.now() + 30_000) {
			return this.accessTokenCache.token;
		}

		const credentials = this.readCredentials();
		const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
				refresh_token: credentials.refreshToken,
				grant_type: 'refresh_token',
			}),
		});

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(parseDropboxError(payload, 'Failed to refresh Dropbox access token'));
		}

		this.accessTokenCache = {
			token: payload.access_token,
			expiresAt: Date.now() + Number(payload.expires_in || 14400) * 1000,
		};

		return this.accessTokenCache.token;
	}

	async rpc(path, body = {}) {
		return this.requestWithReauth(async (accessToken) => {
			const response = await fetch(`https://api.dropboxapi.com/2${path}`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				const error = new Error(parseDropboxError(payload, 'Dropbox API request failed'));
				error.status = response.status;
				throw error;
			}

			return payload;
		});
	}

	async requestWithReauth(makeRequest) {
		let accessToken = await this.createAccessToken();
		try {
			return await makeRequest(accessToken);
		} catch (error) {
			if (error?.status !== 401) {
				throw error;
			}
			accessToken = await this.createAccessToken(true);
			return makeRequest(accessToken);
		}
	}

	async content(path, { args, body, contentType = 'application/octet-stream', headers = {} } = {}) {
		return this.requestWithReauth(async (accessToken) => {
			const response = await fetch(`https://content.dropboxapi.com/2${path}`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Dropbox-API-Arg': JSON.stringify(args),
					...(contentType ? { 'Content-Type': contentType } : {}),
					...headers,
				},
				body,
				...(body ? { duplex: 'half' } : {}),
			});

			if (!response.ok && response.status === 401) {
				const error = new Error('Dropbox content request unauthorized');
				error.status = response.status;
				throw error;
			}

			return response;
		});
	}

	async listFolder(path = '', recursive = true) {
		const entries = [];
		let payload = await this.rpc('/files/list_folder', {
			path,
			recursive,
			include_deleted: false,
			include_has_explicit_shared_members: false,
			include_mounted_folders: true,
			include_non_downloadable_files: true,
		});

		entries.push(...(payload.entries || []));

		while (payload.has_more) {
			payload = await this.rpc('/files/list_folder/continue', { cursor: payload.cursor });
			entries.push(...(payload.entries || []));
		}

		return entries;
	}

	async ensureRemotePath(virtualPath = '/') {
		const normalizedPath = normalizePath(virtualPath);
		if (normalizedPath === '/') return '';

		const segments = normalizedPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let currentPath = '';

		for (const segment of segments) {
			currentPath = joinDropboxPath(currentPath || '/', segment);
			try {
				await this.rpc('/files/get_metadata', { path: currentPath });
			} catch (error) {
				if (!error.message.includes('not_found')) throw error;
				await this.rpc('/files/create_folder_v2', {
					path: currentPath,
					autorename: false,
				});
			}
		}

		return currentPath;
	}

	async fetchStructure() {
		const entries = await this.listFolder('', true);

		return entries
			.filter((entry) => entry['.tag'] === 'file' || entry['.tag'] === 'folder')
			.map((entry) => {
				const isFolder = entry['.tag'] === 'folder';
				return {
					virtual_path: toVirtualPath(entry.path_display || entry.path_lower),
					file_name: entry.name,
					is_folder: isFolder,
					size: isFolder ? 0 : Number(entry.size || 0),
					mime_type: isFolder ? null : guessMimeType(entry.name),
					remote_file_id: entry.id || entry.path_lower,
					remote_parent_id: toVirtualPath(entry.path_display || entry.path_lower),
					remote_created_time: null,
					remote_modified_time: isFolder ? null : entry.server_modified || null,
				};
			});
	}

	async getStorageSummary() {
		const payload = await this.rpc('/users/get_space_usage', {});
		const allocation = payload.allocation || {};
		const totalSpace = allocation.allocated || allocation.individual?.allocated || allocation.team?.allocated || this.account.total_space || 0;

		return {
			totalSpace: Number(totalSpace || 0),
			usedSpace: Number(payload.used || this.account.used_space || 0),
		};
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', onProgress }) {
		const parentPath = await this.ensureRemotePath(virtualPath);
		const targetPath = joinDropboxPath(parentPath || '/', fileName);
		const progressStream = this.createProgressStream(onProgress);
		const response = await this.content('/files/upload', {
			args: {
				path: targetPath,
				mode: 'add',
				autorename: true,
				mute: false,
				strict_conflict: false,
			},
			body: stream.pipe(progressStream),
			contentType: 'application/octet-stream',
		});

		const errorResponse = response.ok ? null : response.clone();
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			const message = payload
				? parseDropboxError(payload, 'Failed to upload file to Dropbox')
				: await parseDropboxContentErrorResponse(errorResponse, 'Failed to upload file to Dropbox');
			const error = new Error(message);
			error.status = response.status;
			throw error;
		}

		return {
			remoteFileId: payload.id || payload.path_lower,
			remoteParentId: parentPath || '/',
			size: Number(payload.size || size || 0),
			fileName: payload.name || fileName,
			mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/' }) {
		const parentPath = await this.ensureRemotePath(virtualPath);
		const folderPath = joinDropboxPath(parentPath || '/', name);
		const payload = await this.rpc('/files/create_folder_v2', {
			path: folderPath,
			autorename: true,
		});

		return {
			remoteFileId: payload.metadata?.id || payload.metadata?.path_lower || folderPath,
			remoteParentId: parentPath || '/',
			fileName: payload.metadata?.name || name,
		};
	}

	async getMetadata(fileRecord) {
		return this.rpc('/files/get_metadata', {
			path: fileRecord.remote_file_id || joinDropboxPath(fileRecord.virtual_path, fileRecord.file_name),
			include_media_info: true,
			include_deleted: false,
			include_has_explicit_shared_members: false,
		});
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const response = await this.content('/files/download', {
			args: {
				path: fileRecord.remote_file_id || joinDropboxPath(fileRecord.virtual_path, fileRecord.file_name),
			},
			body: null,
			contentType: '',
			// Dropbox's content download endpoint honors a standard Range header
			// and replies 206 with the requested slice for seek/resume support.
			...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
		});

		if (!response.ok && response.status !== 206) {
			const payload = await response.json().catch(() => null);
			throw new Error(parseDropboxError(payload, 'Failed to download file from Dropbox'));
		}

		if (!response.body) {
			throw new Error('Dropbox download returned an empty response');
		}

		return Readable.fromWeb(response.body);
	}

	async renameFile(fileRecord, nextName) {
		const fromPath = joinDropboxPath(fileRecord.virtual_path, fileRecord.file_name);
		const toPath = joinDropboxPath(fileRecord.virtual_path, nextName);
		await this.rpc('/files/move_v2', {
			from_path: fileRecord.remote_file_id || fromPath,
			to_path: toPath,
			autorename: false,
			allow_shared_folder: true,
		});
	}

	async moveFile(fileRecord, targetVirtualPath) {
		const fromPath = joinDropboxPath(fileRecord.virtual_path, fileRecord.file_name);
		const parentPath = await this.ensureRemotePath(targetVirtualPath);
		const toPath = joinDropboxPath(parentPath || '/', fileRecord.file_name);
		const payload = await this.rpc('/files/move_v2', {
			from_path: fileRecord.remote_file_id || fromPath,
			to_path: toPath,
			autorename: false,
			allow_shared_folder: true,
		});
		return {
			remoteFileId: payload.metadata?.id || payload.metadata?.path_lower || toPath,
			remoteParentId: parentPath || '/',
		};
	}

	async deleteFile(fileRecord) {
		await this.rpc('/files/delete_v2', {
			path: fileRecord.remote_file_id || joinDropboxPath(fileRecord.virtual_path, fileRecord.file_name),
		});
	}

	async getFileDetails(fileRecord) {
		const remote = await this.getMetadata(fileRecord);
		return {
			name: remote.name || fileRecord.file_name,
			mime_type: fileRecord.mime_type,
			size: Number(remote.size || fileRecord.size || 0),
			createdTime: null,
			modifiedTime: remote.server_modified || null,
			webViewLink: null,
			owner_email: this.account.email,
			remote_parent_id: toVirtualPath(remote.path_display || remote.path_lower),
			provider: 'dropbox',
		};
	}

	async revokeAccess() {
		try {
			const accessToken = await this.createAccessToken();
			await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
				method: 'POST',
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			return true;
		} catch (error) {
			console.warn(`[dropbox] token revoke failed for ${this.account.email}:`, error?.message || error);
			return false;
		}
	}
}
