import { computed, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { formatBytesStrict } from './useFormatFile.js';
import { useAccountManagementStore } from '../stores/accountManagement';
import { api } from '../services/api.js';

export function useStorageStats() {
	const accountStore = useAccountManagementStore();
	const { accounts } = storeToRefs(accountStore);
	const { t } = useI18n();

	// Usable capacity fetched from backend (reflects RAID replica overhead)
	const capacityData = ref(null);

	async function refreshCapacity() {
		try {
			const { data } = await api.getCapacity();
			capacityData.value = data;
		} catch {
			// Fallback: will use raw totals from accounts
			capacityData.value = null;
		}
	}

	// Refresh capacity whenever accounts change
	watchEffect(() => {
		if (accounts.value.length > 0) {
			refreshCapacity();
		}
	});

	// Raw totals (from accounts, for account-level display in Overview tab)
	const totalUsed = computed(() =>
		accounts.value.reduce((sum, account) => sum + Number(account.used_space || 0), 0),
	);

	const totalSpace = computed(() =>
		accounts.value.reduce((sum, account) => sum + Number(account.total_space || 0), 0),
	);

	const totalFree = computed(() => Math.max(0, totalSpace.value - totalUsed.value));

	// Effective usable capacity (RAID-aware) — used for sidebar + storage indicator
	const usableCapacity = computed(() =>
		capacityData.value ? Number(capacityData.value.usableCapacity) : totalSpace.value,
	);
	const rawTotal = computed(() =>
		capacityData.value ? Number(capacityData.value.rawTotal) : totalSpace.value,
	);
	const replicaOverhead = computed(() =>
		capacityData.value ? Number(capacityData.value.replicaOverhead) : 0,
	);
	const replicationFactor = computed(() =>
		capacityData.value ? Number(capacityData.value.replicationFactor) : 1,
	);

	// In RAID mode, we only count the primary (unique) file sizes as the "used" space in the progress bar
	const effectiveUsed = computed(() =>
		capacityData.value ? Number(capacityData.value.primaryUsed) : totalUsed.value,
	);

	// storagePercent uses usable capacity as the denominator so the bar fills correctly
	const storagePercent = computed(() => {
		if (!usableCapacity.value) return 0;
		return Math.min(100, (effectiveUsed.value / usableCapacity.value) * 100);
	});

	const storagePercentRounded = computed(() => Math.round(storagePercent.value));

	const usedFormatted = computed(() => formatBytesStrict(effectiveUsed.value));
	const usableFormatted = computed(() => formatBytesStrict(usableCapacity.value));
	const rawTotalFormatted = computed(() => formatBytesStrict(rawTotal.value));
	const totalFormatted = computed(() => usableFormatted.value); // alias for sidebar compat
	const freeFormatted = computed(() => formatBytesStrict(Math.max(0, usableCapacity.value - effectiveUsed.value)));

	const storageLabel = computed(() =>
		t('sidebar.storageUsed', { used: usedFormatted.value, total: usableFormatted.value }),
	);

	const usedTotalLabel = computed(() => `${usedFormatted.value} / ${usableFormatted.value}`);

	return {
		accounts,
		totalUsed,
		totalSpace,
		totalFree,
		usableCapacity,
		rawTotal,
		replicaOverhead,
		replicationFactor,
		storagePercent,
		storagePercentRounded,
		usedFormatted,
		usableFormatted,
		rawTotalFormatted,
		totalFormatted,
		freeFormatted,
		storageLabel,
		usedTotalLabel,
		refreshCapacity,
	};
}
