import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock allocationService so the allocator's selection math is tested in isolation
// from SQLite. The mock holds an in-memory config + account list + rotation
// state, mirroring the real read/write contract the allocator depends on.
let mockConfig = { strategy: 'most_free', order: [] };
let mockAccounts = [];
let rrCursor = 0;
let swrrState = {};

vi.mock('./allocationService.js', () => ({
	getAllocationConfig: () => mockConfig,
	getOrderedActiveAccounts: () => mockAccounts,
	getRoundRobinCursor: () => rrCursor,
	setRoundRobinCursor: (_userId, cursor) => {
		rrCursor = cursor;
	},
	getSwrrState: () => swrrState,
	setSwrrState: (_userId, state) => {
		swrrState = state;
	},
}));

const { selectBestAccount } = await import('./spaceAllocator.js');

const USER = 'user-1';

function account(id, totalGb, usedGb) {
	const GB = 1024 * 1024 * 1024;
	return { id, provider: id, email: `${id}@x`, total_space: totalGb * GB, used_space: usedGb * GB, created_at: id };
}

beforeEach(() => {
	mockConfig = { strategy: 'most_free', order: [] };
	mockAccounts = [];
	rrCursor = 0;
	swrrState = {};
});

describe('selectBestAccount — guards', () => {
	it('throws when there are no active accounts', () => {
		mockAccounts = [];
		expect(() => selectBestAccount(USER, 100)).toThrow(/No active cloud account/);
	});

	it('returns a fallback chain sorted by free space, excluding the selected account', () => {
		mockConfig = { strategy: 'most_free', order: [] };
		mockAccounts = [account('a', 100, 90), account('b', 100, 10), account('c', 100, 50)];
		const { selected, fallbackChain } = selectBestAccount(USER, 0);
		expect(selected.id).toBe('b'); // most free
		expect(fallbackChain.map((x) => x.id)).toEqual(['c', 'a']);
	});
});

describe('most_free strategy', () => {
	it('picks the account with the largest free space', () => {
		mockConfig = { strategy: 'most_free', order: [] };
		mockAccounts = [account('a', 100, 80), account('b', 100, 20)];
		expect(selectBestAccount(USER, 0).selected.id).toBe('b');
	});
});

describe('least_used strategy', () => {
	it('picks the account with the lowest used ratio among those with enough space', () => {
		mockConfig = { strategy: 'least_used', order: [] };
		// a: 10% used, b: 50% used → a wins
		mockAccounts = [account('a', 100, 10), account('b', 100, 50)];
		expect(selectBestAccount(USER, 1).selected.id).toBe('a');
	});

	it('falls back to all accounts when none has enough space', () => {
		const GB = 1024 * 1024 * 1024;
		mockConfig = { strategy: 'least_used', order: [] };
		mockAccounts = [account('a', 100, 99), account('b', 100, 95)];
		// require 50GB — neither has it; pool falls back to all, lowest ratio (b) wins
		expect(selectBestAccount(USER, 50 * GB).selected.id).toBe('b');
	});
});

describe('manual strategy', () => {
	it('picks the first account in order that fits, respecting provided order', () => {
		mockConfig = { strategy: 'manual', order: ['a', 'b'] };
		// getOrderedActiveAccounts mock returns the array as-is; emulate ordering
		mockAccounts = [account('a', 100, 99), account('b', 100, 10)];
		const GB = 1024 * 1024 * 1024;
		// a does not fit 50GB, b does → b
		expect(selectBestAccount(USER, 50 * GB).selected.id).toBe('b');
	});

	it('falls back to the first account when none fits', () => {
		const GB = 1024 * 1024 * 1024;
		mockConfig = { strategy: 'manual', order: [] };
		mockAccounts = [account('a', 100, 99), account('b', 100, 99)];
		expect(selectBestAccount(USER, 50 * GB).selected.id).toBe('a');
	});
});

describe('round_robin strategy', () => {
	it('advances the cursor across sequential allocations', () => {
		mockConfig = { strategy: 'round_robin', order: [] };
		mockAccounts = [account('a', 100, 0), account('b', 100, 0), account('c', 100, 0)];

		expect(selectBestAccount(USER, 0).selected.id).toBe('a');
		expect(selectBestAccount(USER, 0).selected.id).toBe('b');
		expect(selectBestAccount(USER, 0).selected.id).toBe('c');
		// wraps back to the start
		expect(selectBestAccount(USER, 0).selected.id).toBe('a');
	});

	it('skips accounts without enough free space', () => {
		const GB = 1024 * 1024 * 1024;
		mockConfig = { strategy: 'round_robin', order: [] };
		// b is full; requiring 10GB should skip b and land on c
		mockAccounts = [account('a', 100, 95), account('b', 100, 100), account('c', 100, 0)];
		// cursor starts at 0: a has 5GB free (<10), b 0 free, c 100 free → c
		expect(selectBestAccount(USER, 10 * GB).selected.id).toBe('c');
	});

	it('falls back to the cursor position when no account has enough space', () => {
		const GB = 1024 * 1024 * 1024;
		mockConfig = { strategy: 'round_robin', order: [] };
		mockAccounts = [account('a', 100, 100), account('b', 100, 100)];
		// none fits 10GB → returns the start cursor account (a)
		expect(selectBestAccount(USER, 10 * GB).selected.id).toBe('a');
	});
});

describe('weighted_round_robin strategy', () => {
	it('distributes proportionally to total_space weights (SWRR)', () => {
		mockConfig = { strategy: 'weighted_round_robin', order: [] };
		// weights: a=300, b=100 → over 4 picks expect a:3, b:1
		mockAccounts = [account('a', 300, 0), account('b', 100, 0)];

		const picks = [];
		for (let i = 0; i < 4; i += 1) {
			picks.push(selectBestAccount(USER, 0).selected.id);
		}
		const aCount = picks.filter((id) => id === 'a').length;
		const bCount = picks.filter((id) => id === 'b').length;
		expect(aCount).toBe(3);
		expect(bCount).toBe(1);
	});

	it('only considers accounts with enough free space when at least one fits', () => {
		const GB = 1024 * 1024 * 1024;
		mockConfig = { strategy: 'weighted_round_robin', order: [] };
		// a is full, b has room → b always chosen for a 10GB upload
		mockAccounts = [account('a', 300, 300), account('b', 100, 0)];
		expect(selectBestAccount(USER, 10 * GB).selected.id).toBe('b');
	});
});
