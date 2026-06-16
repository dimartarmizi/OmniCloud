import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { formatBytes } from './useFormatFile.js';
import { useAccountManagementStore } from '../stores/accountManagement';

export function useStorageStats() {
	const accountStore = useAccountManagementStore();
	const { accounts } = storeToRefs(accountStore);
	const { t } = useI18n();

	const totalUsed = computed(() =>
		accounts.value.reduce((sum, account) => sum + Number(account.used_space || 0), 0),
	);

	const totalSpace = computed(() =>
		accounts.value.reduce((sum, account) => sum + Number(account.total_space || 0), 0),
	);

	const totalFree = computed(() => Math.max(0, totalSpace.value - totalUsed.value));

	const storagePercent = computed(() => {
		if (!totalSpace.value) return 0;
		return Math.min(100, (totalUsed.value / totalSpace.value) * 100);
	});

	const storagePercentRounded = computed(() => Math.round(storagePercent.value));

	const usedFormatted = computed(() => formatBytes(totalUsed.value, { strict: true }));
	const totalFormatted = computed(() => formatBytes(totalSpace.value, { strict: true }));
	const freeFormatted = computed(() => formatBytes(totalFree.value, { strict: true }));

	const storageLabel = computed(() =>
		t('sidebar.storageUsed', { used: usedFormatted.value, total: totalFormatted.value }),
	);

	const usedTotalLabel = computed(() => `${usedFormatted.value} / ${totalFormatted.value}`);

	return {
		accounts,
		totalUsed,
		totalSpace,
		totalFree,
		storagePercent,
		storagePercentRounded,
		usedFormatted,
		totalFormatted,
		freeFormatted,
		storageLabel,
		usedTotalLabel,
	};
}
