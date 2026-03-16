import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.yarn/**', '*.d.ts']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' }
      ]
    }
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['packages/*/src/services/**/*.ts', 'packages/*/src/types/**/*.ts', 'packages/*/src/interfaces/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-async-promise-executor': 'off',
      'no-useless-catch': 'off',
      'no-empty': 'off',
      'no-case-declarations': 'off',
      'preserve-caught-error': 'off'
    }
  },
  eslintConfigPrettier
);
