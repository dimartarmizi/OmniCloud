<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import {
	IconChevronRight,
	IconHelp,
	IconHome,
	IconMenu2,
	IconMoon,
	IconPlus,
	IconSearch,
	IconSettings,
	IconSun,
	IconStar,
	IconUsers,
	IconX,
	IconClockHour4,
	IconCloud,
	IconFolder,
	IconCloudFilled,
	IconClockHour4Filled,
	IconFolderFilled,
	IconHomeFilled,
	IconStarFilled,
	IconUserFilled,
	IconLanguage,
	IconLogout,
	IconBell,
} from '@tabler/icons-vue';
import { useRouter } from 'vue-router';
import logoUrl from '../assets/logo.webp';
import { useAccountManagementStore } from '../stores/accountManagement';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { useStorageStats } from '../composables/useStorageStats.js';
import HelpModal from './HelpModal.vue';
import ProfileModal from './ProfileModal.vue';
import LanguageModal from './LanguageModal.vue';
import UpdatesModal from './UpdatesModal.vue';
import { api } from '../services/api';
import { useFileTreeStore } from '../stores/fileTree';
import { getFileIcon } from '../composables/useFileType.js';
import { useIncrementalRender } from '../composables/useIncrementalRender.js';

const { t } = useI18n();
const router = useRouter();
const fileTreeStore = useFileTreeStore();

const props = defineProps({
	currentSection: { type: String, required: true },
});

const emit = defineEmits(['new-folder', 'upload-files', 'upload-folder']);

const isCreateMenuOpen = ref(false);
const isMobileNavOpen = ref(false);
const isHelpModalOpen = ref(false);
const isProfileModalOpen = ref(false);
const isLanguageModalOpen = ref(false);
const isUpdatesModalOpen = ref(false);
const globalSearchTerm = ref('');
const globalSearchResults = ref([]);
const isGlobalSearchOpen = ref(false);
const isGlobalSearchLoading = ref(false);
const globalSearchError = ref('');
const globalSearchDebounce = ref(null);
const createMenuRef = ref(null);
const searchRef = ref(null);
const accountStore = useAccountManagementStore();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const { accounts } = storeToRefs(accountStore);
const { hasActiveAccount } = storeToRefs(accountStore);
const { theme } = storeToRefs(settingsStore);
const { isHosted } = storeToRefs(authStore);
const { storagePercent, storagePercentRounded, storageLabel } = useStorageStats();
const { visibleItems: renderedGlobalSearchResults, handleScroll: handleGlobalSearchScroll } = useIncrementalRender(
	globalSearchResults,
	{
		initialCount: 20,
		step: 20,
		threshold: 160,
	},
);

async function handleLogout() {
	await authStore.logout();
	router.replace('/login');
}

function openSettings() {
	router.push('/settings');
}

function formatSearchDate(value) {
	if (!value) return '—';
	try {
		return new Intl.DateTimeFormat(undefined, {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		}).format(new Date(value));
	} catch {
		return '—';
	}
}

function getItemPath(item) {
	const basePath = item.virtual_path || '/';
	if (!item.is_folder) return basePath;
	const nextPath = `${basePath === '/' ? '/' : basePath}${item.file_name}/`;
	return nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
}

async function runGlobalSearch(term) {
	const keyword = term.trim();
	if (!keyword) {
		globalSearchResults.value = [];
		globalSearchError.value = '';
		isGlobalSearchLoading.value = false;
		return;
	}

	isGlobalSearchLoading.value = true;
	globalSearchError.value = '';
	try {
		const { data } = await api.searchFiles(keyword, 80);
		if (globalSearchTerm.value.trim() === keyword) {
			globalSearchResults.value = data || [];
		}
	} catch (error) {
		if (globalSearchTerm.value.trim() === keyword) {
			globalSearchResults.value = [];
			globalSearchError.value = error.message || 'Search failed';
		}
	} finally {
		if (globalSearchTerm.value.trim() === keyword) {
			isGlobalSearchLoading.value = false;
		}
	}
}

function handleSearchFocus() {
	isGlobalSearchOpen.value = true;
}

function clearGlobalSearch() {
	globalSearchTerm.value = '';
	globalSearchResults.value = [];
	globalSearchError.value = '';
	isGlobalSearchOpen.value = false;
}

