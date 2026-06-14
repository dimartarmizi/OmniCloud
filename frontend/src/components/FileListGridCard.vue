<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconStarFilled } from '@tabler/icons-vue';
import TruncateMarquee from './TruncateMarquee.vue';
import { formatBytes, formatDate, getModifiedTime, providerIcon, providerLabel } from '../composables/useFormatFile.js';
import { getFileIcon } from '../composables/useFileType.js';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();

const { t } = useI18n();

const props = defineProps({
	item: { type: Object, required: true },
	selected: { type: Boolean, default: false },
	nameField: { type: String, default: 'file_name' },
	showStar: { type: Boolean, default: true },
	highlighted: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'open', 'contextmenu']);

const displayName = computed(() => {
	if (props.nameField === 'display_name') {
		return props.item.display_name || props.item.file_name || '';
	}
	return props.item[props.nameField] || '';
});

const owners = computed(() => {
	const emails = props.item.email ? props.item.email.split(',').map(s => s.trim()) : [];
	const providersList = props.item.providers ? props.item.providers.split(',').map(s => s.trim()) : [];
	const result = [];
	
	if (emails.length === 0) {
		if (props.item.email || props.item.provider) {
			result.push({
				email: props.item.email || '',
				provider: props.item.provider || 'unknown'
			});
		}
	} else {
		for (let i = 0; i < emails.length; i++) {
			result.push({
				email: emails[i],
				provider: providersList[i] || props.item.provider || 'unknown'
			});
		}
	}
	
	const seen = new Set();
	return result.filter(o => {
		const key = `${o.email}::${o.provider}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
});

// ── Fixed-position tooltip (escapes overflow clipping) ──────────────────────
const tooltipVisible = ref(false);
const tooltipStyle = ref({});

const TOOLTIP_WIDTH = 300;
const TOOLTIP_HEIGHT = 240;

function showTooltip(event) {
	const rect = event.currentTarget.getBoundingClientRect();
	const vw = window.innerWidth;
	const vh = window.innerHeight;

	let left = rect.left;
	if (left + TOOLTIP_WIDTH > vw - 12) {
		left = vw - TOOLTIP_WIDTH - 12;
	}
	if (left < 8) left = 8;

	let top;
	const spaceBelow = vh - rect.bottom;
	const spaceAbove = rect.top;
	if (spaceBelow >= TOOLTIP_HEIGHT || spaceBelow >= spaceAbove) {
		top = rect.bottom + 8;
	} else {
		top = rect.top - TOOLTIP_HEIGHT - 8;
		if (top < 8) top = 8;
	}

	tooltipStyle.value = { top: `${top}px`, left: `${left}px` };
	tooltipVisible.value = true;
}

function hideTooltip() {
	tooltipVisible.value = false;
}

function handleClick(event) {
	emit('select', event);
}

function handleDblClick(event) {
	emit('open', event);
}

function handleContextMenu(event) {
	emit('contextmenu', event);
}
</script>

<template>
	<div
		class="relative group select-none rounded-[22px] border p-4 transition hover:-translate-y-0.5 hover:border-[#d2e3fc] hover:shadow-[0_10px_30px_rgba(32,33,36,0.08)] dark:hover:border-slate-500 cursor-pointer"
		:class="selected ? 'border-[#1a73e8] bg-gradient-to-br from-[#e8f0fe] to-[#f8fbff] shadow-[0_14px_34px_rgba(26,115,232,0.14)] dark:border-sky-400 dark:from-sky-500/15 dark:to-slate-800' : highlighted ? 'border-amber-400 bg-gradient-to-br from-amber-50 to-[#fffdf5] shadow-[0_14px_34px_rgba(245,158,11,0.14)] dark:border-amber-300 dark:from-amber-400/15 dark:to-slate-800' : 'border-[#e0e3e7] bg-white dark:border-slate-700 dark:bg-slate-800'"
		:data-file-id="item.id"
		@click="handleClick"
		@dblclick="handleDblClick"
		@contextmenu="handleContextMenu"
	>
		<div class="flex w-full flex-col items-start gap-4 text-left">
			<div class="flex w-full items-start justify-between gap-3">
				<div class="grid size-12 place-items-center rounded-2xl transition" :class="selected ? 'bg-[#d3e3fd] text-[#1a73e8] shadow-inner dark:bg-sky-500/20 dark:text-sky-300' : highlighted ? 'bg-amber-100 text-amber-500 shadow-inner dark:bg-amber-400/20 dark:text-amber-300' : 'bg-[#f1f3f4] text-[#5f6368] dark:bg-slate-700 dark:text-slate-300'">
					<component :is="getFileIcon(item, selected || highlighted)" :size="22" :stroke="selected || highlighted ? 0 : 1.8" class="transition-transform duration-200 group-hover:scale-110" />
				</div>
				<div class="flex items-center gap-1.5 shrink-0">
					<span v-if="!item.is_folder && item.parts_count !== undefined && settingsStore.replicationFactor > 1" class="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase transition" :class="item.parts_count >= settingsStore.replicationFactor ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'">
						{{ item.parts_count >= settingsStore.replicationFactor ? 'Secured' : 'Syncing' }}
					</span>
					<IconStarFilled v-if="showStar && item.is_starred && item.capabilities?.starred" :size="16" :stroke="0" class="text-amber-400" />
				</div>
			</div>

			<div class="min-w-0 w-full">
				<TruncateMarquee as="p" class="text-sm font-semibold text-[#202124] dark:text-slate-100" :text="displayName" />

				<!-- Owner area -->
				<div class="mt-2.5 flex min-w-0 items-center gap-2 text-[#5f6368] dark:text-slate-400">
					<!-- Single owner -->
					<template v-if="owners.length <= 1">
						<div v-if="owners[0] && providerIcon(owners[0].provider)" class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-slate-100 dark:border-slate-800/80 dark:bg-slate-900/70">
							<img :src="providerIcon(owners[0].provider)" :alt="providerLabel(owners[0].provider)" class="size-3.5 object-contain" />
						</div>
						<TruncateMarquee as="p" class="min-w-0 text-xs font-medium" :text="owners[0] ? owners[0].email : item.email || t('drive.noOwner')" />
					</template>

					<!-- Multi-owner (RAID) -->
					<template v-else>
						<div
							class="flex items-center gap-2 min-w-0 cursor-pointer rounded-lg px-1.5 py-1 -mx-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-700/50"
							@mouseenter="showTooltip"
							@mouseleave="hideTooltip"
						>
							<!-- Stacked Avatars -->
							<div class="flex -space-x-2 shrink-0">
								<div
									v-for="(owner, idx) in owners"
									:key="idx"
									class="relative flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
									:style="{ zIndex: owners.length - idx }"
								>
									<img :src="providerIcon(owner.provider)" :alt="providerLabel(owner.provider)" class="size-3.5 object-contain" />
								</div>
							</div>

							<!-- Label -->
							<div class="flex flex-col min-w-0">
								<span class="truncate text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-none">Cloud RAID</span>
								<span class="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{{ owners.length }} Accounts</span>
							</div>
						</div>

						<!-- Teleported tooltip – renders at <body> level, never clipped -->
						<Teleport to="body">
							<Transition name="tooltip-fade">
								<div
									v-if="tooltipVisible"
									class="omni-fixed-tooltip"
									:style="tooltipStyle"
									@mouseenter="tooltipVisible = true"
									@mouseleave="hideTooltip"
								>
									<!-- Header -->
									<div class="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800/80">
										<div class="flex items-center gap-1.5">
											<span class="inline-flex size-5 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
												<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
											</span>
											<span class="text-xs font-bold text-slate-800 dark:text-slate-200">Cloud RAID Storage</span>
										</div>
										<span class="rounded-full bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-950/60 dark:border-indigo-900/30 dark:text-indigo-400">Active</span>
									</div>

									<!-- Owner list -->
									<div class="space-y-1.5 max-h-[180px] overflow-y-auto pr-0.5">
										<div
											v-for="(owner, idx) in owners"
											:key="idx"
											class="flex items-center justify-between gap-3 rounded-xl p-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
										>
											<div class="flex items-center gap-2 min-w-0">
												<div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700">
													<img :src="providerIcon(owner.provider)" :alt="providerLabel(owner.provider)" class="size-4 object-contain" />
												</div>
												<div class="min-w-0">
													<p class="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{{ owner.email }}</p>
													<p class="text-[10px] text-slate-400 dark:text-slate-500 capitalize">{{ providerLabel(owner.provider) }}</p>
												</div>
											</div>
											<span
												class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase"
												:class="idx === 0 ? 'bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30' : 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30'"
											>
												{{ idx === 0 ? 'Primary' : 'Replica' }}
											</span>
										</div>
									</div>
								</div>
							</Transition>
						</Teleport>
					</template>
				</div>
			</div>

			<div class="flex w-full items-center justify-between text-xs text-[#5f6368] dark:text-slate-400">
				<span>{{ formatDate(getModifiedTime(item)) }}</span>
				<span>{{ item.is_folder ? t('drive.folder') : formatBytes(item.size) }}</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
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

:global(.dark) .omni-fixed-tooltip {
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
