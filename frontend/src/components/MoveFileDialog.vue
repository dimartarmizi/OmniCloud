<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX, IconFolder, IconChevronRight, IconArrowBackUp } from '@tabler/icons-vue';
import { api } from '../services/api';

const props = defineProps({
	// The file/folder being moved. Used to scope the browse to the same provider
	// account (cross-provider moves are unsupported) and to forbid moving a
	// folder into itself.
	file: { type: Object, default: null },
	isOpen: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'confirm']);

const { t } = useI18n();

const currentPath = ref('/');
const folders = ref([]);
const loading = ref(false);
const errorMessage = ref('');

const accountId = computed(() => props.file?.cloud_account_id || null);

// The folder path the moved item currently lives in — selecting it is a no-op.
const sourcePath = computed(() => props.file?.virtual_path || '/');

// A folder cannot be moved into itself or its own descendants.
const ownSelfPath = computed(() => {
	if (!props.file?.is_folder) return null;
	const parent = sourcePath.value;
	const base = parent === '/' ? '' : parent.replace(/\/+$/, '');
	return `${base}/${props.file.file_name}/`;
});

const breadcrumbs = computed(() => {
	const normalized = currentPath.value === '/' ? '/' : currentPath.value.replace(/^\/+|\/+$/g, '');
	if (normalized === '/') return [{ label: t('drive.rootName'), path: '/' }];
	const segments = normalized.split('/').filter(Boolean);
	const crumbs = [{ label: t('drive.rootName'), path: '/' }];
	let acc = '';
	segments.forEach((segment) => {
		acc += `/${segment}`;
		crumbs.push({ label: segment, path: `${acc}/` });
	});
	return crumbs;
});

const canMoveHere = computed(() => {
	if (!props.file) return false;
	if (currentPath.value === sourcePath.value) return false;
	// Block moving a folder into itself or a descendant.
	if (ownSelfPath.value && currentPath.value.startsWith(ownSelfPath.value)) return false;
	return true;
});

async function loadFolders(path) {
	loading.value = true;
	errorMessage.value = '';
	try {
		const { data } = await api.listFiles(path);
		const list = Array.isArray(data) ? data : [];
		// Only same-account folders are valid destinations (same provider).
		folders.value = list.filter(
			(item) =>
				item.is_folder &&
				item.cloud_account_id === accountId.value &&
				// Never let the user descend into the folder being moved.
				!(
					ownSelfPath.value &&
					`${path === '/' ? '' : path.replace(/\/+$/, '')}/${item.file_name}/` === ownSelfPath.value
				),
		);
		currentPath.value = path;
	} catch (error) {
		errorMessage.value = error.message;
	} finally {
		loading.value = false;
	}
}

function openFolder(folder) {
	const base = currentPath.value === '/' ? '' : currentPath.value.replace(/\/+$/, '');
	loadFolders(`${base}/${folder.file_name}/`);
}

function goUp() {
	if (currentPath.value === '/') return;
	const trimmed = currentPath.value.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	loadFolders(lastSlash <= 0 ? '/' : `${trimmed.slice(0, lastSlash)}/`);
}

function confirmMove() {
	if (!canMoveHere.value) return;
	emit('confirm', currentPath.value);
}

// (Re)load the root listing whenever the dialog opens for a new file.
watch(
	() => props.isOpen,
	(open) => {
		if (open && props.file) {
			loadFolders('/');
		}
	},
	{ immediate: true },
);
</script>

<template>
	<div
		v-if="isOpen && file"
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4"
		role="dialog"
		aria-modal="true"
		@click="emit('close')"
	>
		<div
			class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-[28px] bg-white p-6 text-[#202124] shadow-[0_24px_60px_rgba(32,33,36,0.28)] dark:bg-slate-800 dark:text-slate-100"
			@click.stop
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-xl font-semibold">{{ t('drive.moveTitle') }}</h3>
					<p class="mt-1 text-sm text-[#5f6368] dark:text-slate-400">
						{{ t('drive.moveDescription', { name: file.file_name }) }}
					</p>
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

			<nav aria-label="Breadcrumb" class="mt-4 flex flex-wrap items-center gap-1 text-sm">
				<template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
					<button
						type="button"
						class="max-w-[160px] truncate rounded px-1.5 py-0.5 text-left text-[#1a73e8] hover:bg-[#e8f0fe] dark:hover:bg-sky-500/10"
						@click="loadFolders(crumb.path)"
					>
						{{ crumb.label }}
					</button>
					<IconChevronRight
						v-if="index < breadcrumbs.length - 1"
						:size="14"
						:stroke="2"
						class="text-[#5f6368] dark:text-slate-400"
					/>
				</template>
			</nav>

			<div
				class="mt-3 min-h-[200px] flex-1 overflow-y-auto rounded-2xl border border-[#e0e3e7] dark:border-slate-700"
			>
				<button
					v-if="currentPath !== '/'"
					type="button"
					class="flex w-full items-center gap-2 border-b border-[#e8eaed] px-4 py-2.5 text-left text-sm hover:bg-[#f1f3f4] dark:border-slate-700 dark:hover:bg-slate-700/40"
					@click="goUp"
				>
					<IconArrowBackUp :size="18" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
					<span>{{ t('drive.moveUp') }}</span>
				</button>

				<p v-if="errorMessage" class="px-4 py-3 text-sm text-[#c5221f] dark:text-red-300">{{ errorMessage }}</p>
				<p v-else-if="loading" class="px-4 py-6 text-center text-sm text-[#5f6368] dark:text-slate-400">
					{{ t('common.loading') }}
				</p>
				<p v-else-if="!folders.length" class="px-4 py-6 text-center text-sm text-[#5f6368] dark:text-slate-400">
					{{ t('drive.moveNoSubfolders') }}
				</p>
				<button
					v-for="folder in folders"
					:key="folder.id"
					type="button"
					class="flex w-full items-center justify-between gap-2 border-b border-[#e8eaed] px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-[#f1f3f4] dark:border-slate-700 dark:hover:bg-slate-700/40"
					@click="openFolder(folder)"
				>
					<span class="flex items-center gap-2 truncate">
						<IconFolder :size="18" :stroke="2" class="shrink-0 text-[#5f6368] dark:text-slate-400" />
						<span class="truncate">{{ folder.file_name }}</span>
					</span>
					<IconChevronRight :size="16" :stroke="2" class="shrink-0 text-[#5f6368] dark:text-slate-400" />
				</button>
			</div>

			<div class="mt-4 flex items-center justify-end gap-2">
				<button
					type="button"
					class="rounded-full px-4 py-2 text-sm font-medium text-[#5f6368] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/8"
					@click="emit('close')"
				>
					{{ t('common.cancel') }}
				</button>
				<button
					type="button"
					class="rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:opacity-50"
					:disabled="!canMoveHere"
					@click="confirmMove"
				>
					{{ t('common.moveHere') }}
				</button>
			</div>
		</div>
	</div>
</template>
