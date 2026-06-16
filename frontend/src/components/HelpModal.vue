<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconBook2, IconFolderPlus, IconLifebuoy, IconSearch, IconUpload, IconX } from '@tabler/icons-vue';

defineProps({
	open: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const { t, tm } = useI18n();

const usageTips = computed(() => tm('help.usageTipsList'));
const connectAccountSteps = computed(() => tm('help.connectAccountSteps'));

const quickActions = computed(() => [
	{
		icon: IconFolderPlus,
		title: t('help.createFolder'),
		description: t('help.createFolderDesc'),
	},
	{
		icon: IconUpload,
		title: t('help.uploadFiles'),
		description: t('help.uploadFilesDesc'),
	},
	{
		icon: IconSearch,
		title: t('help.searchFiles'),
		description: t('help.searchFilesDesc'),
	},
]);

function closeModal() {
	emit('close');
}
</script>

<template>
	<Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
		<div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm" @click.self="closeModal">
			<div class="relative flex max-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-[#dfe6f1] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_28px_80px_rgba(2,6,23,0.65)]">
				<button type="button" class="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10" :aria-label="t('common.close')" @click="closeModal">
					<IconX :size="20" :stroke="2" />
				</button>

				<div class="shrink-0 border-b border-[#eef2f7] p-6 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_58%)]">
					<div class="flex items-start gap-4">
						<div class="grid size-16 shrink-0 place-items-center rounded-3xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">
							<IconLifebuoy :size="30" :stroke="1.8" />
						</div>
						<div class="min-w-0 flex-1 pt-1">
							<div class="mb-2 inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">
								<IconBook2 :size="14" :stroke="2" />
								<span>{{ t('help.centerTitle') }}</span>
							</div>
							<h3 class="text-2xl font-semibold text-[#202124] dark:text-slate-100">{{ t('help.title') }}</h3>
							<p class="mt-1 text-sm leading-6 text-[#5f6368] dark:text-slate-400">
								{{ t('help.subtitle') }}
							</p>
						</div>
					</div>
				</div>

				<div class="space-y-5 overflow-y-auto p-6">
					<div class="grid gap-3 md:grid-cols-3">
						<div v-for="item in quickActions" :key="item.title" class="rounded-[12px] border border-[#e7edf6] bg-[#f8fafd] p-4 dark:border-slate-800 dark:bg-slate-800/70">
							<div class="mb-3 grid size-11 place-items-center rounded-2xl bg-white text-[#1a73e8] shadow-[0_8px_18px_rgba(26,115,232,0.10)] dark:bg-slate-900 dark:text-blue-300">
								<component :is="item.icon" :size="22" :stroke="1.8" />
							</div>
							<h4 class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ item.title }}</h4>
							<p class="mt-2 text-xs leading-5 text-[#5f6368] dark:text-slate-400">{{ item.description }}</p>
						</div>
					</div>

					<div class="rounded-[12px] border border-[#e7edf6] bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-800/60">
						<h4 class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ t('help.usageTips') }}</h4>
						<ul class="mt-3 space-y-2 text-sm leading-6 text-[#5f6368] dark:text-slate-400">
							<li v-for="(tip, index) in usageTips" :key="index">• {{ tip }}</li>
						</ul>
					</div>

					<div class="rounded-[12px] border border-[#e7edf6] bg-[#f8fafd] px-5 py-4 dark:border-slate-800 dark:bg-slate-800/70">
						<h4 class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ t('help.connectAccount') }}</h4>
						<div class="mt-3 space-y-3 text-sm leading-6 text-[#5f6368] dark:text-slate-400">
							<p v-for="(step, index) in connectAccountSteps" :key="index">{{ step }}</p>
						</div>
					</div>

					<div class="rounded-[12px] border border-[#e7edf6] bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-800/60">
						<h4 class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ t('help.howItWorks') }}</h4>
						<div class="mt-4 space-y-3">
							<div class="flex gap-3">
								<div class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-bold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">1</div>
								<p class="text-sm leading-6 text-[#5f6368] dark:text-slate-400">
									{{ t('help.howItWorksStep1') }}
								</p>
							</div>
							<div class="flex gap-3">
								<div class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-bold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">2</div>
								<p class="text-sm leading-6 text-[#5f6368] dark:text-slate-400">
									{{ t('help.howItWorksStep2') }}
								</p>
							</div>
							<div class="flex gap-3">
								<div class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-bold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">3</div>
								<p class="text-sm leading-6 text-[#5f6368] dark:text-slate-400">
									{{ t('help.howItWorksStep3') }}
								</p>
							</div>
							<div class="flex gap-3">
								<div class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-bold text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">4</div>
								<p class="text-sm leading-6 text-[#5f6368] dark:text-slate-400">
									{{ t('help.howItWorksStep4') }}
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>