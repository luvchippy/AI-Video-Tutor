import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/.output/**', '**/.wxt/**', '**/node_modules/**', '**/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // WXT auto-imported globals (browser, defineBackground, ...)
        browser: 'readonly',
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        defineUnlistedScript: 'readonly',
        defineWxtPlugin: 'readonly',
        ContentScriptContext: 'readonly',
        MatchPattern: 'readonly',
        createShadowRootUi: 'readonly',
        createIntegratedUi: 'readonly',
        createIframeUi: 'readonly',
        injectScript: 'readonly',
        storage: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off', // TS + WXT globals handle this
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
