<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX, IconCopy, IconCheck } from '@tabler/icons-vue';
import {
	formatBytes,
	formatDate,
	getCreatedTime,
	getModifiedTime,
	providerLabel as defaultProviderLabel,
} from '../composables/useFormatFile.js';

const props = defineProps({
	file: { type: Object, default: null },
	isOpen: { type: Boolean, default: false },
	isLoading: { type: Boolean, default: false },
	locationFallback: { type: String, default: '' },
	providerLabelFn: { type: Function, default: null },
	isFolder: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const { t } = useI18n();

const isVisible = computed(() => Boolean(props.isOpen && props.file));
const providerLabel = computed(() => {
	const fn = typeof props.providerLabelFn === 'function' ? props.providerLabelFn : defaultProviderLabel;
	return fn(props.file?.provider) || props.file?.provider || '—';
});
const fileName = computed(() => props.file?.name || props.file?.file_name || '—');
const mimeType = computed(() => props.file?.mime_type || props.file?.mimeType || '—');
const owner = computed(() => props.file?.owner_email || props.file?.email || '—');
const remoteId = computed(() => props.file?.remote_file_id || props.file?.id || '—');
const location = computed(() => props.file?.virtual_path || props.locationFallback || '—');
const title = computed(() => (props.isFolder ? `${t('drive.details')} ${t('drive.folder')}` : t('drive.details')));

function onBackdropClick() {
	emit('close');
}

const copied = ref(false);
let copyResetTimer = null;

// Copy the internal remote id to the clipboard on demand. End-users never need
// to read the raw provider id, so it's hidden behind this action instead of
// being rendered inline. Falls back to a hidden textarea when the async
// Clipboard API is unavailable (insecure context / older browsers).
async function copyRemoteId() {
	const value = remoteId.value;
	if (!value || value === '—') return;

	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
		} else {
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.setAttribute('readonly', '');
			textarea.style.position = 'absolute';
			textarea.style.left = '-9999px';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
		}
		copied.value = true;
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			copied.value = false;
		}, 2000);
	} catch {
		// Clipboard write can be rejected (permissions); leave the button state
		// unchanged so the user can retry. No raw error surfaced to the UI.
	}
}
</script>

<template>
	<div
		v-if="isVisible"
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4"
		@click="onBackdropClick"
	>
		<div
			class="w-full max-w-lg rounded-[28px] bg-white p-6 text-[#202124] shadow-[0_24px_60px_rgba(32,33,36,0.28)] dark:bg-slate-800 dark:text-slate-100"
			@click.stop
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-xl font-semibold">{{ title }}</h3>
					<p class="mt-1 text-sm text-[#5f6368] dark:text-slate-400">{{ t('drive.metadataDescription') }}</p>
				</div>
				<button
					type="button"
					class="grid size-9 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8"
					:title="t('common.close')"
					@click="emit('close')"
				>
					<IconX :size="18" :stroke="2" />
				</button>
			</div>

			<div v-if="props.isLoading" class="mt-6 text-sm text-[#5f6368] dark:text-slate-400">
				{{ t('common.loading') }}
			</div>

			<dl v-else class="mt-6 grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 text-sm">
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('common.name') }}</dt>
				<dd>{{ fileName }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.type') }}</dt>
				<dd>{{ mimeType }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.size') }}</dt>
				<dd>
					<span v-if="props.isFolder">—</span>
					<span v-else>{{ formatBytes(props.file?.size) }}</span>
				</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.owner') }}</dt>
				<dd>{{ owner }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.provider') || 'Provider' }}</dt>
				<dd>{{ providerLabel }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.created') }}</dt>
				<dd>{{ formatDate(getCreatedTime(props.file)) }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.modified') }}</dt>
				<dd>{{ formatDate(getModifiedTime(props.file)) }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.location') }}</dt>
				<dd class="break-all">{{ location }}</dd>
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.remoteId') || 'Remote ID' }}</dt>
				<dd>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#5f6368] transition hover:bg-black/5 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-white/8"
						:title="remoteId"
						@click="copyRemoteId"
					>
						<IconCheck v-if="copied" :size="14" :stroke="2" />
						<IconCopy v-else :size="14" :stroke="2" />
						<span>{{ copied ? t('common.copied') : t('common.copyId') }}</span>
					</button>
				</dd>
			</dl>
		</div>
	</div>
</template>
