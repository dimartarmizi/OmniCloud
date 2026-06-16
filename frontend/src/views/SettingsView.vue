<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { IconLock, IconTrash, IconUserCircle } from '@tabler/icons-vue';
import DriveShell from '../components/DriveShell.vue';
import { useAuthStore } from '../stores/auth';
import { confirmDialog } from '../composables/useDialog.js';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const { user, isHosted } = storeToRefs(authStore);

const activeTab = ref('account');

// --- Change password form state ---
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passwordError = ref('');
const passwordSuccess = ref('');
const passwordSubmitting = ref(false);

const passwordMismatch = computed(() => Boolean(confirmPassword.value) && newPassword.value !== confirmPassword.value);
const canSubmitPassword = computed(
	() =>
		!passwordSubmitting.value &&
		currentPassword.value.length > 0 &&
		newPassword.value.length >= 8 &&
		newPassword.value === confirmPassword.value,
);

async function submitPasswordChange() {
	passwordError.value = '';
	passwordSuccess.value = '';
	if (!canSubmitPassword.value) return;

	passwordSubmitting.value = true;
	try {
		const ok = await authStore.changePassword({
			currentPassword: currentPassword.value,
			newPassword: newPassword.value,
		});
		if (ok) {
			passwordSuccess.value = t('settings.passwordChanged');
			currentPassword.value = '';
			newPassword.value = '';
			confirmPassword.value = '';
		} else {
			passwordError.value = authStore.error || t('settings.passwordChangeFailed');
		}
	} finally {
		passwordSubmitting.value = false;
	}
}

// --- Delete account state ---
const deletePassword = ref('');
const deleteError = ref('');
const deleteSubmitting = ref(false);

async function submitDeleteAccount() {
	deleteError.value = '';
	if (!deletePassword.value) {
		deleteError.value = t('settings.deletePasswordRequired');
		return;
	}

	const confirmed = await confirmDialog({
		title: t('settings.deleteAccount'),
		message: t('settings.deleteAccountConfirm'),
		confirmLabel: t('settings.deleteAccount'),
		destructive: true,
	});
	if (!confirmed) return;

	deleteSubmitting.value = true;
	try {
		const ok = await authStore.deleteAccount({ password: deletePassword.value });
		if (ok) {
			router.replace('/login');
		} else {
			deleteError.value = authStore.error || t('settings.deleteAccountFailed');
		}
	} finally {
		deleteSubmitting.value = false;
	}
}
</script>

