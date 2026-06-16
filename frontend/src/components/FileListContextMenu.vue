<script setup>
import { computed, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	IconFolder,
	IconStar,
	IconStarFilled,
	IconEye,
	IconDownload,
	IconEdit,
	IconFolderShare,
	IconInfoCircle,
	IconTrash,
} from '@tabler/icons-vue';

const { t } = useI18n();

const props = defineProps({
	contextMenuRef: { type: Object, default: null },
	contextMenu: { type: Object, required: true },
	selectedCount: { type: Number, required: true },
	primarySelectedFile: { type: Object, default: null },
	canPreview: { type: Boolean, default: false },
	canToggleStar: { type: Boolean, default: false },
	isPrimaryStarred: { type: Boolean, default: false },
	canDownload: { type: Boolean, default: false },
	canRename: { type: Boolean, default: false },
	canShowDetails: { type: Boolean, default: true },
	canOpenFolder: { type: Boolean, default: false },
	canDelete: { type: Boolean, default: true },
	canMove: { type: Boolean, default: false },
});

const emit = defineEmits([
	'open-folder',
	'preview',
	'toggle-star',
	'download',
	'rename',
	'move',
	'show-details',
	'delete',
	'close',
]);

const showOpen = computed(
	() => props.canOpenFolder && props.selectedCount === 1 && Boolean(props.primarySelectedFile?.is_folder),
);
const showPreview = computed(() => props.selectedCount === 1 && !props.primarySelectedFile?.is_folder);
const showStar = computed(() => props.canToggleStar);

// Resolve the forwarded ref to the menu DOM element (it may be a template-ref
// object or the element itself, depending on how the parent passes it).
function menuElement() {
	const node = props.contextMenuRef;
	if (!node) return null;
	return node.value ?? node;
}

function menuItems() {
	const el = menuElement();
	if (!el?.querySelectorAll) return [];
	return Array.from(el.querySelectorAll('[role="menuitem"]:not([disabled])'));
}

// When the menu opens, move focus to the first item so it is operable by
// keyboard (arrow keys navigate, Enter activates, Escape closes).
watch(
	() => props.contextMenu.visible,
	async (visible) => {
		if (!visible) return;
		await nextTick();
		menuItems()[0]?.focus();
	},
);

function handleMenuKeydown(event) {
	const items = menuItems();
	if (!items.length) return;
	const currentIndex = items.indexOf(document.activeElement);

	if (event.key === 'ArrowDown') {
		event.preventDefault();
		const next = items[(currentIndex + 1) % items.length] || items[0];
		next.focus();
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		const prev = items[(currentIndex - 1 + items.length) % items.length] || items[items.length - 1];
		prev.focus();
	} else if (event.key === 'Home') {
		event.preventDefault();
		items[0].focus();
	} else if (event.key === 'End') {
		event.preventDefault();
		items[items.length - 1].focus();
	} else if (event.key === 'Escape') {
		event.preventDefault();
		emit('close');
	}
}

function handleOpen() {
	emit('open-folder');
}
function handlePreview() {
	emit('preview', props.primarySelectedFile);
}
function handleStar() {
	emit('toggle-star');
}
function handleDownload() {
	emit('download');
}
function handleRename() {
	emit('rename');
}
function handleMove() {
	emit('move');
}
function handleDetails() {
	emit('show-details');
}
function handleDelete() {
	emit('delete');
}
</script>

<template>
	<div
		v-if="contextMenu.visible"
		ref="contextMenuRef"
		role="menu"
		:aria-label="t('drive.details')"
		class="fixed z-50 min-w-[220px] overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white py-2 shadow-[0_16px_40px_rgba(32,33,36,0.2)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_16px_40px_rgba(15,23,42,0.45)]"
		:style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
		@click.stop
		@contextmenu.stop
		@keydown="handleMenuKeydown"
	>
		<button
			v-if="showOpen"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			@click="handleOpen"
		>
			<IconFolder :size="17" :stroke="2" />
			<span>{{ t('common.open') }}</span>
		</button>
		<button
			v-if="showPreview"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			:disabled="!canPreview"
			@click="handlePreview"
		>
			<IconEye :size="17" :stroke="2" />
			<span>{{ t('drive.preview') }}</span>
		</button>
		<button
			v-if="showStar"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			@click="handleStar"
		>
			<component
				:is="isPrimaryStarred ? IconStarFilled : IconStar"
				:size="17"
				:stroke="isPrimaryStarred ? 0 : 2"
			/>
			<span>{{ isPrimaryStarred ? t('drive.unstar') : t('drive.star') }}</span>
		</button>
		<button
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			:disabled="!canDownload"
			@click="handleDownload"
		>
			<IconDownload :size="17" :stroke="2" />
			<span>{{ t('common.download') }}</span>
		</button>
		<button
			v-if="canRename"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			:disabled="!canRename"
			@click="handleRename"
		>
			<IconEdit :size="17" :stroke="2" />
			<span>{{ t('common.rename') }}</span>
		</button>
		<button
			v-if="canMove"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			:disabled="!canMove"
			@click="handleMove"
		>
			<IconFolderShare :size="17" :stroke="2" />
			<span>{{ t('common.move') }}</span>
		</button>
		<button
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f8fafd] focus:bg-[#f8fafd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:bg-slate-700/70 dark:focus:bg-slate-700/70"
			:disabled="!canShowDetails"
			@click="handleDetails"
		>
			<IconInfoCircle :size="17" :stroke="2" />
			<span>{{ t('drive.details') }}</span>
		</button>
		<button
			v-if="canDelete"
			type="button"
			role="menuitem"
			tabindex="0"
			class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#c5221f] hover:bg-[#fce8e6] focus:bg-[#fce8e6] focus:outline-none dark:text-red-300 dark:hover:bg-red-950/30 dark:focus:bg-red-950/30"
			@click="handleDelete"
		>
			<IconTrash :size="17" :stroke="2" />
			<span>{{ t('common.delete') }}</span>
		</button>
	</div>
</template>
