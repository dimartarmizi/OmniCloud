<script setup>
// Skeleton placeholder rows that mimic the file-list table shape (name / owner
// / modified / size columns) so first load shows content-shaped loading state
// instead of a centered spinner that shifts layout when data arrives.
defineProps({
	rows: { type: Number, default: 8 },
});
</script>

<template>
	<div role="status" aria-live="polite" class="animate-pulse">
		<span class="sr-only">{{ $t('common.loading') }}</span>
		<div
			v-for="row in rows"
			:key="row"
			class="grid min-h-10 grid-cols-[minmax(260px,2fr)_minmax(180px,1.1fr)_minmax(150px,1fr)_140px] items-center gap-3 border-t border-[#eceff1] px-4 first:border-t-0 dark:border-slate-700"
		>
			<div class="flex items-center gap-2.5">
				<div class="size-[18px] shrink-0 rounded bg-[#e8eaed] dark:bg-slate-700"></div>
				<div
					class="h-3.5 rounded bg-[#e8eaed] dark:bg-slate-700"
					:style="{ width: `${45 + ((row * 13) % 40)}%` }"
				></div>
			</div>
			<div class="flex items-center gap-2">
				<div class="size-6 shrink-0 rounded-full bg-[#e8eaed] dark:bg-slate-700"></div>
				<div class="h-3 w-2/3 rounded bg-[#e8eaed] dark:bg-slate-700"></div>
			</div>
			<div class="h-3 w-20 rounded bg-[#e8eaed] dark:bg-slate-700"></div>
			<div class="h-3 w-12 rounded bg-[#e8eaed] dark:bg-slate-700"></div>
		</div>
	</div>
</template>
