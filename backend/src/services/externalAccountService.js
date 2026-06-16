import { randomUUID } from 'crypto';
import { upsertCloudAccount, markAccountStatus } from './accountService.js';
import { syncAccount } from './syncService.js';
import { pcloudLogin } from '../utils/pcloudClient.js';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

const GIB = 1024 * 1024 * 1024;

const DEFAULT_S3_TOTAL_SPACE = 10 * GIB;

// Block obvious SSRF targets: the S3 endpoint is user-supplied and used to make
// outbound requests from the server, so it must be a public https URL and must
// not point at localhost, link-local, or private/internal ranges. This is a
// best-effort hostname/IP check (not a full network-policy guard) but stops the
// common "point the server at the cloud metadata endpoint / intranet" attack.
function assertSafeS3Endpoint(rawEndpoint) {
	let url;
	try {
		url = new URL(rawEndpoint);
	} catch {
		throw new Error('Endpoint must be a valid URL (e.g. https://s3.example.com)');
	}

	if (url.protocol !== 'https:') {
		throw new Error('Endpoint must use https.');
	}

	const host = url.hostname.toLowerCase();

	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
		throw new Error('Endpoint host is not allowed.');
	}

	// Cloud metadata service and loopback/link-local literals.
	if (host === '169.254.169.254' || host === '[::1]' || host === '::1') {
		throw new Error('Endpoint host is not allowed.');
	}

	// IPv4 private / loopback / link-local ranges.
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b] = ipv4.slice(1).map(Number);
		const isPrivate =
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a === 0;
		if (isPrivate) {
			throw new Error('Endpoint host is not allowed (private/loopback address).');
		}
	}

	// IPv6 private (unique-local fc00::/7) and link-local (fe80::/10).
	if (host.startsWith('[')) {
		const inner = host.slice(1, -1);
		if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(inner)) {
			throw new Error('Endpoint host is not allowed (private/link-local address).');
		}
	}

	return url.toString();
}

function buildEmailLabel(provider, identifier) {
	return identifier || `${provider}-account`;
}

export async function connectS3Account(userId, body = {}) {
	const {
		accessKeyId,
		secretAccessKey,
		bucket,
		region: regionInput,
		endpoint: endpointInput,
		label,
		totalSpace,
		forcePathStyle,
	} = body;

	if (!accessKeyId || !secretAccessKey || !bucket) {
		throw new Error('accessKeyId, secretAccessKey, and bucket are required');
	}

	const region = regionInput || 'auto';

	if (!endpointInput) {
		throw new Error('Endpoint is required (e.g. https://your-s3-endpoint)');
	}

	// Validate/normalize the endpoint before it is used for any outbound request.
	const endpoint = assertSafeS3Endpoint(endpointInput);

	const client = new S3Client({
		region,
		endpoint,
		forcePathStyle: forcePathStyle !== false,
		credentials: { accessKeyId, secretAccessKey },
	});

	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
	} catch (error) {
		const status = error?.$metadata?.httpStatusCode;
		const name = error?.name;

		if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
			throw new Error(`Bucket "${bucket}" was not found on this endpoint. Check the bucket name and endpoint.`);
		}
		if (status === 403 || name === 'Forbidden' || name === 'AccessDenied') {
			throw new Error('Access denied. Check the access key, secret key, and bucket permissions.');
		}
		if (status === 401 || name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
			throw new Error('Invalid credentials. Check the access key ID and secret access key.');
		}
		if (error?.code === 'ENOTFOUND' || /getaddrinfo|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(error?.message || '')) {
			throw new Error(`Could not reach the endpoint "${endpoint}". Check the endpoint URL.`);
		}
		throw new Error(`Failed to connect to S3 bucket: ${name || error?.message || 'unknown error'} (HTTP ${status ?? 'n/a'}).`);
	}

	const email = buildEmailLabel('s3', label || `${bucket}@s3`);
	const resolvedTotal = Number(totalSpace) || DEFAULT_S3_TOTAL_SPACE;

	const account = upsertCloudAccount({
		userId,
		id: randomUUID(),
		email,
		provider: 's3',
		credentials: {
			provider: 's3',
			accessKeyId,
			secretAccessKey,
			bucket,
			region,
			endpoint: endpoint || null,
			forcePathStyle: forcePathStyle !== false,
		},
		total_space: resolvedTotal,
		used_space: 0,
		status: 'active',
	});

	await syncAccount(userId, account).catch((error) => {
		markAccountStatus(userId, account.id, 'active');
		console.warn('S3 initial sync warning:', error?.message || error);
	});

	return { account, profile: { email, provider: 's3' } };
}

export async function connectPCloudAccount(userId, body = {}) {
	const { username, password } = body;
	if (!username || !password) {
		throw new Error('pCloud username (email) and password are required');
	}

	const login = await pcloudLogin({ username, password });

	const account = upsertCloudAccount({
		userId,
		id: randomUUID(),
		email: login.email || username,
		provider: 'pcloud',
		credentials: {
			provider: 'pcloud',
			username,
			password,
			host: login.host,
			auth: login.auth,
		},
		total_space: login.totalSpace,
		used_space: login.usedSpace,
		status: 'active',
	});

	await syncAccount(userId, account).catch((error) => {
		console.warn('pCloud initial sync warning:', error?.message || error);
	});

	return {
		account,
		profile: {
			email: login.email || username,
			totalSpace: login.totalSpace,
			usedSpace: login.usedSpace,
		},
	};
}
