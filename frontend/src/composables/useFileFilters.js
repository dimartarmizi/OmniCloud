export function matchesUpdatedFilter(value, filter) {
	if (!value) return false;
	if (filter === 'all') return true;
	return createUpdatedFilterPredicate(filter)(value);
}

/**
 * Compile an "updated" date-range filter into a predicate whose boundary dates
 * are computed once, instead of rebuilding ~7 Date objects on every call. Used
 * by list views to test many files against the same active filter without
 * redundant per-item allocation. The returned predicate accepts a Date or any
 * Date-parseable value and preserves the exact ranges of matchesUpdatedFilter.
 */
export function createUpdatedFilterPredicate(filter) {
	if (filter === 'all') {
		return () => true;
	}

	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const last7Start = new Date(todayStart);
	last7Start.setDate(last7Start.getDate() - 6);
	const last30Start = new Date(todayStart);
	last30Start.setDate(last30Start.getDate() - 29);
	const thisYearStart = new Date(now.getFullYear(), 0, 1);
	const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
	const lastYearEnd = new Date(now.getFullYear(), 0, 1);

	switch (filter) {
		case 'today':
			return (value) => value != null && new Date(value) >= todayStart;
		case 'last7':
			return (value) => value != null && new Date(value) >= last7Start;
		case 'last30':
			return (value) => value != null && new Date(value) >= last30Start;
		case 'thisYear':
			return (value) => value != null && new Date(value) >= thisYearStart;
		case 'lastYear':
			return (value) => {
				if (value == null) return false;
				const fileDate = new Date(value);
				return fileDate >= lastYearStart && fileDate < lastYearEnd;
			};
		default:
			return () => true;
	}
}
