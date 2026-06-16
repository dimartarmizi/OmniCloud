import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import { setUnauthorizedHandler } from './services/api';
import { useAuthStore } from './stores/auth';

const storedTheme = window.localStorage.getItem('omnicloud-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light');

document.documentElement.classList.toggle('dark', initialTheme === 'dark');

// Keep <html lang> in sync with the active UI locale, including on first paint.
// Screen readers and translation tools rely on this attribute, and the static
// lang="en" in index.html would otherwise mismatch an Indonesian-default UI.
function applyDocumentLang(locale) {
	document.documentElement.setAttribute('lang', locale);
}
applyDocumentLang(i18n.global.locale.value);
watch(i18n.global.locale, (locale) => applyDocumentLang(locale));

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(i18n);

// Centralized 401 handling: when any API call reports an expired/missing session
// in hosted mode, reset auth state and route to /login (preserving the intended
// destination), instead of letting each caller surface its own error banner.
setUnauthorizedHandler(() => {
	const authStore = useAuthStore(pinia);
	if (!authStore.requiresAuth) return;
	const wasAuthenticated = authStore.authenticated;
	authStore.handleUnauthorized();
	if (wasAuthenticated && router.currentRoute.value.name !== 'login') {
		const fullPath = router.currentRoute.value.fullPath;
		router.replace({ path: '/login', query: fullPath && fullPath !== '/' ? { redirect: fullPath } : {} });
	}
});

app.mount('#app');
