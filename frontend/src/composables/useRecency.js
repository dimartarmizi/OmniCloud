export function startOfWeek(date) {
	const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const day = copy.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	copy.setDate(copy.getDate() + diff);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

/**
 * Build a recency resolver whose date-range boundaries are computed ONCE from
 * "now", then reused for every value tested. Grouping a list calls the resolver
 * per file; the boundaries depend only on the current time, so rebuilding ~9
 * Date objects per file (the previous behavior of resolveRecencyGroup) was pure
 * loop-invariant waste. For N files this turns 10*N Date allocations into ~10.
 */
export function createRecencyResolver(now = new Date()) {
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterdayStart = new Date(todayStart);
	yesterdayStart.setDate(yesterdayStart.getDate() - 1);
	const thisWeekStart = startOfWeek(now);
	const lastWeekStart = new Date(thisWeekStart);
	lastWeekStart.setDate(lastWeekStart.getDate() - 7);
	const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const thisYearStart = new Date(now.getFullYear(), 0, 1);
	const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);

	return function resolve(value) {
		if (!value) return 'older';
		const fileDate = new Date(value);

		if (fileDate >= todayStart) return 'today';
		if (fileDate >= yesterdayStart) return 'yesterday';
		if (fileDate >= thisWeekStart) return 'thisWeek';
		if (fileDate >= lastWeekStart) return 'lastWeek';
		if (fileDate >= thisMonthStart) return 'thisMonth';
		if (fileDate >= lastMonthStart) return 'lastMonth';
		if (fileDate >= thisYearStart) return 'thisYear';
		if (fileDate >= lastYearStart) return 'lastYear';
		return 'older';
	};
}

// Single-value convenience wrapper. For grouping many files in one pass, prefer
// createRecencyResolver() so the boundaries are built once.
export function resolveRecencyGroup(value) {
	return createRecencyResolver()(value);
}
