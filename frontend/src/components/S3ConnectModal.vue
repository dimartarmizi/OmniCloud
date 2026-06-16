<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
	isConnecting: {
		type: Boolean,
		default: false,
	},
	error: {
		type: String,
		default: '',
	},
});

const emit = defineEmits(['close', 'connect']);

const { t } = useI18n();

const form = ref({
	accessKeyId: '',
	secretAccessKey: '',
	bucket: '',
	region: '',
	endpoint: '',
	label: '',
	totalSpace: '',
});

function closeModal() {
	if (props.isConnecting) return;
	emit('close');
}

function submitForm() {
	const gb = Number(form.value.totalSpace);
	emit('connect', {
		accessKeyId: form.value.accessKeyId.trim(),
		secretAccessKey: form.value.secretAccessKey.trim(),
		bucket: form.value.bucket.trim(),
		region: form.value.region.trim() || undefined,
		endpoint: form.value.endpoint.trim() || undefined,
		label: form.value.label.trim() || undefined,
		totalSpace: gb > 0 ? Math.round(gb * 1024 * 1024 * 1024) : undefined,
	});
}
</script>

<template>
	<div class="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm">
		<form class="max-h-full w-full max-w-lg overflow-y-auto rounded-[14px] border border-[#e0e3e7] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.24)] dark:border-slate-700 dark:bg-slate-900" @submit.prevent="submitForm">
			<div class="mb-2">
				<h2 class="text-xl font-medium">{{ t('connectModal.s3.title') }}</h2>
			</div>
			<p class="mb-5 text-sm text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.hint') }}</p>

			<p v-if="error" class="mb-4 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300">
				{{ error }}
			</p>

			<div class="mb-3 grid grid-cols-2 gap-3">
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.accessKeyId') }}</span>
					<input v-model="form.accessKeyId" type="text" required autocomplete="off" :placeholder="t('connectModal.s3.accessKeyIdPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.secretAccessKey') }}</span>
					<input v-model="form.secretAccessKey" type="password" required autocomplete="off" :placeholder="t('connectModal.s3.secretAccessKeyPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
			</div>

			<div class="mb-3 grid grid-cols-2 gap-3">
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.bucket') }}</span>
					<input v-model="form.bucket" type="text" required :placeholder="t('connectModal.s3.bucketPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.region') }}</span>
					<input v-model="form.region" type="text" :placeholder="t('connectModal.s3.regionPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
			</div>

			<label class="mb-3 block text-sm">
				<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.endpoint') }}</span>
				<input v-model="form.endpoint" type="text" required :placeholder="t('connectModal.s3.endpointPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
			</label>

			<div class="mb-3 grid grid-cols-2 gap-3">
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.label') }}</span>
					<input v-model="form.label" type="text" :placeholder="t('connectModal.s3.labelPlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
				<label class="block text-sm">
					<span class="mb-1 block text-[#5f6368] dark:text-slate-400">{{ t('connectModal.s3.totalSpace') }}</span>
					<input v-model="form.totalSpace" type="number" min="1" :placeholder="t('connectModal.s3.totalSpacePlaceholder')" class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500" />
				</label>
			</div>

			<div class="mt-6 flex items-center justify-end gap-3">
				<button type="button" class="h-10 rounded-full px-4 text-[#5f6368] hover:bg-[#f1f3f4] disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800" :disabled="isConnecting" @click="closeModal">{{ t('connectModal.cancel') }}</button>
				<button type="submit" class="h-10 rounded-full bg-[#1a73e8] px-5 text-white disabled:opacity-60" :disabled="isConnecting">{{ isConnecting ? t('connectModal.connecting') : t('connectModal.connect') }}</button>
			</div>
		</form>
	</div>
</template>
