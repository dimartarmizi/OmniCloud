import { db } from '../config/database.js';
import { getActiveAccounts } from './accountService.js';

export const ALLOCATION_STRATEGIES = [
	'round_robin',
	'weighted_round_robin',
	'least_used',
	'most_free',
	'manual',
];

export const DEFAULT_STRATEGY = 'round_robin';

// Dragging N files fires N sequential /uploads/initiate calls in a short burst.
// Each call reads the strategy/order config and the active-account list from
// SQLite. These reads are identical across the burst (used_space only changes
// once bytes actually stream, which happens after all initiations), so we
// memoize them per-user for a short window to avoid 2*N redundant queries.
// Rotation state (cursor/SWRR) is intentionally NOT cached: it must advance on
// every allocation. Writes invalidate the cache so a strategy/order change or a
// newly connected account is reflected immediately.
const READ_CACHE_TTL_MS = 2000;
const configCache = new Map();
const activeAccountsCache = new Map();

function readCached(cache, userId, loader) {
	const now = Date.now();
	const hit = cache.get(userId);
	if (hit && hit.expiresAt > now) {
		return hit.value;
	}
	const value = loader();
	cache.set(userId, { value, expiresAt: now + READ_CACHE_TTL_MS });
	return value;
}

function invalidateAllocationCache(userId) {
	configCache.delete(userId);
	activeAccountsCache.delete(userId);
}

const SETTING_KEYS = {
	strategy: 'allocation_strategy',
	order: 'allocation_order',
	rrCursor: 'allocation_rr_cursor',
	swrrState: 'allocation_swrr_state',
};

function readSetting(userId, key) {
	const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
	return row ? row.value : null;
}

function writeSetting(userId, key, value) {
	db.prepare(`
		INSERT INTO user_settings (id, user_id, key, value, updated_at)
		VALUES (lower(hex(randomblob(16))), ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id, key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`).run(userId, key, value);
}

function parseJson(value, fallback) {
	if (!value) return fallback;
	try {
		const parsed = JSON.parse(value);
		return parsed ?? fallback;
	} catch {
		return fallback;
	}
}

export function getAllocationConfig(userId) {
	return readCached(configCache, userId, () => {
		const strategyRaw = readSetting(userId, SETTING_KEYS.strategy);
		const strategy = ALLOCATION_STRATEGIES.includes(strategyRaw) ? strategyRaw : DEFAULT_STRATEGY;
		const order = parseJson(readSetting(userId, SETTING_KEYS.order), []).filter((id) => typeof id === 'string');

		return { strategy, order };
	});
}

export function getOrderedActiveAccounts(userId) {
	const active = readCached(activeAccountsCache, userId, () => getActiveAccounts(userId));
	const { order } = getAllocationConfig(userId);
	const byId = new Map(active.map((account) => [account.id, account]));

	const ordered = [];
	order.forEach((id) => {
		if (byId.has(id)) {
			ordered.push(byId.get(id));
			byId.delete(id);
		}
	});

	[...byId.values()]
		.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
		.forEach((account) => ordered.push(account));

	return ordered;
}

export function setAllocationConfig(userId, { strategy, order } = {}) {
	const current = getAllocationConfig(userId);
	let nextStrategy = current.strategy;
	let nextOrder = current.order;
	let shouldReset = false;

	if (strategy !== undefined) {
		if (!ALLOCATION_STRATEGIES.includes(strategy)) {
			throw new Error(`Invalid allocation strategy: ${strategy}`);
		}
		if (strategy !== current.strategy) {
			shouldReset = true;
		}
		nextStrategy = strategy;
		writeSetting(userId, SETTING_KEYS.strategy, strategy);
	}

	if (order !== undefined) {
		if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
			throw new Error('Allocation order must be an array of account ids');
		}
		shouldReset = true;
		nextOrder = order;
		writeSetting(userId, SETTING_KEYS.order, JSON.stringify(order));
	}

	if (shouldReset) {
		resetRotationState(userId);
	}

	invalidateAllocationCache(userId);

	return { strategy: nextStrategy, order: nextOrder };
}

export function resetRotationState(userId) {
	writeSetting(userId, SETTING_KEYS.rrCursor, '0');
	writeSetting(userId, SETTING_KEYS.swrrState, '{}');
}

export function getRoundRobinCursor(userId) {
	return Number(readSetting(userId, SETTING_KEYS.rrCursor)) || 0;
}

export function setRoundRobinCursor(userId, cursor) {
	writeSetting(userId, SETTING_KEYS.rrCursor, String(cursor));
}

export function getSwrrState(userId) {
	return parseJson(readSetting(userId, SETTING_KEYS.swrrState), {});
}

export function setSwrrState(userId, state) {
	writeSetting(userId, SETTING_KEYS.swrrState, JSON.stringify(state || {}));
}
