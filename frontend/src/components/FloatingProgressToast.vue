<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	IconArrowRight,
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconDownload,
	IconEdit,
	IconFileDescription,
	IconFilter2X,
	IconFolderPlus,
	IconLoader2,
	IconRefresh,
	IconTrash,
	IconUpload,
	IconX,
} from '@tabler/icons-vue';

const { t } = useI18n();

const props = defineProps({
	uploads: { type: Array, required: true },
	totalProgress: { type: Number, required: true },
});

const emit = defineEmits(['close', 'close-item', 'retry']);

const isDismissed = ref(false);
const isMinimized = ref(false);

const rawUploads = computed(() => props.uploads);
const visibleUploads = computed(() => {
	const groups = [];
	const indexes = new Map();

	for (const upload of rawUploads.value) {
		const key = upload.batchId || upload.id;
		const index = indexes.get(key);
		if (index === undefined) {
			indexes.set(key, groups.length);
			groups.push({ ...upload, id: key, items: [upload] });
			continue;
		}

		groups[index].items.push(upload);
	}

	return groups.map((group) => {
		const itemCount = group.batchTotal || group.items.length;
		const statuses = group.items.map((item) => item.status);
		const failedItem = group.items.find((item) => item.status === 'failed');
		const activeItem = group.items.find((item) => !['completed', 'failed', 'cancelled'].includes(item.status));
		const progress = Math.round(
			group.items.reduce((sum, item) => sum + item.progress_percentage, 0) / group.items.length,
		);
		let status = activeItem?.status || group.status;

		if (failedItem) status = 'failed';
		else if (statuses.every((statusValue) => statusValue === 'completed')) status = 'completed';
		else if (statuses.every((statusValue) => statusValue === 'cancelled')) status = 'cancelled';

		return {
			...group,
			name: itemCount > 1 ? `${itemCount} item` : group.name,
			itemCount,
			status,
			error: failedItem?.error || group.error,
			progress_percentage: progress,
		};
	});
});
const activeCount = computed(
	() => visibleUploads.value.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status)).length,
);
const completedCount = computed(() => visibleUploads.value.filter((item) => item.status === 'completed').length);
const failedCount = computed(() => visibleUploads.value.filter((item) => item.status === 'failed').length);

const toastTitle = computed(() => {
	const latestTask = visibleUploads.value[0];
	if (!latestTask) return '';

	const type = latestTask.type || 'upload';
	const taskCount = latestTask.itemCount || 1;
	const labels = {
		upload: t('upload.uploading'),
		download: t('upload.downloading'),
		'create-folder': t('upload.creating'),
		rename: t('upload.renaming'),
		delete: t('upload.deleting'),
	};
	const targetKind = latestTask.targetKind || 'item';

	if (['create-folder', 'rename', 'delete'].includes(type)) {
		return `${labels[type] || t('upload.processing')} ${taskCount} ${targetKind}`;
	}

	return `${labels[type] || t('upload.processing')} ${taskCount} ${t('upload.item')}`;
});

const summaryText = computed(() => {
	if (failedCount.value) return t('upload.failed', { count: failedCount.value });
	if (activeCount.value) return t('upload.lessThanMinute');
	if (completedCount.value === visibleUploads.value.length) return t('upload.completed');
	return t('upload.waiting');
});

function closeToast() {
	isDismissed.value = true;
	emit('close');
}

function formatStatus(upload) {
	if (upload.error) return upload.error;
	const statusLabels = {
		pending: t('upload.waiting'),
		uploading: t('upload.uploading'),
		downloading: t('upload.downloading'),
		processing: t('upload.processing'),
		completed: t('upload.completed'),
		failed: t('upload.failed', { count: 1 }),
		cancelled: t('upload.cancelled'),
	};
	return statusLabels[upload.status] || upload.status;
}

function canCancel(upload) {
	return (
		['upload', 'download'].includes(upload.type) && ['pending', 'uploading', 'downloading'].includes(upload.status)
	);
}

// A failed upload can be retried (downloads/other ops cannot be re-run from here).
function canRetry(upload) {
	return upload.type === 'upload' && upload.status === 'failed';
}

function iconFor(upload) {
	const icons = {
		upload: IconUpload,
		download: IconDownload,
		'create-folder': IconFolderPlus,
		rename: IconEdit,
		delete: IconTrash,
	};
	return icons[upload.type] || IconFileDescription;
}
</script>

