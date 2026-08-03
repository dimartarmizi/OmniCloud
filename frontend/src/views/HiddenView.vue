<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { IconChevronRight, IconCopy, IconLock, IconLockOff, IconShieldCheck } from '@tabler/icons-vue';
import DriveShell from '../components/DriveShell.vue';
import FloatingProgressToast from '../components/FloatingProgressToast.vue';
import FileListFilterBar from '../components/FileListFilterBar.vue';
import FileListSelectionBar from '../components/FileListSelectionBar.vue';
import FileListViewModeToggle from '../components/FileListViewModeToggle.vue';
import FileListHeader from '../components/FileListHeader.vue';
import FileListRow from '../components/FileListRow.vue';
import FileListGridCard from '../components/FileListGridCard.vue';
import FileListContextMenu from '../components/FileListContextMenu.vue';
import FilePreviewModal from '../components/FilePreviewModal.vue';
import FileDetailsModal from '../components/FileDetailsModal.vue';
import LoadingState from '../components/LoadingState.vue';
import { useFileListView } from '../composables/useFileListView';
import { useTrackedFileActions } from '../composables/useTrackedFileActions.js';
import { providerLabel } from '../composables/useFormatFile.js';
import { useUploadQueueStore } from '../stores/uploadQueue';
import { useVaultStore } from '../stores/vaultStore';
import { api } from '../services/api';

const { t } = useI18n();
const vaultStore = useVaultStore();
const uploadQueueStore = useUploadQueueStore();
const { uploads, totalProgress } = storeToRefs(uploadQueueStore);
const { status, words, isLoading, error } = storeToRefs(vaultStore);

// ---- setup wizard ----
const setupStep = ref(1); // 1 = PIN, 2 = show words, 3 = confirm words
const pin1 = ref('');
const pin2 = ref('');
const pinError = ref('');
const confirmIndices = ref([]);
const confirmInput = ref('');
const confirmError = ref('');
const copied = ref(false);

// ---- unlock / reset ----
const unlockPin = ref('');
const unlockError = ref('');
const showReset = ref(false);
const resetWords = ref('');
const resetPin1 = ref('');
const resetPin2 = ref('');
const resetError = ref('');

// ---- upload ----
const fileInputRef = ref(null);
const folderInputRef = ref(null);
const isDragActive = ref(false);
const dragDepth = ref(0);

const view = useFileListView({
	loadFiles: async () => {
		if (vaultStore.status !== 'unlocked') return [];
		return vaultStore.loadHiddenFiles();
	},
	uploadQueueStore,
	autoRefresh: false,
	actions: useTrackedFileActions({ uploadQueueStore, api }),
});

const {
	loading,
	errorMessage,
	searchTerm,
	isGridView,
	activeFilterMenu,
	selectedTypeFilter,
	selectedOwnerFilter,
	selectedUpdatedFilter,
	typeOptions,
	ownerOptions,
	updatedOptions,
	toggleFilterMenu,
	applyFilter,
	clearFilter,
	sortedFiles,
	selectedCount,
	primarySelectedFile,
	isSelected,
	openContextMenu,
	clearSelection,
	selectItem,
	canDownloadSelection,
	canRenameSelection,
	canToggleStarSelection,
	isPrimarySelectedStarred,
	canOpenSelection,
	canPreviewSelection,
	canPreview,
	toggleSelectedFileStar,
	sortBy,
	sortDirection,
	setSort,
	previewFile,
	isPreviewOpen,
	isPreviewLoading,
	openPreview,
	closePreview,
	handlePreviewLoaded,
	handlePreviewFailed,
	detailsFile,
	isDetailsOpen,
	closeDetails,
	downloadSelection,
	renameSelectedFile,
	deleteSelectedFile,
	showSelectedFileDetails,
	contextMenu,
	contextMenuRef,
	closeContextMenu,
	actionInProgress,
	actionLabel,
} = view;

// A hidden route returned 403 VAULT_LOCKED (server TTL expired) — re-lock the UI.
watch(
	() => errorMessage.value,
	(message) => {
		if (message === 'VAULT_LOCKED') vaultStore.markLocked();
	},
);

