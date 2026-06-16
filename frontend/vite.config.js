import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
	plugins: [vue(), tailwindcss()],
	build: {
		rollupOptions: {
			output: {
				// Split large, rarely-changing vendor code out of the per-route
				// chunks so it is cached independently of app code: the Vue runtime
				// stack in one chunk and the icon set (which is large and used app-
				// wide) in another. Everything else stays route-split via the
				// dynamic imports in router/index.js.
				manualChunks(id) {
					if (!id.includes('node_modules')) return undefined;
					if (/[\\/]node_modules[\\/](vue|vue-router|pinia|@vue|vue-i18n|@intlify)[\\/]/.test(id)) {
						return 'framework';
					}
					if (/[\\/]node_modules[\\/]@tabler[\\/]/.test(id)) {
						return 'icons';
					}
					return undefined;
				},
			},
		},
	},
});
