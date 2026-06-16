import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node environment is sufficient for the current backend-focused suite.
		environment: 'node',
		include: ['backend/**/*.{test,spec}.js', 'frontend/**/*.{test,spec}.js'],
		exclude: ['**/node_modules/**', '**/dist/**'],
	},
});