watch(words, (value) => {
	if (Array.isArray(value) && value.length) {
		confirmIndices.value = pickRandomIndices(value.length, 3);
		setupStep.value = 2;
	}
});

function pickRandomIndices(length, count) {
	const indices = new Set();
	while (indices.size < count && indices.size < length) {
		indices.add(Math.floor(Math.random() * length));
	}
	return [...indices].sort((a, b) => a - b);
}

async function submitPinSetup() {
	pinError.value = '';
	if (!/^\d{6}$/.test(pin1.value)) {
		pinError.value = t('vault.pinFormat');
		return;
	}
	if (pin1.value !== pin2.value) {
		pinError.value = t('vault.pinMismatch');
		return;
	}
	try {
		await vaultStore.setup(pin1.value); // sets words + unlocks
		pin1.value = '';
		pin2.value = '';
	} catch (e) {
		pinError.value = e.message;
	}
}

async function copyWords() {
	try {
		await navigator.clipboard.writeText(words.value.join(' '));
		copied.value = true;
		setTimeout(() => (copied.value = false), 2000);
	} catch {
		// clipboard unavailable — the words remain on screen
	}
}

function submitWordsSaved() {
	setupStep.value = 3;
	confirmInput.value = '';
	confirmError.value = '';
}

function submitWordsConfirm() {
	confirmError.value = '';
	const entered = confirmInput.value.trim().split(/\s+/).filter(Boolean);
	const expected = confirmIndices.value.map((index) => words.value[index].toLowerCase());
	if (entered.length !== expected.length || entered.some((w, i) => w.toLowerCase() !== expected[i])) {
		confirmError.value = t('vault.confirmError');
		return;
	}
	vaultStore.confirmWords(); // words cleared -> vault list renders
	view.refresh();
}

async function submitUnlock() {
	unlockError.value = '';
	if (!/^\d{6}$/.test(unlockPin.value)) {
		unlockError.value = t('vault.pinFormat');
		return;
	}
	try {
		await vaultStore.unlock(unlockPin.value);
		unlockPin.value = '';
		unlockError.value = '';
		await view.refresh();
	} catch (e) {
		unlockError.value = e.message;
	}
}

async function submitReset() {
	resetError.value = '';
	if (!/^\d{6}$/.test(resetPin1.value) || resetPin1.value !== resetPin2.value) {
		resetError.value = t('vault.pinFormat');
		return;
	}
	const wordArray = resetWords.value.trim().split(/\s+/).filter(Boolean);
	if (wordArray.length !== 12) {
		resetError.value = t('vault.wordsCount');
		return;
	}
	try {
		await vaultStore.resetPin(wordArray, resetPin1.value);
		showReset.value = false;
		resetWords.value = '';
		resetPin1.value = '';
		resetPin2.value = '';
		await view.refresh();
	} catch (e) {
		resetError.value = e.message;
	}
}

async function lockVault() {
	await vaultStore.lock();
	view.files.value = [];
}

function openItemOnDoubleClick(file) {
	if (file?.is_folder) return;
	if (canPreview(file)) openPreview(file);
}

// ---- uploads ----
function resetInput(inputRef) {
	if (inputRef.value) inputRef.value.value = '';
}

function openFilePicker() {
	resetInput(fileInputRef);
	fileInputRef.value?.click();
}

function openFolderPicker() {
	resetInput(folderInputRef);
	folderInputRef.value?.click();
}

async function onFileInputChange(event) {
	const files = Array.from(event.target.files || []);
	await handleUploads(files);
}

async function onFolderInputChange(event) {
	const entries = Array.from(event.target.files || []).map((file) => ({
		file,
		relativePath: file.webkitRelativePath || file.name,
	}));
	await handleUploads(entries);
}

async function handleUploads(entries) {
	if (!entries.length || vaultStore.status !== 'unlocked') return;
	try {
		// Hidden files never appear in normal listings — refresh the vault list after upload.
		await uploadQueueStore.uploadFiles(entries, '/', () => view.refresh(), { isHidden: true });
		await view.refresh();
	} catch {
		// errors surface in the progress toast
	}
}

