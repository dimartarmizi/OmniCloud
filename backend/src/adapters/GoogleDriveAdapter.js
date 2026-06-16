import { google } from 'googleapis';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { decryptJson } from '../utils/crypto.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function escapeDriveQueryValue(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveAdapter extends BaseCloudAdapter {
	getCapabilities() {
		return {
			starred: true,
			rename: true,
			delete: true,
		};
	}

	supportsDeltaSync() {
		return true;
	}

	createOAuthClient() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		const oauthClient = new google.auth.OAuth2(
			credentials.clientId,
			credentials.clientSecret,
			credentials.redirectUri,
		);

		oauthClient.setCredentials({
			refresh_token: credentials.refreshToken || undefined,
			access_token: credentials.accessToken || undefined,
			expiry_date: credentials.expiryDate || undefined,
			scope: credentials.scope || undefined,
			token_type: credentials.tokenType || undefined,
		});

		return oauthClient;
	}

	async getDriveClient() {
		const auth = this.createOAuthClient();
		return google.drive({ version: 'v3', auth });
	}

	async ensureRemotePath(virtualPath = '/') {
		const normalizedPath = normalizePath(virtualPath);
		if (normalizedPath === '/') {
			return 'root';
		}

		const drive = await this.getDriveClient();
		const segments = normalizedPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let parentId = 'root';

		for (const segment of segments) {
			const response = await drive.files.list({
				q: [
					`trashed = false`,
					`mimeType = '${FOLDER_MIME_TYPE}'`,
					`name = '${escapeDriveQueryValue(segment)}'`,
					`'${parentId}' in parents`,
				].join(' and '),
				fields: 'files(id, name)',
				pageSize: 1,
			});

			const existing = response.data.files?.[0];
			if (existing) {
				parentId = existing.id;
				continue;
			}

			const created = await drive.files.create({
				requestBody: {
					name: segment,
					mimeType: FOLDER_MIME_TYPE,
					parents: [parentId],
				},
				fields: 'id, parents',
			});

			parentId = created.data.id;
		}

		return parentId;
	}

	async fetchStructure() {
		const drive = await this.getDriveClient();
		const files = [];
		let pageToken;

		do {
			const response = await drive.files.list({
				q: "trashed = false and 'me' in owners",
				fields: 'nextPageToken, files(id, name, mimeType, size, parents, starred, createdTime, modifiedTime)',
				pageSize: 1000,
				pageToken,
				supportsAllDrives: false,
			});

			files.push(...(response.data.files || []));
			pageToken = response.data.nextPageToken || undefined;
		} while (pageToken);

		const byId = new Map(files.map((file) => [file.id, file]));

		// Memoize each folder's own path so a parent chain shared by many files
		// is walked at most once instead of re-traversed per descendant. Without
		// this, building paths for N items in a tree of depth D costs O(N*D); the
		// cache makes it O(N) amortized. Keyed by folder id; the value is that
		// folder's full path including its trailing slash (e.g. "/a/b/").
		const folderPathById = new Map();

		const resolveFolderOwnPath = (folderId) => {
			if (!folderId || folderId === 'root') {
				return '/';
			}

			const cached = folderPathById.get(folderId);
			if (cached !== undefined) {
				return cached;
			}

			// Walk up the unresolved ancestors, then fill the cache top-down so
			// every visited folder is memoized in a single pass. A visited set
			// guards against cyclic/broken parent references from the provider.
			const chain = [];
			const visited = new Set();
			let currentId = folderId;

			while (currentId && currentId !== 'root' && !visited.has(currentId) && !folderPathById.has(currentId)) {
				visited.add(currentId);
				const current = byId.get(currentId);
				if (!current) {
					currentId = null;
					break;
				}
				chain.push(current);
				currentId = current.parents?.[0];
			}

			let basePath = currentId && folderPathById.has(currentId)
				? folderPathById.get(currentId)
				: '/';

			for (let index = chain.length - 1; index >= 0; index -= 1) {
				const folder = chain[index];
				basePath = `${basePath}${folder.name}/`;
				folderPathById.set(folder.id, basePath);
			}

			return folderPathById.get(folderId) || '/';
		};

		const buildFolderPath = (file) => resolveFolderOwnPath(file.parents?.[0]);

		return files.map((file) => ({
			virtual_path: buildFolderPath(file),
			file_name: file.name,
			is_folder: file.mimeType === FOLDER_MIME_TYPE,
			is_starred: file.starred ? 1 : 0,
			size: Number(file.size || 0),
			mime_type: file.mimeType || null,
			remote_file_id: file.id,
			remote_parent_id: file.parents?.[0] || null,
			remote_created_time: file.createdTime || null,
			remote_modified_time: file.modifiedTime || null,
		}));
	}

	async listSharedWithMe() {
		const drive = await this.getDriveClient();
		const files = [];
		let pageToken;

		do {
			const response = await drive.files.list({
				q: 'sharedWithMe = true and trashed = false',
				fields: 'nextPageToken, files(id, name, mimeType, size, parents, starred, createdTime, modifiedTime, owners(displayName,emailAddress), capabilities(canEdit,canRename,canDelete,canRemoveMyDriveParent))',
				pageSize: 1000,
				pageToken,
				supportsAllDrives: false,
			});

			files.push(...(response.data.files || []));
			pageToken = response.data.nextPageToken || undefined;
		} while (pageToken);

		return files.map((file) => ({
			file_name: file.name,
			is_folder: file.mimeType === FOLDER_MIME_TYPE,
			is_starred: file.starred ? 1 : 0,
			size: Number(file.size || 0),
			mime_type: file.mimeType || null,
			remote_file_id: file.id,
			remote_parent_id: file.parents?.[0] || null,
			remote_drive_id: null,
			createdTime: file.createdTime || null,
			modifiedTime: file.modifiedTime || null,
			owner_name: file.owners?.[0]?.displayName || null,
			owner_email: file.owners?.[0]?.emailAddress || this.account.email,
			capabilities: {
				starred: true,
				rename: Boolean(file.capabilities?.canRename || file.capabilities?.canEdit),
				delete: Boolean(file.capabilities?.canDelete),
			},
		}));
	}

	async listSharedFolderChildren(folderRecord) {
		const drive = await this.getDriveClient();
		const files = [];
		let pageToken;

		do {
			const response = await drive.files.list({
				q: [`'${escapeDriveQueryValue(folderRecord.remote_file_id)}' in parents`, 'trashed = false'].join(' and '),
				fields: 'nextPageToken, files(id, name, mimeType, size, parents, starred, createdTime, modifiedTime, owners(displayName,emailAddress), capabilities(canEdit,canRename,canDelete,canRemoveMyDriveParent))',
				pageSize: 1000,
				pageToken,
				supportsAllDrives: false,
			});

			files.push(...(response.data.files || []));
			pageToken = response.data.nextPageToken || undefined;
		} while (pageToken);

		return files.map((file) => ({
			file_name: file.name,
			is_folder: file.mimeType === FOLDER_MIME_TYPE,
			is_starred: file.starred ? 1 : 0,
			size: Number(file.size || 0),
			mime_type: file.mimeType || null,
			remote_file_id: file.id,
			remote_parent_id: file.parents?.[0] || folderRecord.remote_file_id,
			remote_drive_id: null,
			createdTime: file.createdTime || null,
			modifiedTime: file.modifiedTime || null,
			owner_name: file.owners?.[0]?.displayName || null,
			owner_email: file.owners?.[0]?.emailAddress || this.account.email,
			capabilities: {
				starred: true,
				rename: Boolean(file.capabilities?.canRename || file.capabilities?.canEdit),
				delete: Boolean(file.capabilities?.canDelete),
			},
		}));
	}

	async setFileStarred(fileRecord, isStarred) {
		const drive = await this.getDriveClient();
		await drive.files.update({
			fileId: fileRecord.remote_file_id,
			requestBody: {
				starred: Boolean(isStarred),
			},
			fields: 'id, starred',
		});
	}

	async getStorageSummary() {
		const drive = await this.getDriveClient();
		const response = await drive.about.get({
			fields: 'storageQuota(limit,usage)',
		});

		return {
			totalSpace: Number(response.data.storageQuota?.limit || 0),
			usedSpace: Number(response.data.storageQuota?.usage || 0),
		};
	}

	/**
	 * Seed the delta cursor after a full walk. Drive's startPageToken marks "now"
	 * so the next sync can ask for only changes since this point.
	 */
	async getInitialDeltaToken() {
		const drive = await this.getDriveClient();
		const response = await drive.changes.getStartPageToken();
		return response.data.startPageToken || null;
	}

	/**
	 * Walk Drive's changes feed from the stored token. Returns whether anything
	 * changed and the advanced token, without enumerating per-file paths: the
	 * sync service uses `hasChanges` to skip the expensive full structure walk
	 * when nothing changed (the common case for periodic syncs), and does a full
	 * diff-upsert only when changes exist — which keeps denormalized descendant
	 * paths correct across folder renames/moves. `expired` signals a stale token
	 * so the caller falls back to a full sync and re-seeds.
	 */
	async getDeltaChanges(token) {
		const drive = await this.getDriveClient();
		let pageToken = token;
		let hasChanges = false;

		try {
			while (pageToken) {
				const response = await drive.changes.list({
					pageToken,
					pageSize: 100,
					fields: 'newStartPageToken, nextPageToken, changes(fileId)',
					includeRemoved: true,
					supportsAllDrives: false,
				});

				if ((response.data.changes || []).length > 0) {
					hasChanges = true;
				}

				// Once any change is seen, the sync service does a full structure
				// walk and re-seeds the token via getInitialDeltaToken(), so the
				// nextToken computed here is discarded. Stop paging the rest of the
				// change feed instead of walking it to completion for no reason.
				if (hasChanges) {
					return { hasChanges: true, nextToken: null, expired: false };
				}

				if (response.data.nextPageToken) {
					pageToken = response.data.nextPageToken;
					continue;
				}

				return { hasChanges, nextToken: response.data.newStartPageToken || null, expired: false };
			}

			return { hasChanges, nextToken: token, expired: false };
		} catch (error) {
			// A 404/410 on the page token means it has expired; signal a full resync.
			const status = error?.code || error?.response?.status;
			if (status === 404 || status === 410) {
				return { hasChanges: true, nextToken: null, expired: true };
			}
			throw error;
		}
	}

	async uploadStream({ stream, fileName, mimeType, virtualPath, remoteParentId, onProgress }) {
		const drive = await this.getDriveClient();
		const parentId = remoteParentId || await this.ensureRemotePath(virtualPath);
		const progressStream = this.createProgressStream(onProgress);
		const body = stream.pipe(progressStream);

		const response = await drive.files.create(
			{
				requestBody: {
					name: fileName,
					parents: parentId ? [parentId] : undefined,
				},
				media: {
					mimeType,
					body,
				},
				fields: 'id, parents, size, mimeType, name',
			},
			{
				maxBodyLength: Infinity,
			},
		);

		return {
			remoteFileId: response.data.id,
			remoteParentId: response.data.parents?.[0] || parentId || null,
			size: Number(response.data.size || 0),
			fileName: response.data.name || fileName,
			mimeType: response.data.mimeType || mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/', remoteParentId }) {
		const drive = await this.getDriveClient();
		const parentId = remoteParentId || await this.ensureRemotePath(virtualPath);
		const response = await drive.files.create({
			requestBody: {
				name,
				mimeType: FOLDER_MIME_TYPE,
				parents: parentId ? [parentId] : undefined,
			},
			fields: 'id, parents, name',
		});

		return {
			remoteFileId: response.data.id,
			remoteParentId: response.data.parents?.[0] || parentId || null,
			fileName: response.data.name || name,
		};
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const drive = await this.getDriveClient();
		const response = await drive.files.get(
			{
				fileId: fileRecord.remote_file_id,
				alt: 'media',
			},
			{
				responseType: 'stream',
				// Drive honors the HTTP Range header on alt=media downloads and
				// replies 206 with only the requested bytes, enabling seek/resume.
				...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
			},
		);

		return response.data;
	}

	async renameFile(fileRecord, nextName) {
		const drive = await this.getDriveClient();
		await drive.files.update({
			fileId: fileRecord.remote_file_id,
			requestBody: {
				name: nextName,
			},
			fields: 'id, name',
		});
	}

	async moveFile(fileRecord, targetVirtualPath) {
		const drive = await this.getDriveClient();
		const newParentId = await this.ensureRemotePath(targetVirtualPath);
		// Drive moves are expressed as a parent reparent: add the new parent and
		// remove the previous one(s) in a single update.
		const current = await drive.files.get({
			fileId: fileRecord.remote_file_id,
			fields: 'parents',
		});
		const previousParents = (current.data.parents || []).join(',');
		await drive.files.update({
			fileId: fileRecord.remote_file_id,
			addParents: newParentId,
			removeParents: previousParents || undefined,
			fields: 'id, parents',
		});
		return { remoteParentId: newParentId };
	}

	async deleteFile(fileRecord) {
		const drive = await this.getDriveClient();
		await drive.files.delete({
			fileId: fileRecord.remote_file_id,
		});
	}

	async getFileDetails(fileRecord) {
		const drive = await this.getDriveClient();
		const response = await drive.files.get({
			fileId: fileRecord.remote_file_id,
			fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, owners(displayName,emailAddress), parents',
		});

		const remote = response.data;
		return {
			name: remote.name,
			file_name: remote.name,
			is_folder: remote.mimeType === FOLDER_MIME_TYPE,
			mimeType: remote.mimeType,
			mime_type: remote.mimeType,
			size: Number(remote.size || fileRecord.size || 0),
			createdTime: remote.createdTime,
			modifiedTime: remote.modifiedTime,
			webViewLink: remote.webViewLink,
			webContentLink: remote.webContentLink,
			owner_name: remote.owners?.[0]?.displayName || null,
			owner_email: remote.owners?.[0]?.emailAddress || this.account.email,
			remote_file_id: remote.id,
			remote_parent_id: remote.parents?.[0] || fileRecord.remote_parent_id || null,
			remote_drive_id: null,
			provider: 'google_drive',
		};
	}

	async revokeAccess() {
		try {
			const oauthClient = this.createOAuthClient();
			await oauthClient.revokeCredentials();
			return true;
		} catch (error) {
			console.warn(`[google_drive] token revoke failed for ${this.account.email}:`, error?.message || error);
			return false;
		}
	}
}
