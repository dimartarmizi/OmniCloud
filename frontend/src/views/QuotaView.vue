<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
	IconChevronDown,
	IconCloud,
	IconLinkPlus,
	IconPlugConnected,
	IconPlugConnectedX,
	IconRefresh,
	IconArrowUp,
	IconArrowDown,
	IconGripVertical,
	IconDeviceFloppy,
	IconCheck,
	IconChartPie,
	IconAdjustments,
} from '@tabler/icons-vue';
import DriveShell from '../components/DriveShell.vue';
import MegaConnectModal from '../components/MegaConnectModal.vue';
import PCloudConnectModal from '../components/PCloudConnectModal.vue';
import S3ConnectModal from '../components/S3ConnectModal.vue';
import TruncateMarquee from '../components/TruncateMarquee.vue';
import { useAccountManagementStore } from '../stores/accountManagement';
import { api } from '../services/api';
import { confirmDialog } from '../composables/useDialog.js';
import { formatBytes, providerIcon, providerLabel } from '../composables/useFormatFile.js';
import { useStorageStats } from '../composables/useStorageStats.js';

const { t } = useI18n();
const accountStore = useAccountManagementStore();
const { accounts, isLoading, error, isDisconnectingId } = storeToRefs(accountStore);
const route = useRoute();
const router = useRouter();
const { totalSpace, totalFree, usedFormatted, freeFormatted, usedTotalLabel } = useStorageStats();

const connectingProvider = ref('');
const actionError = ref('');
const actionSuccess = ref('');
let successTimer = null;

// Show a transient success banner that auto-dismisses after a few seconds, so
// the green OAuth-return message doesn't linger until the next action.
function showActionSuccess(message) {
	actionSuccess.value = message;
	if (successTimer) clearTimeout(successTimer);
	successTimer = setTimeout(() => {
		actionSuccess.value = '';
		successTimer = null;
	}, 4000);
}

const isSyncing = ref(false);
const isConnectMenuOpen = ref(false);
const isMegaModalOpen = ref(false);
const isPCloudModalOpen = ref(false);
const isS3ModalOpen = ref(false);

const ALLOCATION_STRATEGIES = ['round_robin', 'weighted_round_robin', 'least_used', 'most_free', 'manual'];
const activeTab = ref('overview');
const selectedStrategy = ref('round_robin');
const allocationOrder = ref([]);
const isAllocationLoading = ref(false);
const isSavingAllocation = ref(false);
const allocationError = ref('');
const allocationSaved = ref(false);
const dragIndex = ref(null);

const allocationStrategyOptions = computed(() =>
	ALLOCATION_STRATEGIES.map((key) => ({
		key,
		label: t(`allocation.strategies.${key}`),
		description: t(`allocation.strategies.${key}_desc`),
	})),
);

const orderedAllocationAccounts = computed(() => {
	const byId = new Map(accounts.value.map((account) => [account.id, account]));
	const ordered = [];
	allocationOrder.value.forEach((id) => {
		if (byId.has(id)) {
			ordered.push(byId.get(id));
			byId.delete(id);
		}
	});
	[...byId.values()].forEach((account) => ordered.push(account));
	return ordered;
});

const accountPalette = [
	{
		used: 'bg-[#1a73e8]',
		free: 'bg-[#d2e3fc]',
		surface: 'bg-[#e8f0fe]',
		text: 'text-[#1a73e8]',
	},
	{
		used: 'bg-[#188038]',
		free: 'bg-[#ceead6]',
		surface: 'bg-[#e6f4ea]',
		text: 'text-[#188038]',
	},
	{
		used: 'bg-[#c26401]',
		free: 'bg-[#fce8b2]',
		surface: 'bg-[#fef7e0]',
		text: 'text-[#c26401]',
	},
	{
		used: 'bg-[#9334e6]',
		free: 'bg-[#e9d7fe]',
		surface: 'bg-[#f3e8ff]',
		text: 'text-[#9334e6]',
	},
];

