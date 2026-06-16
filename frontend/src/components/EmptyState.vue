<script setup>
import { IconCloudOff, IconUpload } from '@tabler/icons-vue';

// Polished empty state: an icon, a short message, and an optional CTA button.
// Used by the drive views in place of plain "no files" text.
defineProps({
	message: { type: String, required: true },
	hint: { type: String, default: '' },
	icon: { type: [Object, Function], default: null },
	ctaLabel: { type: String, default: '' },
	ctaIcon: { type: [Object, Function], default: () => IconUpload },
});

const emit = defineEmits(['cta']);
</script>

<template>
	<div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
		<div
			class="grid size-16 place-items-center rounded-full bg-[#e8f0fe] text-[#1a73e8] dark:bg-slate-800 dark:text-sky-300"
		>
			<component :is="icon || IconCloudOff" :size="30" :stroke="1.6" />
		</div>
		<div>
			<p class="text-sm font-medium text-[#202124] dark:text-slate-100">{{ message }}</p>
			<p v-if="hint" class="mt-1 text-xs text-[#5f6368] dark:text-slate-400">{{ hint }}</p>
		</div>
		<button
			v-if="ctaLabel"
			type="button"
			class="mt-1 inline-flex items-center gap-2 rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc]"
			@click="emit('cta')"
		>
			<component :is="ctaIcon" :size="18" :stroke="2" />
			<span>{{ ctaLabel }}</span>
		</button>
	</div>
</template>