<template>
	<DriveShell current-section="storage">
		<div
			class="min-h-[calc(100vh-84px)] rounded-[12px] bg-white px-4 py-6 text-[#202124] dark:bg-slate-800 dark:text-slate-100 sm:px-6"
		>
			<h1 class="m-0 mb-6 text-2xl font-normal">{{ t('settings.title') }}</h1>

			<div class="mb-6 flex gap-2 border-b border-[#e8eaed] dark:border-slate-700">
				<button
					type="button"
					class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition"
					:class="
						activeTab === 'account'
							? 'border-[#1a73e8] text-[#1a73e8]'
							: 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-slate-400 dark:hover:text-slate-200'
					"
					@click="activeTab = 'account'"
				>
					<IconUserCircle :size="18" :stroke="2" />
					<span>{{ t('settings.account') }}</span>
				</button>
			</div>

			<div
				v-if="!isHosted"
				class="rounded-2xl border border-[#e0e3e7] bg-[#f8fafd] px-5 py-8 text-center text-sm text-[#5f6368] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
			>
				{{ t('settings.localModeNotice') }}
			</div>

			<div v-else class="max-w-xl space-y-8">
				<section>
					<p class="mb-1 text-sm text-[#5f6368] dark:text-slate-400">{{ t('settings.signedInAs') }}</p>
					<p class="text-base font-medium">{{ user?.email || '—' }}</p>
				</section>

				<section class="rounded-2xl border border-[#e0e3e7] p-5 dark:border-slate-700">
					<h2 class="mb-4 flex items-center gap-2 text-lg font-medium">
						<IconLock :size="20" :stroke="2" />
						{{ t('settings.changePassword') }}
					</h2>

					<form class="space-y-4" @submit.prevent="submitPasswordChange">
						<div>
							<label for="current-password" class="mb-1 block text-sm font-medium">{{
								t('settings.currentPassword')
							}}</label>
							<input
								id="current-password"
								v-model="currentPassword"
								type="password"
								autocomplete="current-password"
								class="w-full rounded-xl border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900"
							/>
						</div>
						<div>
							<label for="new-password" class="mb-1 block text-sm font-medium">{{
								t('settings.newPassword')
							}}</label>
							<input
								id="new-password"
								v-model="newPassword"
								type="password"
								autocomplete="new-password"
								class="w-full rounded-xl border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900"
							/>
							<p class="mt-1 text-xs text-[#5f6368] dark:text-slate-400">
								{{ t('settings.passwordHint') }}
							</p>
						</div>
						<div>
							<label for="confirm-password" class="mb-1 block text-sm font-medium">{{
								t('settings.confirmPassword')
							}}</label>
							<input
								id="confirm-password"
								v-model="confirmPassword"
								type="password"
								autocomplete="new-password"
								class="w-full rounded-xl border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] dark:border-slate-600 dark:bg-slate-900"
							/>
							<p v-if="passwordMismatch" class="mt-1 text-xs text-[#c5221f] dark:text-red-300">
								{{ t('settings.passwordMismatch') }}
							</p>
						</div>

						<p
							v-if="passwordError"
							class="rounded-xl bg-[#fce8e6] px-3 py-2 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300"
						>
							{{ passwordError }}
						</p>
						<p
							v-if="passwordSuccess"
							class="rounded-xl bg-[#e6f4ea] px-3 py-2 text-sm text-[#137333] dark:bg-emerald-950/40 dark:text-emerald-300"
						>
							{{ passwordSuccess }}
						</p>

						<button
							type="submit"
							class="rounded-full bg-[#1a73e8] px-5 py-2 text-sm font-medium text-white transition enabled:hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:opacity-50"
							:disabled="!canSubmitPassword"
						>
							{{ t('settings.updatePassword') }}
						</button>
					</form>
				</section>

				<section
					class="rounded-2xl border border-[#f3c2bf] bg-[#fef7f6] p-5 dark:border-red-900/50 dark:bg-red-950/20"
				>
					<h2 class="mb-2 flex items-center gap-2 text-lg font-medium text-[#c5221f] dark:text-red-300">
						<IconTrash :size="20" :stroke="2" />
						{{ t('settings.deleteAccount') }}
					</h2>
					<p class="mb-4 text-sm text-[#5f6368] dark:text-slate-400">
						{{ t('settings.deleteAccountWarning') }}
					</p>

					<form class="space-y-4" @submit.prevent="submitDeleteAccount">
						<div>
							<label for="delete-password" class="mb-1 block text-sm font-medium">{{
								t('settings.confirmWithPassword')
							}}</label>
							<input
								id="delete-password"
								v-model="deletePassword"
								type="password"
								autocomplete="current-password"
								class="w-full rounded-xl border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#c5221f] dark:border-slate-600 dark:bg-slate-900"
							/>
						</div>

						<p
							v-if="deleteError"
							class="rounded-xl bg-[#fce8e6] px-3 py-2 text-sm text-[#c5221f] dark:bg-red-950/40 dark:text-red-300"
						>
							{{ deleteError }}
						</p>

						<button
							type="submit"
							class="rounded-full bg-[#c5221f] px-5 py-2 text-sm font-medium text-white transition enabled:hover:bg-[#a50e0e] disabled:cursor-not-allowed disabled:opacity-50"
							:disabled="deleteSubmitting"
						>
							{{ t('settings.deleteAccount') }}
						</button>
					</form>
				</section>
			</div>
		</div>
	</DriveShell>
</template>