<template>
	<aside
		v-if="visibleUploads.length && !isDismissed"
		class="fixed bottom-0 right-4 z-50 w-[360px] overflow-hidden rounded-t-[18px] border border-b-0 border-[#e6ebf2] bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_16px_40px_rgba(15,23,42,0.35)]"
	>
		<header class="flex h-[54px] items-center justify-between gap-3 px-5 text-[#202124] dark:text-slate-100">
			<strong class="text-base font-medium">{{ toastTitle }}</strong>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="grid size-8 place-items-center rounded-full text-[#202124] transition hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-800"
					:title="isMinimized ? t('upload.expand') : t('upload.minimize')"
					@click="isMinimized = !isMinimized"
				>
					<component :is="isMinimized ? IconChevronUp : IconChevronDown" :size="20" :stroke="2.2" />
				</button>
				<button
					type="button"
					class="grid size-8 place-items-center rounded-full text-[#202124] transition hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-800"
					:title="t('upload.dismiss')"
					@click="closeToast"
				>
					<IconX :size="22" :stroke="2.2" />
				</button>
			</div>
		</header>

		<div v-show="!isMinimized">
			<div
				class="flex h-9 items-center justify-between bg-[#fbfcff] px-5 text-sm text-[#5f6368] dark:bg-slate-800/70 dark:text-slate-300"
			>
				<span>{{ summaryText }}</span>
				<span v-if="activeCount" class="font-medium text-[#1a73e8]">{{ totalProgress }}%</span>
			</div>

			<div class="max-h-[260px] overflow-y-auto py-2">
				<div
					v-for="upload in visibleUploads"
					:key="upload.id"
					class="group grid grid-cols-[28px_minmax(0,1fr)_36px] items-center gap-4 border-t border-[#eef2f7] px-5 py-3 text-sm text-[#5f6368] first:border-t-0 hover:bg-[#f8fafd] dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/70"
				>
					<div
						class="grid size-8 place-items-center rounded-md bg-[#e8f0fe] text-[#1a73e8] dark:bg-slate-800 dark:text-sky-300"
					>
						<component :is="iconFor(upload)" :size="17" :stroke="1.9" />
					</div>
					<div class="min-w-0">
						<p
							v-if="upload.type === 'rename' && upload.fromName && upload.toName"
							class="flex min-w-0 items-center gap-1.5 text-[#3c4043] dark:text-slate-100"
						>
							<span class="truncate">{{ upload.fromName }}</span>
							<IconArrowRight
								:size="15"
								:stroke="2"
								class="shrink-0 text-[#5f6368] dark:text-slate-400"
							/>
							<span class="truncate">{{ upload.toName }}</span>
						</p>
						<p v-else class="truncate text-[#3c4043] dark:text-slate-100">{{ upload.name }}</p>
						<p class="truncate text-xs text-[#7b8087] dark:text-slate-400">{{ formatStatus(upload) }}</p>
					</div>
					<div class="flex items-center justify-end gap-1">
						<button
							v-if="canRetry(upload)"
							type="button"
							class="grid size-7 place-items-center rounded-full text-[#1a73e8] transition hover:bg-[#e8f0fe] dark:text-sky-300 dark:hover:bg-slate-800"
							:title="t('common.retry')"
							:aria-label="t('common.retry')"
							@click="emit('retry', upload.id)"
						>
							<IconRefresh :size="18" :stroke="2.2" />
						</button>
						<button
							v-if="canCancel(upload)"
							type="button"
							class="relative grid size-7 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#eef2f7] dark:text-slate-300 dark:hover:bg-slate-800"
							:title="t('upload.cancel')"
							@click="emit('close-item', upload.id)"
						>
							<IconLoader2
								:size="22"
								:stroke="2"
								class="absolute animate-spin text-[#1a73e8] transition-opacity group-hover:opacity-0"
							/>
							<IconX
								:size="18"
								:stroke="2.2"
								class="text-[#c5221f] opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
						<IconLoader2
							v-else-if="
								upload.status !== 'completed' &&
								upload.status !== 'failed' &&
								upload.status !== 'cancelled'
							"
							:size="22"
							:stroke="2"
							class="animate-spin text-[#1a73e8]"
						/>
						<button
							v-else-if="upload.status === 'completed'"
							type="button"
							class="relative grid size-7 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#eef2f7] dark:text-slate-300 dark:hover:bg-slate-800"
							:title="t('upload.dismiss')"
							@click="emit('close-item', upload.id)"
						>
							<IconCheck
								:size="22"
								:stroke="2.2"
								class="absolute text-[#188038] transition-opacity group-hover:opacity-0"
							/>
							<IconFilter2X
								:size="18"
								:stroke="2.2"
								class="opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
						<button
							v-else-if="upload.status === 'cancelled'"
							type="button"
							class="relative grid size-7 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#eef2f7] dark:text-slate-300 dark:hover:bg-slate-800"
							:title="t('upload.dismiss')"
							@click="emit('close-item', upload.id)"
						>
							<IconX
								:size="20"
								:stroke="2.2"
								class="absolute text-[#c5221f] transition-opacity group-hover:opacity-0"
							/>
							<IconFilter2X
								:size="18"
								:stroke="2.2"
								class="opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
						<button
							v-else
							type="button"
							class="grid size-7 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#eef2f7] dark:text-slate-300 dark:hover:bg-slate-800"
							:title="t('upload.dismiss')"
							@click="emit('close-item', upload.id)"
						>
							<IconFilter2X :size="18" :stroke="2.2" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</aside>
</template>
