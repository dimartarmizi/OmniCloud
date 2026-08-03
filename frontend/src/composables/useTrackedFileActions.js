export function useTrackedFileActions({ uploadQueueStore, api }) {
	if (!uploadQueueStore) {
		throw new Error('useTrackedFileActions: uploadQueueStore is required');
	}
	if (!api) {
		throw new Error('useTrackedFileActions: api is required');
	}

	function resolveTargetKind(files) {
		if (files.every((file) => file.is_folder)) return 'folder';
		if (files.every((file) => !file.is_folder)) return 'file';
		return 'item';
	}

	function rename(file, nextName) {
		return uploadQueueStore.trackServerOperation(
			{
				type: 'rename',
				name: nextName,
				fromName: file.display_name || file.file_name,
				toName: nextName,
				targetKind: file.is_folder ? 'folder' : 'file',
			},
			() => api.renameFile(file.id, { name: nextName }),
		);
	}

	function deleteFiles(target) {
		const files = Array.isArray(target) ? target : [target];
		if (files.length === 1) {
			return uploadQueueStore.trackServerOperation(
				{
					type: 'delete',
					name: files[0].display_name || files[0].file_name,
					targetKind: files[0].is_folder ? 'folder' : 'file',
				},
				() => api.deleteFile(files[0].id),
			);
		}
		const targetKind = resolveTargetKind(files);
		return uploadQueueStore.trackServerOperation(
			{
				type: 'delete',
				name: `${files.length} ${targetKind}`,
				batchTotal: files.length,
				targetKind,
			},
			() => api.deleteFiles(files.map((file) => file.id)),
		);
	}

	return { rename, delete: deleteFiles };
}
