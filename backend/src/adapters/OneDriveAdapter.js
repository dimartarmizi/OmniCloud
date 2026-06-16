import { Readable } from 'stream';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { decryptJson } from '../utils/crypto.js';

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function encodePathSegment(value) {
	return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export class OneDriveAdapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.accessTokenCache = null;
	}

	getCapabilities() {
		return {
			starred: false,
			rename: true,
			delete: true,
		};
	}

	async createAccessToken(forceRefresh = false) {
		if (!forceRefresh && this.accessTokenCache && this.accessTokenCache.expiresAt > Date.now() + 30_000) {
			return this.accessTokenCache.token;
		}

		const credentials = decryptJson(this.account.encrypted_credentials);

		if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret || !credentials.tenantId) {
			throw new Error('OneDrive account credentials are incomplete');
		}

		const response = await fetch(
			`https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					client_id: credentials.clientId,
					client_secret: credentials.clientSecret,
					refresh_token: credentials.refreshToken,
					redirect_uri: credentials.redirectUri,
					grant_type: 'refresh_token',
					scope: 'offline_access openid profile email Files.ReadWrite.All User.Read',
				}),
			},
		);

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error_description || payload.error || 'Failed to refresh OneDrive access token');
		}

		this.accessTokenCache = {
			token: payload.access_token,
			expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000),
		};

		return this.accessTokenCache.token;
	}

	async requestGraph(url, options = {}) {
		const accessToken = await this.createAccessToken();
		let response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...(options.headers || {}),
			},
		});

		if (response.status === 401) {
			const refreshedToken = await this.createAccessToken(true);
			response = await fetch(url, {
				...options,
				headers: {
					Authorization: `Bearer ${refreshedToken}`,
					...(options.headers || {}),
				},
			});
		}

		return response;
	}

	async graph(path, options = {}) {
		const response = await this.requestGraph(`https://graph.microsoft.com/v1.0${path}`, options);

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || 'OneDrive Graph request failed');
		}

		return payload;
	}

	async graphAbsolute(url, options = {}) {
		const response = await this.requestGraph(url, options);
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || 'OneDrive Graph request failed');
		}

		return payload;
	}

	async getItem(itemId) {
		return this.graph(
			`/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder,parentReference,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy`,
		);
	}

	async listChildren(folderId = 'root') {
		const files = [];
		let nextUrl = folderId === 'root'
			? 'https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,size,file,folder,parentReference,webUrl,createdDateTime,lastModifiedDateTime'
			: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,size,file,folder,parentReference,webUrl,createdDateTime,lastModifiedDateTime`;

		while (nextUrl) {
			const payload = await this.graphAbsolute(nextUrl);
			files.push(...(payload.value || []));
			nextUrl = payload['@odata.nextLink'] || null;
		}

		return files;
	}

	async ensureRemotePath(virtualPath = '/') {
		const normalizedPath = normalizePath(virtualPath);
		if (normalizedPath === '/') {
			return 'root';
		}

		const segments = normalizedPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let parentId = 'root';

		for (const segment of segments) {
			const children = await this.listChildren(parentId);
			const existing = children.find((item) => item.folder && item.name === segment);

			if (existing) {
				parentId = existing.id;
				continue;
			}

			const created = await this.graph(
				parentId === 'root' ? '/me/drive/root/children' : `/me/drive/items/${encodeURIComponent(parentId)}/children`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						name: segment,
						folder: {},
						'@microsoft.graph.conflictBehavior': 'rename',
					}),
				},
			);

			parentId = created.id;
		}

		return parentId;
	}

	async fetchStructure() {
		const records = [];

		// Breadth-first traversal that fetches sibling folders concurrently with a
		// bounded fan-out, instead of a strictly serial depth-first walk. Deep
		// trees previously produced N sequential Graph round-trips (latency grew
		// linearly with folder count); processing each level in parallel batches
		// collapses that to roughly tree-depth * (folders / concurrency) waits.
		const CONCURRENCY = 6;
		let frontier = [{ folderId: 'root', currentPath: '/' }];

		while (frontier.length) {
			const nextFrontier = [];

			for (let i = 0; i < frontier.length; i += CONCURRENCY) {
				const batch = frontier.slice(i, i + CONCURRENCY);
				const results = await Promise.all(
					batch.map(async (node) => ({
						node,
						children: await this.listChildren(node.folderId),
					})),
				);

				for (const { node, children } of results) {
					const virtualPath = normalizePath(node.currentPath);
					for (const item of children) {
						const isFolder = Boolean(item.folder);
						records.push({
							virtual_path: virtualPath,
							file_name: item.name,
							is_folder: isFolder,
							is_starred: 0,
							size: Number(item.size || 0),
							mime_type: item.file?.mimeType || null,
							remote_file_id: item.id,
							remote_parent_id:
								item.parentReference?.id || (node.folderId === 'root' ? 'root' : node.folderId),
							remote_created_time: item.createdDateTime || null,
							remote_modified_time: item.lastModifiedDateTime || null,
						});

						if (isFolder) {
							nextFrontier.push({ folderId: item.id, currentPath: `${virtualPath}${item.name}/` });
						}
					}
				}
			}

			frontier = nextFrontier;
		}

		return records;
	}

	async listSharedWithMe() {
		const items = [];
		let nextUrl = 'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$select=id,name,remoteItem';

		while (nextUrl) {
			const payload = await this.graphAbsolute(nextUrl);
			items.push(...(payload.value || []));
			nextUrl = payload['@odata.nextLink'] || null;
		}

		return items
			.map((item) => item.remoteItem || null)
			.filter(Boolean)
			.map((remote) => ({
				file_name: remote.name,
				is_folder: Boolean(remote.folder),
				is_starred: 0,
				size: Number(remote.size || 0),
				mime_type: remote.file?.mimeType || null,
				remote_file_id: remote.id,
				remote_parent_id: remote.parentReference?.id || null,
				remote_drive_id: remote.parentReference?.driveId || remote.parentReference?.driveType || null,
				createdTime: remote.createdDateTime || null,
				modifiedTime: remote.lastModifiedDateTime || null,
				owner_name: remote.createdBy?.user?.displayName || null,
				owner_email: remote.createdBy?.user?.email || this.account.email,
				capabilities: {
					starred: false,
					rename: false,
					delete: false,
				},
			}));
	}

	async listSharedFolderChildren(folderRecord) {
		const driveId = folderRecord.remote_drive_id;
		if (!driveId) {
			return [];
		}

		const items = [];
		let nextUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderRecord.remote_file_id)}/children?$select=id,name,size,file,folder,parentReference,webUrl,createdDateTime,lastModifiedDateTime,createdBy`;

		while (nextUrl) {
			const payload = await this.graphAbsolute(nextUrl);
			items.push(...(payload.value || []));
			nextUrl = payload['@odata.nextLink'] || null;
		}

		return items.map((remote) => ({
			file_name: remote.name,
			is_folder: Boolean(remote.folder),
			is_starred: 0,
			size: Number(remote.size || 0),
			mime_type: remote.file?.mimeType || null,
			remote_file_id: remote.id,
			remote_parent_id: remote.parentReference?.id || folderRecord.remote_file_id,
			remote_drive_id: remote.parentReference?.driveId || driveId,
			createdTime: remote.createdDateTime || null,
			modifiedTime: remote.lastModifiedDateTime || null,
			owner_name: remote.createdBy?.user?.displayName || null,
			owner_email: remote.createdBy?.user?.email || this.account.email,
			capabilities: {
				starred: false,
				rename: false,
				delete: false,
			},
		}));
	}

	async getStorageSummary() {
		const drive = await this.graph('/me/drive?$select=quota');

		return {
			totalSpace: Number(drive.quota?.total || this.account.total_space || 0),
			usedSpace: Number(drive.quota?.used || this.account.used_space || 0),
		};
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', remoteParentId, onProgress }) {
		const parentId = remoteParentId || await this.ensureRemotePath(virtualPath);
		const progressStream = this.createProgressStream(onProgress);
		const body = stream.pipe(progressStream);
		const uploadPath = `/me/drive/items/${encodeURIComponent(parentId)}:/${encodePathSegment(fileName)}:/content`;
		const response = await this.requestGraph(`https://graph.microsoft.com/v1.0${uploadPath}`, {
			method: 'PUT',
			headers: {
				'Content-Type': mimeType || 'application/octet-stream',
				...(size ? { 'Content-Length': String(size) } : {}),
			},
			body,
			duplex: 'half',
		});

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || 'Failed to upload file to OneDrive');
		}

		return {
			remoteFileId: payload.id,
			remoteParentId: payload.parentReference?.id || parentId,
			size: Number(payload.size || size || 0),
			fileName: payload.name || fileName,
			mimeType: payload.file?.mimeType || mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/', remoteParentId }) {
		const parentId = remoteParentId || await this.ensureRemotePath(virtualPath);
		const payload = await this.graph(
			parentId === 'root' ? '/me/drive/root/children' : `/me/drive/items/${encodeURIComponent(parentId)}/children`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					name,
					folder: {},
					'@microsoft.graph.conflictBehavior': 'rename',
				}),
			},
		);

		return {
			remoteFileId: payload.id,
			remoteParentId: payload.parentReference?.id || parentId,
			fileName: payload.name || name,
		};
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const response = await this.requestGraph(
			`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileRecord.remote_file_id)}/content`,
			range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {},
		);

		if (!response.ok && response.status !== 206) {
			let message = 'Failed to download file from OneDrive';
			try {
				const payload = await response.json();
				message = payload.error?.message || message;
			} catch {
				// Ignore JSON parsing for binary response.
			}
			throw new Error(message);
		}

		if (!response.body) {
			throw new Error('OneDrive download returned an empty response');
		}

		return Readable.fromWeb(response.body);
	}

	async renameFile(fileRecord, nextName) {
		await this.graph(`/me/drive/items/${encodeURIComponent(fileRecord.remote_file_id)}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: nextName,
			}),
		});
	}

	async moveFile(fileRecord, targetVirtualPath) {
		const newParentId = await this.ensureRemotePath(targetVirtualPath);
		// OneDrive moves by PATCHing the item's parentReference to the new folder.
		const updated = await this.graph(`/me/drive/items/${encodeURIComponent(fileRecord.remote_file_id)}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				parentReference: { id: newParentId },
			}),
		});
		return { remoteParentId: updated.parentReference?.id || newParentId };
	}

	async deleteFile(fileRecord) {
		const response = await this.requestGraph(
			`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileRecord.remote_file_id)}`,
			{
				method: 'DELETE',
			},
		);

		if (!response.ok) {
			const payload = await response.json();
			throw new Error(payload.error?.message || 'Failed to delete OneDrive item');
		}
	}

	async getFileDetails(fileRecord) {
		const remote = await this.getItem(fileRecord.remote_file_id);

		return {
			name: remote.name,
			file_name: remote.name,
			is_folder: Boolean(remote.folder),
			mimeType: remote.file?.mimeType || fileRecord.mime_type,
			mime_type: remote.file?.mimeType || fileRecord.mime_type,
			size: Number(remote.size || fileRecord.size || 0),
			createdTime: remote.createdDateTime,
			modifiedTime: remote.lastModifiedDateTime,
			webViewLink: remote.webUrl,
			webContentLink: null,
			owner_name: remote.createdBy?.user?.displayName || null,
			owner_email: remote.createdBy?.user?.email || this.account.email,
			remote_file_id: remote.id,
			remote_parent_id: remote.parentReference?.id || fileRecord.remote_parent_id || null,
			remote_drive_id: remote.parentReference?.driveId || fileRecord.remote_drive_id || null,
			provider: 'onedrive',
		};
	}
}
