import { defineStore } from 'pinia';
import { api } from '../services/api';

export const useVaultStore = defineStore('vault', {
	state: () => ({
		status: 'loading', // 'loading' | 'none' | 'locked' | 'unlocked'
		words: null, // 12-word recovery phrase — shown exactly once at setup, then cleared
		files: [],
		isLoading: false,
		error: '',
	}),
	getters: {
		isUnlocked: (state) => state.status === 'unlocked',
	},
	actions: {
		async loadStatus() {
			try {
				const { data } = await api.getVaultStatus();
				this.status = data.has_vault ? (data.unlocked ? 'unlocked' : 'locked') : 'none';
			} catch (error) {
				this.error = error.message;
			}
			return this.status;
		},
		async setup(pin) {
			this.isLoading = true;
			this.error = '';
			try {
				const { data } = await api.setupVault(pin);
				this.words = String(data.words || '').split(' ').filter(Boolean);
				this.status = 'unlocked';
				return this.words;
			} catch (error) {
				this.error = error.message;
				throw error;
			} finally {
				this.isLoading = false;
			}
		},
		confirmWords() {
			this.words = null;
		},
		async unlock(pin) {
			this.isLoading = true;
			this.error = '';
			try {
				await api.unlockVault(pin);
				this.status = 'unlocked';
			} catch (error) {
				this.error = error.message;
				throw error;
			} finally {
				this.isLoading = false;
			}
		},
		async resetPin(words, newPin) {
			this.isLoading = true;
			this.error = '';
			try {
				await api.resetVaultPin(words, newPin);
				this.status = 'unlocked';
			} catch (error) {
				this.error = error.message;
				throw error;
			} finally {
				this.isLoading = false;
			}
		},
		async lock() {
			try {
				await api.lockVault();
			} catch {
				// even if the request fails, re-lock locally — the server TTL will catch up
			}
			this.status = 'locked';
			this.files = [];
		},
		async loadHiddenFiles() {
			if (this.status !== 'unlocked') return [];
			this.isLoading = true;
			this.error = '';
			try {
				const { data } = await api.listHiddenFiles();
				this.files = data || [];
				return this.files;
			} catch (error) {
				this.error = error.message;
				throw error;
			} finally {
				this.isLoading = false;
			}
		},
		// A 403 VAULT_LOCKED came back on some hidden route — drop back to the unlock screen.
		markLocked() {
			this.status = 'locked';
			this.files = [];
		},
	},
});
