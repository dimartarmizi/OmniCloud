import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { providerLabel } from './useFormatFile.js';
import { useFileFiltersUi } from './useFileFiltersUi.js';
import { useFileActions } from './useFileActions.js';
import { useFileActionProgress } from './useFileActionProgress.js';
import { getFileCategory } from './useFileType.js';
import { createUpdatedFilterPredicate } from './useFileFilters.js';

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

		// Hoist all loop-invariant work out of the per-file predicate: the search
		// query is normalized once, and the date-range filter is compiled once so
		// its ~7 boundary Date objects are not rebuilt for every file. For N files
		// this turns O(N) redundant allocations/normalizations into O(1) setup.
		const query = searchTerm.value.trim().toLowerCase();
		const applySearch = Boolean(query) && !sourceFiles;
		const typeFilter = selectedTypeFilter.value;
		const ownerFilter = selectedOwnerFilter.value;
		const updatedFilter = selectedUpdatedFilter.value;
		const matchesUpdated = createUpdatedFilterPredicate(updatedFilter);

		return source.filter((file) => {
			if (applySearch) {
				const matchesQuery = [file.file_name, file.email, file.provider, file.virtual_path]
					.filter(Boolean)
					.some((value) => String(value).toLowerCase().includes(query));
				if (!matchesQuery) return false;
			}
			const typeMatches = typeFilter === 'all' || getFileCategory(file) === typeFilter;
			const ownerMatches = ownerFilter === 'all' || `${file.provider || 'unknown'}::${file.email}` === ownerFilter;
			const updatedMatches = updatedFilter === 'all'
				|| matchesUpdated(file.modifiedTime || file.createdTime || 0);
			return typeMatches && ownerMatches && updatedMatches;
		});
	});

	const sortedFiles = computed(() => {
		const source = filteredFiles.value;

		// Decorate-sort-undecorate: precompute each item's sort key exactly once
		// (O(n)) instead of recomputing it inside the comparator, which runs
		// O(n log n) times. This removes repeated Date parsing / string casing on
		// every search keystroke, filter change, and data refresh. Ordering is
		// identical to the previous inline comparator.
		if (!sortable) {
			const decorated = source.map((file) => ({
				file,
				time: new Date(file.modifiedTime || file.createdTime || 0).getTime(),
			}));
			decorated.sort((a, b) => {
				if (a.time !== b.time) return b.time - a.time;
				return (a.file.file_name || '').localeCompare(b.file.file_name || '', 'id');
			});
			return decorated.map((entry) => entry.file);
		}

		const direction = sortDirection.value === 'asc' ? 1 : -1;
		const field = sortBy.value;
		const keyOf = (file) => {
			switch (field) {
				case 'file_name':
					return (file.display_name || file.file_name || '').toLowerCase();
				case 'email':
					return (file.email || '').toLowerCase();
				case 'size':
					return Number(file.size || 0);
				case 'modified_at':
				case 'updated_at':
				default:
					return new Date(file.modifiedTime || file.createdTime || 0).getTime();
			}
		};

		const decorated = source.map((file) => ({ file, key: keyOf(file) }));
		decorated.sort((a, b) => {
			if (a.file.is_folder !== b.file.is_folder) return a.file.is_folder ? -1 : 1;
			if (a.key < b.key) return -1 * direction;
			if (a.key > b.key) return 1 * direction;
			return 0;
		});
		return decorated.map((entry) => entry.file);
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
