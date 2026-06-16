<script setup>
import { IconList, IconListDetailsFilled, IconLayoutGrid, IconLayoutGridFilled } from '@tabler/icons-vue';

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['update:modelValue']);

function setMode(mode) {
	const isGrid = mode === 'grid';
	if (props.modelValue !== isGrid) emit('update:modelValue', isGrid);
}
</script>

<template>
	<div class="flex items-center gap-2">
		<button
type="button" class="grid size-9 place-items-center rounded-full transition" :class="!modelValue
			? 'bg-[#e8f0fe] text-[#1a73e8] dark:bg-sky-500/15 dark:text-sky-300'
			: 'text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8'" @click="setMode('list')">
			<component :is="!modelValue ? IconListDetailsFilled : IconList" :size="18" :stroke="!modelValue ? 0 : 2" />
		</button>
		<button
type="button" class="grid size-9 place-items-center rounded-full transition" :class="modelValue
			? 'bg-[#e8f0fe] text-[#1a73e8] dark:bg-sky-500/15 dark:text-sky-300'
			: 'text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8'" @click="setMode('grid')">
			<component :is="modelValue ? IconLayoutGridFilled : IconLayoutGrid" :size="18" :stroke="modelValue ? 0 : 2" />
		</button>
	</div>
</template>
