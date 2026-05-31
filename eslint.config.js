import js from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'

export default [
  {
    ignores: [
      'build/**',
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'tests/electron/**',
    ],
  },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['src/**/*.{js,vue}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'vue/comment-directive': 'error',
      'vue/jsx-uses-vars': 'error',
      'vue/multi-word-component-names': 'off',
      'no-console': 'off',
      'no-useless-assignment': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['src/main/image-analyzer.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
]