const providerConnectOptions = computed(() => [
	{
		key: 'google_drive',
		label: t('providers.googleDrive'),
		busyLabel: t('storage.connectingProvider', { provider: 'Google' }),
		icon: providerIcon('google_drive'),
		action: connectGoogleDrive,
	},
	{
		key: 'onedrive',
		label: t('providers.oneDrive'),
		busyLabel: t('storage.connectingProvider', { provider: 'OneDrive' }),
		icon: providerIcon('onedrive'),
		action: connectOneDrive,
	},
	{
		key: 'dropbox',
		label: t('providers.dropbox'),
		busyLabel: t('storage.connectingProvider', { provider: 'Dropbox' }),
		icon: providerIcon('dropbox'),
		action: connectDropbox,
	},
	{
		key: 'mega',
		label: t('providers.mega'),
		busyLabel: t('storage.connectingProvider', { provider: 'MEGA' }),
		icon: providerIcon('mega'),
		action: openMegaModal,
	},
	{
		key: 'pcloud',
		label: t('providers.pcloud'),
		busyLabel: t('storage.connectingProvider', { provider: 'pCloud' }),
		icon: providerIcon('pcloud'),
		action: openPCloudModal,
	},
	{
		key: 'yandex',
		label: t('providers.yandex'),
		busyLabel: t('storage.connectingProvider', { provider: 'Yandex' }),
		icon: providerIcon('yandex'),
		action: connectYandex,
	},
	{
		key: 's3',
		label: t('providers.s3'),
		busyLabel: t('storage.connectingProvider', { provider: 'S3' }),
		icon: providerIcon('s3'),
		action: openS3Modal,
	},
]);

const storageSegments = computed(() => {
	const total = totalSpace.value || 1;

	const accountSegments = accounts.value.flatMap((account, index) => {
		const used = Math.max(0, Number(account.used_space || 0));
		const capacity = Math.max(0, Number(account.total_space || 0));
		const free = Math.max(0, capacity - used);
		const palette = accountPalette[index % accountPalette.length];

		return [
			{
				key: `${account.id}-used`,
				width: `${(used / total) * 100}%`,
				className: palette.used,
			},
			{
				key: `${account.id}-free`,
				width: `${(free / total) * 100}%`,
				className: palette.free,
			},
		].filter((segment) => Number.parseFloat(segment.width) > 0);
	});

	if (!accounts.value.length && totalFree.value > 0) {
		return [
			{
				key: 'empty-free',
				width: '100%',
				className: 'bg-[#eef2f7] dark:bg-slate-700',
			},
		];
	}

	return accountSegments;
});

const accountLegends = computed(() =>
	accounts.value.map((account, index) => {
		const used = Math.max(0, Number(account.used_space || 0));
		const total = Math.max(0, Number(account.total_space || 0));
		const free = Math.max(0, total - used);
		return {
			...account,
			used,
			free,
			palette: accountPalette[index % accountPalette.length],
		};
	}),
);

function providerBadgeClass(status) {
	return status === 'active'
		? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
		: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
}

function isReconnectable(account) {
	return ['suspended', 'invalid_token'].includes(account?.status);
}

function isAccountActionBusy(account) {
	if (isReconnectable(account)) {
		return connectingProvider.value === account.provider;
	}

	return isDisconnectingId.value === account.id;
}

function accountActionLabel(account) {
	if (isReconnectable(account)) {
		return connectingProvider.value === account.provider ? t('storage.connecting') : t('storage.connect');
	}

	return isDisconnectingId.value === account.id ? t('storage.disconnecting') : t('storage.disconnect');
}

async function reconnectAccount(account) {
	if (account.provider === 'google_drive') {
		await connectGoogleDrive();
		return;
	}

	if (account.provider === 'onedrive') {
		await connectOneDrive();
		return;
	}

	if (account.provider === 'dropbox') {
		await connectDropbox();
		return;
	}

	if (account.provider === 'mega') {
		openMegaModal();
		return;
	}

	actionError.value = t('storage.reconnectNotSupported', {
		provider: providerLabel(account.provider),
	});
}

async function handleAccountAction(account) {
	if (isReconnectable(account)) {
		await reconnectAccount(account);
		return;
	}

	await disconnectAccount(account);
}

async function loadPage() {
	await accountStore.loadAccounts();
	await loadAllocation();
}

async function loadAllocation() {
	isAllocationLoading.value = true;
	allocationError.value = '';
	try {
		const { data } = await api.getAllocation();
		if (data?.strategy && ALLOCATION_STRATEGIES.includes(data.strategy)) {
			selectedStrategy.value = data.strategy;
		}
		allocationOrder.value = Array.isArray(data?.accounts) ? data.accounts.map((account) => account.id) : [];
	} catch (error) {
		allocationError.value = error.message;
	} finally {
		isAllocationLoading.value = false;
	}
}

