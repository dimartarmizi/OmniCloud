import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveRecencyGroup, startOfWeek, createRecencyResolver } from './useRecency.js';

// Pin "now" to a deterministic instant so date-bucket boundaries are stable.
// Chosen: Wednesday, 2024-06-12 14:30 local time. Wednesday keeps both the
// start-of-week (Monday) and prior buckets comfortably inside the same month.
const NOW = new Date(2024, 5, 12, 14, 30, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

// Build a Date offset by whole days from NOW (negative = past).
function daysAgo(days, hour = 12) {
	return new Date(2024, 5, 12 - days, hour, 0, 0).toISOString();
}

describe('startOfWeek', () => {
	it('returns Monday 00:00 for a mid-week date', () => {
		const monday = startOfWeek(NOW);
		expect(monday.getDay()).toBe(1); // Monday
		expect(monday.getHours()).toBe(0);
		expect(monday.getMinutes()).toBe(0);
		// NOW is Wed Jun 12 → Monday is Jun 10
		expect(monday.getDate()).toBe(10);
	});

	it('treats Sunday as the end of the current week (Monday is 6 days back)', () => {
		const sunday = new Date(2024, 5, 16, 9, 0, 0); // Sunday Jun 16
		const monday = startOfWeek(sunday);
		expect(monday.getDay()).toBe(1);
		expect(monday.getDate()).toBe(10); // still Jun 10
	});
});

describe('resolveRecencyGroup', () => {
	it('returns "older" for a null/empty value', () => {
		expect(resolveRecencyGroup(null)).toBe('older');
		expect(resolveRecencyGroup('')).toBe('older');
		expect(resolveRecencyGroup(undefined)).toBe('older');
	});

	it('buckets a timestamp from earlier today as "today"', () => {
		expect(resolveRecencyGroup(new Date(2024, 5, 12, 8, 0, 0).toISOString())).toBe('today');
	});

	it('buckets yesterday correctly', () => {
		expect(resolveRecencyGroup(daysAgo(1))).toBe('yesterday');
	});

	it('buckets earlier-this-week (not today/yesterday) as "thisWeek"', () => {
		// Monday Jun 10 is this week but before yesterday (Jun 11)
		expect(resolveRecencyGroup(new Date(2024, 5, 10, 9, 0, 0).toISOString())).toBe('thisWeek');
	});

	it('buckets last week as "lastWeek"', () => {
		// Jun 5 (previous week)
		expect(resolveRecencyGroup(new Date(2024, 5, 5, 9, 0, 0).toISOString())).toBe('lastWeek');
	});

	it('buckets earlier this month as "thisMonth"', () => {
		// Jun 1 — same month, before last-week boundary
		expect(resolveRecencyGroup(new Date(2024, 5, 1, 9, 0, 0).toISOString())).toBe('thisMonth');
	});

	it('buckets last month as "lastMonth"', () => {
		expect(resolveRecencyGroup(new Date(2024, 4, 15, 9, 0, 0).toISOString())).toBe('lastMonth');
	});

	it('buckets earlier this year as "thisYear"', () => {
		expect(resolveRecencyGroup(new Date(2024, 1, 10, 9, 0, 0).toISOString())).toBe('thisYear');
	});

	it('buckets last year as "lastYear"', () => {
		expect(resolveRecencyGroup(new Date(2023, 7, 10, 9, 0, 0).toISOString())).toBe('lastYear');
	});

	it('buckets anything older than last year as "older"', () => {
		expect(resolveRecencyGroup(new Date(2021, 0, 1, 9, 0, 0).toISOString())).toBe('older');
	});
});

describe('createRecencyResolver', () => {
	it('produces identical buckets to resolveRecencyGroup across all ranges', () => {
		const resolve = createRecencyResolver();
		const samples = [
			null,
			'',
			new Date(2024, 5, 12, 8, 0, 0).toISOString(), // today
			daysAgo(1), // yesterday
			new Date(2024, 5, 10, 9, 0, 0).toISOString(), // thisWeek
			new Date(2024, 5, 5, 9, 0, 0).toISOString(), // lastWeek
			new Date(2024, 5, 1, 9, 0, 0).toISOString(), // thisMonth
			new Date(2024, 4, 15, 9, 0, 0).toISOString(), // lastMonth
			new Date(2024, 1, 10, 9, 0, 0).toISOString(), // thisYear
			new Date(2023, 7, 10, 9, 0, 0).toISOString(), // lastYear
			new Date(2021, 0, 1, 9, 0, 0).toISOString(), // older
		];
		for (const sample of samples) {
			expect(resolve(sample)).toBe(resolveRecencyGroup(sample));
		}
	});

	it('reuses one set of boundaries for every value (resolver is a closure)', () => {
		const resolve = createRecencyResolver();
		expect(resolve(new Date(2024, 5, 12, 8, 0, 0).toISOString())).toBe('today');
		expect(resolve(daysAgo(1))).toBe('yesterday');
		expect(resolve(null)).toBe('older');
	});
});
