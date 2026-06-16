<script setup>
import { computed, toRef } from 'vue';
import { IconChevronDown, IconCloud, IconCloudFilled, IconCheck, IconSearch, IconX } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';
import { getTypeFilterIcon } from '../composables/useFileType.js';
import { providerIcon, providerLabel } from '../composables/useFormatFile.js';
import { useFileFiltersUi } from '../composables/useFileFiltersUi.js';

const { t } = useI18n();

const props = defineProps({
	typeOptions: { type: Array, required: true },
	ownerOptions: { type: Array, required: true },
	updatedOptions: { type: Array, required: true },
	selectedTypeFilter: { type: String, required: true },
	selectedOwnerFilter: { type: String, required: true },
	selectedUpdatedFilter: { type: String, required: true },
	activeFilterMenu: { type: [String, null], default: null },
	searchTerm: { type: String, default: '' },
});

const emit = defineEmits(['toggle-filter-menu', 'apply-filter', 'clear-filter', 'update:searchTerm']);

// Reuse the single source of truth for label/active-state logic instead of
// re-implementing it here. The composable reads its inputs reactively, so prop
// refs are forwarded; the menu/apply/clear handlers it also returns are unused
// here because this presentational component emits those events to its parent.
const { getFilterLabel, renderOwnerLabel, isFilterActive } = useFileFiltersUi({
	typeOptions: toRef(props, 'typeOptions'),
	ownerOptions: toRef(props, 'ownerOptions'),
	updatedOptions: toRef(props, 'updatedOptions'),
	selectedTypeFilter: computed(() => props.selectedTypeFilter),
	selectedOwnerFilter: computed(() => props.selectedOwnerFilter),
	selectedUpdatedFilter: computed(() => props.selectedUpdatedFilter),
	activeFilterMenu: computed(() => props.activeFilterMenu),
	t,
	providerLabel,
});
</script>

