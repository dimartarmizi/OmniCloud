<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { IconFileDescription } from '@tabler/icons-vue';
import DriveShell from '../components/DriveShell.vue';
import TruncateMarquee from '../components/TruncateMarquee.vue';
import { useFileTreeStore } from '../stores/fileTree';
import { useAccountManagementStore } from '../stores/accountManagement';
import { getModifiedTime, formatDate, providerIcon, providerLabel, formatBytesStrict } from '../composables/useFormatFile.js';
import { useStorageStats } from '../composables/useStorageStats.js';

// ── Per-row tooltip state (keyed by file id) ─────────────────────────────────
const activeTooltip = ref(null); // { id, style }

const TOOLTIP_WIDTH = 300;
const TOOLTIP_HEIGHT = 240;

function fileOwners(file) {
	const emails = file.email ? file.email.split(',').map(s => s.trim()) : [];
	const providersList = file.providers ? file.providers.split(',').map(s => s.trim()) : [];
	const result = [];
	if (emails.length === 0) {
		if (file.email || file.provider) result.push({ email: file.email || '', provider: file.provider || 'unknown' });
	} else {
		for (let i = 0; i < emails.length; i++) {
			result.push({ email: emails[i], provider: providersList[i] || file.provider || 'unknown' });
		}
	}
	const seen = new Set();
	return result.filter(o => {
		const key = `${o.email}::${o.provider}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function showOwnerTooltip(event, fileId) {
	const rect = event.currentTarget.getBoundingClientRect();
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let left = rect.left;
	if (left + TOOLTIP_WIDTH > vw - 12) left = vw - TOOLTIP_WIDTH - 12;
	if (left < 8) left = 8;
	let top;
	const spaceBelow = vh - rect.bottom;
	if (spaceBelow >= TOOLTIP_HEIGHT || spaceBelow >= rect.top) {
		top = rect.bottom + 8;
	} else {
		top = rect.top - TOOLTIP_HEIGHT - 8;
		if (top < 8) top = 8;
	}
	activeTooltip.value = { id: fileId, style: { top: `${top}px`, left: `${left}px` } };
}

function hideOwnerTooltip() {
	activeTooltip.value = null;
}

const { t } = useI18n();

const fileTreeStore = useFileTreeStore();
const accountStore = useAccountManagementStore();

const { files, isLoading } = storeToRefs(fileTreeStore);
const { storagePercentRounded, storageLabel, usedFormatted, usedTotalLabel, totalUsed } = useStorageStats();

const quickFiles = computed(() => files.value.filter((file) => !file.is_folder).slice(0, 6));

async function loadPage() {
	await Promise.all([fileTreeStore.loadFiles('/'), accountStore.loadAccounts()]);
}

onMounted(loadPage);
</script>

<template>
	<DriveShell current-section="home">
		<div class="min-h-[calc(100vh-84px)] rounded-[24px] bg-white px-4 py-6 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6">
			<section class="mb-7 grid gap-5 rounded-[20px] bg-gradient-to-b from-[#e8f0fe] to-[#f1f6ff] p-7 dark:from-slate-900 dark:to-slate-800 sm:grid-cols-[minmax(0,1.6fr)_280px]">
				<div>
					<p class="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#1a73e8]">{{ t('home.subtitle') }}</p>
					<h2 class="mb-2 text-[28px] font-medium text-[#202124] dark:text-slate-100">{{ t('home.heroTitle') }}</h2>
					<p class="text-[#5f6368] dark:text-slate-400">
						{{ t('home.heroDesc') }}
					</p>

					<div class="mt-[18px] flex flex-wrap gap-3">
						<RouterLink to="/my-drive" class="inline-flex h-10 items-center rounded-full border border-[#1a73e8] bg-[#1a73e8] px-[18px] text-white disabled:opacity-60">
							{{ t('nav.myDrive') }}
						</RouterLink>
						<RouterLink to="/quota" class="inline-flex h-10 items-center rounded-full border border-[#dadce0] bg-white px-[18px] text-[#1a73e8] dark:border-slate-600 dark:bg-slate-800 dark:text-sky-400">
							{{ t('nav.storage') }}
						</RouterLink>
					</div>
				</div>

				<div class="flex flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e0e3e7] bg-white p-5 text-center dark:border-slate-700 dark:bg-slate-800/80">
					<div class="grid size-[116px] place-items-center rounded-full" :style="{ background: `conic-gradient(#1a73e8 0 ${storagePercentRounded}%, #eaf1fb ${storagePercentRounded}% 100%)` }">
						<div class="grid size-[82px] place-items-center rounded-full bg-white font-bold text-[#1a73e8] dark:bg-slate-900">{{ storagePercentRounded }}%</div>
					</div>
					<div>
						<strong>{{ usedFormatted }}</strong>
						<p class="text-[#5f6368] dark:text-slate-400">{{ storageLabel }}</p>
					</div>
				</div>
			</section>

			<section class="mt-[26px]">
				<div class="mb-3 flex items-center justify-between gap-3">
					<h2 class="m-0 text-base font-medium text-[#202124] dark:text-slate-100">{{ t('home.recentFiles') }}</h2>
					<RouterLink to="/recent" class="rounded-full border border-[#dadce0] bg-white px-3.5 py-2 text-[#1a73e8] dark:border-slate-600 dark:bg-slate-800 dark:text-sky-400">{{ t('home.viewAll') }}</RouterLink>
				</div>

				<div class="overflow-hidden rounded-2xl border border-[#e0e3e7] dark:border-slate-700">
					<div class="grid min-h-11 grid-cols-[minmax(220px,2fr)_1.1fr_1fr_140px] items-center gap-3 bg-[#f8fafd] px-[18px] text-[13px] text-[#5f6368] dark:bg-slate-900/70 dark:text-slate-400 max-md:grid-cols-[minmax(180px,1.8fr)_1fr_1fr]">
						<span>{{ t('home.fileName') }}</span>
						<span>{{ t('home.fileOwner') }}</span>
						<span>{{ t('home.fileModified') }}</span>
						<span class="max-md:hidden">{{ t('home.fileSize') }}</span>
					</div>

					<div v-for="file in quickFiles" :key="file.id" class="grid min-h-[52px] grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_140px] items-center gap-3 border-t border-[#eceff1] px-[18px] dark:border-slate-700 max-md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
						<span class="flex min-w-0 items-center gap-2.5 text-[#202124] dark:text-slate-100">
							<IconFileDescription :size="18" :stroke="1.8" class="text-[#5f6368] dark:text-slate-400" />
							<TruncateMarquee :text="file.display_name || file.file_name" />
						</span>
						<!-- Owner cell -->
						<div class="flex min-w-0 items-center gap-2 text-[#5f6368] dark:text-slate-400">
							<!-- Single owner -->
							<template v-if="fileOwners(file).length <= 1">
								<div v-if="fileOwners(file)[0] && providerIcon(fileOwners(file)[0].provider)" class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-slate-100 dark:border-slate-800/80 dark:bg-slate-900/70">
									<img :src="providerIcon(fileOwners(file)[0].provider)" :alt="providerLabel(fileOwners(file)[0].provider)" class="size-3.5 object-contain" />
								</div>
								<TruncateMarquee class="min-w-0 text-xs font-medium" :text="fileOwners(file)[0] ? fileOwners(file)[0].email : file.email" />
							</template>
							<!-- Multi-owner (RAID) -->
							<template v-else>
								<div
									class="flex items-center gap-2 min-w-0 cursor-pointer rounded-lg px-1 py-0.5 -mx-1 transition hover:bg-slate-100 dark:hover:bg-slate-700/50"
									@mouseenter="showOwnerTooltip($event, file.id)"
									@mouseleave="hideOwnerTooltip"
								>
									<div class="flex -space-x-2 shrink-0">
										<div v-for="(owner, idx) in fileOwners(file)" :key="idx"
											class="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
											:style="{ zIndex: fileOwners(file).length - idx }">
											<img :src="providerIcon(owner.provider)" :alt="providerLabel(owner.provider)" class="size-3.5 object-contain" />
										</div>
									</div>
									<div class="flex flex-col min-w-0">
										<span class="text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-none">Cloud RAID</span>
										<span class="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{{ fileOwners(file).length }} Accounts</span>
									</div>
								</div>
								<!-- Teleported fixed tooltip -->
								<Teleport to="body">
									<Transition name="tooltip-fade">
										<div v-if="activeTooltip?.id === file.id" class="omni-fixed-tooltip" :style="activeTooltip.style"
											@mouseenter="activeTooltip = activeTooltip"
											@mouseleave="hideOwnerTooltip">
											<div class="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800/80">
												<div class="flex items-center gap-1.5">
													<span class="inline-flex size-5 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
														<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
													</span>
													<span class="text-xs font-bold text-slate-800 dark:text-slate-200">Cloud RAID Storage</span>
												</div>
												<span class="rounded-full bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-950/60 dark:border-indigo-900/30 dark:text-indigo-400">Active</span>
											</div>
											<div class="space-y-1.5 max-h-[180px] overflow-y-auto pr-0.5">
												<div v-for="(owner, idx) in fileOwners(file)" :key="idx" class="flex items-center justify-between gap-3 rounded-xl p-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
													<div class="flex items-center gap-2 min-w-0">
														<div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700">
															<img :src="providerIcon(owner.provider)" :alt="providerLabel(owner.provider)" class="size-4 object-contain" />
														</div>
														<div class="min-w-0">
															<p class="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{{ owner.email }}</p>
															<p class="text-[10px] text-slate-400 dark:text-slate-500 capitalize">{{ providerLabel(owner.provider) }}</p>
														</div>
													</div>
													<span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase"
														:class="idx === 0 ? 'bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30' : 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30'">
														{{ idx === 0 ? 'Primary' : 'Replica' }}
													</span>
												</div>
											</div>
										</div>
									</Transition>
								</Teleport>
							</template>
						</div>
						<span class="text-[#5f6368] dark:text-slate-400">{{ formatDate(getModifiedTime(file)) }}</span>
						<span class="text-[#5f6368] dark:text-slate-400 max-md:hidden">{{ formatBytesStrict(file.size) }}</span>
					</div>

					<div v-if="!quickFiles.length && !isLoading" class="p-[18px] text-[#5f6368] dark:text-slate-400">{{ t('home.noFiles') }}</div>
				</div>
			</section>
		</div>
	</DriveShell>
</template>

<style>
.omni-fixed-tooltip {
	position: fixed;
	z-index: 9999;
	min-width: 300px;
	max-width: 360px;
	border-radius: 20px;
	border: 1px solid rgba(226, 232, 240, 0.6);
	background: rgba(255, 255, 255, 0.97);
	padding: 14px;
	box-shadow:
		0 4px 6px -1px rgba(0, 0, 0, 0.07),
		0 20px 40px -8px rgba(0, 0, 0, 0.14),
		0 0 0 1px rgba(0, 0, 0, 0.04);
	backdrop-filter: blur(16px);
	-webkit-backdrop-filter: blur(16px);
	pointer-events: auto;
}

.dark .omni-fixed-tooltip {
	border-color: rgba(51, 65, 85, 0.6);
	background: rgba(2, 6, 23, 0.97);
	box-shadow:
		0 4px 6px -1px rgba(0, 0, 0, 0.3),
		0 20px 40px -8px rgba(0, 0, 0, 0.5),
		0 0 0 1px rgba(255, 255, 255, 0.05);
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
	transition: opacity 0.15s ease, transform 0.15s ease;
}
.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
	opacity: 0;
	transform: translateY(4px) scale(0.98);
}
</style>