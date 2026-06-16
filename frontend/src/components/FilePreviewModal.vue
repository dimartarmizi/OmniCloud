<script setup>
import { computed } from 'vue';
import { IconX, IconPlayerPlay } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
	file: { type: Object, default: null },
	isOpen: { type: Boolean, default: false },
	isLoading: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'loaded', 'failed']);

const { t } = useI18n();

const displayName = computed(() => {
	if (!props.file) return '';
	return props.file.display_name || props.file.file_name || props.file.name || '';
});

const isVisible = computed(() => Boolean(props.isOpen && props.file));

function onBackdropClick() {
	emit('close');
}

function onClose() {
	emit('close');
}

function onLoad() {
	emit('loaded');
}

function onError() {
	emit('failed');
}
</script>

<template>
	<div
		v-if="isVisible"
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8"
		@click="onBackdropClick"
	>
		<div
			class="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white text-[#202124] shadow-[0_24px_60px_rgba(32,33,36,0.28)] dark:bg-slate-900 dark:text-slate-100"
			@click.stop
		>
			<div
				class="flex items-center justify-between gap-4 border-b border-[#e8eaed] px-5 py-4 dark:border-slate-800"
			>
				<div class="min-w-0">
					<p class="truncate text-base font-semibold">{{ displayName }}</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="grid size-10 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8"
						@click="onClose"
					>
						<IconX :size="18" :stroke="2" />
					</button>
				</div>
			</div>
			<div class="relative min-h-[420px] flex-1 bg-[#f8fafd] dark:bg-slate-950">
				<div
					v-if="props.isLoading"
					class="absolute inset-0 z-10 grid place-items-center text-sm text-[#5f6368] dark:text-slate-400"
				>
					{{ t('preview.loading') }}
				</div>
				<img
					v-if="props.file?.previewType === 'image'"
					:src="props.file?.previewUrl"
					class="max-h-[75vh] w-full object-contain"
					:alt="displayName"
					@load="onLoad"
					@error="onError"
				/>
				<video
					v-else-if="props.file?.previewType === 'video'"
					class="max-h-[75vh] w-full bg-black"
					controls
					playsinline
					@loadeddata="onLoad"
					@error="onError"
				>
					<source :src="props.file?.previewUrl" :type="props.file?.mime_type || 'video/mp4'" />
				</video>
				<iframe
					v-else-if="['pdf', 'document', 'audio'].includes(props.file?.previewType)"
					:src="props.file?.previewUrl"
					class="h-[75vh] w-full border-0"
					:title="t('preview.document')"
					@load="onLoad"
				/>
				<div
					v-else
					class="grid min-h-[420px] place-items-center px-6 text-center text-sm text-[#5f6368] dark:text-slate-400"
				>
					<div>
						<div
							class="mx-auto grid size-16 place-items-center rounded-full bg-[#e8f0fe] text-[#1a73e8] dark:bg-slate-800"
						>
							<IconPlayerPlay :size="28" :stroke="1.8" />
						</div>
						<p class="mt-4">{{ t('preview.notAvailable') }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
