// Flat config — ESLint >= 9.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // eslint.config.js + drizzle.config.ts are outside tsconfig's project —
    // the type-checked preset can't parse them, and they're config, not app.
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'drizzle/**', 'eslint.config.js', 'drizzle.config.ts'],
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
      // null: 'ignore' — `x != null` is the intentional null-or-undefined
      // idiom used throughout; forcing !== would change semantics.
      'eqeqeq':                              ['error', 'always', { null: 'ignore' }],
      // Empty catch = deliberate "best effort, ignore failure"; other empty
      // blocks still error.
      'no-empty':                            ['error', { allowEmptyCatch: true }],
      'no-unused-vars':                      'off',
      '@typescript-eslint/no-unused-vars':   ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any':  'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises':  'error',
      // Off: MCP tool handlers must be async to satisfy the SDK callback
      // type even when a particular handler awaits nothing — the rule only
      // produces noise here. Floating/misused-promises stay as the guards.
      '@typescript-eslint/require-await':        'off',
      'no-console':                          'off',  // intentional structured logging
    },
  },
)
