import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';

// Mock every dependency of uploadService so the test exercises only the upload
// pipeline's control flow (account resolution, single-attempt streaming) without
// touching SQLite or real providers.
const adapters = new Map();
const accounts = new Map();

vi.mock('./adapterRegistry.js', () => ({
	createAdapter: (account) => adapters.get(account.id),
}));

vi.mock('./accountService.js', () => ({
	getAccountById: (_userId, id) => accounts.get(id) || null,
	markAccountStatus: vi.fn((_userId, id, status) => {
		const account = accounts.get(id);
		if (account) account.status = status;
	}),
	updateAccountUsage: vi.fn(),
	adjustAccountUsage: vi.fn(),
}));

vi.mock('./fileService.js', () => ({
	upsertFileByRemoteId: vi.fn((record) => ({ id: 'mirror-1', ...record })),
}));

vi.mock('./websocketHub.js', () => ({
	emitUploadEvent: vi.fn(),
}));

const sessionStore = new Map();
vi.mock('./uploadSessionService.js', () => ({
	getUploadSessionForUser: (userId, id) => {
		const session = sessionStore.get(id);
		return session && session.user_id === userId ? session : null;
	},
	updateUploadSession: vi.fn(),
	removeUploadSession: vi.fn((id) => sessionStore.delete(id)),
}));

const { handleUpload } = await import('./uploadService.js');

const BOUNDARY = 'testboundary';

// Build a minimal multipart/form-data request stream that busboy can parse.
function makeRequest(body, { fileName = 'hello.txt' } = {}) {
	const req = new PassThrough();
	req.headers = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
	req.user = { id: 'user-1' };

	const payload = Buffer.concat([
		Buffer.from(`--${BOUNDARY}\r\n`),
		Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
		Buffer.from('Content-Type: text/plain\r\n\r\n'),
		Buffer.from(body),
		Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
	]);

	process.nextTick(() => {
		req.end(payload);
	});
	return req;
}

function registerAccount(id, status = 'active') {
	accounts.set(id, { id, user_id: 'user-1', status, used_space: 0 });
}

function registerSession(overrides = {}) {
	const session = {
		id: 'session-1',
		user_id: 'user-1',
		token: 'tok',
		file_name: 'hello.txt',
		size: 5,
		mime_type: 'text/plain',
		virtual_path: '/',
		remote_parent_id: null,
		cloud_account_id: 'acc-primary',
		fallback_chain: [],
		status: 'pending',
		...overrides,
	};
	sessionStore.set(session.id, session);
	return session;
}

beforeEach(() => {
	adapters.clear();
	accounts.clear();
	sessionStore.clear();
	vi.clearAllMocks();
});

describe('handleUpload', () => {
	it('uploads to the primary account and mirrors the result', async () => {
		registerAccount('acc-primary');
		const uploadStream = vi.fn(async ({ stream }) => {
			// Drain the stream as a real adapter would.
			for await (const _chunk of stream) {
				/* consume */
			}
			return { remoteFileId: 'remote-1', remoteParentId: null, size: 5, fileName: 'hello.txt', mimeType: 'text/plain' };
		});
		adapters.set('acc-primary', { uploadStream });

		registerSession();
		const result = await handleUpload(makeRequest('hello'), 'session-1', 'tok');

		expect(uploadStream).toHaveBeenCalledTimes(1);
		expect(result.remote_file_id).toBe('remote-1');
	});

	it('does NOT re-attempt on another account after a mid-stream failure (no drained re-pipe)', async () => {
		registerAccount('acc-primary');
		registerAccount('acc-fallback');

		const primaryUpload = vi.fn(async ({ stream }) => {
			// Consume some bytes, then fail — simulating a mid-stream provider error.
			for await (const _chunk of stream) {
				/* consume */
			}
			throw new Error('provider exploded mid-stream');
		});
		const fallbackUpload = vi.fn(async () => ({ remoteFileId: 'should-not-happen' }));
		adapters.set('acc-primary', { uploadStream: primaryUpload });
		adapters.set('acc-fallback', { uploadStream: fallbackUpload });

		registerSession({ fallback_chain: ['acc-fallback'] });

		await expect(handleUpload(makeRequest('hello'), 'session-1', 'tok')).rejects.toThrow('provider exploded mid-stream');

		// The critical regression guard: the source stream is consumed once and
		// never replayed to the fallback account.
		expect(primaryUpload).toHaveBeenCalledTimes(1);
		expect(fallbackUpload).not.toHaveBeenCalled();
	});

	it('resolves to a healthy fallback account BEFORE streaming when the primary is not active', async () => {
		registerAccount('acc-primary', 'invalid_token');
		registerAccount('acc-fallback', 'active');

		const fallbackUpload = vi.fn(async ({ stream }) => {
			for await (const _chunk of stream) {
				/* consume */
			}
			return { remoteFileId: 'remote-fb', remoteParentId: null, size: 5, fileName: 'hello.txt' };
		});
		adapters.set('acc-fallback', { uploadStream: fallbackUpload });
		// Primary has no adapter registered; if the code tried to use it, createAdapter would return undefined and throw.

		registerSession({ fallback_chain: ['acc-fallback'] });
		const result = await handleUpload(makeRequest('hello'), 'session-1', 'tok');

		expect(fallbackUpload).toHaveBeenCalledTimes(1);
		expect(result.remote_file_id).toBe('remote-fb');
	});

	it('fails clearly when no connected account is available', async () => {
		registerAccount('acc-primary', 'invalid_token');
		registerSession();

		await expect(handleUpload(makeRequest('hello'), 'session-1', 'tok')).rejects.toThrow(/No connected account/);
	});

	it('rejects when the upload session does not exist', async () => {
		const req = makeRequest('hello');
		await expect(handleUpload(req, 'missing-session', 'tok')).rejects.toThrow('Upload session not found');
	});

	it('rejects when the upload token is missing', async () => {
		registerAccount('acc-primary');
		registerSession();
		await expect(handleUpload(makeRequest('hello'), 'session-1')).rejects.toThrow(/upload token/i);
	});

	it('rejects when the upload token does not match the session', async () => {
		registerAccount('acc-primary');
		registerSession({ token: 'correct-token' });
		await expect(handleUpload(makeRequest('hello'), 'session-1', 'wrong-token')).rejects.toThrow(/upload token/i);
	});
});
