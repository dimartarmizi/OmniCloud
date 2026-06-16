import { defineStore } from 'pinia';
import { api } from '../services/api';

export const useAccountManagementStore = defineStore('accountManagement', {
	state: () => ({
		accounts: [],
		isLoading: false,
		isDisconnectingId: '',
		error: null,
	}),
	getters: {
		activeAccounts: (state) => state.accounts.filter((account) => account.status === 'active'),
		hasActiveAccount() {
			return this.activeAccounts.length > 0;
		},
	},
	actions: {
		async loadAccounts() {
			this.isLoading = true;
			this.error = null;
			try {
				const { data } = await api.listAccounts();
				this.accounts = data;
			} catch (error) {
				this.error = error.message;
			} finally {
				this.isLoading = false;
			}
		},
		async disconnectAccount(accountId) {
			this.isDisconnectingId = accountId;
			this.error = null;
			try {
				await api.disconnectAccount(accountId);
				this.accounts = this.accounts.filter((account) => account.id !== accountId);
			} catch (error) {
				this.error = error.message;
				throw error;
			} finally {
				this.isDisconnectingId = '';
			}
		},
	},
});
