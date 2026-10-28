import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.tsc/**', '**/node_modules/**', 'apps/api/src/generated/**', 'packages/api-client/src/schema.ts', 'apps/api/openapi.json', 'storage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // Tests poke at Express internals and use loose typing on purpose.
    files: ['apps/api/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  { files: ['apps/api/src/types/*.d.ts'], rules: { '@typescript-eslint/no-namespace': 'off' } },
);
