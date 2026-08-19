import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist/**', 'dist-server/**', 'node_modules/**', 'railguard.db'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } }, globals: { console: 'readonly', process: 'readonly', crypto: 'readonly', atob: 'readonly', localStorage: 'readonly', fetch: 'readonly', FormData: 'readonly' } },
    rules: { 'no-unused-vars': 'off', 'no-undef': 'off' }
  }
]
