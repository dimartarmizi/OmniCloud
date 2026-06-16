<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX } from '@tabler/icons-vue';
import { useDialogState } from '../composables/useDialog.js';
import { useFocusTrap } from '../composables/useFocusTrap.js';

const { t } = useI18n();
const { state, confirm, cancel, setInputValue } = useDialogState();

const inputRef = ref(null);
const dialogRef = ref(null);
const isOpen = computed(() => state.open);

// Trap Tab focus inside the dialog while open and restore focus to the trigger
// on close. For prompts, focus the text input first; otherwise the trap focuses
// the first focusable control.
useFocusTrap(isOpen, dialogRef, {
	initialFocus: () => (state.type === 'prompt' ? inputRef.value : null),
});

watch(
	() => state.open,
	async (open) => {
		if (!open) return;
		await nextTick();
		if (state.type === 'prompt') {
			inputRef.value?.select?.();
		}
	},
);

function onSubmit() {
	confirm();
}
</script>

<template>
	<Transition
		enter-active-class="transition duration-150 ease-out"
		enter-from-class="opacity-0"
		enter-to-class="opacity-100"
		leave-active-class="transition duration-100 ease-in"
		leave-from-class="opacity-100"
		leave-to-class="opacity-0"
	>
		<div
			v-if="state.open"
			class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="app-dialog-title"
			@click.self="cancel"
			@keydown.esc.prevent="cancel"
		>
			<form
				ref="dialogRef"
				class="w-full max-w-md rounded-[14px] border border-[#e0e3e7] bg-white p-6 text-[#202124] shadow-[0_24px_60px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
				@submit.prevent="onSubmit"
			>
				<div class="mb-4 flex items-start justify-between gap-4">
					<h3 id="app-dialog-title" class="text-lg font-semibold">
						{{ state.title }}
					</h3>
					<button
						type="button"
						class="grid size-9 place-items-center rounded-full text-[#5f6368] hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/8"
						:aria-label="t('common.close')"
						@click="cancel"
					>
						<IconX :size="18" :stroke="2" />
					</button>
				</div>

				<p v-if="state.message" class="mb-4 text-sm leading-6 text-[#5f6368] dark:text-slate-400">
					{{ state.message }}
				</p>

				<label v-if="state.type === 'prompt'" class="block">
					<input
						ref="inputRef"
						:value="state.inputValue"
						type="text"
						:placeholder="state.inputPlaceholder"
						class="h-11 w-full rounded-2xl border border-[#dadce0] bg-white px-4 outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500"
						@input="setInputValue($event.target.value)"
					/>
				</label>

				<div class="mt-6 flex items-center justify-end gap-3">
					<button
						type="button"
						class="h-10 rounded-full px-4 text-[#5f6368] hover:bg-[#f1f3f4] dark:text-slate-300 dark:hover:bg-slate-800"
						@click="cancel"
					>
						{{ state.cancelLabel || t('common.cancel') }}
					</button>
					<button
						type="submit"
						class="h-10 rounded-full px-5 text-white"
						:class="
							state.destructive ? 'bg-[#c5221f] hover:bg-[#a50e0b]' : 'bg-[#1a73e8] hover:bg-[#1765cc]'
						"
					>
						{{ state.confirmLabel || t('common.confirm') }}
					</button>
				</div>
			</form>
		</div>
	</Transition>
</template>
