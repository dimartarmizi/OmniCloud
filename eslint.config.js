import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default [
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/*.db',
			'frontend/public/**',
			'backend/omnicloud.db*',
		],
	},
	js.configs.recommended,
	...pluginVue.configs['flat/recommended'],

	// Backend: Node ESM
	{
		files: ['backend/**/*.js'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: { ...globals.node },
		},
		rules: {
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'no-console': 'off',
		},
	},

	// Frontend: browser + Vue SFCs
	{
		files: ['frontend/**/*.{js,vue}'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: { ...globals.browser },
		},
		rules: {
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			// Single-word component file names (e.g. App.vue) are intentional here.
			'vue/multi-word-component-names': 'off',
		},
	},

	// Tests (Vitest)
	{
		files: ['**/*.{test,spec}.js'],
		plugins: { vitest },
		languageOptions: {
			globals: { ...globals.node, ...vitest.environments.env.globals },
		},
		rules: {
			...vitest.configs.recommended.rules,
		},
	},

	// Disable stylistic rules that conflict with Prettier (must be last).
	prettier,
];
