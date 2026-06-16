import { defineStore } from 'pinia';
import { api } from '../services/api';

function normalizePath(path) {
	if (!path || path === '/') return '/';
	const prefixed = path.startsWith('/') ? path : `/${path}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function buildVirtualPath(currentPath, relativePath = '') {
	const normalizedCurrent = normalizePath(currentPath);
	if (!relativePath) return normalizedCurrent;

	const segments = relativePath.split('/').filter(Boolean);
	segments.pop();

	if (!segments.length) return normalizedCurrent;
	return normalizePath(`${normalizedCurrent}${segments.join('/')}`);
}

function normalizeUploadEntry(entry) {
	if (entry instanceof File) {
		return {
			file: entry,
			relativePath: entry.webkitRelativePath || entry.name,
		};
	}

	return {
		file: entry.file,
		relativePath: entry.relativePath || entry.file?.webkitRelativePath || entry.file?.name,
	};
}

function isAbortError(error) {
	return error?.name === 'AbortError';
}

function isCancellable(operation) {
	return ['upload', 'download'].includes(operation?.type) && ['pending', 'uploading', 'downloading'].includes(operation?.status);
}

function createBatchId() {
	return crypto.randomUUID();
}

export const useUploadQueueStore = defineStore('uploadQueue', {
	state: () => ({
		uploads: [],
	}),
	getters: {
		activeUploads: (state) => state.uploads.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status)),
		totalProgress: (state) => {
			const activeItems = state.uploads.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status));
			if (!activeItems.length) return 0;
			const total = activeItems.reduce((sum, item) => sum + item.progress_percentage, 0);
			return Math.round(total / activeItems.length);
		},
	},
	actions: {
		registerOperation({ type, name, size = 0, status = 'pending', progress = 0, ...metadata }) {
			const operation = {
				id: crypto.randomUUID(),
				type,
				name,
				...metadata,
				size,
				progress_percentage: progress,
				status,
				error: null,
				createdAt: Date.now(),
			};

			this.uploads.unshift(operation);
			return operation;
		},
		registerUpload(file, currentPath, relativePath, metadata = {}) {
			const abortController = new AbortController();
			const upload = {
				id: crypto.randomUUID(),
				type: 'upload',
				file,
				name: relativePath || file.name,
				...metadata,
				size: file.size,
				progress_percentage: 0,
				status: 'pending',
				socket: null,
				abortController,
				currentPath,
				error: null,
			};

			this.uploads.unshift(upload);
			return upload;
		},
		updateUpload(id, patch) {
			const index = this.uploads.findIndex((item) => item.id === id);
			if (index === -1) return;
			this.uploads[index] = { ...this.uploads[index], ...patch };
		},
		closeOperation(id) {
			const operation = this.uploads.find((item) => item.id === id);
			const batchOperations = operation ? [] : this.uploads.filter((item) => item.batchId === id);

			if (batchOperations.length) {
				const hasCancellable = batchOperations.some((item) => isCancellable(item));
				if (hasCancellable) {
					for (const item of batchOperations) {
						item.abortController?.abort?.();
						item.socket?.close?.();
						this.updateUpload(item.id, {
							status: 'cancelled',
							error: null,
						});
					}
					return;
				}

				for (const item of batchOperations) {
					item.socket?.close?.();
				}
				this.uploads = this.uploads.filter((item) => item.batchId !== id);
				return;
			}

			if (isCancellable(operation)) {
				operation.abortController?.abort?.();
				operation.socket?.close?.();
				this.updateUpload(id, {
					status: 'cancelled',
					error: null,
				});
				return;
			}

			if (operation?.socket) {
				operation.socket.close();
			}

			this.uploads = this.uploads.filter((item) => item.id !== id);
		},
		clearOperations() {
			for (const operation of this.uploads) {
				operation.abortController?.abort?.();
				operation.socket?.close?.();
			}
			this.uploads = [];
		},
		async trackServerOperation(metadata, operation) {
			const queueItem = this.registerOperation({ ...metadata, status: 'processing', progress: 15 });

			try {
				this.updateUpload(queueItem.id, { progress_percentage: 45 });
				const result = await operation();
				this.updateUpload(queueItem.id, {
					progress_percentage: 100,
					status: 'completed',
				});
				return result;
			} catch (error) {
				this.updateUpload(queueItem.id, {
					status: 'failed',
					error: error.message,
				});
				throw error;
			}
		},
		async downloadFile(file) {
			return this.downloadFiles(file ? [file] : []);
		},
		async downloadFiles(files) {
			const downloadableFiles = files.filter((file) => file && !file.is_folder);
			if (!downloadableFiles.length) return;

			const batchId = createBatchId();
			const batchTotal = downloadableFiles.length;

			for (const file of downloadableFiles) {
				// Trigger a native browser download via an anchor instead of
				// fetching the whole file into a Blob in memory. The browser
				// streams the response straight to disk (no in-tab buffering, so
				// multi-GB files no longer risk an OOM), and the request carries
				// the auth cookie since the endpoint is same-origin. The tradeoff
				// is that we can't render byte-level progress for downloads, so the
				// queue item reflects "started → completed" rather than a percentage.
				const queueItem = this.registerOperation({
					type: 'download',
					name: file.display_name || file.file_name,
					size: file.size || 0,
					status: 'downloading',
					progress: 100,
					batchId,
					batchTotal,
				});

				try {
					const link = document.createElement('a');
					link.href = api.downloadUrl(file.id);
					link.download = file.display_name || file.file_name || 'download';
					link.rel = 'noopener';
					document.body.appendChild(link);
					link.click();
					link.remove();

					this.updateUpload(queueItem.id, {
						progress_percentage: 100,
						status: 'completed',
					});
				} catch (error) {
					this.updateUpload(queueItem.id, {
						status: 'failed',
						error: error.message,
					});
					if (batchTotal === 1) throw error;
				}
			}
		},
		async uploadFiles(files, currentPath, onCompleted) {
			const entries = Array.from(files || []);
			const batchId = createBatchId();
			const batchTotal = entries.length;

			for (const rawEntry of entries) {
				const { file, relativePath } = normalizeUploadEntry(rawEntry);
				const queueItem = this.registerUpload(file, currentPath, relativePath, { batchId, batchTotal });
				await this.runUpload(queueItem, onCompleted);
			}
		},
		// Run (or re-run) a single registered upload queue item. Extracted so both
		// the initial batch and retryUpload share one implementation.
		async runUpload(queueItem, onCompleted) {
			const { file, currentPath, name: relativePath } = queueItem;
			const targetPath = buildVirtualPath(currentPath, relativePath);

			try {
				const { data } = await api.initiateUpload({
					file_name: file.name,
					size: file.size,
					mime_type: file.type || 'application/octet-stream',
					virtual_path: targetPath,
				}, { signal: queueItem.abortController.signal });

				const socket = api.createUploadSocket(data.upload_id);
				this.updateUpload(queueItem.id, {
					status: 'uploading',
					socket,
					remoteUploadId: data.upload_id,
				});

				socket.onmessage = (event) => {
					if (queueItem.abortController.signal.aborted) return;

					const message = JSON.parse(event.data);
					if (message.type === 'upload:progress') {
						this.updateUpload(queueItem.id, {
							progress_percentage: message.percent,
							status: message.status,
						});
					}

					if (message.type === 'upload:complete') {
						this.updateUpload(queueItem.id, {
							progress_percentage: 100,
							status: 'completed',
						});
						socket.close();
						onCompleted?.();
					}

					if (message.type === 'upload:error') {
						this.updateUpload(queueItem.id, {
							status: 'failed',
							error: message.message,
						});
						socket.close();
					}
				};

				socket.onerror = () => {
					this.updateUpload(queueItem.id, {
						status: 'failed',
						error: 'WebSocket connection failed',
					});
				};

				await api.uploadFile(data.upload_id, file, {
					token: data.session_token,
					signal: queueItem.abortController.signal,
				});
			} catch (error) {
				if (isAbortError(error) || queueItem.abortController.signal.aborted) {
					this.updateUpload(queueItem.id, {
						status: 'cancelled',
						error: null,
					});
					return;
				}

				this.updateUpload(queueItem.id, {
					status: 'failed',
					error: error.message,
				});
			}
		},
		// Retry a previously failed upload. Resets its state and gives it a fresh
		// AbortController (the old one may have been aborted) before re-running.
		async retryUpload(id, onCompleted) {
			const index = this.uploads.findIndex((item) => item.id === id);
			if (index === -1) return;
			const item = this.uploads[index];
			if (item.type !== 'upload' || item.status !== 'failed' || !item.file) return;

			const abortController = new AbortController();
			this.updateUpload(id, {
				status: 'pending',
				progress_percentage: 0,
				error: null,
				socket: null,
				abortController,
			});

			await this.runUpload(this.uploads[this.uploads.findIndex((entry) => entry.id === id)], onCompleted);
		},
		// Retry from the toast, which keys by either a single item id or a batchId.
		// Retries the single matching failed upload, or every failed upload in the
		// batch, re-running them sequentially.
		async retryOperation(id, onCompleted) {
			const single = this.uploads.find((item) => item.id === id);
			if (single && single.type === 'upload') {
				await this.retryUpload(id, onCompleted);
				return;
			}
			const batchFailedIds = this.uploads
				.filter((item) => item.batchId === id && item.type === 'upload' && item.status === 'failed')
				.map((item) => item.id);
			for (const failedId of batchFailedIds) {
				await this.retryUpload(failedId, onCompleted);
			}
		},
	},
});
