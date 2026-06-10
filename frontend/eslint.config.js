// Flat config — ESLint >= 9.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.desloppify/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        window:    'readonly',
        document:  'readonly',
        navigator: 'readonly',
        console:   'readonly',
        fetch:     'readonly',
        localStorage:   'readonly',
        sessionStorage: 'readonly',
        setTimeout:     'readonly',
        clearTimeout:   'readonly',
        setInterval:    'readonly',
        clearInterval: 'readonly',
        URL:           'readonly',
        AbortController: 'readonly',
        DOMException:    'readonly',
      },
    },
    plugins: {
      'react-hooks':   reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // null: 'ignore' — `x != null` is the intentional null-or-undefined idiom.
      'eqeqeq':                            ['error', 'always', { null: 'ignore' }],
      // Empty catch = deliberate "best effort, ignore failure".
      'no-empty':                          ['error', { allowEmptyCatch: true }],
      'no-unused-vars':                    'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      ...reactHooks.configs.recommended.rules,
      // Off: flags the standard "context + hook in one file" pattern used
      // throughout (AuthContext/useAuth etc.). The only cost of mixing
      // exports is a full-page reload during dev HMR on those files; the
      // proper fix is file splits, which we'll do when touching those files.
      'react-refresh/only-export-components': 'off',
    },
  },
)
