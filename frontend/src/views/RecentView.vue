<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
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
import { useRecencyGroups } from '../composables/useRecencyGroups.js';
import { useUploadQueueStore } from '../stores/uploadQueue';
import { api } from '../services/api';

const { t } = useI18n();
const uploadQueueStore = useUploadQueueStore();
const { uploads, totalProgress } = storeToRefs(uploadQueueStore);

const view = useFileListView({
	loadFiles: async () => {
		const { data } = await api.listRecentFiles();
		return Array.isArray(data) ? data : [];
	},
	uploadQueueStore,
	filterIncoming: (items) => items.filter((file) => !file.is_folder),
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
	canRenameSelection,
	canToggleStarSelection,
	isPrimarySelectedStarred,
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

function openItemOnDoubleClick(file) {
	if (view.canPreview(file)) openPreview(file);
}
</script>

<template>
	<DriveShell current-section="recent">
		<div
			class="relative min-h-[calc(100vh-84px)] rounded-[12px] bg-white px-4 py-4 pb-4 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
			@click="clearSelection"
		>
			<div class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 class="m-0 text-2xl font-normal text-[#202124] dark:text-slate-100">{{ t('nav.recent') }}</h1>
				</div>
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
				/>
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
								{{ t('recent.empty') }}
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
						{{ t('recent.empty') }}
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
				:can-open-folder="false"
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
