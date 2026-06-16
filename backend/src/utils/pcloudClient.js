import crypto from 'crypto';

export const PCLOUD_HOSTS = ['api.pcloud.com', 'eapi.pcloud.com'];

function sha1Hex(value) {
	return crypto.createHash('sha1').update(value).digest('hex');
}

async function pcloudGet(host, method, params = {}) {
	const url = new URL(`https://${host}/${method}`);
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	});

	const response = await fetch(url.toString());
	const payload = await response.json().catch(() => null);

	if (!payload) {
		throw new Error('pCloud returned an invalid response');
	}

	if (payload.result !== 0) {
		const error = new Error(payload.error || `pCloud error ${payload.result}`);
		error.result = payload.result;
		throw error;
	}

	return payload;
}

export async function pcloudLogin({ username, password }) {
	let lastError = null;

	for (const host of PCLOUD_HOSTS) {
		try {
			const { digest } = await pcloudGet(host, 'getdigest');
			const usernameHash = sha1Hex(String(username).toLowerCase());
			const passwordDigest = sha1Hex(password + usernameHash + digest);

			const auth = await pcloudGet(host, 'login', {
				getauth: 1,
				logout: 0,
				username,
				digest,
				passworddigest: passwordDigest,
			});

			if (!auth.auth) {
				throw new Error('pCloud login did not return an auth token');
			}

			return {
				host,
				auth: auth.auth,
				email: auth.email || username,
				totalSpace: Number(auth.quota || 0),
				usedSpace: Number(auth.usedquota || 0),
			};
		} catch (error) {
			lastError = error;
			// pCloud result 2000 means "login failed" (bad credentials): the same
			// answer comes from every host, so stop trying other regions. Any other
			// error (network, transient, or region-specific) falls through to retry
			// against the next host.
			if (error.result === 2000) {
				break;
			}
		}
	}

	throw lastError || new Error('Unable to log in to pCloud');
}

export { pcloudGet };
