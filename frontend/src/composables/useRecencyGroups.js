import { computed } from 'vue';
import { createRecencyResolver } from './useRecency.js';
import { getCreatedTime, getModifiedTime } from './useFormatFile.js';

export function useRecencyGroups(files, t) {
	const groups = computed(() => {
		const groupsByKey = {
			today: { key: 'today', label: t('recent.today'), items: [] },
			yesterday: { key: 'yesterday', label: t('recent.yesterday'), items: [] },
			thisWeek: { key: 'thisWeek', label: t('recent.thisWeek'), items: [] },
			lastWeek: { key: 'lastWeek', label: t('recent.lastWeek'), items: [] },
			thisMonth: { key: 'thisMonth', label: t('recent.thisMonth'), items: [] },
			lastMonth: { key: 'lastMonth', label: t('recent.lastMonth'), items: [] },
			thisYear: { key: 'thisYear', label: t('recent.thisYear'), items: [] },
			lastYear: { key: 'lastYear', label: t('recent.lastYear'), items: [] },
			older: { key: 'older', label: t('recent.older'), items: [] },
		};

		// Compute the date-range boundaries once for the whole pass instead of
		// rebuilding them inside resolveRecencyGroup for every file.
		const resolveRecency = createRecencyResolver();
		for (const file of files.value) {
			const key = resolveRecency(getModifiedTime(file) || getCreatedTime(file));
			groupsByKey[key]?.items.push(file);
		}

		return Object.values(groupsByKey).filter((group) => group.items.length);
	});

	return { groups };
}
