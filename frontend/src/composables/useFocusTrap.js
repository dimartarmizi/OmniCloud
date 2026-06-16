import { nextTick, watch } from 'vue';

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container) {
	if (!container) return [];
	return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
		(el) => el.offsetParent !== null || el === document.activeElement,
	);
}

/**
 * Trap keyboard focus inside `containerRef` while `isOpen` is true, and restore
 * focus to whatever was focused before opening once it closes.
 *
 * @param {import('vue').Ref<boolean>} isOpen
 * @param {import('vue').Ref<HTMLElement|null>} containerRef
 * @param {() => HTMLElement | null} [options.initialFocus] Optional element to focus on open.
 */
export function useFocusTrap(isOpen, containerRef, { initialFocus } = {}) {
	let previouslyFocused = null;

	function handleKeydown(event) {
		if (event.key !== 'Tab') return;
		const focusable = getFocusable(containerRef.value);
		if (!focusable.length) {
			event.preventDefault();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;

		if (event.shiftKey) {
			if (active === first || !containerRef.value?.contains(active)) {
				event.preventDefault();
				last.focus();
			}
		} else if (active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	watch(
		isOpen,
		async (open) => {
			if (open) {
				previouslyFocused = document.activeElement;
				document.addEventListener('keydown', handleKeydown, true);
				await nextTick();
				const target = initialFocus?.() || getFocusable(containerRef.value)[0];
				target?.focus?.();
			} else {
				document.removeEventListener('keydown', handleKeydown, true);
				// Return focus to the trigger element so keyboard users land back
				// where they were before the dialog opened.
				if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
					previouslyFocused.focus();
				}
				previouslyFocused = null;
			}
		},
		{ immediate: true },
	);
}
