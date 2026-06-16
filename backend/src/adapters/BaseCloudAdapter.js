import { Transform } from 'stream';

export class BaseCloudAdapter {
	constructor(account) {
		this.account = account;
	}

	getCapabilities() {
		return {
			starred: false,
			rename: true,
			delete: true,
		};
	}

	/**
	 * Whether this provider supports incremental change tokens (delta sync). When
	 * false, the sync service always does a full fetchStructure walk and uses a
	 * local diff to apply only what changed. When true, the provider implements
	 * getDeltaChanges() and returns a token to resume from next time.
	 */
	supportsDeltaSync() {
		return false;
	}

	async fetchStructure() {
		return [];
	}

	async getStorageSummary() {
		return {
			totalSpace: Number(this.account.total_space || 0),
			usedSpace: Number(this.account.used_space || 0),
		};
	}

	createProgressStream(onProgress) {
		let bytes = 0;

		return new Transform({
			transform(chunk, _encoding, callback) {
				bytes += chunk.length;
				onProgress(bytes);
				callback(null, chunk);
			},
		});
	}

	async uploadStream() {
		throw new Error(`Upload is not implemented for provider ${this.account.provider}`);
	}

	async createFolder() {
		throw new Error(`Create folder is not implemented for provider ${this.account.provider}`);
	}

	async getDownloadStream() {
		throw new Error(`Download is not implemented for provider ${this.account.provider}`);
	}

	async renameFile() {
		throw new Error(`Rename is not supported for provider ${this.account.provider}`);
	}

	async moveFile() {
		throw new Error(`Move is not supported for provider ${this.account.provider}`);
	}

	async deleteFile() {
		throw new Error(`Delete is not supported for provider ${this.account.provider}`);
	}

	async getFileDetails(fileRecord) {
		return {
			name: fileRecord.file_name,
			mime_type: fileRecord.mime_type,
			size: fileRecord.size,
			virtual_path: fileRecord.virtual_path,
			remote_file_id: fileRecord.remote_file_id,
			provider: this.account.provider,
			owner_email: this.account.email,
			createdTime: fileRecord.remote_created_time,
			modifiedTime: fileRecord.remote_modified_time,
		};
	}

	async getDeltaChanges() {
		// Default for providers without delta support: report "changed" so the
		// caller falls back to a full structure walk. supportsDeltaSync() is false
		// for these providers, so this is not normally reached.
		return { hasChanges: true, nextToken: null, expired: false };
	}

	/**
	 * Return the current change token without enumerating changes — used right
	 * after a full structure walk to seed the delta cursor so the next sync can
	 * be incremental. Default null means "no token available" (provider does not
	 * support deltas), which keeps the account on full-walk sync.
	 */
	async getInitialDeltaToken() {
		return null;
	}

	async listSharedWithMe() {
		return [];
	}

	async listSharedFolderChildren() {
		return [];
	}

	async setFileStarred() {
		throw new Error(`Starred state is not supported for provider ${this.account.provider}`);
	}

	/**
	 * Best-effort revocation of this account's provider credentials (OAuth token
	 * revoke, session logout, etc.). Default is a no-op for providers without a
	 * revoke endpoint (S3 keys, MEGA sessions). Implementations must not throw on
	 * provider failure — revocation is best-effort during account/teardown.
	 */
	async revokeAccess() {
		return false;
	}
}