function selectStrategy(key) {
	if (!ALLOCATION_STRATEGIES.includes(key)) return;
	selectedStrategy.value = key;
	allocationSaved.value = false;
}

function syncOrderFromAccounts() {
	allocationOrder.value = orderedAllocationAccounts.value.map((account) => account.id);
}

function moveAccount(index, direction) {
	syncOrderFromAccounts();
	const target = index + direction;
	if (target < 0 || target >= allocationOrder.value.length) return;
	const next = [...allocationOrder.value];
	[next[index], next[target]] = [next[target], next[index]];
	allocationOrder.value = next;
	allocationSaved.value = false;
}

function onDragStart(index) {
	syncOrderFromAccounts();
	dragIndex.value = index;
}

function onDragOver(index, event) {
	event.preventDefault();
	if (dragIndex.value === null || dragIndex.value === index) return;
	const next = [...allocationOrder.value];
	const [moved] = next.splice(dragIndex.value, 1);
	next.splice(index, 0, moved);
	allocationOrder.value = next;
	dragIndex.value = index;
	allocationSaved.value = false;
}

function onDragEnd() {
	dragIndex.value = null;
}

async function saveAllocation() {
	isSavingAllocation.value = true;
	allocationError.value = '';
	allocationSaved.value = false;
	syncOrderFromAccounts();
	try {
		const { data } = await api.updateAllocation({
			strategy: selectedStrategy.value,
			order: allocationOrder.value,
		});
		if (data?.strategy) selectedStrategy.value = data.strategy;
		allocationOrder.value = Array.isArray(data?.accounts)
			? data.accounts.map((account) => account.id)
			: allocationOrder.value;
		allocationSaved.value = true;
	} catch (error) {
		allocationError.value = error.message;
	} finally {
		isSavingAllocation.value = false;
	}
}