async function readDirectoryEntry(entry, prefix = '') {
	const reader = entry.createReader();
	const children = await new Promise((resolve, reject) => {
		reader.readEntries(resolve, reject);
	});
	const nested = await Promise.all(
		children.map((child) => readDroppedEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name)),
	);
	return nested.flat();
}

async function readFileEntry(entry, prefix = '') {
	return new Promise((resolve, reject) => {
		entry.file((file) => resolve([{ file, relativePath: prefix ? `${prefix}/${file.name}` : file.name }]), reject);
	});
}

async function readDroppedEntry(entry, prefix = '') {
	if (entry.isDirectory) return readDirectoryEntry(entry, prefix);
	return readFileEntry(entry, prefix);
}

async function collectDroppedEntries(dataTransfer) {
	const items = Array.from(dataTransfer.items || []);
	const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
	if (!entries.length) return Array.from(dataTransfer.files || []);
	const collected = await Promise.all(entries.map((entry) => readDroppedEntry(entry)));
	return collected.flat();
}

function handleDragEnter() {
	dragDepth.value += 1;
	isDragActive.value = true;
}

function handleDragLeave(event) {
	if (!event.currentTarget.contains(event.relatedTarget)) {
		dragDepth.value = 0;
		isDragActive.value = false;
		return;
	}
	dragDepth.value = Math.max(0, dragDepth.value - 1);
	if (dragDepth.value === 0) isDragActive.value = false;
}

async function handleDrop(event) {
	dragDepth.value = 0;
	isDragActive.value = false;
	const entries = await collectDroppedEntries(event.dataTransfer);
	await handleUploads(entries);
}

const wizardTitle = computed(() => {
	if (setupStep.value === 1) return t('vault.pinSetupTitle');
	if (setupStep.value === 2) return t('vault.wordsTitle');
	return t('vault.confirmTitle');
});

