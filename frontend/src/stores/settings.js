import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../services/api';
import { setLocale, getLocale, SUPPORTED_LOCALES } from '../i18n';

export const useSettingsStore = defineStore('settings', () => {
	const language = ref(getLocale());
	const replicationFactor = ref(1);
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
			if (data?.replication_factor) {
				replicationFactor.value = Math.min(3, Math.max(1, Number(data.replication_factor) || 1));
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

		const previousLanguage = language.value;
		language.value = newLanguage;
		setLocale(newLanguage);

		try {
			await api.updateSettings({ language: newLanguage });
		} catch (err) {
			console.warn('Could not save language to backend, saved to local storage only:', err.message);
		}
	}

	async function updateReplicationFactor(newFactor) {
		const parsed = Math.min(3, Math.max(1, Number(newFactor) || 1));
		replicationFactor.value = parsed;
		try {
			await api.updateSettings({ replication_factor: String(parsed) });
		} catch (err) {
			console.warn('Could not save replication factor to backend:', err.message);
		}
	}

	return {
		language,
		replicationFactor,
		isLoading,
		error,
		isInitialized,
		loadSettings,
		updateLanguage,
		updateReplicationFactor,
	};
});
