<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { IconChevronRight, IconFolder } from '@tabler/icons-vue';
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
import { useIncrementalRender } from '../composables/useIncrementalRender';
import { useFileListView } from '../composables/useFileListView';
import { useAutoRefresh } from '../composables/useAutoRefresh.js';
import { providerLabel } from '../composables/useFormatFile.js';
import { useRecencyGroups } from '../composables/useRecencyGroups.js';
import { useUploadQueueStore } from '../stores/uploadQueue';
import { api } from '../services/api';

const { t } = useI18n();
const uploadQueueStore = useUploadQueueStore();
const { uploads, totalProgress } = storeToRefs(uploadQueueStore);

const folderStack = ref([]);
const navigating = ref(false);

const view = useFileListView({
	loadFiles: async () => {
		const { data } = await api.listSharedWithMeFiles();
		return Array.isArray(data) ? data : [];
	},
	uploadQueueStore,
	// This view drives its own folder-stack navigation and its own periodic
	// refresh (useAutoRefresh(refreshShared) below), so the generic 30s timer in
	// useFileListView must stay off — otherwise it reloads the shared ROOT
	// listing and yanks the user out of any nested shared folder every 30s.
	autoRefresh: false,
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
	updatedOptions,
	ownerOptions,
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
	canToggleStarSelection,
	isPrimarySelectedStarred,
	canOpenSelection,
	canPreviewSelection,
	previewFile,
	isPreviewOpen,
	isPreviewLoading,
	openPreview,
	closePreview,
	handlePreviewLoaded,
	handlePreviewFailed,
	detailsFile,
	isDetailsOpen,
	isDetailsLoading,
	closeDetails,
	downloadSelection,
	renameSelectedFile,
	deleteSelectedFile,
	toggleSelectedFileStar,
	showSelectedFileDetails,
	contextMenu,
	contextMenuRef,
	closeContextMenu,
	actionInProgress,
	actionLabel,
} = view;

const breadcrumbItems = computed(() => [
	{ label: t('nav.shared'), index: -1 },
	...folderStack.value.map((item, index) => ({ label: item.file_name, index })),
]);

const { groups: groupedFiles } = useRecencyGroups(sortedFiles, t);

const { visibleItems: renderedSortedFiles, handleScroll: handleListScroll } = useIncrementalRender(sortedFiles, {
	initialCount: 80,
	step: 80,
	threshold: 240,
});

const renderedGroupedFiles = computed(() => {
	const visibleIds = new Set(renderedSortedFiles.value.map((file) => file.id));
	return groupedFiles.value
		.map((group) => ({
			...group,
			items: group.items.filter((file) => visibleIds.has(file.id)),
		}))
		.filter((group) => group.items.length);
});

async function loadCurrentFolder(folder) {
	navigating.value = true;
	loading.value = true;
	errorMessage.value = '';
	view.files.value = [];
	try {
		const { data } = folder ? await api.listSharedFolderChildren(folder.id) : await api.listSharedWithMeFiles();
		view.files.value = Array.isArray(data) ? data : [];
	} catch (error) {
		errorMessage.value = errorMessage.value || error.message;
	} finally {
		loading.value = false;
		navigating.value = false;
	}
}

async function refreshShared() {
	const currentFolder = folderStack.value.at(-1);
	await loadCurrentFolder(currentFolder);
}

async function openFolder(file) {
	if (!file?.is_folder) return;
	closeContextMenu();
	clearSelection();
	folderStack.value = [...folderStack.value, file];
	navigating.value = true;
	await loadCurrentFolder(file);
}

async function navigateToBreadcrumb(index) {
	closeContextMenu();
	clearSelection();
	if (index < 0) {
		folderStack.value = [];
		navigating.value = true;
		await loadCurrentFolder(null);
		return;
	}
	folderStack.value = folderStack.value.slice(0, index + 1);
	navigating.value = true;
	await loadCurrentFolder(folderStack.value.at(-1));
}

function openSelectedItem() {
	const file = primarySelectedFile.value || contextMenu.value.file;
	if (file?.is_folder) openFolder(file);
}

function openItemOnDoubleClick(file) {
	if (file.is_folder) {
		openFolder(file);
		return;
	}
	if (view.canPreview(file)) openPreview(file);
}

useAutoRefresh(refreshShared, { intervalMs: 30000 });
</script>

<template>
	<DriveShell current-section="shared">
		<div
			class="relative min-h-[calc(100vh-84px)] rounded-[12px] bg-white px-4 py-4 pb-4 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
			@click="clearSelection"
		>
			<div class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<h1 class="m-0">
					<nav
						aria-label="Breadcrumb"
						class="flex flex-wrap items-center gap-1 text-2xl font-normal text-[#202124] dark:text-slate-100"
					>
						<template
							v-for="(crumb, breadcrumbIndex) in breadcrumbItems"
							:key="`${crumb.index}:${crumb.label}`"
						>
							<button
								type="button"
								class="max-w-[220px] truncate leading-tight transition hover:text-[#1a73e8] dark:hover:text-sky-300"
								@click="navigateToBreadcrumb(crumb.index)"
							>
								{{ crumb.label }}
							</button>
							<IconChevronRight
								v-if="breadcrumbIndex < breadcrumbItems.length - 1"
								:size="18"
								:stroke="2"
								class="text-[#5f6368] mx-1 dark:text-slate-400"
							/>
						</template>
					</nav>
				</h1>
				<FileListViewModeToggle v-model="isGridView" />
			</div>

			<div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<FileListSelectionBar
					v-if="selectedCount"
					:selected-count="selectedCount"
					:can-preview="canPreviewSelection"
					:can-toggle-star="canToggleStarSelection"
					:is-primary-starred="isPrimarySelectedStarred"
					:can-download="canDownloadSelection"
					:can-rename="false"
					:can-delete="false"
					:primary-file="primarySelectedFile"
					@clear="clearSelection"
					@preview="openPreview"
					@toggle-star="toggleSelectedFileStar"
					@download="downloadSelection"
					@rename="renameSelectedFile"
					@show-details="showSelectedFileDetails"
					@delete="deleteSelectedFile"
				>
					<template #prefix="{ primary }">
						<button
							v-if="primary?.is_folder && selectedCount === 1"
							type="button"
							class="inline-flex size-9 items-center justify-center rounded-full transition enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
							:title="t('common.open')"
							@click="openSelectedItem"
						>
							<IconFolder :size="18" :stroke="2" />
						</button>
					</template>
				</FileListSelectionBar>
				<FileListFilterBar
					v-else
					v-model:search-term="searchTerm"
					:type-options="typeOptions"
					:owner-options="ownerOptions"
					:updated-options="updatedOptions"
					:selected-type-filter="selectedTypeFilter"
					:selected-owner-filter="selectedOwnerFilter"
					:selected-updated-filter="selectedUpdatedFilter"
					:active-filter-menu="activeFilterMenu"
					@toggle-filter-menu="toggleFilterMenu"
					@apply-filter="applyFilter"
					@clear-filter="clearFilter"
				/>
			</div>

			<p
				v-if="errorMessage"
				class="mb-4 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300"
			>
				{{ errorMessage }}
			</p>

			<div v-if="!isGridView" class="relative">
				<div
					class="custom-scrollbar overflow-x-auto rounded-2xl border border-[#e0e3e7] bg-white dark:border-slate-700 dark:bg-slate-800"
				>
					<div class="min-w-[760px]">
						<div
							class="custom-scrollbar max-h-[min(70vh,780px)] overflow-y-auto overflow-x-hidden"
							@scroll="handleListScroll"
						>
							<FileListHeader :sortable="false" />

							<template v-for="group in renderedGroupedFiles" :key="group.key">
								<div
									class="sticky top-9 z-[1] bg-[#f8fafd] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6368] dark:bg-slate-900 dark:text-slate-400"
								>
									{{ group.label }}
								</div>
								<FileListRow
									v-for="item in group.items"
									:key="item.id"
									:item="item"
									:selected="isSelected(item)"
									@select="(event) => selectItem(event, item)"
									@open="openItemOnDoubleClick(item)"
									@contextmenu="(event) => openContextMenu(event, item)"
								/>
							</template>
							<div
								v-if="!groupedFiles.length && !loading"
								class="p-[18px] text-[#5f6368] dark:text-slate-400"
							>
								{{ t('shared.empty') }}
							</div>
							<div v-if="loading" class="p-[18px]"><LoadingState /></div>
						</div>
					</div>
				</div>
				<LoadingState
					v-if="actionInProgress"
					variant="overlay"
					:message="actionLabel || t('drive.processing')"
				/>
			</div>

			<div v-else class="relative">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<template v-for="group in renderedGroupedFiles" :key="group.key">
						<div
							class="col-span-full rounded-2xl bg-[#f8fafd] px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6368] dark:bg-slate-900 dark:text-slate-400"
						>
							{{ group.label }}
						</div>
						<FileListGridCard
							v-for="item in group.items"
							:key="item.id"
							:item="item"
							:selected="isSelected(item)"
							@select="(event) => selectItem(event, item)"
							@open="openItemOnDoubleClick(item)"
							@contextmenu="(event) => openContextMenu(event, item)"
						/>
					</template>
					<div
						v-if="!groupedFiles.length && !loading"
						class="col-span-full rounded-2xl border border-dashed border-[#dadce0] bg-white px-5 py-8 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
					>
						{{ t('shared.empty') }}
					</div>
					<div
						v-if="loading"
						class="col-span-full rounded-2xl border border-dashed border-[#dadce0] bg-white px-5 py-8 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
					>
						<LoadingState />
					</div>
				</div>
				<LoadingState
					v-if="actionInProgress"
					variant="overlay"
					:message="actionLabel || t('drive.processing')"
				/>
			</div>

			<FileListContextMenu
				:context-menu-ref="contextMenuRef"
				:context-menu="contextMenu"
				:selected-count="selectedCount"
				:primary-selected-file="primarySelectedFile"
				:can-preview="canPreviewSelection"
				:can-toggle-star="canToggleStarSelection"
				:is-primary-starred="isPrimarySelectedStarred"
				:can-download="canDownloadSelection"
				:can-rename="false"
				:can-delete="false"
				:can-show-details="selectedCount === 1"
				:can-open-folder="canOpenSelection"
				@open-folder="openSelectedItem"
				@preview="openPreview"
				@toggle-star="toggleSelectedFileStar"
				@download="downloadSelection"
				@rename="renameSelectedFile"
				@show-details="showSelectedFileDetails"
				@delete="deleteSelectedFile"
				@close="closeContextMenu"
			/>

			<FileDetailsModal
				:file="detailsFile"
				:is-open="isDetailsOpen"
				:is-loading="isDetailsLoading"
				:provider-label-fn="providerLabel"
				@close="closeDetails"
			/>
			<FilePreviewModal
				:file="previewFile"
				:is-open="isPreviewOpen"
				:is-loading="isPreviewLoading"
				@close="closePreview"
				@loaded="handlePreviewLoaded"
				@failed="handlePreviewFailed"
			/>
		</div>

		<FloatingProgressToast
			:uploads="uploads"
			:total-progress="totalProgress"
			@close="uploadQueueStore.clearOperations"
			@close-item="uploadQueueStore.closeOperation"
			@retry="uploadQueueStore.retryOperation"
		/>
	</DriveShell>
</template>