async function connectGoogleDrive() {
	connectingProvider.value = 'google_drive';
	isConnectMenuOpen.value = false;
	actionError.value = '';
	try {
		const { data } = await api.getGoogleConnectUrl();
		window.location.href = data.authorizationUrl;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

async function connectOneDrive() {
	connectingProvider.value = 'onedrive';
	isConnectMenuOpen.value = false;
	actionError.value = '';
	try {
		const { data } = await api.getOneDriveConnectUrl();
		window.location.href = data.authorizationUrl;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

async function connectDropbox() {
	connectingProvider.value = 'dropbox';
	isConnectMenuOpen.value = false;
	actionError.value = '';
	try {
		const { data } = await api.getDropboxConnectUrl();
		window.location.href = data.authorizationUrl;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

function openMegaModal() {
	isConnectMenuOpen.value = false;
	actionError.value = '';
	isMegaModalOpen.value = true;
}

function closeMegaModal() {
	if (connectingProvider.value === 'mega') return;
	isMegaModalOpen.value = false;
}

async function connectMega(payload) {
	connectingProvider.value = 'mega';
	actionError.value = '';
	try {
		await api.connectMegaAccount(payload);
		await accountStore.loadAccounts();
		isMegaModalOpen.value = false;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

function openPCloudModal() {
	isConnectMenuOpen.value = false;
	actionError.value = '';
	isPCloudModalOpen.value = true;
}

function closePCloudModal() {
	if (connectingProvider.value === 'pcloud') return;
	isPCloudModalOpen.value = false;
}

async function connectPCloud(payload) {
	connectingProvider.value = 'pcloud';
	actionError.value = '';
	try {
		await api.connectPCloudAccount(payload);
		await accountStore.loadAccounts();
		isPCloudModalOpen.value = false;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

async function connectYandex() {
	connectingProvider.value = 'yandex';
	isConnectMenuOpen.value = false;
	actionError.value = '';
	try {
		const { data } = await api.getYandexConnectUrl();
		window.location.href = data.authorizationUrl;
	} catch (error) {
		actionError.value = error.message;
		connectingProvider.value = '';
	}
}

function openS3Modal() {
	isConnectMenuOpen.value = false;
	actionError.value = '';
	isS3ModalOpen.value = true;
}

function closeS3Modal() {
	if (connectingProvider.value === 's3') return;
	isS3ModalOpen.value = false;
}

async function connectS3(payload) {
	connectingProvider.value = 's3';
	actionError.value = '';
	try {
		await api.connectS3Account(payload);
		await accountStore.loadAccounts();
		isS3ModalOpen.value = false;
	} catch (error) {
		actionError.value = error.message;
	} finally {
		connectingProvider.value = '';
	}
}

async function disconnectAccount(account) {
	const confirmed = await confirmDialog({
		title: t('storage.disconnect'),
		message: t('storage.disconnectConfirm', { email: account.email }),
		confirmLabel: t('storage.disconnect'),
		destructive: true,
	});
	if (!confirmed) return;

	actionError.value = '';
	try {
		await accountStore.disconnectAccount(account.id);
	} catch (error) {
		actionError.value = error.message;
	}
}

async function syncNow() {
	isSyncing.value = true;
	actionError.value = '';
	try {
		await api.runSync();
		await accountStore.loadAccounts();
	} catch (error) {
		actionError.value = error.message;
	} finally {
		isSyncing.value = false;
	}
}

function toggleConnectMenu() {
	isConnectMenuOpen.value = !isConnectMenuOpen.value;
}

const OAUTH_PROVIDERS = ['yandex', 'google', 'onedrive', 'dropbox'];

async function handleOAuthRedirect() {
	const query = route.query;
	const provider = OAUTH_PROVIDERS.find((key) => query[key]);
	if (!provider) return;

	const status = String(query[provider]);
	const message = query.message ? String(query.message) : '';

	if (status === 'connected') {
		await accountStore.loadAccounts();
		await loadAllocation();
		showActionSuccess(t('storage.connectSuccess', { provider }));
		actionError.value = '';
	} else if (status === 'error') {
		actionError.value = message || t('storage.connectFailed', { provider });
		actionSuccess.value = '';
	}

	const nextQuery = { ...query };
	delete nextQuery[provider];
	delete nextQuery.message;
	router.replace({ query: nextQuery });
}

onMounted(async () => {
	await loadPage();
	await handleOAuthRedirect();
});

onBeforeUnmount(() => {
	if (successTimer) clearTimeout(successTimer);
});
</script>

<template>
	<DriveShell current-section="storage">
		<div
			class="min-h-[calc(100vh-84px)] rounded-[12px] bg-white px-4 py-4 pb-5 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
		>
			<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 class="text-2xl font-normal">{{ t('storage.title') }}</h1>
					<p class="mt-1 text-sm text-[#5f6368] dark:text-slate-400">
						{{ t('storage.subtitle') }}
					</p>
				</div>

				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-full border border-[#dadce0] bg-white px-4 py-2 text-[#1a73e8] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-400"
						:disabled="isSyncing"
						@click="syncNow"
					>
						<IconRefresh :size="18" :stroke="2" :class="isSyncing ? 'animate-spin' : ''" />
						<span>{{ isSyncing ? t('storage.syncing') : t('storage.syncNow') }}</span>
					</button>

					<div class="relative">
						<button
							type="button"
							class="inline-flex items-center gap-2 rounded-full bg-[#1a73e8] px-4 py-2 text-white disabled:opacity-60"
							:disabled="Boolean(connectingProvider)"
							@click="toggleConnectMenu"
						>
							<IconLinkPlus :size="18" :stroke="2" />
							<span>{{ connectingProvider ? t('storage.connecting') : t('storage.connect') }}</span>
							<IconChevronDown
								:size="16"
								:stroke="2"
								class="transition"
								:class="isConnectMenuOpen ? 'rotate-180' : ''"
							/>
						</button>

						<div
							v-if="isConnectMenuOpen"
							class="absolute right-0 top-[calc(100%+10px)] z-20 min-w-[240px] overflow-hidden rounded-[10px] border border-[#e0e3e7] bg-white py-2 shadow-[0_18px_44px_rgba(32,33,36,0.18)] dark:border-slate-700 dark:bg-slate-900"
						>
							<button
								v-for="provider in providerConnectOptions"
								:key="provider.key"
								type="button"
								class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] disabled:opacity-60 dark:text-slate-100 dark:hover:bg-slate-800"
								:disabled="Boolean(connectingProvider)"
								@click="provider.action"
							>
								<img
									:src="provider.icon"
									:alt="provider.label"
									class="size-[18px] shrink-0 object-contain"
								/>
								<span>{{
									connectingProvider === provider.key ? provider.busyLabel : provider.label
								}}</span>
							</button>
						</div>
					</div>
				</div>
			</div>

			<div
				class="mb-5 flex items-center gap-1 rounded-full border border-[#e0e3e7] bg-[#f8fafd] p-1 dark:border-slate-700 dark:bg-slate-900/60 sm:w-fit"
			>
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition"
					:class="
						activeTab === 'overview'
							? 'bg-white text-[#1a73e8] shadow-sm dark:bg-slate-800 dark:text-sky-300'
							: 'text-[#5f6368] hover:text-[#202124] dark:text-slate-400 dark:hover:text-slate-200'
					"
					@click="activeTab = 'overview'"
				>
					<IconChartPie :size="18" :stroke="1.9" />
					<span>{{ t('storage.tabOverview') }}</span>
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition"
					:class="
						activeTab === 'allocation'
							? 'bg-white text-[#1a73e8] shadow-sm dark:bg-slate-800 dark:text-sky-300'
							: 'text-[#5f6368] hover:text-[#202124] dark:text-slate-400 dark:hover:text-slate-200'
					"
					@click="activeTab = 'allocation'"
				>
					<IconAdjustments :size="18" :stroke="1.9" />
					<span>{{ t('storage.tabAllocation') }}</span>
				</button>
			</div>

			<section
				v-show="activeTab === 'overview'"
				class="mb-6 rounded-[14px] border border-[#e0e3e7] bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70"
			>
				<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
					<div class="flex items-center gap-3">
						<div
							class="grid size-12 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-slate-800"
						>
							<IconCloud :size="24" :stroke="1.8" />
						</div>
						<div>
							<p class="text-sm text-[#5f6368] dark:text-slate-400">
								{{ t('storage.totalStorage') }}
							</p>
							<strong class="text-xl">{{ usedTotalLabel }}</strong>
						</div>
					</div>

					<div class="min-w-[220px] rounded-[12px] bg-[#f8fafd] px-4 py-3 text-sm dark:bg-slate-800/80">
						<div class="flex items-center justify-between gap-3">
							<span class="text-[#5f6368] dark:text-slate-400">{{ t('storage.usedSpace') }}</span>
							<strong>{{ usedFormatted }}</strong>
						</div>
						<div class="mt-2 flex items-center justify-between gap-3">
							<span class="text-[#5f6368] dark:text-slate-400">{{ t('storage.freeSpace') }}</span>
							<strong>{{ freeFormatted }}</strong>
						</div>
					</div>
				</div>

				<div class="mt-5 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-slate-800">
					<div class="flex h-5 w-full overflow-hidden rounded-full">
						<div
							v-for="segment in storageSegments"
							:key="segment.key"
							class="h-full"
							:class="segment.className"
							:style="{ width: segment.width }"
						/>
					</div>
				</div>

				<div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					<div
						v-for="account in accountLegends"
						:key="account.id"
						class="min-w-0 rounded-[12px] border border-[#e3e8ee] bg-[#f8fafd] p-4 dark:border-slate-700 dark:bg-slate-800/85"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 items-start gap-3">
								<div
									class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-slate-900/70"
								>
									<img
										v-if="providerIcon(account.provider)"
										:src="providerIcon(account.provider)"
										:alt="providerLabel(account.provider)"
										class="size-5 object-contain"
									/>
								</div>
								<div class="min-w-0">
									<TruncateMarquee as="p" class="text-sm font-semibold" :text="account.email" />
									<TruncateMarquee
										as="p"
										class="text-xs text-[#5f6368] dark:text-slate-400"
										:text="providerLabel(account.provider)"
									/>
								</div>
							</div>
							<div class="grid gap-1 text-xs">
								<span class="inline-flex items-center gap-2">
									<span class="size-2.5 rounded-full" :class="account.palette.used" />
									{{ t('storage.used') }}
								</span>
								<span class="inline-flex items-center gap-2 text-[#5f6368] dark:text-slate-400">
									<span class="size-2.5 rounded-full" :class="account.palette.free" />
									{{ t('storage.free') }}
								</span>
							</div>
						</div>

						<div class="mt-4 h-3 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-slate-700">
							<div class="flex h-full w-full overflow-hidden rounded-full">
								<div
									class="h-full"
									:class="account.palette.used"
									:style="{
										width: `${account.total_space ? Math.min(100, (account.used / account.total_space) * 100) : 0}%`,
									}"
								/>
								<div
									class="h-full"
									:class="account.palette.free"
									:style="{
										width: `${account.total_space ? Math.min(100, (account.free / account.total_space) * 100) : 0}%`,
									}"
								/>
							</div>
						</div>

						<div class="mt-3 flex items-center justify-between gap-3 text-sm">
							<span class="text-[#5f6368] dark:text-slate-400"
								>{{ formatBytes(account.used, { strict: true }) }} /
								{{ formatBytes(account.total_space, { strict: true }) }}</span
							>
							<span class="font-medium" :class="account.palette.text"
								>{{ formatBytes(account.free, { strict: true }) }} {{ t('storage.empty') }}</span
							>
						</div>

						<div class="mt-4 flex items-center justify-between gap-3">
							<button
								type="button"
								class="inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 disabled:opacity-60 dark:bg-slate-800"
								:class="
									isReconnectable(account)
										? 'border-[#c7dafc] text-[#1a73e8] dark:border-sky-900/50 dark:text-sky-300'
										: 'border-[#f3c7c4] text-[#c5221f] dark:border-red-900/50 dark:text-red-300'
								"
								:disabled="isAccountActionBusy(account)"
								@click="handleAccountAction(account)"
							>
								<IconPlugConnected v-if="isReconnectable(account)" :size="18" :stroke="2" />
								<IconPlugConnectedX v-else :size="18" :stroke="2" />
								<span>{{ accountActionLabel(account) }}</span>
							</button>

							<span
								class="inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize"
								:class="providerBadgeClass(account.status)"
								>{{ account.status }}</span
							>
						</div>
					</div>
				</div>
			</section>

			<section
				v-show="activeTab === 'allocation'"
				class="mb-6 rounded-[14px] border border-[#e0e3e7] bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70"
			>
				<div class="flex flex-col gap-1">
					<h2 class="text-lg font-medium">{{ t('allocation.title') }}</h2>
					<p class="text-sm text-[#5f6368] dark:text-slate-400">
						{{ t('allocation.subtitle') }}
					</p>
				</div>

				<div
					v-if="!accounts.length"
					class="mt-4 rounded-2xl border border-dashed border-[#dadce0] bg-[#f8fafd] px-4 py-6 text-center text-sm text-[#5f6368] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
				>
					{{ t('allocation.noAccounts') }}
				</div>

				<template v-else>
					<div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						<button
							v-for="option in allocationStrategyOptions"
							:key="option.key"
							type="button"
							class="flex flex-col gap-1 rounded-2xl border p-4 text-left transition"
							:class="
								selectedStrategy === option.key
									? 'border-[#1a73e8] bg-[#e8f0fe] dark:border-sky-500 dark:bg-sky-950/30'
									: 'border-[#e3e8ee] bg-[#f8fafd] hover:border-[#c7dafc] dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-sky-900/60'
							"
							@click="selectStrategy(option.key)"
						>
							<span class="flex items-center justify-between gap-2">
								<span
									class="text-sm font-semibold"
									:class="selectedStrategy === option.key ? 'text-[#1a73e8] dark:text-sky-300' : ''"
									>{{ option.label }}</span
								>
								<IconCheck
									v-if="selectedStrategy === option.key"
									:size="18"
									:stroke="2.2"
									class="text-[#1a73e8] dark:text-sky-300"
								/>
							</span>
							<span class="text-xs leading-relaxed text-[#5f6368] dark:text-slate-400">{{
								option.description
							}}</span>
						</button>
					</div>

					<div
						class="mt-5 rounded-2xl border border-[#e3e8ee] bg-[#f8fafd] p-4 dark:border-slate-700 dark:bg-slate-800/70"
						:class="selectedStrategy === 'manual' ? '' : 'opacity-80'"
					>
						<div class="flex items-center justify-between gap-3">
							<h3 class="text-sm font-semibold">
								{{ t('allocation.orderTitle') }}
							</h3>
						</div>
						<p class="mt-1 text-xs text-[#5f6368] dark:text-slate-400">
							{{ t('allocation.reorderHint') }}
						</p>

						<ul class="mt-3 grid gap-2">
							<li
								v-for="(account, index) in orderedAllocationAccounts"
								:key="account.id"
								draggable="true"
								class="flex items-center gap-3 rounded-xl border border-[#e3e8ee] bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/70"
								:class="dragIndex === index ? 'ring-2 ring-[#1a73e8] dark:ring-sky-500' : ''"
								@dragstart="onDragStart(index)"
								@dragover="onDragOver(index, $event)"
								@dragend="onDragEnd"
							>
								<span class="cursor-grab text-[#9aa0a6] active:cursor-grabbing dark:text-slate-500"
									><IconGripVertical :size="18" :stroke="1.8"
								/></span>
								<span
									class="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-semibold text-[#1a73e8] dark:bg-slate-800 dark:text-sky-300"
									>{{ index + 1 }}</span
								>
								<div
									class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#f1f3f4] dark:bg-slate-800"
								>
									<img
										v-if="providerIcon(account.provider)"
										:src="providerIcon(account.provider)"
										:alt="providerLabel(account.provider)"
										class="size-4 object-contain"
									/>
								</div>
								<div class="min-w-0 flex-1">
									<TruncateMarquee as="p" class="text-sm font-medium" :text="account.email" />
									<p class="text-xs text-[#5f6368] dark:text-slate-400">
										{{ providerLabel(account.provider) }} ·
										{{
											formatBytes(Number(account.total_space) - Number(account.used_space), {
												strict: true,
											})
										}}
										{{ t('storage.free').toLowerCase() }}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-1">
									<button
										type="button"
										class="grid size-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
										:disabled="index === 0"
										:title="t('allocation.moveUp')"
										@click="moveAccount(index, -1)"
									>
										<IconArrowUp :size="16" :stroke="2" />
									</button>
									<button
										type="button"
										class="grid size-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
										:disabled="index === orderedAllocationAccounts.length - 1"
										:title="t('allocation.moveDown')"
										@click="moveAccount(index, 1)"
									>
										<IconArrowDown :size="16" :stroke="2" />
									</button>
								</div>
							</li>
						</ul>
					</div>

					<div class="mt-4 flex flex-wrap items-center justify-end gap-3">
						<span
							v-if="allocationSaved"
							class="inline-flex items-center gap-1.5 text-sm text-[#188038] dark:text-emerald-400"
							><IconCheck :size="16" :stroke="2.2" />{{ t('allocation.saved') }}</span
						>
						<button
							type="button"
							class="inline-flex items-center gap-2 rounded-full bg-[#1a73e8] px-4 py-2 text-white disabled:opacity-60"
							:disabled="isSavingAllocation || isAllocationLoading"
							@click="saveAllocation"
						>
							<IconDeviceFloppy :size="18" :stroke="2" />
							<span>{{ isSavingAllocation ? t('allocation.saving') : t('allocation.save') }}</span>
						</button>
					</div>

					<p
						v-if="allocationError"
						class="mt-3 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300"
					>
						{{ allocationError }}
					</p>
				</template>
			</section>

			<p
				v-if="actionError || error"
				class="mb-4 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300"
			>
				{{ actionError || error }}
			</p>
			<p
				v-if="actionSuccess"
				class="mb-4 rounded-2xl bg-[#e6f4ea] px-4 py-3 text-sm text-[#188038] dark:bg-emerald-950/40 dark:text-emerald-300"
			>
				{{ actionSuccess }}
			</p>

			<div
				v-if="!accounts.length && !isLoading"
				class="rounded-[12px] border border-dashed border-[#dadce0] bg-white p-6 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400"
			>
				{{ t('storage.noAccounts') }}
			</div>
			<MegaConnectModal
				v-if="isMegaModalOpen"
				:is-connecting="connectingProvider === 'mega'"
				:error="actionError"
				@close="closeMegaModal"
				@connect="connectMega"
			/>
			<PCloudConnectModal
				v-if="isPCloudModalOpen"
				:is-connecting="connectingProvider === 'pcloud'"
				:error="actionError"
				@close="closePCloudModal"
				@connect="connectPCloud"
			/>
			<S3ConnectModal
				v-if="isS3ModalOpen"
				:is-connecting="connectingProvider === 's3'"
				:error="actionError"
				@close="closeS3Modal"
				@connect="connectS3"
			/>
		</div>
	</DriveShell>
</template>
