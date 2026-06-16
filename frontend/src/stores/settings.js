import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../services/api';
import { setLocale, getLocale, SUPPORTED_LOCALES } from '../i18n';

const SUPPORTED_THEMES = ['light', 'dark'];
const THEME_STORAGE_KEY = 'omnicloud-theme';

function applyThemeToDocument(theme) {
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useSettingsStore = defineStore('settings', () => {
	const language = ref(getLocale());
	const theme = ref(
		document.documentElement.classList.contains('dark') ? 'dark' : 'light',
	);
	const isLoading = ref(false);
	const error = ref('');
	const isInitialized = ref(false);

	async function loadSettings() {
		if (isInitialized.value) return;

		isLoading.value = true;
		error.value = '';

		try {
			const { data } = await api.getSettings();
			if (data?.language && SUPPORTED_LOCALES.includes(data.language)) {
				language.value = data.language;
				setLocale(data.language);
			}
			if (data?.theme && SUPPORTED_THEMES.includes(data.theme)) {
				theme.value = data.theme;
				applyThemeToDocument(data.theme);
				window.localStorage.setItem(THEME_STORAGE_KEY, data.theme);
			}
			isInitialized.value = true;
		} catch (err) {
			console.warn('Could not load settings from backend, using local storage:', err.message);
			isInitialized.value = true;
		} finally {
			isLoading.value = false;
		}
	}

	async function updateLanguage(newLanguage) {
		if (!SUPPORTED_LOCALES.includes(newLanguage)) return;

		language.value = newLanguage;
		setLocale(newLanguage);

		try {
			await api.updateSettings({ language: newLanguage });
		} catch (err) {
			console.warn('Could not save language to backend, saved to local storage only:', err.message);
		}
	}

	async function updateTheme(newTheme) {
		if (!SUPPORTED_THEMES.includes(newTheme)) return;

		theme.value = newTheme;
		applyThemeToDocument(newTheme);
		window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);

		try {
			await api.updateSettings({ theme: newTheme });
		} catch (err) {
			console.warn('Could not save theme to backend, saved to local storage only:', err.message);
		}
	}

	function toggleTheme() {
		return updateTheme(theme.value === 'dark' ? 'light' : 'dark');
	}

	return {
		language,
		theme,
		isLoading,
		error,
		isInitialized,
		loadSettings,
		updateLanguage,
		updateTheme,
		toggleTheme,
	};
});
