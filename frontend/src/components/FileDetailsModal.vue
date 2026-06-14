<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX, IconShieldCheck, IconShieldOff, IconShieldExclamation } from '@tabler/icons-vue';
import {
	formatBytes,
	formatDate,
	getCreatedTime,
	getModifiedTime,
	providerIcon,
	providerLabel as defaultProviderLabel,
} from '../composables/useFormatFile.js';
import { useSettingsStore } from '../stores/settings';

const props = defineProps({
	file: { type: Object, default: null },
	isOpen: { type: Boolean, default: false },
	isLoading: { type: Boolean, default: false },
	locationFallback: { type: String, default: '' },
	providerLabelFn: { type: Function, default: null },
	isFolder: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const { t } = useI18n();

const isVisible = computed(() => Boolean(props.isOpen && props.file));
const fileName = computed(() => props.file?.name || props.file?.file_name || props.file?.display_name || '—');
const mimeType = computed(() => props.file?.mime_type || props.file?.mimeType || '—');
const remoteId = computed(() => props.file?.remote_file_id || props.file?.id || '—');
const location = computed(() => props.file?.virtual_path || props.locationFallback || '—');
const title = computed(() => (props.isFolder ? `${t('drive.details')} ${t('drive.folder')}` : t('drive.details')));

// Parse all owners (supports Cloud RAID multi-account)
const owners = computed(() => {
	const file = props.file;
	if (!file) return [];
	const fn = typeof props.providerLabelFn === 'function' ? props.providerLabelFn : defaultProviderLabel;
	const emails = file.email ? file.email.split(',').map(s => s.trim()) : [];
	const providersList = file.providers ? file.providers.split(',').map(s => s.trim()) : [];
	const result = [];
	if (emails.length === 0) {
		if (file.email || file.provider) {
			result.push({ email: file.email || file.owner_email || '—', provider: file.provider || 'unknown', providerName: fn(file.provider) || file.provider || '—' });
		}
	} else {
		for (let i = 0; i < emails.length; i++) {
			const prov = providersList[i] || file.provider || 'unknown';
			result.push({ email: emails[i], provider: prov, providerName: fn(prov) || prov });
		}
	}
	// Fallback when nothing parsed
	if (result.length === 0 && (file.owner_email || file.email)) {
		const prov = file.provider || 'unknown';
		result.push({ email: file.owner_email || file.email || '—', provider: prov, providerName: fn(prov) || prov });
	}
	const seen = new Set();
	return result.filter(o => {
		const key = `${o.email}::${o.provider}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
});

const isRaid = computed(() => owners.value.length > 1);

const settingsStore = useSettingsStore();

const protectionStatus = computed(() => {
	const status = props.file?.replication_status;
	if (!status || props.file?.is_folder || settingsStore.replicationFactor <= 1) return null;
	const partsCount = props.file?.parts_count || 0;
	if (status === 'fully_protected') return { label: `Fully Protected (${partsCount}/${settingsStore.replicationFactor} replicas)`, color: 'emerald', icon: 'check' };
	if (status === 'partially_protected') return { label: `Partially Protected (${partsCount}/${settingsStore.replicationFactor} replicas)`, color: 'amber', icon: 'exclamation' };
	return { label: `Not Protected — waiting for replication`, color: 'slate', icon: 'off' };
});

function onBackdropClick() {
	emit('close');
}
</script>

<template>
	<div v-if="isVisible" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4" @click="onBackdropClick">
		<div class="w-full max-w-lg rounded-[28px] bg-white p-6 text-[#202124] shadow-[0_24px_60px_rgba(32,33,36,0.28)] dark:bg-slate-800 dark:text-slate-100" @click.stop>
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-xl font-semibold">{{ title }}</h3>
					<p class="mt-1 text-sm text-[#5f6368] dark:text-slate-400">{{ t('drive.metadataDescription') }}</p>
				</div>
				<button type="button" class="grid size-9 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8" :title="t('common.close')" @click="emit('close')">
					<IconX :size="18" :stroke="2" />
				</button>
			</div>

			<div v-if="props.isLoading" class="mt-6 text-sm text-[#5f6368] dark:text-slate-400">
				{{ t('common.loading') }}
			</div>

			<dl v-else class="mt-6 grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 text-sm">
				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('common.name') }}</dt>
				<dd>{{ fileName }}</dd>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.type') }}</dt>
				<dd>{{ mimeType }}</dd>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.size') }}</dt>
				<dd>
					<span v-if="props.isFolder">—</span>
					<span v-else>{{ formatBytes(props.file?.size) }}</span>
				</dd>

				<!-- Protection Status (RAID) -->
				<template v-if="protectionStatus">
					<dt class="text-[#5f6368] dark:text-slate-400">Protection</dt>
					<dd class="flex items-center gap-1.5">
						<IconShieldCheck v-if="protectionStatus.icon === 'check'" :size="14" :stroke="2.2" class="shrink-0 text-emerald-600 dark:text-emerald-400" />
						<IconShieldExclamation v-else-if="protectionStatus.icon === 'exclamation'" :size="14" :stroke="2.2" class="shrink-0 text-amber-500 dark:text-amber-400" />
						<IconShieldOff v-else :size="14" :stroke="2" class="shrink-0 text-slate-400 dark:text-slate-500" />
						<span :class="protectionStatus.color === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : protectionStatus.color === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'">{{ protectionStatus.label }}</span>
					</dd>
				</template>

				<!-- Owner(s) — single row for normal files, card list for Cloud RAID -->
				<template v-if="!isRaid">
					<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.owner') }}</dt>
					<dd class="flex items-center gap-2">
						<img v-if="owners[0] && providerIcon(owners[0].provider)" :src="providerIcon(owners[0].provider)" :alt="owners[0].providerName" class="size-4 object-contain shrink-0" />
						<span>{{ owners[0]?.email || '—' }}</span>
					</dd>
					<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.provider') || 'Provider' }}</dt>
					<dd>{{ owners[0]?.providerName || '—' }}</dd>
				</template>

				<template v-else>
					<dt class="col-span-2 -mx-1">
						<!-- Cloud RAID header badge -->
						<div class="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 dark:bg-indigo-950/30">
							<span class="inline-flex size-5 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-400">
								<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
							</span>
							<span class="text-xs font-bold text-indigo-700 dark:text-indigo-300">Cloud RAID Storage</span>
							<span class="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">{{ owners.length }} Accounts</span>
						</div>
					</dt>
					<dd class="col-span-2 -mx-1 space-y-1.5">
						<div
							v-for="(owner, idx) in owners"
							:key="idx"
							class="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-700/40"
						>
							<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-slate-200/50 dark:border-slate-600 dark:bg-slate-800">
								<img v-if="providerIcon(owner.provider)" :src="providerIcon(owner.provider)" :alt="owner.providerName" class="size-4.5 object-contain" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{{ owner.email }}</p>
								<p class="text-xs text-slate-400 dark:text-slate-500 capitalize">{{ owner.providerName }}</p>
							</div>
							<span
								class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase"
								:class="idx === 0 ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'"
							>
								{{ idx === 0 ? 'Primary' : 'Replica' }}
							</span>
						</div>
					</dd>
				</template>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.created') }}</dt>
				<dd>{{ formatDate(getCreatedTime(props.file)) }}</dd>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.modified') }}</dt>
				<dd>{{ formatDate(getModifiedTime(props.file)) }}</dd>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.location') }}</dt>
				<dd class="break-all">{{ location }}</dd>

				<dt class="text-[#5f6368] dark:text-slate-400">{{ t('drive.remoteId') || 'Remote ID' }}</dt>
				<dd class="break-all">{{ remoteId }}</dd>
			</dl>
		</div>
	</div>
</template>
