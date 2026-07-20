import { createRouter, createWebHistory } from 'vue-router';
import MyDriveView from '../views/MyDriveView.vue';
import RecentView from '../views/RecentView.vue';
import SharedWithMeView from '../views/SharedWithMeView.vue';
import StarredView from '../views/StarredView.vue';
import QuotaView from '../views/QuotaView.vue';
import LoginView from '../views/auth/LoginView.vue';
import RegisterView from '../views/auth/RegisterView.vue';
import { useAuthStore } from '../stores/auth';

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
			redirect: '/my-drive',
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
	],
});

router.beforeEach(async (to) => {
	const authStore = useAuthStore();
	await authStore.bootstrap();

	if (!authStore.requiresAuth) {
		if (to.meta.public) {
			return { path: '/my-drive' };
		}
		return true;
	}

	if (to.meta.public) {
		return authStore.authenticated ? { path: '/my-drive' } : true;
	}

	if (!authStore.authenticated) {
		return { path: '/login', query: to.fullPath === '/my-drive' ? {} : { redirect: to.fullPath } };
	}

	return true;
});

export default router;
