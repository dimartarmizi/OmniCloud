import { reactive, readonly } from 'vue';

/**
 * Promise-based dialog service backing a single global modal (AppDialog.vue,
 * mounted once in App.vue). Replaces the unstyled, blocking, non-i18n
 * `window.prompt`/`window.confirm` while keeping call sites simple: callers just
 * `await confirmDialog(...)` / `await promptDialog(...)` exactly where they used
 * the native primitives.
 *
 * Only one dialog can be open at a time; opening a new one resolves any pending
 * dialog as cancelled first, mirroring native behavior closely enough for the
 * sequential flows in this app.
 */
const state = reactive({
	open: false,
	type: 'confirm', // 'confirm' | 'prompt'
	title: '',
	message: '',
	confirmLabel: '',
	cancelLabel: '',
	destructive: false,
	inputValue: '',
	inputPlaceholder: '',
});

let resolver = null;

function settle(result) {
	const resolve = resolver;
	resolver = null;
	state.open = false;
	if (resolve) resolve(result);
}

function openDialog(config) {
	// Resolve any in-flight dialog as a cancel before showing the next one.
	if (resolver) settle(state.type === 'prompt' ? null : false);

	state.type = config.type;
	state.title = config.title || '';
	state.message = config.message || '';
	state.confirmLabel = config.confirmLabel || '';
	state.cancelLabel = config.cancelLabel || '';
	state.destructive = Boolean(config.destructive);
	state.inputValue = config.defaultValue || '';
	state.inputPlaceholder = config.placeholder || '';
	state.open = true;

	return new Promise((resolve) => {
		resolver = resolve;
	});
}

/**
 * Show a confirmation dialog. Resolves to `true` (confirmed) or `false`.
 */
export function confirmDialog(options = {}) {
	return openDialog({ ...options, type: 'confirm' });
}

/**
 * Show a text-input dialog. Resolves to the trimmed string on confirm, or
 * `null` if cancelled (matching `window.prompt`'s null-on-cancel contract).
 */
export function promptDialog(options = {}) {
	return openDialog({ ...options, type: 'prompt' });
}

export function useDialogState() {
	return {
		state: readonly(state),
		confirm() {
			if (state.type === 'prompt') {
				const value = String(state.inputValue || '').trim();
				settle(value ? value : null);
				return;
			}
			settle(true);
		},
		cancel() {
			settle(state.type === 'prompt' ? null : false);
		},
		setInputValue(value) {
			state.inputValue = value;
		},
	};
}
