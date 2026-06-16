import { Readable } from 'stream';
import crypto from 'crypto';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { decryptJson } from '../utils/crypto.js';
import { pcloudGet, pcloudLogin } from '../utils/pcloudClient.js';
import { updateAccountCredentials } from '../services/accountService.js';

function normalizeVirtualPath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function joinPath(parent = '/', name = '') {
	const base = parent === '/' ? '' : parent.replace(/\/+$/, '');
	return `${base}/${name}`;
}

function toIsoDate(value) {
	if (!value) return null;
	if (typeof value === 'number') {
		const date = new Date(value * 1000);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class PCloudAdapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.session = null;
	}

	readCredentials() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		if (!credentials.auth && (!credentials.username || !credentials.password)) {
			throw new Error('pCloud account credentials are incomplete');
		}
		return credentials;
	}

	async getSession(forceRelogin = false) {
		if (this.session && !forceRelogin) return this.session;

		const credentials = this.readCredentials();

		if (credentials.auth && credentials.host && !forceRelogin) {
			this.session = { host: credentials.host, auth: credentials.auth };
			return this.session;
		}

		if (!credentials.username || !credentials.password) {
			throw new Error('pCloud session expired and no stored password to re-login');
		}

		const login = await pcloudLogin({
			username: credentials.username,
			password: credentials.password,
		});
		this.session = { host: login.host, auth: login.auth };
		try {
			updateAccountCredentials(this.account.user_id, this.account.id, {
				...credentials,
				host: login.host,
				auth: login.auth,
			});
		} catch (error) {
			console.warn('pCloud: failed to persist refreshed session:', error?.message || error);
		}
		return this.session;
	}

	async call(method, params = {}) {
		const { host, auth } = await this.getSession();
		try {
			return await pcloudGet(host, method, { ...params, auth });
		} catch (error) {
			if ([1000, 2000, 2094].includes(error.result)) {
				const fresh = await this.getSession(true);
				return pcloudGet(fresh.host, method, { ...params, auth: fresh.auth });
			}
			throw error;
		}
	}

	async fetchStructure() {
		const records = [];
		// pCloud's listfolder supports `recursive: 1`, returning the ENTIRE
		// directory tree (every folder carries a nested `contents` array) in a
		// single request. The previous implementation issued one listfolder call
		// per folder (populateFolderContents recursed the tree), an N+1 network
		// pattern whose sync latency grew linearly with folder count. One recursive
		// call replaces all of them; `walk` already handles the nested contents.
		const rootPayload = await this.call('listfolder', { path: '/', recursive: 1 });

		const walk = (entry, parentVirtualPath) => {
			const isFolder = Boolean(entry.isfolder);
			const name = entry.name;

			if (entry.path === '/' || !name) {
				(entry.contents || []).forEach((child) => walk(child, '/'));
				return;
			}

			const virtualPath = normalizeVirtualPath(parentVirtualPath);
			records.push({
				virtual_path: virtualPath,
				file_name: name,
				is_folder: isFolder,
				size: isFolder ? 0 : Number(entry.size || 0),
				mime_type: isFolder ? null : entry.contenttype || 'application/octet-stream',
				remote_file_id: isFolder ? `d${entry.folderid}` : `f${entry.fileid}`,
				remote_parent_id: virtualPath,
				remote_created_time: toIsoDate(entry.created),
				remote_modified_time: toIsoDate(entry.modified),
			});

			if (isFolder) {
				const childVirtualPath = joinPath(virtualPath === '/' ? '' : virtualPath.replace(/\/+$/, ''), name) + '/';
				(entry.contents || []).forEach((child) => walk(child, childVirtualPath));
			}
		};

		walk(rootPayload.metadata, '/');
		return records;
	}

	async getStorageSummary() {
		const payload = await this.call('userinfo', {});
		return {
			totalSpace: Number(payload.quota || this.account.total_space || 0),
			usedSpace: Number(payload.usedquota || this.account.used_space || 0),
		};
	}

	async ensureFolder(virtualPath = '/') {
		const normalized = normalizeVirtualPath(virtualPath);
		if (normalized === '/') return 0;

		const path = normalized.replace(/\/+$/, '');
		const payload = await this.call('createfolderifnotexists', { path });
		return payload.metadata?.folderid ?? 0;
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', onProgress }) {
		const { host, auth } = await this.getSession();
		await this.ensureFolder(virtualPath);

		const normalized = normalizeVirtualPath(virtualPath);
		const folderPath = normalized === '/' ? '/' : normalized.replace(/\/+$/, '');

		// Stream the request body instead of buffering the whole file into memory.
		// We hand-build a multipart/form-data payload as an async generator: the
		// field preamble, then the source stream chunks (driving onProgress), then
		// the closing boundary. undici's fetch consumes async iterables as a
		// streamed body when `duplex: 'half'` is set, so RAM stays flat regardless
		// of file size.
		const boundary = `----OmniCloudBoundary${crypto.randomBytes(16).toString('hex')}`;
		// Field/filename values are sanitized to avoid breaking the multipart
		// headers (CR/LF and quotes are not allowed in a quoted-string parameter).
		const safeFileName = String(fileName).replace(/[\r\n"]/g, '_');
		const contentType = mimeType || 'application/octet-stream';

		const preamble =
			`--${boundary}\r\nContent-Disposition: form-data; name="auth"\r\n\r\n${auth}\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${folderPath}\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${safeFileName}\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="nopartial"\r\n\r\n1\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\n` +
			`Content-Type: ${contentType}\r\n\r\n`;
		const epilogue = `\r\n--${boundary}--\r\n`;

		let received = 0;
		async function* multipartBody() {
			yield Buffer.from(preamble, 'utf8');
			for await (const chunk of stream) {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				received += buffer.length;
				if (typeof onProgress === 'function') {
					onProgress(received);
				}
				yield buffer;
			}
			yield Buffer.from(epilogue, 'utf8');
		}

		const response = await fetch(`https://${host}/uploadfile`, {
			method: 'POST',
			headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
			body: multipartBody(),
			duplex: 'half',
		});

		const payload = await response.json().catch(() => null);
		if (!payload || payload.result !== 0) {
			const message = payload?.error || `pCloud upload failed (HTTP ${response.status})`;
			throw new Error(message);
		}

		if (size && received !== size) {
			console.warn(`pCloud upload size mismatch: expected ${size}, received ${received}`);
		}

		const meta = (payload.metadata || [])[0] || {};
		return {
			remoteFileId: meta.fileid ? `f${meta.fileid}` : undefined,
			remoteParentId: normalized,
			size: Number(meta.size || size || 0),
			fileName: meta.name || fileName,
			mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/' }) {
		const normalized = normalizeVirtualPath(virtualPath);
		const base = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
		const path = `${base}/${name}`;
		const payload = await this.call('createfolderifnotexists', { path });

		return {
			remoteFileId: `d${payload.metadata?.folderid ?? ''}`,
			remoteParentId: normalized,
			fileName: payload.metadata?.name || name,
		};
	}

	idParams(fileRecord) {
		const id = fileRecord.remote_file_id || '';
		if (id.startsWith('f')) return { fileid: id.slice(1) };
		if (id.startsWith('d')) return { folderid: id.slice(1) };

		const base = fileRecord.virtual_path === '/' ? '' : normalizeVirtualPath(fileRecord.virtual_path).replace(/\/+$/, '');
		return { path: `${base}/${fileRecord.file_name}` };
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const params = this.idParams(fileRecord);
		const link = await this.call('getfilelink', params);
		const host = (link.hosts || [])[0];
		if (!host || !link.path) {
			throw new Error('pCloud did not return a download link');
		}

		const response = await fetch(`https://${host}${link.path}`, {
			...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
		});
		if ((!response.ok && response.status !== 206) || !response.body) {
			throw new Error('Failed to download file from pCloud');
		}

		return Readable.fromWeb(response.body);
	}

	async renameFile(fileRecord, nextName) {
		const params = this.idParams(fileRecord);
		const method = fileRecord.is_folder ? 'renamefolder' : 'renamefile';
		await this.call(method, { ...params, toname: nextName });
	}

	async moveFile(fileRecord, targetVirtualPath) {
		await this.ensureFolder(targetVirtualPath);
		const params = this.idParams(fileRecord);
		const method = fileRecord.is_folder ? 'renamefolder' : 'renamefile';
		const normalized = normalizeVirtualPath(targetVirtualPath);
		const base = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
		// pCloud rename* doubles as move when given a destination topath that
		// keeps the same file name.
		const topath = `${base}/${fileRecord.file_name}`;
		await this.call(method, { ...params, topath });
		return { remoteParentId: normalized };
	}

	async deleteFile(fileRecord) {
		const params = this.idParams(fileRecord);
		if (fileRecord.is_folder) {
			await this.call('deletefolderrecursive', params);
		} else {
			await this.call('deletefile', params);
		}
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
			provider: 'pcloud',
		};
	}
}
