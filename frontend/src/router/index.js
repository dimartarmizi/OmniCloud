import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

// Lazy-load every view via dynamic import so the entry bundle no longer pulls in
// the heavy drive/quota pages when a user only needs the (public) login screen.
// Each view becomes its own code-split chunk, fetched on first navigation.
const HomeView = () => import('../views/HomeView.vue');
const MyDriveView = () => import('../views/MyDriveView.vue');
const RecentView = () => import('../views/RecentView.vue');
const SharedWithMeView = () => import('../views/SharedWithMeView.vue');
const StarredView = () => import('../views/StarredView.vue');
const QuotaView = () => import('../views/QuotaView.vue');
const SettingsView = () => import('../views/SettingsView.vue');
const LoginView = () => import('../views/auth/LoginView.vue');
const RegisterView = () => import('../views/auth/RegisterView.vue');

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/login',
			name: 'login',
			component: LoginView,
			meta: { public: true },
		},
		{
			path: '/register',
			name: 'register',
			component: RegisterView,
			meta: { public: true },
		},
		{
			path: '/',
			name: 'home',
			component: HomeView,
		},
		{
			path: '/my-drive',
			name: 'my-drive',
			component: MyDriveView,
		},
		{
			path: '/shared-with-me',
			name: 'shared-with-me',
			component: SharedWithMeView,
		},
		{
			path: '/recent',
			name: 'recent',
			component: RecentView,
		},
		{
			path: '/starred',
			name: 'starred',
			component: StarredView,
		},
		{
			path: '/quota',
			name: 'quota',
			component: QuotaView,
		},
		{
			path: '/settings',
			name: 'settings',
			component: SettingsView,
		},
	],
});

router.beforeEach(async (to) => {
	const authStore = useAuthStore();
	await authStore.bootstrap();

	if (!authStore.requiresAuth) {
		if (to.meta.public) {
			return { path: '/' };
		}
		return true;
	}

	if (to.meta.public) {
		return authStore.authenticated ? { path: '/' } : true;
	}

	if (!authStore.authenticated) {
		return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
	}

	return true;
});

export default router;