async function openSearchResult(item) {
	const targetPath = getItemPath(item);
	clearGlobalSearch();
	fileTreeStore.pendingHighlightId = item.is_folder ? null : item.id;

	if (router.currentRoute.value.name === 'my-drive') {
		fileTreeStore.pendingPath = null;
		await fileTreeStore.navigate(targetPath);
		return;
	}

	fileTreeStore.pendingPath = targetPath;
	await router.push({ name: 'my-drive' });
}

function toggleCreateMenu() {
	if (!hasActiveAccount.value) return;
	isCreateMenuOpen.value = !isCreateMenuOpen.value;
}

function toggleMobileNav() {
	isMobileNavOpen.value = !isMobileNavOpen.value;
}

function closeMobileNav() {
	isMobileNavOpen.value = false;
}

function openProfileModal() {
	isProfileModalOpen.value = true;
}

function closeProfileModal() {
	isProfileModalOpen.value = false;
}

function openHelpModal() {
	isHelpModalOpen.value = true;
}

function closeHelpModal() {
	isHelpModalOpen.value = false;
}

function openLanguageModal() {
	isLanguageModalOpen.value = true;
}

function closeLanguageModal() {
	isLanguageModalOpen.value = false;
}

function openUpdatesModal() {
	isUpdatesModalOpen.value = true;
}

function closeUpdatesModal() {
	isUpdatesModalOpen.value = false;
}

function runCreateAction(action) {
	if (!hasActiveAccount.value) return;
	isCreateMenuOpen.value = false;
	isMobileNavOpen.value = false;
	emit(action);
}

function handleDocumentClick(event) {
	if (!createMenuRef.value?.contains(event.target)) {
		isCreateMenuOpen.value = false;
	}

	if (!searchRef.value?.contains(event.target)) {
		isGlobalSearchOpen.value = false;
	}

	if (
		isMobileNavOpen.value &&
		!event.target.closest('[data-mobile-nav-card]') &&
		!event.target.closest('[data-mobile-nav-toggle]')
	) {
		isMobileNavOpen.value = false;
	}
}

function handleWindowKeydown(event) {
	if (event.key !== 'Escape') {
		return;
	}

	if (isLanguageModalOpen.value) {
		closeLanguageModal();
	}

	if (isHelpModalOpen.value) {
		closeHelpModal();
	}

	if (isProfileModalOpen.value) {
		closeProfileModal();
	}

	if (isUpdatesModalOpen.value) {
		closeUpdatesModal();
	}

	if (isGlobalSearchOpen.value) {
		isGlobalSearchOpen.value = false;
	}
}

function toggleTheme() {
	settingsStore.toggleTheme();
}

onMounted(() => {
	settingsStore.loadSettings();
	document.addEventListener('click', handleDocumentClick);
	window.addEventListener('keydown', handleWindowKeydown);
	if (!accounts.value.length) {
		accountStore.loadAccounts();
	}
});

onBeforeUnmount(() => {
	document.removeEventListener('click', handleDocumentClick);
	window.removeEventListener('keydown', handleWindowKeydown);
	if (globalSearchDebounce.value) {
		window.clearTimeout(globalSearchDebounce.value);
	}
});

watch(globalSearchTerm, (term) => {
	isGlobalSearchOpen.value = true;
	if (globalSearchDebounce.value) {
		window.clearTimeout(globalSearchDebounce.value);
	}

	if (!term.trim()) {
		globalSearchResults.value = [];
		globalSearchError.value = '';
		isGlobalSearchLoading.value = false;
		return;
	}

	isGlobalSearchLoading.value = true;
	globalSearchError.value = '';
	globalSearchDebounce.value = window.setTimeout(() => runGlobalSearch(term), 250);
});

const navItems = computed(() => [
	{
		id: 'home',
		label: t('nav.home'),
		icon: IconHome,
		activeIcon: IconHomeFilled,
		to: '/',
	},
	{
		id: 'drive',
		label: t('nav.myDrive'),
		icon: IconFolder,
		activeIcon: IconFolderFilled,
		to: '/my-drive',
	},
	{
		id: 'shared',
		label: t('nav.shared'),
		icon: IconUsers,
		activeIcon: IconUserFilled,
		to: '/shared-with-me',
	},
	{
		id: 'recent',
		label: t('nav.recent'),
		icon: IconClockHour4,
		activeIcon: IconClockHour4Filled,
		to: '/recent',
	},
	{
		id: 'starred',
		label: t('nav.starred'),
		icon: IconStar,
		activeIcon: IconStarFilled,
		to: '/starred',
	},
	{
		id: 'storage',
		label: t('nav.storage'),
		icon: IconCloud,
		activeIcon: IconCloudFilled,
		to: '/quota',
	},
]);

