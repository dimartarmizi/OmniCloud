import { Readable } from 'stream';
import {
	S3Client,
	ListObjectsV2Command,
	GetObjectCommand,
	DeleteObjectCommand,
	CopyObjectCommand,
	PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { guessMimeType } from '../utils/mime.js';
import { decryptJson } from '../utils/crypto.js';

const FOLDER_MARKER = '/';

function normalizeVirtualPath(input = '/') {
	if (!input || input === '/') return '/';
	const prefixed = input.startsWith('/') ? input : `/${input}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function toKey(virtualPath = '/', name = '') {
	const folder = normalizeVirtualPath(virtualPath).replace(/^\/+/, '');
	return `${folder}${name}`;
}

function keyToVirtualPath(key = '') {
	const trimmed = key.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	if (lastSlash === -1) return '/';
	return `/${trimmed.slice(0, lastSlash)}/`;
}

function keyToName(key = '') {
	const trimmed = key.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

export class S3Adapter extends BaseCloudAdapter {
	constructor(account) {
		super(account);
		this.clientCache = null;
		this.bucketCache = null;
		this.objectsCache = null;
	}

	readCredentials() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucket) {
			throw new Error('S3 account credentials are incomplete (accessKeyId, secretAccessKey, bucket required)');
		}
		return credentials;
	}

	getClient() {
		if (this.clientCache) {
			return { client: this.clientCache, bucket: this.bucketCache };
		}

		const credentials = this.readCredentials();
		this.bucketCache = credentials.bucket;
		this.clientCache = new S3Client({
			region: credentials.region || 'auto',
			endpoint: credentials.endpoint || undefined,
			forcePathStyle: credentials.forcePathStyle !== false,
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
			},
		});

		return { client: this.clientCache, bucket: this.bucketCache };
	}

	async listAllObjects() {
		// Within a single sync cycle the adapter instance is reused: syncService
		// calls fetchStructure() then getStorageSummary() on the same instance.
		// Both need the full object listing, so we paginate the entire bucket once
		// and memoize it here. Without this cache each sync would walk the whole
		// bucket twice (2x ListObjectsV2 round-trips and 2x egress on large
		// buckets). The cache lives only as long as the adapter instance, so a
		// fresh sync still sees fresh data.
		if (this.objectsCache) {
			return this.objectsCache;
		}

		const { client, bucket } = this.getClient();
		const objects = [];
		let continuationToken;

		do {
			const response = await client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					ContinuationToken: continuationToken,
				}),
			);
			objects.push(...(response.Contents || []));
			continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
		} while (continuationToken);

		this.objectsCache = objects;
		return objects;
	}

	async fetchStructure() {
		const objects = await this.listAllObjects();
		const records = [];
		const folderKeys = new Set();

		for (const object of objects) {
			const key = object.Key;
			if (!key) continue;

			const isFolder = key.endsWith(FOLDER_MARKER);
			if (isFolder) {
				folderKeys.add(key);
				records.push({
					virtual_path: keyToVirtualPath(key),
					file_name: keyToName(key),
					is_folder: true,
					size: 0,
					mime_type: null,
					remote_file_id: key,
					remote_parent_id: keyToVirtualPath(key),
					remote_created_time: null,
					remote_modified_time: object.LastModified ? new Date(object.LastModified).toISOString() : null,
				});
				continue;
			}

			records.push({
				virtual_path: keyToVirtualPath(key),
				file_name: keyToName(key),
				is_folder: false,
				size: Number(object.Size || 0),
				mime_type: guessMimeType(keyToName(key)),
				remote_file_id: key,
				remote_parent_id: keyToVirtualPath(key),
				remote_created_time: null,
				remote_modified_time: object.LastModified ? new Date(object.LastModified).toISOString() : null,
			});
		}

		const seen = new Set(folderKeys);
		for (const object of objects) {
			const key = object.Key || '';
			const segments = key.replace(/\/+$/, '').split('/');
			segments.pop();
			let prefix = '';
			for (const segment of segments) {
				prefix += `${segment}/`;
				if (seen.has(prefix)) continue;
				seen.add(prefix);
				records.push({
					virtual_path: keyToVirtualPath(prefix),
					file_name: keyToName(prefix),
					is_folder: true,
					size: 0,
					mime_type: null,
					remote_file_id: prefix,
					remote_parent_id: keyToVirtualPath(prefix),
					remote_created_time: null,
					remote_modified_time: null,
				});
			}
		}

		return records;
	}

	async getStorageSummary() {
		const objects = await this.listAllObjects();
		const usedSpace = objects.reduce((sum, object) => sum + Number(object.Size || 0), 0);

		return {
			totalSpace: Number(this.account.total_space || 0),
			usedSpace,
		};
	}

	async uploadStream({ stream, size, fileName, mimeType, virtualPath = '/', onProgress }) {
		const { client, bucket } = this.getClient();
		const key = toKey(virtualPath, fileName);
		const progressStream = this.createProgressStream(onProgress);

		const upload = new Upload({
			client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: stream.pipe(progressStream),
				ContentType: mimeType || 'application/octet-stream',
			},
		});

		await upload.done();

		return {
			remoteFileId: key,
			remoteParentId: normalizeVirtualPath(virtualPath),
			size: Number(size || 0),
			fileName,
			mimeType,
		};
	}

	async createFolder({ name, virtualPath = '/' }) {
		const { client, bucket } = this.getClient();
		const key = `${toKey(virtualPath, name)}/`;

		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: '',
			}),
		);

		return {
			remoteFileId: key,
			remoteParentId: normalizeVirtualPath(virtualPath),
			fileName: name,
		};
	}

	async getDownloadStream(fileRecord, { range } = {}) {
		const { client, bucket } = this.getClient();
		const key = fileRecord.remote_file_id || toKey(fileRecord.virtual_path, fileRecord.file_name);

		const response = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
				// S3 understands the standard HTTP byte-range form; forwarding it
				// lets the provider return only the requested slice (206) instead
				// of us downloading the whole object to serve a seek.
				...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
			}),
		);

		if (!response.Body) {
			throw new Error('S3 download returned an empty body');
		}

		if (response.Body instanceof Readable) {
			return response.Body;
		}

		return Readable.fromWeb(response.Body);
	}

	async renameFile(fileRecord, nextName) {
		const { client, bucket } = this.getClient();
		const fromKey = fileRecord.remote_file_id || toKey(fileRecord.virtual_path, fileRecord.file_name);
		const toKeyName = toKey(fileRecord.virtual_path, nextName);

		await client.send(
			new CopyObjectCommand({
				Bucket: bucket,
				CopySource: `${bucket}/${fromKey}`,
				Key: toKeyName,
			}),
		);
		await client.send(
			new DeleteObjectCommand({
				Bucket: bucket,
				Key: fromKey,
			}),
		);
	}

	async deleteFile(fileRecord) {
		const { client, bucket } = this.getClient();
		const key = fileRecord.remote_file_id || toKey(fileRecord.virtual_path, fileRecord.file_name);

		await client.send(
			new DeleteObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
	}

	async moveFile(fileRecord, targetVirtualPath) {
		const { client, bucket } = this.getClient();
		const fromKey = fileRecord.remote_file_id || toKey(fileRecord.virtual_path, fileRecord.file_name);
		// S3 has no native move: copy the object to the destination key then
		// delete the source. Keeps the same file name under the new prefix.
		const toKeyName = toKey(targetVirtualPath, fileRecord.file_name);
		if (toKeyName === fromKey) {
			return { remoteFileId: fromKey, remoteParentId: normalizeVirtualPath(targetVirtualPath) };
		}

		await client.send(
			new CopyObjectCommand({
				Bucket: bucket,
				CopySource: `${bucket}/${fromKey}`,
				Key: toKeyName,
			}),
		);
		await client.send(
			new DeleteObjectCommand({
				Bucket: bucket,
				Key: fromKey,
			}),
		);

		return { remoteFileId: toKeyName, remoteParentId: normalizeVirtualPath(targetVirtualPath) };
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
			provider: this.account.provider,
		};
	}
}

