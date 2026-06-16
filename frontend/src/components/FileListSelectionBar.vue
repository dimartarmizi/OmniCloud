<script setup>
import {
	IconX,
	IconEye,
	IconStar,
	IconStarFilled,
	IconDownload,
	IconEdit,
	IconFolderShare,
	IconInfoCircle,
	IconTrash,
} from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps({
	selectedCount: { type: Number, required: true },
	canPreview: { type: Boolean, default: false },
	canToggleStar: { type: Boolean, default: false },
	isPrimaryStarred: { type: Boolean, default: false },
	canDownload: { type: Boolean, default: false },
	canRename: { type: Boolean, default: false },
	canShowDetails: { type: Boolean, default: true },
	canDelete: { type: Boolean, default: true },
	canMove: { type: Boolean, default: false },
	primaryFile: { type: Object, default: null },
});

const emit = defineEmits(['clear', 'preview', 'toggle-star', 'download', 'rename', 'move', 'show-details', 'delete']);
</script>

<template>
	<div
		class="flex flex-wrap items-center gap-1.5 rounded-full bg-[#e8f0fe] px-2 py-1 text-[#174ea6] dark:bg-sky-500/15 dark:text-sky-200"
	>
		<button
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition hover:bg-[#d2e3fc] dark:hover:bg-sky-500/20"
			:title="t('drive.deselectAll')"
			@click="emit('clear')"
		>
			<IconX :size="18" :stroke="2" />
		</button>
		<span class="pr-2 text-sm font-semibold">{{ selectedCount }} {{ t('drive.selected') }}</span>

		<slot name="prefix" :primary="primaryFile" />

		<button
			v-if="selectedCount === 1"
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="t('drive.preview')"
			:disabled="!canPreview"
			@click="emit('preview', primaryFile)"
		>
			<IconEye :size="18" :stroke="2" />
		</button>

		<button
			v-if="canToggleStar"
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="isPrimaryStarred ? t('drive.unstar') : t('drive.star')"
			@click="emit('toggle-star')"
		>
			<component
				:is="isPrimaryStarred ? IconStarFilled : IconStar"
				:size="18"
				:stroke="isPrimaryStarred ? 0 : 2"
			/>
		</button>

		<button
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="t('common.download')"
			:disabled="!canDownload"
			@click="emit('download')"
		>
			<IconDownload :size="18" :stroke="2" />
		</button>

		<button
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="t('common.rename')"
			:disabled="!canRename"
			@click="emit('rename')"
		>
			<IconEdit :size="18" :stroke="2" />
		</button>

		<button
			v-if="canMove"
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="t('common.move')"
			:disabled="!canMove"
			@click="emit('move')"
		>
			<IconFolderShare :size="18" :stroke="2" />
		</button>

		<button
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-[#d2e3fc] dark:enabled:hover:bg-sky-500/20"
			:title="t('drive.details')"
			:disabled="!canShowDetails || selectedCount !== 1"
			@click="emit('show-details')"
		>
			<IconInfoCircle :size="18" :stroke="2" />
		</button>

		<slot name="suffix" :primary="primaryFile" />

		<button
			v-if="canDelete"
			type="button"
			class="inline-flex size-9 items-center justify-center rounded-full text-[#c5221f] transition hover:bg-[#fce8e6] dark:text-red-300 dark:hover:bg-red-950/30"
			:title="t('common.delete')"
			@click="emit('delete')"
		>
			<IconTrash :size="18" :stroke="2" />
		</button>
	</div>
</template>
