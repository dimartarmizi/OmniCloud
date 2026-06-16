import dropboxLogo from '../assets/dropbox.svg';
import googleDriveLogo from '../assets/google-drive.svg';
import megaLogo from '../assets/mega.svg';
import oneDriveLogo from '../assets/microsoft-onedrive.svg';
import pcloudLogo from '../assets/pcloud.svg';
import s3Logo from '../assets/s3-storage.svg';
import yandexLogo from '../assets/yandex-disk.svg';

const PROVIDER_META = {
	google_drive: { key: 'google_drive', label: 'Google Drive', icon: googleDriveLogo },
	onedrive: { key: 'onedrive', label: 'OneDrive', icon: oneDriveLogo },
	dropbox: { key: 'dropbox', label: 'Dropbox', icon: dropboxLogo },
	mega: { key: 'mega', label: 'MEGA', icon: megaLogo },
	pcloud: { key: 'pcloud', label: 'pCloud', icon: pcloudLogo },
	yandex: { key: 'yandex', label: 'Yandex Disk', icon: yandexLogo },
	s3: { key: 's3', label: 'S3 Storage', icon: s3Logo },
};

function toNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

// Hoisted so formatBytes does not rebuild this array on every call (invoked once
// per rendered row, per re-render).
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function getProviderMeta(provider) {
	return PROVIDER_META[provider] || { key: provider || 'unknown', label: provider || 'Provider', icon: null };
}

export function providerKey(file) {
	return `${file.provider || 'unknown'}::${file.email || ''}`;
}

export function providerLabel(provider) {
	return getProviderMeta(provider).label;
}

export function providerIcon(provider) {
	return getProviderMeta(provider).icon;
}

/**
 * Format a byte count for display.
 *
 * @param {number} value
 * @param {object} [options]
 * @param {boolean} [options.strict=false] When false (default), a falsy value
 *   (0, null, undefined) renders as an em-dash placeholder ("—"). When true,
 *   the value is always formatted numerically (e.g. 0 → "0 B"), which is what
 *   storage/quota readouts want.
 */
export function formatBytes(value, { strict = false } = {}) {
	if (!strict && !value) return '—';
	let amount = toNumber(value);
	let index = 0;
	while (amount >= 1024 && index < BYTE_UNITS.length - 1) {
		amount /= 1024;
		index += 1;
	}
	return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${BYTE_UNITS[index]}`;
}

// Intl.DateTimeFormat construction resolves locale data and is comparatively
// expensive; formatDate is called once per rendered row and the file lists
// re-render on every scroll/filter/sort/search. Cache one formatter per locale
// and reuse it, instead of building a fresh formatter on each call.
const dateFormatterCache = new Map();

function getDateFormatter(locale) {
	let formatter = dateFormatterCache.get(locale);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
		dateFormatterCache.set(locale, formatter);
	}
	return formatter;
}

export function formatDate(value, locale = 'id-ID') {
	if (!value) return '—';
	return getDateFormatter(locale).format(new Date(value));
}

export function getCreatedTime(file) {
	return file.createdTime;
}

export function getModifiedTime(file) {
	return file.modifiedTime;
}
