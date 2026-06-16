<script setup>
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { IconFolder } from '@tabler/icons-vue';
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
import { providerLabel } from '../composables/useFormatFile.js';
import { useFileTreeStore } from '../stores/fileTree';
import { useUploadQueueStore } from '../stores/uploadQueue';
import { api } from '../services/api';

const { t } = useI18n();
const router = useRouter();
const fileTreeStore = useFileTreeStore();
const uploadQueueStore = useUploadQueueStore();
const { uploads, totalProgress } = storeToRefs(uploadQueueStore);

const view = useFileListView({
	loadFiles: async () => {
		const { data } = await api.listStarredFiles();
		return Array.isArray(data) ? data : [];
	},
	uploadQueueStore,
	sortable: true,
	initialSortBy: 'updated_at',
	initialSortDirection: 'desc',
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
	sortBy,
	sortDirection,
	setSort,
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

const { visibleItems: renderedFiles, handleScroll: handleListScroll } = useIncrementalRender(sortedFiles, {
	initialCount: 80,
	step: 80,
	threshold: 240,
});

function openFolder(file) {
	if (!file?.is_folder) return;
	clearSelection();
	const parent = file.virtual_path || '/';
	const inside = `${parent === '/' ? '' : parent}${file.file_name}/`;
	const targetPath = inside.startsWith('/') ? inside : `/${inside}`;
	fileTreeStore.pendingPath = targetPath;
	router.push({ path: '/my-drive' });
}

function openSelectedItem() {
	const file = primarySelectedFile.value || contextMenu.value.file;
	closeContextMenu();
	if (file?.is_folder) openFolder(file);
}

function openItemOnDoubleClick(file) {
	if (file.is_folder) {
		openFolder(file);
		return;
	}
	if (view.canPreview(file)) openPreview(file);
}
</script>

<template>
	<DriveShell current-section="starred">
		<div
			class="relative min-h-[calc(100vh-84px)] rounded-[12px] bg-white px-4 py-4 pb-4 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
			@click="clearSelection"
		>
			<div class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<h1 class="m-0 text-2xl font-normal text-[#202124] dark:text-slate-100">{{ t('nav.starred') }}</h1>
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
					:can-rename="canRenameSelection"
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
							class="custom-scrollbar max-h-[min(52vh,520px)] overflow-y-auto overflow-x-hidden"
							@scroll="handleListScroll"
						>
							<FileListHeader
								:sortable="true"
								:sort-by="sortBy"
								:sort-direction="sortDirection"
								@sort="setSort"
							/>

							<FileListRow
								v-for="item in renderedFiles"
								:key="item.id"
								:item="item"
								:selected="isSelected(item)"
								@select="(event) => selectItem(event, item)"
								@open="openItemOnDoubleClick(item)"
								@contextmenu="(event) => openContextMenu(event, item)"
							/>
							<div
								v-if="!sortedFiles.length && !loading"
								class="p-[18px] text-[#5f6368] dark:text-slate-400"
							>
								{{ t('drive.noFiles') }}
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
					<FileListGridCard
						v-for="item in renderedFiles"
						:key="item.id"
						:item="item"
						:selected="isSelected(item)"
						@select="(event) => selectItem(event, item)"
						@open="openItemOnDoubleClick(item)"
						@contextmenu="(event) => openContextMenu(event, item)"
					/>
					<div
						v-if="!sortedFiles.length && !loading"
						class="col-span-full rounded-2xl border border-dashed border-[#dadce0] bg-white px-5 py-8 text-center text-[#5f6368] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
					>
						{{ t('drive.noFiles') }}
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
				:can-rename="canRenameSelection"
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
				:is-folder="detailsFile?.is_folder"
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
