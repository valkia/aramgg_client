const vue = require('eslint-plugin-vue')

module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  ignorePatterns: ['legacy/react/', 'tests/electron/'],
  plugins: ['vue'],
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  overrides: [
    {
      files: ['*.vue'],
      parser: 'vue-eslint-parser',
    },
    {
      files: ['src/main/image-analyzer.js'],
      rules: {
        'no-unused-vars': 'off',
      },
    },
  ],
  rules: {
    ...vue.configs.essential.rules,
    'vue/comment-directive': 'error',
    'vue/jsx-uses-vars': 'error',
    'vue/multi-word-component-names': 'off',
    'no-console': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
}
