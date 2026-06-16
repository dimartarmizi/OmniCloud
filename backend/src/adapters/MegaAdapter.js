import { Storage } from 'megajs';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { guessMimeType } from '../utils/mime.js';
import { decryptJson } from '../utils/crypto.js';
import { updateAccountCredentials } from '../services/accountService.js';

function isMegaSessionError(error) {
	return /invalid or expired user session|ESID|utype/i.test(error?.message || '');
}

function normalizePath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function buildVirtualPath(file) {
	const names = [];
	let cursor = file.parent;

	while (cursor?.parent && cursor.name) {
		names.unshift(cursor.name);
		cursor = cursor.parent;
	}

	return names.length ? `/${names.join('/')}/` : '/';
}

function findChildFolder(parent, name) {
	return (parent.children || []).find((child) => child.directory && child.name === name) || null;
}

function hasAncestor(node, target) {
	if (!node || !target) return false;
	let cursor = node.parent;
	const seen = new WeakSet();
	while (cursor && !seen.has(cursor)) {
		if (cursor === target) return true;
		seen.add(cursor);
		cursor = cursor.parent;
	}
	return false;
}

export class MegaAdapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.storagePromise = null;
	}

	readCredentials() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		if (!credentials.session && (!credentials.email || !credentials.password)) {
			throw new Error('MEGA account credentials are incomplete');
		}
		return credentials;
	}

	async getStorage() {
		if (this.storagePromise) return this.storagePromise;

		const credentials = this.readCredentials();
		this.storagePromise = (async () => {
			let sessionError = null;

			if (credentials.session) {
				const sessionStorage = Storage.fromJSON(credentials.session);

				try {
					await sessionStorage.ready;
					await this.loadFileTree(sessionStorage);
					return sessionStorage;
				} catch (error) {
					sessionError = error;
					await sessionStorage.close().catch(() => { });

					if (!credentials.email || !credentials.password || !isMegaSessionError(error)) {
						throw error;
					}
				}
			}

			if (!credentials.email || !credentials.password) {
				throw sessionError || new Error('MEGA account credentials are incomplete');
			}

			const passwordStorage = new Storage({
				email: credentials.email,
				password: credentials.password,
				secondFactorCode: credentials.secondFactorCode || undefined,
				autoload: true,
				keepalive: false,
			});

			await passwordStorage.ready;

			this.persistRefreshedSession(credentials, passwordStorage);

			return passwordStorage;
		})();

		this.storagePromise.catch(() => {
			this.storagePromise = null;
		});

		return this.storagePromise;
	}

	invalidateStorage() {
		const previous = this.storagePromise;
		this.storagePromise = null;
		if (previous && typeof previous.then === 'function') {
			previous
				.then((storage) => {
					if (storage && typeof storage.close === 'function') {
						storage.close().catch(() => { });
					}
				})
				.catch(() => { /* already rejected */ });
		}
	}

	loadFileTree(storage) {
		return new Promise((resolve, reject) => {
			storage.reload(true, (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(storage);
			});
		});
	}

	persistRefreshedSession(credentials, storage) {
		try {
			const session = storage.toJSON();
			if (!session) return;

			updateAccountCredentials(this.account.user_id, this.account.id, {
				...credentials,
				session,
			});
		} catch (error) {
			console.warn(`Failed to persist refreshed MEGA session for ${this.account.email}:`, error?.message || error);
		}
	}

	async ensureRemotePath(virtualPath = '/') {
		const storage = await this.getStorage();
		const normalizedPath = normalizePath(virtualPath);
		if (normalizedPath === '/') return storage.root;

		const segments = normalizedPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let current = storage.root;

		for (const segment of segments) {
			let next = findChildFolder(current, segment);
			if (!next) {
				next = await current.mkdir(segment);
			}
			current = next;
		}

		return current;
	}

	async findByRecord(fileRecord) {
		const storage = await this.getStorage();
		const remoteId = fileRecord.remote_file_id;

		if (remoteId && storage.files?.[remoteId]) {
			return storage.files[remoteId];
		}

		const parent = await this.ensureRemotePath(fileRecord.virtual_path);
		const match = (parent.children || []).find((child) => child.name === fileRecord.file_name);
		if (!match) {
			throw new Error(`MEGA item not found: ${fileRecord.file_name}`);
		}

		return match;
	}

	async fetchStructure() {
		// getStorage() already returns a storage with a fully loaded file tree:
		// the session path calls loadFileTree() and the password path uses
		// autoload before resolving `ready`. The previous extra loadFileTree()
		// here triggered a SECOND full account reload (network + decrypt of the
		// whole tree) on every sync. A fresh adapter instance is created per sync
		// cycle, so the tree is already current — the reload was pure duplicate work.
		const storage = await this.getStorage();

		const files = Object.values(storage.files || {});

		return files
			.filter((file) => file && file !== storage.root && file !== storage.trash && file !== storage.inbox && file.name)
			.filter((file) => !hasAncestor(file, storage.trash) && !hasAncestor(file, storage.inbox))
			.map((file) => ({
				virtual_path: buildVirtualPath(file),
				file_name: file.name,
				is_folder: Boolean(file.directory),
				size: file.directory ? 0 : Number(file.size || 0),
				mime_type: file.directory ? null : guessMimeType(file.name),
				remote_file_id: file.nodeId || file.downloadId,
				remote_parent_id: file.parent?.nodeId || null,
				remote_created_time: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
				remote_modified_time: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
			}));
	}

	async getStorageSummary() {
		const storage = await this.getStorage();
		const account = await storage.getAccountInfo();

		return {
			totalSpace: Number(account.spaceTotal || this.account.total_space || 0),
			usedSpace: Number(account.spaceUsed || this.account.used_space || 0),
		};
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', onProgress }) {
		const parent = await this.ensureRemotePath(virtualPath);
		const progressStream = this.createProgressStream(onProgress);
		const upload = parent.upload({ name: fileName, size: Number(size || 0) });

		stream.pipe(progressStream).pipe(upload);
		const file = await upload.complete;

		return {
			remoteFileId: file.nodeId || file.downloadId,
			remoteParentId: parent.nodeId || null,
			size: Number(file.size || size || 0),
			fileName: file.name || fileName,
			mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/' }) {
		const parent = await this.ensureRemotePath(virtualPath);
		const folder = await parent.mkdir(name);

		return {
			remoteFileId: folder.nodeId || folder.downloadId,
			remoteParentId: parent.nodeId || null,
			fileName: folder.name || name,
		};
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const file = await this.findByRecord(fileRecord);
		if (file.directory) {
			throw new Error('Folders cannot be downloaded directly from MEGA');
		}

		// megajs supports byte-range downloads via start/end options, so a seek
		// fetches only the requested slice instead of the whole file. `end` is
		// inclusive in our range model and exclusive-by-default in some APIs, so
		// pass end + 1 which megajs treats as the (exclusive) stop offset.
		if (range) {
			return file.download({ start: range.start, end: range.end + 1 });
		}

		return file.download({});
	}

	async renameFile(fileRecord, nextName) {
		const file = await this.findByRecord(fileRecord);
		await file.rename(nextName);
		this.invalidateStorage();
	}

	async moveFile(fileRecord, targetVirtualPath) {
		const file = await this.findByRecord(fileRecord);
		const targetFolder = await this.ensureRemotePath(targetVirtualPath);
		await file.moveTo(targetFolder);
		this.invalidateStorage();
		return { remoteParentId: targetFolder.nodeId || null };
	}

	async deleteFile(fileRecord) {
		const file = await this.findByRecord(fileRecord);
		const result = await file.delete(false);

		this.invalidateStorage();
		return result;
	}

	async getFileDetails(fileRecord) {
		const file = await this.findByRecord(fileRecord);

		return {
			name: file.name || fileRecord.file_name,
			mime_type: fileRecord.mime_type,
			size: Number(file.size || fileRecord.size || 0),
			createdTime: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
			modifiedTime: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
			webViewLink: null,
			owner_email: this.account.email,
			remote_parent_id: file.parent?.nodeId || null,
			provider: 'mega',
		};
	}
}
