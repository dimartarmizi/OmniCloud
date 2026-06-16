<script setup>
import { IconLanguage, IconX } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';
import idFlag from '../assets/id.svg';
import usFlag from '../assets/us.svg';
import { useSettingsStore } from '../stores/settings';

defineProps({
	open: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const { t } = useI18n();
const settingsStore = useSettingsStore();

const languages = [
	{ code: 'id', label: 'Bahasa Indonesia', flag: idFlag },
	{ code: 'en', label: 'English', flag: usFlag },
];

async function selectLanguage(code) {
	await settingsStore.updateLanguage(code);
	emit('close');
}

function closeModal() {
	emit('close');
}
</script>

<template>
	<Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
		<div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm" @click.self="closeModal">
			<div class="relative flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-[14px] border border-[#dfe6f1] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_28px_80px_rgba(2,6,23,0.65)]">
				<button type="button" class="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10" :aria-label="t('common.close')" @click="closeModal">
					<IconX :size="20" :stroke="2" />
				</button>

				<div class="shrink-0 border-b border-[#eef2f7] p-6 dark:border-slate-800">
					<div class="flex items-start gap-4">
						<div class="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300">
							<IconLanguage :size="28" :stroke="1.8" />
						</div>
						<div class="min-w-0 flex-1 pt-1">
							<h3 class="text-xl font-semibold text-[#202124] dark:text-slate-100">{{ t('language.title') }}</h3>
							<p class="text-sm leading-6 text-[#5f6368] dark:text-slate-400">
								{{ t('language.selectLanguage') }}
							</p>
						</div>
					</div>
				</div>

				<div class="overflow-y-auto p-4">
					<div class="grid gap-2">
						<button v-for="lang in languages" :key="lang.code" type="button" class="flex items-center gap-4 rounded-2xl border border-[#e7edf6] bg-[#f8fafd] p-4 text-left transition-all hover:border-[#1a73e8] hover:bg-[#e8f0fe] dark:border-slate-800 dark:bg-slate-800/70 dark:hover:border-blue-400/40 dark:hover:bg-slate-800" :class="{ 'border-[#1a73e8] bg-[#e8f0fe] dark:border-blue-400/40 dark:bg-slate-800': settingsStore.language === lang.code }" @click="selectLanguage(lang.code)">
							<img :src="lang.flag" :alt="lang.label" class="h-8 w-8 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10" />
							<span class="text-base font-medium text-[#202124] dark:text-slate-100">{{ lang.label }}</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>