<template>
	<div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
		<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
			<div class="relative">
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-2xl border border-[#e0e3e7] bg-[#f8fafd] px-3.5 py-2.5 text-sm font-medium text-[#3c4043] transition hover:border-[#c7d2e0] hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
					@click.stop="emit('toggle-filter-menu', 'type')"
				>
					<span>{{ getFilterLabel('type', selectedTypeFilter) }}</span>
					<IconX
						v-if="isFilterActive('type')"
						:size="16"
						:stroke="2"
						class="text-[#5f6368] transition hover:text-[#1a73e8] dark:text-slate-400 dark:hover:text-sky-300"
						@click.stop="emit('clear-filter', 'type')"
					/>
					<IconChevronDown v-else :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
				</button>
				<div
					v-if="activeFilterMenu === 'type'"
					class="absolute right-0 top-full z-30 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white p-2 shadow-[0_16px_40px_rgba(32,33,36,0.16)] dark:border-slate-700 dark:bg-slate-800"
				>
					<button
						v-for="option in typeOptions"
						:key="option.value"
						type="button"
						class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
						@click="emit('apply-filter', 'type', option.value)"
					>
						<span class="flex items-center gap-2">
							<component
								:is="getTypeFilterIcon(option.value, selectedTypeFilter === option.value)"
								:size="16"
								:stroke="selectedTypeFilter === option.value ? 0 : 1.8"
								:class="
									selectedTypeFilter === option.value
										? 'text-[#1a73e8] dark:text-sky-300'
										: 'text-[#5f6368] dark:text-slate-400'
								"
							/>
							<span>{{ option.label }}</span>
						</span>
						<IconCheck
							v-if="selectedTypeFilter === option.value"
							:size="16"
							:stroke="2"
							class="text-[#1a73e8] dark:text-sky-300"
						/>
					</button>
				</div>
			</div>

			<div class="relative">
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-2xl border border-[#e0e3e7] bg-[#f8fafd] px-3.5 py-2.5 text-sm font-medium text-[#3c4043] transition hover:border-[#c7d2e0] hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
					@click.stop="emit('toggle-filter-menu', 'owner')"
				>
					<span>{{ renderOwnerLabel(selectedOwnerFilter) }}</span>
					<IconX
						v-if="isFilterActive('owner')"
						:size="16"
						:stroke="2"
						class="text-[#5f6368] transition hover:text-[#1a73e8] dark:text-slate-400 dark:hover:text-sky-300"
						@click.stop="emit('clear-filter', 'owner')"
					/>
					<IconChevronDown v-else :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
				</button>
				<div
					v-if="activeFilterMenu === 'owner'"
					class="absolute right-0 top-full z-30 mt-2 min-w-[260px] overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white p-2 shadow-[0_16px_40px_rgba(32,33,36,0.16)] dark:border-slate-700 dark:bg-slate-800"
				>
					<button
						type="button"
						class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
						@click="emit('apply-filter', 'owner', 'all')"
					>
						<span class="flex min-w-0 items-center gap-2">
							<span class="flex size-5 shrink-0 items-center justify-center">
								<component
									:is="selectedOwnerFilter === 'all' ? IconCloudFilled : IconCloud"
									:size="16"
									:stroke="selectedOwnerFilter === 'all' ? 0 : 1.8"
									:class="
										selectedOwnerFilter === 'all'
											? 'text-[#1a73e8] dark:text-sky-300'
											: 'text-[#5f6368] dark:text-slate-400'
									"
								/>
							</span>
							<span>{{ t('filters.allOwners') }}</span>
						</span>
						<IconCheck
							v-if="selectedOwnerFilter === 'all'"
							:size="16"
							:stroke="2"
							class="text-[#1a73e8] dark:text-sky-300"
						/>
					</button>
					<button
						v-for="owner in ownerOptions"
						:key="owner.key"
						type="button"
						class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
						@click="emit('apply-filter', 'owner', owner.key)"
					>
						<span class="flex min-w-0 items-center gap-2">
							<div
								v-if="providerIcon(owner.provider)"
								class="flex size-5 shrink-0 items-center justify-center rounded-full bg-white dark:bg-slate-900/70"
							>
								<img
									:src="providerIcon(owner.provider)"
									:alt="providerLabel(owner.provider)"
									class="size-3.5 object-contain"
								/>
							</div>
							<div v-else class="size-5 shrink-0"></div>
							<span class="flex min-w-0 flex-col">
								<span class="truncate">{{ owner.email }}</span>
							</span>
						</span>
						<IconCheck
							v-if="selectedOwnerFilter === owner.key"
							:size="16"
							:stroke="2"
							class="text-[#1a73e8] dark:text-sky-300"
						/>
					</button>
				</div>
			</div>

			<div class="relative">
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-2xl border border-[#e0e3e7] bg-[#f8fafd] px-3.5 py-2.5 text-sm font-medium text-[#3c4043] transition hover:border-[#c7d2e0] hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
					@click.stop="emit('toggle-filter-menu', 'updated')"
				>
					<span>{{ getFilterLabel('updated', selectedUpdatedFilter) }}</span>
					<IconX
						v-if="isFilterActive('updated')"
						:size="16"
						:stroke="2"
						class="text-[#5f6368] transition hover:text-[#1a73e8] dark:text-slate-400 dark:hover:text-sky-300"
						@click.stop="emit('clear-filter', 'updated')"
					/>
					<IconChevronDown v-else :size="16" :stroke="2" class="text-[#5f6368] dark:text-slate-400" />
				</button>
				<div
					v-if="activeFilterMenu === 'updated'"
					class="absolute right-0 top-full z-30 mt-2 min-w-[240px] overflow-hidden rounded-2xl border border-[#e0e3e7] bg-white p-2 shadow-[0_16px_40px_rgba(32,33,36,0.16)] dark:border-slate-700 dark:bg-slate-800"
				>
					<button
						v-for="option in updatedOptions"
						:key="option.value"
						type="button"
						class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-[#202124] hover:bg-[#f8fafd] dark:text-slate-100 dark:hover:bg-slate-700/70"
						@click="emit('apply-filter', 'updated', option.value)"
					>
						<span>{{ option.label }}</span>
						<IconCheck
							v-if="selectedUpdatedFilter === option.value"
							:size="16"
							:stroke="2"
							class="text-[#1a73e8] dark:text-sky-300"
						/>
					</button>
				</div>
			</div>
		</div>

		<div class="relative ml-auto w-full min-w-0 shrink-0 sm:ml-0 sm:w-[280px]">
			<IconSearch
				:size="18"
				:stroke="2"
				class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5f6368] dark:text-slate-400"
			/>
			<input
				class="h-11 w-full rounded-full border border-[#dadce0] bg-white pl-11 pr-4 text-sm text-[#202124] outline-none transition focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-400"
				type="search"
				:value="searchTerm"
				:placeholder="t('drive.searchInFolder')"
				@input="emit('update:searchTerm', $event.target.value)"
			/>
		</div>
	</div>
</template>
