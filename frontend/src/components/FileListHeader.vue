<script setup>
import { useI18n } from 'vue-i18n';
import { IconChevronUp, IconChevronDown } from '@tabler/icons-vue';

const { t } = useI18n();

const props = defineProps({
	sortable: { type: Boolean, default: false },
	sortBy: { type: String, default: 'file_name' },
	sortDirection: { type: String, default: 'desc' },
});

const emit = defineEmits(['sort']);

function handleSort(field) {
	if (!props.sortable) return;
	emit('sort', field);
}

function sortIndicator(field) {
	if (props.sortBy !== field) return null;
	return props.sortDirection === 'asc' ? IconChevronUp : IconChevronDown;
}
</script>

<template>
	<div
		class="sticky top-0 z-10 grid min-h-9 grid-cols-[minmax(260px,2fr)_minmax(180px,1.1fr)_minmax(150px,1fr)_140px] items-center gap-3 border-b border-[#e8eaed] bg-[#f8fafd]/95 px-4 text-[13px] text-[#5f6368] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-400"
	>
		<template v-if="sortable">
			<button
				type="button"
				class="flex items-center gap-1 text-left hover:text-[#1a73e8]"
				@click="handleSort('file_name')"
			>
				<span>{{ t('drive.sortByName') }}</span>
				<component :is="sortIndicator('file_name')" v-if="sortIndicator('file_name')" :size="14" :stroke="2" />
			</button>
			<button
				type="button"
				class="flex items-center gap-1 text-left hover:text-[#1a73e8]"
				@click="handleSort('email')"
			>
				<span>{{ t('home.fileOwner') }}</span>
				<component :is="sortIndicator('email')" v-if="sortIndicator('email')" :size="14" :stroke="2" />
			</button>
			<button
				type="button"
				class="flex items-center gap-1 text-left hover:text-[#1a73e8]"
				@click="handleSort('updated_at')"
			>
				<span>{{ t('home.fileModified') }}</span>
				<component
					:is="sortIndicator('updated_at')"
					v-if="sortIndicator('updated_at')"
					:size="14"
					:stroke="2"
				/>
			</button>
			<button
				type="button"
				class="flex items-center gap-1 text-left hover:text-[#1a73e8]"
				@click="handleSort('size')"
			>
				<span>{{ t('drive.size') }}</span>
				<component :is="sortIndicator('size')" v-if="sortIndicator('size')" :size="14" :stroke="2" />
			</button>
		</template>
		<template v-else>
			<span>{{ t('drive.sortByName') }}</span>
			<span>{{ t('home.fileOwner') }}</span>
			<span>{{ t('home.fileModified') }}</span>
			<span>{{ t('drive.size') }}</span>
		</template>
	</div>
</template>
