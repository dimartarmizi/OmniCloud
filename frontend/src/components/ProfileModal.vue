<script setup>
import { useI18n } from 'vue-i18n';
import { IconExternalLink, IconX } from '@tabler/icons-vue';

import dimarTarmiziPhoto from '../assets/dimar-tarmizi.jpg';

defineProps({
	open: { type: Boolean, default: false },
	profileLinks: { type: Array, default: () => [] },
});

const emit = defineEmits(['close']);

const { t } = useI18n();

function closeModal() {
	emit('close');
}
</script>

<template>
	<Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
		<div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm" @click.self="closeModal">
			<div class="relative flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-[14px] border border-[#dfe6f1] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:max-h-[calc(100vh-4rem)] sm:rounded-[16px] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_28px_80px_rgba(2,6,23,0.65)]">
				<button type="button" class="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10" :aria-label="t('common.close')" @click="closeModal">
					<IconX :size="20" :stroke="2" />
				</button>

				<div class="border-b border-[#eef2f7] p-6 dark:border-slate-800">
					<h3 class="text-2xl font-semibold text-[#202124] dark:text-slate-100">{{ t('profile.title') }}</h3>
					<p class="mt-1 text-sm leading-6 text-[#5f6368] dark:text-slate-400">{{ t('profile.subtitle') }}</p>
				</div>

				<div class="space-y-5 overflow-y-auto p-5 sm:p-6 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_58%)]">
					<div class="flex flex-col items-center text-center">
						<img :src="dimarTarmiziPhoto" alt="Dimar Tarmizi" class="size-24 rounded-[14px] object-cover shadow-[0_16px_32px_rgba(15,23,42,0.18)] ring-4 ring-white dark:ring-slate-900" />
						<h3 class="mt-4 text-2xl font-semibold text-[#202124] dark:text-slate-100">Dimar Tarmizi</h3>
						<p class="mt-1 max-w-md text-sm leading-6 text-[#5f6368] dark:text-slate-400">Learning &amp; building as I go, making stuff that’s useful and awesome</p>
					</div>

					<div class="rounded-[14px] border border-[#e7edf6] bg-[#f8fafd] p-4 dark:border-slate-800 dark:bg-slate-800/70">
						<div class="mb-3 flex items-center justify-between gap-3">
							<div>
								<h4 class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ t('profile.letsConnect') }}</h4>
								<p class="mt-1 text-xs leading-5 text-[#5f6368] dark:text-slate-400">
									{{ t('profile.letsConnectDesc') }}
								</p>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<a v-for="link in profileLinks" :key="link.id" :href="link.href" target="_blank" rel="noreferrer" class="group flex flex-col items-center rounded-2xl border border-[#e7edf6] bg-white p-3 text-center transition-all hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_14px_28px_rgba(26,115,232,0.12)] dark:border-slate-700 dark:bg-slate-900/80 dark:hover:border-blue-400/40 dark:hover:bg-slate-900">
								<span class="grid size-10 place-items-center rounded-2xl bg-[#f8fafd] text-[#5f6368] transition-colors group-hover:bg-[#e8f0fe] group-hover:text-[#1a73e8] dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-blue-500/15 dark:group-hover:text-blue-300">
									<svg v-if="link.id === 'website'" class="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
									</svg>
									<svg v-else-if="link.id === 'github'" class="size-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
									</svg>
									<svg v-else-if="link.id === 'linkedin'" class="size-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
									</svg>
									<svg v-else-if="link.id === 'instagram'" class="size-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
									</svg>
									<svg v-else-if="link.id === 'facebook'" class="size-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.312h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z" />
									</svg>
									<svg v-else class="size-5" fill="currentColor" viewBox="0 0 16 16">
										<path d="M6.167 8a.83.83 0 0 0-.83.83c0 .459.372.84.83.831a.831.831 0 0 0 0-1.661m1.843 3.647c.315 0 1.403-.038 1.976-.611a.23.23 0 0 0 0-.306.213.213 0 0 0-.306 0c-.353.363-1.126.487-1.67.487-.545 0-1.308-.124-1.671-.487a.213.213 0 0 0-.306 0 .213.213 0 0 0 0 .306c.564.563 1.652.61 1.977.61zm.992-2.807c0 .458.373.83.831.83s.83-.381.83-.83a.831.831 0 0 0-1.66 0z" />
										<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.828-1.165c-.315 0-.602.124-.812.325-.801-.573-1.9-.945-3.121-.993l.534-2.501 1.738.372a.83.83 0 1 0 .83-.869.83.83 0 0 0-.744.468l-1.938-.41a.2.2 0 0 0-.153.028.2.2 0 0 0-.086.134l-.592 2.788c-1.24.038-2.358.41-3.17.992-.21-.2-.496-.324-.81-.324a1.163 1.163 0 0 0-.478 2.224q-.03.17-.029.353c0 1.795 2.091 3.256 4.669 3.256s4.668-1.451 4.668-3.256c0-.114-.01-.238-.029-.353.401-.181.688-.592.688-1.069 0-.65-.525-1.165-1.165-1.165" />
									</svg>
								</span>
								<span class="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#5f6368] transition-colors group-hover:text-[#202124] dark:text-slate-400 dark:group-hover:text-slate-100">{{ link.label }}</span>
							</a>
						</div>
					</div>

					<div class="flex flex-col items-start gap-3 rounded-[12px] border border-[#e7edf6] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/60">
						<div>
							<p class="text-sm font-semibold text-[#202124] dark:text-slate-100">{{ t('profile.openSource') }}</p>
							<p class="mt-1 text-xs text-[#5f6368] dark:text-slate-400">{{ t('profile.madeWith') }}</p>
						</div>
						<a href="https://github.com/dimartarmizi/OmniCloud" target="_blank" rel="noreferrer" class="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(26,115,232,0.24)] transition hover:bg-[#1765cc] sm:w-auto dark:bg-[#3b82f6] dark:hover:bg-[#2563eb]">
							<span>{{ t('profile.githubLink') }}</span>
							<IconExternalLink :size="16" :stroke="2" />
						</a>
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>