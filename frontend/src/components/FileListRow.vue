<script setup>
import { computed } from 'vue';
import { IconLock, IconStarFilled } from '@tabler/icons-vue';
import TruncateMarquee from './TruncateMarquee.vue';
import { formatBytes, formatDate, getModifiedTime, providerIcon, providerLabel } from '../composables/useFormatFile.js';
import { getFileIcon } from '../composables/useFileType.js';

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
	<div class="group grid min-h-[52px] cursor-default select-none grid-cols-[minmax(260px,2fr)_minmax(180px,1.1fr)_minmax(150px,1fr)_140px] items-center gap-3 border-t border-[#eceff1] px-[18px] transition first:border-t-0 dark:border-slate-700" :class="selected ? 'bg-gradient-to-r from-[#e8f0fe] to-[#f8fbff] shadow-[inset_4px_0_0_#1a73e8] dark:from-sky-500/15 dark:to-slate-800 dark:shadow-[inset_4px_0_0_#38bdf8]' : highlighted ? 'bg-gradient-to-r from-amber-50 to-[#fffdf5] shadow-[inset_4px_0_0_#f59e0b] dark:from-amber-400/15 dark:to-slate-800 dark:shadow-[inset_4px_0_0_#fbbf24]' : 'hover:bg-black/[0.02] dark:hover:bg-white/6'" :data-file-id="item.id" @click="handleClick" @dblclick="handleDblClick" @contextmenu="handleContextMenu">
		<div class="flex min-w-0 items-center gap-2.5 text-[#202124] dark:text-slate-100">
			<component :is="getFileIcon(item, selected || highlighted)" :size="18" :stroke="selected || highlighted ? 0 : 1.8" class="transition-transform duration-200 group-hover:scale-110" :class="selected ? 'text-[#1a73e8] drop-shadow-sm dark:text-sky-300' : highlighted ? 'text-amber-500 drop-shadow-sm dark:text-amber-300' : 'text-[#5f6368] dark:text-slate-400'" />
			<TruncateMarquee :text="displayName" />
			<IconLock v-if="item.is_hidden" :size="14" :stroke="2" class="shrink-0 text-[#9aa0a6] dark:text-slate-500" />
			<IconStarFilled v-if="showStar && item.is_starred && item.capabilities?.starred" :size="14" :stroke="0" class="shrink-0 text-amber-400" />
		</div>
		<div class="flex min-w-0 items-center gap-2 text-[#5f6368] dark:text-slate-400">
			<div v-if="providerIcon(item.provider)" class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white dark:bg-slate-900/70">
				<img :src="providerIcon(item.provider)" :alt="providerLabel(item.provider)" class="size-3.5 object-contain" />
			</div>
			<TruncateMarquee class="min-w-0" :text="item.email" />
		</div>
		<span class="text-[#5f6368] dark:text-slate-400">{{ formatDate(getModifiedTime(item)) }}</span>
		<span class="text-[#5f6368] dark:text-slate-400">{{ item.is_folder ? '—' : formatBytes(item.size) }}</span>
	</div>
</template>
