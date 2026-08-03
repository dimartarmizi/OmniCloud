import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { providerLabel } from './useFormatFile.js';
import { useFileFiltersUi } from './useFileFiltersUi.js';
import { useFileActions } from './useFileActions.js';
import { useFileActionProgress } from './useFileActionProgress.js';
import { getFileCategory } from './useFileType.js';
import { matchesUpdatedFilter } from './useFileFilters.js';

export function useFileListView({
	loadFiles,
	sourceFiles,
	uploadQueueStore,
	actions = {},
	getPreviewType,
	previewUnsupportedMessage,
	autoRefresh = true,
	refreshIntervalMs = 30000,
	filterIncoming,
	sortable = false,
	initialSortBy = 'modified_at',
	initialSortDirection = 'desc',
}) {
	if (typeof loadFiles !== 'function' && !sourceFiles) {
		throw new Error('useFileListView: either loadFiles or sourceFiles is required');
	}
	if (!uploadQueueStore) {
		throw new Error('useFileListView: uploadQueueStore is required');
	}

	const { t } = useI18n();
	const files = ref([]);
	const loading = ref(false);
	const errorMessage = ref('');
	const searchTerm = ref('');
	const isGridView = ref(false);
	const activeFilterMenu = ref(null);
	const selectedTypeFilter = ref('all');
	const selectedOwnerFilter = ref('all');
	const selectedUpdatedFilter = ref('all');
	const sortBy = ref(initialSortBy);
	const sortDirection = ref(initialSortDirection);

	const actionProgress = useFileActionProgress();

	const typeOptions = computed(() => [
		{ value: 'all', label: t('filters.allTypes') },
		{ value: 'folder', label: t('common.folder') },
		{ value: 'archive', label: t('filters.archive') },
		{ value: 'audio', label: t('filters.audio') },
		{ value: 'document', label: t('filters.document') },
		{ value: 'image', label: t('filters.image') },
		{ value: 'video', label: t('filters.video') },
		{ value: 'other', label: t('filters.other') },
	]);

	const updatedOptions = computed(() => [
		{ value: 'all', label: t('filters.allTimes') },
		{ value: 'today', label: t('filters.today') },
		{ value: 'last7', label: t('filters.last7') },
		{ value: 'last30', label: t('filters.last30') },
		{ value: 'thisYear', label: t('filters.thisYear') },
		{ value: 'lastYear', label: t('filters.lastYear') },
	]);

	const ownerOptions = computed(() => {
		const ownerMap = new Map();
		const source = sourceFiles ? sourceFiles.value : files.value;
		source.forEach((file) => {
			if (!file.email) return;
			const key = `${file.provider || 'unknown'}::${file.email}`;
			if (ownerMap.has(key)) return;
			ownerMap.set(key, { key, email: file.email, provider: file.provider || null });
		});
		return [...ownerMap.values()].sort((a, b) => {
			const byEmail = a.email.localeCompare(b.email, 'id');
			if (byEmail !== 0) return byEmail;
			return providerLabel(a.provider).localeCompare(providerLabel(b.provider), 'id');
		});
	});

	const filterUi = useFileFiltersUi({
		typeOptions,
		ownerOptions,
		updatedOptions,
		selectedTypeFilter,
		selectedOwnerFilter,
		selectedUpdatedFilter,
		activeFilterMenu,
		t,
		providerLabel,
	});

	const filteredFiles = computed(() => {
		const source = sourceFiles ? sourceFiles.value : files.value;
		return source.filter((file) => {
			const query = searchTerm.value.trim().toLowerCase();
			if (query && !sourceFiles) {
				const matchesQuery = [file.display_name, file.file_name, file.email, file.provider, file.virtual_path]
					.filter(Boolean)
					.some((value) => String(value).toLowerCase().includes(query));
				if (!matchesQuery) return false;
			}
			const typeMatches = selectedTypeFilter.value === 'all' || getFileCategory(file) === selectedTypeFilter.value;
			const ownerMatches = selectedOwnerFilter.value === 'all' || `${file.provider || 'unknown'}::${file.email}` === selectedOwnerFilter.value;
			const updatedMatches = selectedUpdatedFilter.value === 'all'
				|| matchesUpdatedFilter(new Date(file.modifiedTime || file.createdTime || 0), selectedUpdatedFilter.value);
			return typeMatches && ownerMatches && updatedMatches;
		});
	});

	const sortedFiles = computed(() => {
		const items = [...filteredFiles.value];
		if (!sortable) {
			return items.sort((a, b) => {
				const left = new Date(a.modifiedTime || a.createdTime || 0).getTime();
				const right = new Date(b.modifiedTime || b.createdTime || 0).getTime();
				if (left !== right) return right - left;
				return (a.display_name || a.file_name || '').localeCompare(b.display_name || b.file_name || '', 'id');
			});
		}
		const direction = sortDirection.value === 'asc' ? 1 : -1;
		return items.sort((a, b) => {
			if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1;
			let leftValue;
			let rightValue;
			switch (sortBy.value) {
				case 'file_name':
					leftValue = (a.display_name || a.file_name || '').toLowerCase();
					rightValue = (b.display_name || b.file_name || '').toLowerCase();
					break;
				case 'email':
					leftValue = (a.email || '').toLowerCase();
					rightValue = (b.email || '').toLowerCase();
					break;
				case 'size':
					leftValue = Number(a.size || 0);
					rightValue = Number(b.size || 0);
					break;
				case 'modified_at':
				case 'updated_at':
				default:
					leftValue = new Date(a.modifiedTime || a.createdTime || 0).getTime();
					rightValue = new Date(b.modifiedTime || b.createdTime || 0).getTime();
					break;
			}
			if (leftValue < rightValue) return -1 * direction;
			if (leftValue > rightValue) return 1 * direction;
			return 0;
		});
	});

	function setSort(field) {
		if (sortBy.value === field) {
			sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortBy.value = field;
		sortDirection.value = field === 'file_name' || field === 'email' ? 'asc' : 'desc';
	}

	async function refresh() {
		if (typeof loadFiles !== 'function') return;
		loading.value = true;
		errorMessage.value = '';
		try {
			const data = await loadFiles();
			const next = Array.isArray(data) ? data : [];
			files.value = typeof filterIncoming === 'function' ? filterIncoming(next) : next;
		} catch (error) {
			errorMessage.value = error.message;
		} finally {
			loading.value = false;
		}
	}

	function toggleViewMode(mode) {
		isGridView.value = mode === 'grid';
	}

	const actionsApi = useFileActions({
		sourceList: sortedFiles,
		errorRef: errorMessage,
		t,
		getFileCategory,
		uploadQueueStore,
		refresh,
		getPreviewType,
		previewUnsupportedMessage,
		onProgress: actionProgress.runWithProgress,
	});

	const originalRename = actionsApi.renameSelectedFile;
	const originalDelete = actionsApi.deleteSelectedFile;

	async function renameSelectedFile() {
		await originalRename({
			trackServerOperation: actions.rename
				? (file, nextName) => actions.rename(file, nextName)
				: undefined,
		});
	}

	async function deleteSelectedFile() {
		await originalDelete({
			trackServerOperation: actions.delete
				? (target) => actions.delete(target)
				: undefined,
		});
	}

	function handleGlobalPointer() {
		if (actionsApi.contextMenu.value.visible) actionsApi.closeContextMenu();
		activeFilterMenu.value = null;
		actionsApi.clearSelection();
	}

	let refreshTimer = null;

	onMounted(() => {
		if (!sourceFiles) refresh();
		if (autoRefresh && !sourceFiles) {
			refreshTimer = window.setInterval(refresh, refreshIntervalMs);
		}
		window.addEventListener('click', handleGlobalPointer);
		window.addEventListener('scroll', handleGlobalPointer, true);
	});

	onBeforeUnmount(() => {
		if (refreshTimer) window.clearInterval(refreshTimer);
		window.removeEventListener('click', handleGlobalPointer);
		window.removeEventListener('scroll', handleGlobalPointer, true);
	});

	watch(sourceFiles || files, (next) => {
		const validIds = new Set(next.map((file) => file.id));
		const current = actionsApi.selectedFileIds.value;
		const filtered = new Set([...current].filter((id) => validIds.has(id)));
		if (filtered.size !== current.size) {
			actionsApi.selectedFileIds.value = filtered;
		}
	});

	return {
		files,
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
		...filterUi,
		filteredFiles,
		sortedFiles,
		refresh,
		toggleViewMode,
		handleGlobalPointer,
		...actionsApi,
		renameSelectedFile,
		deleteSelectedFile,
		actionInProgress: actionProgress.isActionInProgress,
		actionLabel: actionProgress.actionLabel,
	};
}
