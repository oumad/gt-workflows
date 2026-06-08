// Flat config — ESLint >= 9.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project:         './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Style-ish but bug-adjacent: catch the common foot-guns without forcing
      // a comment-paint-by-numbers pass.
      'eqeqeq':                              ['error', 'always'],
      'no-unused-vars':                      'off',
      '@typescript-eslint/no-unused-vars':   ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any':  'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises':  'error',
      '@typescript-eslint/require-await':        'warn',
      'no-console':                          'off',  // intentional structured logging
    },
  },
)