const profileLinks = [
	{ id: 'website', label: 'Website', href: 'https://tarmizi.id' },
	{ id: 'github', label: 'GitHub', href: 'https://github.com/dimartarmizi' },
	{
		id: 'linkedin',
		label: 'LinkedIn',
		href: 'https://www.linkedin.com/in/dimartarmizi',
	},
	{
		id: 'instagram',
		label: 'Instagram',
		href: 'https://www.instagram.com/dimartarmizi',
	},
	{
		id: 'facebook',
		label: 'Facebook',
		href: 'https://www.facebook.com/dimartarmizi',
	},
	{
		id: 'reddit',
		label: 'Reddit',
		href: 'https://www.reddit.com/user/dimartarmizi',
	},
];
</script>

<template>
	<div class="min-h-screen bg-[#f8fafd] text-[#202124] dark:bg-slate-900 dark:text-slate-100">
		<HelpModal :open="isHelpModalOpen" @close="closeHelpModal" />
		<ProfileModal :open="isProfileModalOpen" :profile-links="profileLinks" @close="closeProfileModal" />
		<LanguageModal :open="isLanguageModalOpen" @close="closeLanguageModal" />
		<UpdatesModal :open="isUpdatesModalOpen" @close="closeUpdatesModal" />

		<header
			class="grid h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2 sm:gap-4 sm:px-4 lg:grid-cols-[256px_minmax(320px,720px)_1fr] lg:gap-3 lg:px-0 lg:pr-4"
		>
			<div class="flex min-w-0 items-center gap-2 lg:gap-3 lg:pl-4">
				<button
					type="button"
					class="grid size-10 shrink-0 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 lg:hidden"
					data-mobile-nav-toggle
					:aria-label="t('header.openNav')"
					@click.stop="toggleMobileNav"
				>
					<IconMenu2 :size="22" :stroke="2" />
				</button>
				<div class="hidden items-center gap-2 lg:flex">
					<button
						type="button"
						class="grid size-11 place-items-center overflow-hidden rounded-2xl bg-white transition hover:scale-[1.03] focus:outline-none focus:ring-4 focus:ring-[#1a73e8]/20 dark:bg-slate-800 dark:focus:ring-blue-400/20"
						:aria-label="t('header.openProfile')"
						@click="openProfileModal"
					>
						<img :src="logoUrl" alt="OmniCloud logo" class="size-full object-cover" />
					</button>
					<div class="text-[22px] font-medium text-[#5f6368] dark:text-slate-300">OmniCloud</div>
				</div>
			</div>

			<div ref="searchRef" class="relative min-w-0 max-w-full">
				<div
					class="grid h-11 grid-cols-[44px_minmax(0,1fr)_42px] items-center rounded-full bg-[#eaf1fb] pr-1.5 dark:bg-slate-800/90 sm:h-12 sm:grid-cols-[52px_minmax(0,1fr)_48px] sm:pr-2.5"
				>
					<span class="grid place-items-center text-[#5f6368] dark:text-slate-400">
						<IconSearch :size="18" :stroke="2" />
					</span>
					<input
						v-model="globalSearchTerm"
						type="text"
						:placeholder="t('header.searchPlaceholder')"
						class="w-full min-w-0 border-0 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#5f6368] dark:text-slate-100 dark:placeholder:text-slate-400 sm:text-base"
						@focus="handleSearchFocus"
						@keydown.esc.prevent="isGlobalSearchOpen = false"
					/>
					<button
						v-if="globalSearchTerm"
						type="button"
						class="grid size-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
						:aria-label="t('header.clearSearch')"
						@click="clearGlobalSearch"
					>
						<IconX :size="16" :stroke="2" />
					</button>
				</div>

				<div
					v-if="isGlobalSearchOpen && globalSearchTerm.trim()"
					class="fixed left-2 right-2 top-16 z-50 overflow-hidden rounded-3xl border border-[#dfe6f1] bg-white/98 shadow-[0_18px_50px_rgba(60,64,67,0.24)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/98 dark:shadow-[0_18px_50px_rgba(2,6,23,0.5)] lg:absolute lg:left-0 lg:right-0 lg:top-[calc(100%+8px)]"
				>
					<div
						class="custom-scrollbar max-h-[min(420px,70vh)] overflow-y-auto py-2"
						@scroll="handleGlobalSearchScroll"
					>
						<div
							v-if="isGlobalSearchLoading && !globalSearchResults.length"
							class="px-4 py-4 text-sm text-[#5f6368] dark:text-slate-400"
						>
							{{ t('header.searchLoading') }}
						</div>
						<div v-else-if="globalSearchError" class="px-4 py-4 text-sm text-red-600 dark:text-red-300">
							{{ globalSearchError }}
						</div>
						<div
							v-else-if="!globalSearchResults.length"
							class="px-4 py-4 text-sm text-[#5f6368] dark:text-slate-400"
						>
							{{ t('header.searchNoResults') }}
						</div>
						<template v-else>
							<button
								v-for="item in renderedGlobalSearchResults"
								:key="item.id"
								type="button"
								class="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f8fafd] dark:hover:bg-slate-800/80"
								@click="openSearchResult(item)"
							>
								<span
									class="grid size-9 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
								>
									<component
										:is="getFileIcon(item, item.is_folder)"
										:size="18"
										:stroke="item.is_folder ? 0 : 1.8"
									/>
								</span>
								<span class="min-w-0">
									<span
										class="block truncate text-sm font-medium text-[#202124] dark:text-slate-100"
										>{{ item.display_name || item.file_name }}</span
									>
									<span
										v-if="!item.is_folder"
										class="block truncate text-xs text-[#5f6368] dark:text-slate-400"
										>{{ item.virtual_path || '/' }}</span
									>
								</span>
								<span class="shrink-0 text-xs text-[#5f6368] dark:text-slate-400">{{
									formatSearchDate(item.createdTime || item.remote_created_time || item.created_at)
								}}</span>
							</button>
						</template>
					</div>
				</div>
			</div>

			<div class="hidden items-center justify-end gap-2 lg:flex">
				<button
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:title="t('header.toggleTheme')"
					@click="toggleTheme"
				>
					<IconMoon v-if="theme !== 'dark'" :size="18" :stroke="2" />
					<IconSun v-else :size="18" :stroke="2" />
				</button>
				<button
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:title="t('common.language')"
					@click="openLanguageModal"
				>
					<IconLanguage :size="18" :stroke="2" />
				</button>
				<button
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:aria-label="t('header.openHelp')"
					@click="openHelpModal"
				>
					<IconHelp :size="18" :stroke="2" />
				</button>
				<button
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:title="t('updates.buttonLabel')"
					:aria-label="t('updates.buttonLabel')"
					@click="openUpdatesModal"
				>
					<IconBell :size="18" :stroke="2" />
				</button>
				<button
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:title="t('common.settings')"
					@click="openSettings"
				>
					<IconSettings :size="18" :stroke="2" />
				</button>
				<button
					v-if="isHosted"
					type="button"
					class="hidden size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 sm:grid"
					:title="t('auth.logout')"
					@click="handleLogout"
				>
					<IconLogout :size="18" :stroke="2" />
				</button>
			</div>
		</header>

		<Transition
			enter-active-class="transition duration-200 ease-out"
			enter-from-class="-translate-y-2 opacity-0 scale-95"
			enter-to-class="translate-y-0 opacity-100 scale-100"
			leave-active-class="transition duration-150 ease-in"
			leave-from-class="translate-y-0 opacity-100 scale-100"
			leave-to-class="-translate-y-2 opacity-0 scale-95"
		>
			<div v-if="isMobileNavOpen" class="fixed left-2 right-2 top-16 z-50 lg:hidden" data-mobile-nav-card>
				<div
					class="max-h-[calc(100vh-16px)] overflow-y-auto rounded-[14px] border border-[#dfe6f1] bg-white/95 p-4 text-[#202124] shadow-[0_20px_60px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
				>
					<div class="mb-5 flex items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<span
								class="grid size-11 place-items-center overflow-hidden rounded-2xl bg-white dark:bg-slate-800"
							>
								<img :src="logoUrl" alt="OmniCloud logo" class="size-full object-cover" />
							</span>
							<span class="text-xl font-medium text-[#5f6368] dark:text-slate-300">OmniCloud</span>
						</div>
						<button
							type="button"
							class="grid size-10 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
							:aria-label="t('header.closeNav')"
							@click="closeMobileNav"
						>
							<IconX :size="20" :stroke="2" />
						</button>
					</div>

					<div ref="createMenuRef" class="relative mb-4">
						<button
							type="button"
							class="flex h-13 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#1a73e8] to-[#4f8ff7] px-4 font-semibold text-white shadow-[0_12px_28px_rgba(26,115,232,0.28)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
							:disabled="!hasActiveAccount"
							:title="hasActiveAccount ? '' : t('sidebar.connectAccountFirst')"
							@click.stop="toggleCreateMenu"
						>
							<IconPlus :size="22" :stroke="2" />
							<span>{{ t('common.new') }}</span>
						</button>

						<div
							v-if="isCreateMenuOpen"
							class="absolute left-0 top-[calc(100%+10px)] z-30 w-full overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white py-2 shadow-[0_12px_36px_rgba(60,64,67,0.2)] dark:border-slate-700 dark:bg-slate-800"
						>
							<button
								type="button"
								class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
								@click="runCreateAction('new-folder')"
							>
								<span>{{ t('sidebar.newFolder') }}</span>
								<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
							</button>
							<button
								type="button"
								class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
								@click="runCreateAction('upload-files')"
							>
								<span>{{ t('sidebar.uploadFile') }}</span>
								<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
							</button>
							<button
								type="button"
								class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
								@click="runCreateAction('upload-folder')"
							>
								<span>{{ t('sidebar.uploadFolder') }}</span>
								<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
							</button>
						</div>
					</div>

					<nav class="flex flex-col gap-1">
						<RouterLink
							v-for="item in navItems"
							:key="item.label"
							:to="item.to"
							class="group relative flex h-12 items-center gap-3.5 overflow-hidden rounded-2xl px-4 text-[#202124] transition-all duration-200 dark:text-slate-100"
							:class="
								props.currentSection === item.id
									? 'bg-[linear-gradient(90deg,rgba(211,227,253,0.98)_0%,rgba(238,245,255,0.94)_72%,rgba(238,245,255,0.12)_88%,rgba(238,245,255,0)_100%)] font-semibold text-[#174ea6] shadow-[inset_4px_0_0_#1a73e8] dark:bg-[linear-gradient(90deg,rgba(59,130,246,0.24)_0%,rgba(51,65,85,0.2)_72%,rgba(30,41,59,0.08)_88%,rgba(15,23,42,0)_100%)] dark:text-blue-200 dark:shadow-[inset_4px_0_0_#60a5fa]'
									: 'hover:bg-black/[0.03] hover:pl-5 dark:hover:bg-white/6'
							"
							@click="closeMobileNav"
						>
							<component
								:is="props.currentSection === item.id ? item.activeIcon : item.icon"
								:size="20"
								:stroke="props.currentSection === item.id ? 0 : 2"
								class="shrink-0 transition-transform duration-200 group-hover:scale-110"
								:class="
									props.currentSection === item.id
										? 'text-[#1a73e8] drop-shadow-sm dark:text-blue-300'
										: 'text-[#5f6368] dark:text-slate-400'
								"
							/>
							<span>{{ item.label }}</span>
						</RouterLink>
					</nav>

					<div
						class="mt-4 rounded-[12px] border border-[#dfe6f1] bg-[#f8fafd] p-4 dark:border-slate-700 dark:bg-slate-800/80"
					>
						<div class="mb-3 flex items-center justify-between gap-3">
							<div class="flex items-center gap-2.5">
								<span
									class="grid size-9 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
								>
									<IconCloudFilled :size="18" :stroke="0" />
								</span>
								<span class="text-sm font-semibold">{{ t('sidebar.storage') }}</span>
							</div>
							<span
								class="rounded-full bg-[#e8f0fe] px-2 py-1 text-xs font-semibold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
								>{{ storagePercentRounded }}%</span
							>
						</div>

						<div class="mb-2 h-2 overflow-hidden rounded-full bg-[#dfe6f1] dark:bg-slate-700">
							<div
								class="h-full rounded-full bg-gradient-to-r from-[#1a73e8] via-[#7c3aed] to-[#06b6d4] transition-all"
								:style="{ width: `${storagePercent}%` }"
							/>
						</div>

						<p class="text-xs leading-5 text-[#5f6368] dark:text-slate-400">
							{{ storageLabel }}
						</p>
					</div>
				</div>
			</div>
		</Transition>

		<div class="grid grid-cols-1 gap-1 lg:grid-cols-[248px_minmax(0,1fr)]">
			<aside class="hidden pb-6 pl-3 pr-1 pt-2 lg:flex lg:min-h-[calc(100vh-4rem)] lg:flex-col">
				<div ref="createMenuRef" class="relative inline-block">
					<button
						type="button"
						class="inline-flex h-14 items-center gap-3.5 rounded-2xl bg-white px-[18px] pr-[22px] font-medium text-[#3c4043] shadow-[0_1px_3px_rgba(60,64,67,0.3),0_4px_8px_rgba(60,64,67,0.15)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none dark:bg-slate-800 dark:text-slate-100 dark:shadow-[0_10px_30px_rgba(15,23,42,0.45)]"
						:disabled="!hasActiveAccount"
						:title="hasActiveAccount ? '' : t('sidebar.connectAccountFirst')"
						@click.stop="toggleCreateMenu"
					>
						<IconPlus :size="22" :stroke="2" />
						<span>{{ t('common.new') }}</span>
					</button>

					<div
						v-if="isCreateMenuOpen"
						class="absolute left-0 top-[calc(100%+10px)] z-30 w-56 overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white py-2 shadow-[0_12px_36px_rgba(60,64,67,0.2)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_12px_36px_rgba(15,23,42,0.45)]"
					>
						<button
							type="button"
							class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
							@click="runCreateAction('new-folder')"
						>
							<span>{{ t('sidebar.newFolder') }}</span>
							<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
						</button>
						<button
							type="button"
							class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
							@click="runCreateAction('upload-files')"
						>
							<span>{{ t('sidebar.uploadFile') }}</span>
							<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
						</button>
						<button
							type="button"
							class="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
							@click="runCreateAction('upload-folder')"
						>
							<span>{{ t('sidebar.uploadFolder') }}</span>
							<IconChevronRight :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
						</button>
					</div>
				</div>

				<nav class="-ml-4 -mr-3 mt-3 flex flex-col gap-0.5">
					<RouterLink
						v-for="item in navItems"
						:key="item.label"
						:to="item.to"
						class="group relative mr-3 flex h-10 items-center gap-3.5 overflow-hidden rounded-r-[6px] px-6 text-[#202124] transition-all duration-200 dark:text-slate-100"
						:class="
							props.currentSection === item.id
								? 'bg-[linear-gradient(90deg,rgba(211,227,253,0.98)_0%,rgba(238,245,255,0.94)_76%,rgba(238,245,255,0.14)_90%,rgba(238,245,255,0)_100%)] font-semibold text-[#174ea6] shadow-[inset_4px_0_0_#1a73e8] dark:bg-[linear-gradient(90deg,rgba(59,130,246,0.24)_0%,rgba(51,65,85,0.18)_76%,rgba(30,41,59,0.08)_90%,rgba(15,23,42,0)_100%)] dark:text-blue-200 dark:shadow-[inset_4px_0_0_#60a5fa]'
								: 'hover:bg-black/[0.03] dark:hover:bg-white/6'
						"
					>
						<component
							:is="props.currentSection === item.id ? item.activeIcon : item.icon"
							:size="18"
							:stroke="props.currentSection === item.id ? 0 : 2"
							class="shrink-0 transition-transform duration-200 group-hover:scale-110"
							:class="
								props.currentSection === item.id
									? 'text-[#1a73e8] drop-shadow-sm dark:text-blue-300'
									: 'text-[#5f6368] dark:text-slate-400'
							"
						/>
						<span>{{ item.label }}</span>
					</RouterLink>
				</nav>

				<RouterLink
					to="/quota"
					class="sticky bottom-4 mt-auto block rounded-[12px] border border-[#dfe6f1] bg-white/70 p-4 text-[#202124] shadow-[0_12px_32px_rgba(60,64,67,0.08)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_40px_rgba(60,64,67,0.14)] dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
				>
					<div class="mb-3 flex items-center justify-between gap-3">
						<div class="flex items-center gap-2.5">
							<span
								class="grid size-9 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
							>
								<IconCloud :size="18" :stroke="2" />
							</span>
							<span class="text-sm font-semibold">{{ t('sidebar.storage') }}</span>
						</div>
						<span
							class="rounded-full bg-[#e8f0fe] px-2 py-1 text-xs font-semibold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
							>{{ storagePercentRounded }}%</span
						>
					</div>

					<div class="mb-2 h-2 overflow-hidden rounded-full bg-[#dfe6f1] dark:bg-slate-700">
						<div
							class="h-full rounded-full bg-gradient-to-r from-[#1a73e8] via-[#7c3aed] to-[#06b6d4] transition-all"
							:style="{ width: `${storagePercent}%` }"
						/>
					</div>

					<p class="text-xs leading-5 text-[#5f6368] dark:text-slate-400">
						{{ storageLabel }}
					</p>
				</RouterLink>
			</aside>

			<main class="px-2 pb-4 lg:px-0 lg:pr-3 lg:pb-4">
				<slot />
			</main>
		</div>
	</div>
</template>