onMounted(async () => {
	await vaultStore.loadStatus();
	if (Array.isArray(words.value) && words.value.length) {
		setupStep.value = 2; // mid-setup reload: jump back to showing the words
	}
	if (vaultStore.status === 'unlocked' && !words.value) {
		await view.refresh();
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('dragend', handleDragLeave);
	window.removeEventListener('drop', handleDrop);
});
</script>

<template>
	<DriveShell current-section="hidden" @upload-files="openFilePicker" @upload-folder="openFolderPicker">
		<div
			v-if="status === 'loading'"
			class="grid min-h-[calc(100vh-84px)] place-items-center rounded-[24px] bg-white dark:bg-slate-800"
		>
			<LoadingState />
		</div>

		<!-- ===================== SETUP WIZARD ===================== -->
		<div
			v-else-if="status === 'none' || (status === 'unlocked' && words)"
			class="mx-auto flex min-h-[calc(100vh-84px)] max-w-xl flex-col justify-center rounded-[24px] bg-white px-6 py-10 dark:bg-slate-800"
		>
			<div class="mb-6 flex flex-col items-center text-center">
				<div class="mb-3 grid size-14 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-sky-500/15 dark:text-sky-300">
					<IconShieldCheck :size="28" :stroke="1.8" />
				</div>
				<h1 class="text-2xl font-semibold text-[#202124] dark:text-slate-100">{{ wizardTitle }}</h1>
			</div>

			<!-- Step 1: PIN -->
			<div v-if="setupStep === 1" class="space-y-4">
				<p class="text-center text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.pinSetupDesc') }}</p>
				<div class="space-y-3">
					<input
						v-model="pin1"
						type="password"
						inputmode="numeric"
						maxlength="6"
						class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
						:placeholder="t('vault.pinLabel')"
					/>
					<input
						v-model="pin2"
						type="password"
						inputmode="numeric"
						maxlength="6"
						class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
						:placeholder="t('vault.confirmPinLabel')"
					/>
				</div>
				<p v-if="pinError" class="text-center text-sm text-[#c5221f] dark:text-red-300">{{ pinError }}</p>
				<button
					type="button"
					class="w-full rounded-2xl bg-[#1a73e8] px-4 py-3 font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-50"
					:disabled="isLoading"
					@click="submitPinSetup"
				>
					{{ t('vault.setPin') }}
				</button>
			</div>

			<!-- Step 2: show the 12 words once -->
			<div v-else-if="setupStep === 2" class="space-y-4">
				<p class="text-center text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.wordsDesc') }}</p>
				<div class="grid grid-cols-2 gap-2 rounded-2xl border border-[#e0e3e7] bg-[#f8fafd] p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900">
					<div v-for="(word, index) in words" :key="index" class="flex items-center gap-1.5 text-sm text-[#202124] dark:text-slate-100">
						<span class="text-xs text-[#9aa0a6] dark:text-slate-500">{{ index + 1 }}.</span>
						<span class="font-medium">{{ word }}</span>
					</div>
				</div>
				<button type="button" class="flex items-center gap-1.5 text-sm font-medium text-[#1a73e8] hover:underline" @click="copyWords">
					<IconCopy :size="16" :stroke="2" />
					{{ copied ? t('vault.wordsCopied') : t('vault.wordsCopy') }}
				</button>
				<p class="rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300">
					{{ t('vault.wordsWarning') }}
				</p>
				<button
					type="button"
					class="w-full rounded-2xl bg-[#1a73e8] px-4 py-3 font-medium text-white transition hover:bg-[#1765cc]"
					@click="submitWordsSaved"
				>
					{{ t('vault.wordsSavedBtn') }}
				</button>
			</div>

			<!-- Step 3: confirm random words -->
			<div v-else-if="setupStep === 3" class="space-y-4">
				<p class="text-center text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.confirmDesc') }}</p>
				<div class="space-y-3">
					<div v-for="index in confirmIndices" :key="index" class="flex items-center gap-2 text-sm text-[#5f6368] dark:text-slate-400">
						<span class="shrink-0 rounded-lg bg-[#e8f0fe] px-2 py-1 font-medium text-[#1a73e8] dark:bg-sky-500/15 dark:text-sky-300">{{ t('vault.confirmPosition', { n: index + 1 }) }}</span>
						<span class="truncate font-medium text-[#202124] dark:text-slate-100">{{ words[index] }}</span>
					</div>
					<input
						v-model="confirmInput"
						type="text"
						class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
						:placeholder="t('vault.confirmInputPlaceholder')"
					/>
				</div>
				<p v-if="confirmError" class="text-center text-sm text-[#c5221f] dark:text-red-300">{{ confirmError }}</p>
				<button
					type="button"
					class="w-full rounded-2xl bg-[#1a73e8] px-4 py-3 font-medium text-white transition hover:bg-[#1765cc]"
					@click="submitWordsConfirm"
				>
					{{ t('vault.confirmBtn') }}
				</button>
			</div>

			<FloatingProgressToast :uploads="uploads" :total-progress="totalProgress" @close="uploadQueueStore.clearOperations" @close-item="uploadQueueStore.closeOperation" />
		</div>

		<!-- ===================== UNLOCK ===================== -->
		<div v-else-if="status === 'locked'" class="mx-auto flex min-h-[calc(100vh-84px)] max-w-md flex-col justify-center rounded-[24px] bg-white px-6 py-10 dark:bg-slate-800">
			<div class="mb-6 flex flex-col items-center text-center">
				<div class="mb-3 grid size-14 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-sky-500/15 dark:text-sky-300">
					<IconLock :size="26" :stroke="1.8" />
				</div>
				<h1 class="text-2xl font-semibold text-[#202124] dark:text-slate-100">{{ t('vault.unlockTitle') }}</h1>
				<p class="mt-1 text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.unlockDesc') }}</p>
			</div>

			<div v-if="!showReset" class="space-y-4">
				<input
					v-model="unlockPin"
					type="password"
					inputmode="numeric"
					maxlength="6"
					class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
					:placeholder="t('vault.unlockPlaceholder')"
					@keyup.enter="submitUnlock"
				/>
				<p v-if="unlockError" class="text-center text-sm text-[#c5221f] dark:text-red-300">{{ unlockError }}</p>
				<button
					type="button"
					class="w-full rounded-2xl bg-[#1a73e8] px-4 py-3 font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-50"
					:disabled="isLoading"
					@click="submitUnlock"
				>
					{{ t('vault.unlockBtn') }}
				</button>
				<button type="button" class="w-full text-center text-sm font-medium text-[#1a73e8] hover:underline" @click="showReset = true">
					{{ t('vault.forgotPin') }}
				</button>
			</div>

			<div v-else class="space-y-4">
				<h2 class="text-lg font-semibold text-[#202124] dark:text-slate-100">{{ t('vault.resetTitle') }}</h2>
				<p class="text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.resetDesc') }}</p>
				<textarea
					v-model="resetWords"
					rows="3"
					class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-sm outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
					:placeholder="t('vault.wordsPlaceholder')"
				></textarea>
				<input
					v-model="resetPin1"
					type="password"
					inputmode="numeric"
					maxlength="6"
					class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
					:placeholder="t('vault.newPinLabel')"
				/>
				<input
					v-model="resetPin2"
					type="password"
					inputmode="numeric"
					maxlength="6"
					class="w-full rounded-2xl border border-[#dadce0] bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
					:placeholder="t('vault.confirmNewPinLabel')"
				/>
				<p v-if="resetError" class="text-center text-sm text-[#c5221f] dark:text-red-300">{{ resetError }}</p>
				<button
					type="button"
					class="w-full rounded-2xl bg-[#1a73e8] px-4 py-3 font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-50"
					:disabled="isLoading"
					@click="submitReset"
				>
					{{ t('vault.resetBtn') }}
				</button>
				<button type="button" class="w-full text-center text-sm font-medium text-[#5f6368] hover:underline" @click="showReset = false">
					{{ t('vault.resetBack') }}
				</button>
			</div>
		</div>

		<!-- ===================== VAULT LIST ===================== -->
		<div
			v-else
			class="relative min-h-[calc(100vh-84px)] rounded-[24px] bg-white px-4 py-[18px] pb-5 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
			@click="clearSelection"
			@dragenter.prevent="handleDragEnter"
			@dragover.prevent="handleDragEnter"
			@dragleave.prevent="handleDragLeave"
			@drop.prevent="handleDrop"
		>
			<input ref="fileInputRef" class="hidden" type="file" multiple @change="onFileInputChange" />
			<input ref="folderInputRef" class="hidden" type="file" multiple webkitdirectory directory @change="onFolderInputChange" />

			<div v-if="isDragActive" class="pointer-events-none absolute inset-4 z-20 grid place-items-center rounded-[24px] border-2 border-dashed border-[#1a73e8] bg-[#e8f0fe]/90 text-center dark:bg-slate-900/90">
				<div>
					<p class="text-lg font-semibold text-[#1a73e8]">{{ t('vault.dragDropTitle') }}</p>
					<p class="mt-2 text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.uploadHint') }}</p>
				</div>
			</div>

			<div class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<h1 class="m-0 flex items-center gap-2 text-2xl font-normal text-[#202124] dark:text-slate-100">
					<IconLock :size="20" :stroke="1.8" class="text-[#5f6368] dark:text-slate-400" />
					{{ t('nav.hidden') }}
				</h1>
				<div class="flex items-center gap-3">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-[#5f6368] transition hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/10"
						@click.stop="lockVault"
					>
						<IconLockOff :size="16" :stroke="2" />
						{{ t('vault.lock') }}
					</button>
					<FileListViewModeToggle v-model="isGridView" />
				</div>
			</div>

			<p class="mb-3 text-sm text-[#5f6368] dark:text-slate-400">{{ t('vault.uploadHint') }}</p>

			<div class="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<FileListSelectionBar v-if="selectedCount" :selected-count="selectedCount" :can-preview="canPreviewSelection" :can-toggle-star="canToggleStarSelection" :is-primary-starred="isPrimarySelectedStarred" :can-download="canDownloadSelection" :can-rename="canRenameSelection" :can-delete="true" :primary-file="primarySelectedFile" @clear="clearSelection" @preview="openPreview" @toggle-star="toggleSelectedFileStar" @download="downloadSelection" @rename="renameSelectedFile" @show-details="showSelectedFileDetails" @delete="deleteSelectedFile" />
				<FileListFilterBar v-else :type-options="typeOptions" :owner-options="ownerOptions" :updated-options="updatedOptions" :selected-type-filter="selectedTypeFilter" :selected-owner-filter="selectedOwnerFilter" :selected-updated-filter="selectedUpdatedFilter" :active-filter-menu="activeFilterMenu" v-model:search-term="searchTerm" @toggle-filter-menu="toggleFilterMenu" @apply-filter="applyFilter" @clear-filter="clearFilter" />
			</div>

			<p v-if="errorMessage" class="mb-4 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300">{{ errorMessage }}</p>

			<div v-if="!isGridView" class="relative">
				<div class="custom-scrollbar overflow-x-auto rounded-2xl border border-[#e0e3e7] bg-white dark:border-slate-700 dark:bg-slate-800">
					<div class="min-w-[760px]">
						<div class="custom-scrollbar max-h-[min(70vh,780px)] overflow-y-auto overflow-x-hidden">
							<FileListHeader :sortable="true" :sort-by="sortBy" :sort-direction="sortDirection" @sort="setSort" />
							<FileListRow v-for="item in sortedFiles" :key="item.id" :item="item" :selected="isSelected(item)" name-field="display_name" @select="(event) => selectItem(event, item)" @open="openItemOnDoubleClick(item)" @contextmenu="(event) => openContextMenu(event, item)" />
							<div v-if="!sortedFiles.length && !loading" class="p-[18px] text-[#5f6368] dark:text-slate-400">{{ t('vault.empty') }}</div>
							<div v-if="loading" class="p-[18px]"><LoadingState /></div>
						</div>
					</div>
				</div>
				<LoadingState v-if="actionInProgress" variant="overlay" :message="actionLabel || t('drive.processing')" />
			</div>

			<div v-else class="relative">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<FileListGridCard v-for="item in sortedFiles" :key="item.id" :item="item" :selected="isSelected(item)" name-field="display_name" @select="(event) => selectItem(event, item)" @open="openItemOnDoubleClick(item)" @contextmenu="(event) => openContextMenu(event, item)" />
					<div v-if="!sortedFiles.length && !loading" class="col-span-full rounded-2xl border border-dashed border-[#dadce0] bg-white px-5 py-8 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">{{ t('vault.empty') }}</div>
					<div v-if="loading" class="col-span-full rounded-2xl border border-dashed border-[#dadce0] bg-white px-5 py-8 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"><LoadingState /></div>
				</div>
				<LoadingState v-if="actionInProgress" variant="overlay" :message="actionLabel || t('drive.processing')" />
			</div>

			<FileListContextMenu :context-menu-ref="contextMenuRef" :context-menu="contextMenu" :selected-count="selectedCount" :primary-selected-file="primarySelectedFile" :can-preview="canPreviewSelection" :can-toggle-star="false" :is-primary-starred="false" :can-download="canDownloadSelection" :can-rename="canRenameSelection" :can-delete="true" :can-show-details="selectedCount === 1" :can-open-folder="canOpenSelection" @open-folder="openPreview" @preview="openPreview" @toggle-star="toggleSelectedFileStar" @download="downloadSelection" @rename="renameSelectedFile" @show-details="showSelectedFileDetails" @delete="deleteSelectedFile" @close="closeContextMenu" />

			<FileDetailsModal :file="detailsFile" :is-open="isDetailsOpen" :provider-label-fn="providerLabel" @close="closeDetails" />
			<FilePreviewModal :file="previewFile" :is-open="isPreviewOpen" :is-loading="isPreviewLoading" @close="closePreview" @loaded="handlePreviewLoaded" @failed="handlePreviewFailed" />

			<FloatingProgressToast :uploads="uploads" :total-progress="totalProgress" @close="uploadQueueStore.clearOperations" @close-item="uploadQueueStore.closeOperation" />
		</div>
	</DriveShell>
</template>
