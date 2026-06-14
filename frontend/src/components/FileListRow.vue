<script setup>
import { computed, ref } from 'vue';
import { IconStarFilled, IconShieldCheck, IconShieldOff, IconShieldExclamation } from '@tabler/icons-vue';
import TruncateMarquee from './TruncateMarquee.vue';
import { formatBytes, formatDate, getModifiedTime, providerIcon, providerLabel } from '../composables/useFormatFile.js';
import { getFileIcon } from '../composables/useFileType.js';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();

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
const TOOLTIP_HEIGHT = 240; // approximate max height

function showTooltip(event) {
	const rect = event.currentTarget.getBoundingClientRect();
	const vw = window.innerWidth;
	const vh = window.innerHeight;

	// Horizontal: prefer aligning to the left edge of trigger, but clamp to viewport
	let left = rect.left;
	if (left + TOOLTIP_WIDTH > vw - 12) {
		left = vw - TOOLTIP_WIDTH - 12;
	}
	if (left < 8) left = 8;

	// Vertical: show above or below based on available space
	let top;
	const spaceBelow = vh - rect.bottom;
	const spaceAbove = rect.top;
	if (spaceBelow >= TOOLTIP_HEIGHT || spaceBelow >= spaceAbove) {
		// Below the row
		top = rect.bottom + 8;
	} else {
		// Above the row
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
	<div class="relative group grid min-h-[52px] cursor-default select-none grid-cols-[minmax(260px,2fr)_minmax(180px,1.1fr)_minmax(150px,1fr)_140px] items-center gap-3 border-t border-[#eceff1] px-[18px] transition first:border-t-0 dark:border-slate-700" :class="selected ? 'bg-gradient-to-r from-[#e8f0fe] to-[#f8fbff] shadow-[inset_4px_0_0_#1a73e8] dark:from-sky-500/15 dark:to-slate-800 dark:shadow-[inset_4px_0_0_#38bdf8]' : highlighted ? 'bg-gradient-to-r from-amber-50 to-[#fffdf5] shadow-[inset_4px_0_0_#f59e0b] dark:from-amber-400/15 dark:to-slate-800 dark:shadow-[inset_4px_0_0_#fbbf24]' : 'hover:bg-black/[0.02] dark:hover:bg-white/6'" :data-file-id="item.id" @click="handleClick" @dblclick="handleDblClick" @contextmenu="handleContextMenu">
		<div class="flex min-w-0 items-center gap-2.5 text-[#202124] dark:text-slate-100">
			<component :is="getFileIcon(item, selected || highlighted)" :size="18" :stroke="selected || highlighted ? 0 : 1.8" class="transition-transform duration-200 group-hover:scale-110" :class="selected ? 'text-[#1a73e8] drop-shadow-sm dark:text-sky-300' : highlighted ? 'text-amber-500 drop-shadow-sm dark:text-amber-300' : 'text-[#5f6368] dark:text-slate-400'" />
			<TruncateMarquee :text="displayName" />
			<!-- Replication status badge (only when RAID > 1x and file is not a folder) -->
			<template v-if="!item.is_folder && settingsStore.replicationFactor > 1 && item.replication_status">
				<span
					v-if="item.replication_status === 'fully_protected'"
					title="Fully Protected — all replicas in place"
					class="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
				>
					<IconShieldCheck :size="11" :stroke="2.2" />
					{{ item.parts_count }}x
				</span>
				<span
					v-else-if="item.replication_status === 'partially_protected'"
					title="Partially Protected — some replicas missing"
					class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
				>
					<IconShieldExclamation :size="11" :stroke="2.2" />
					Partial
				</span>
				<span
					v-else
					title="Not Protected — waiting for replication"
					class="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700/50 dark:text-slate-400"
				>
					<IconShieldOff :size="11" :stroke="2" />
					Unprotected
				</span>
			</template>
			<IconStarFilled v-if="showStar && item.is_starred && item.capabilities?.starred" :size="14" :stroke="0" class="shrink-0 text-amber-400" />
		</div>

		<!-- Owner column -->
		<div class="flex min-w-0 items-center gap-2 text-[#5f6368] dark:text-slate-400">
			<!-- Single owner -->
			<template v-if="owners.length <= 1">
				<div v-if="owners[0] && providerIcon(owners[0].provider)" class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-slate-100 dark:border-slate-800/80 dark:bg-slate-900/70">
					<img :src="providerIcon(owners[0].provider)" :alt="providerLabel(owners[0].provider)" class="size-3.5 object-contain" />
				</div>
				<TruncateMarquee class="min-w-0 text-xs font-medium" :text="owners[0] ? owners[0].email : item.email" />
			</template>

			<!-- Multi-owner (RAID) -->
			<template v-else>
				<div
					class="flex items-center gap-2 min-w-0 cursor-pointer py-1 rounded-lg px-1 -mx-1 transition hover:bg-slate-100 dark:hover:bg-slate-700/50"
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

		<span class="text-[#5f6368] dark:text-slate-400">{{ formatDate(getModifiedTime(item)) }}</span>
		<span class="text-[#5f6368] dark:text-slate-400">{{ item.is_folder ? '—' : formatBytes(item.size) }}</span>
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
