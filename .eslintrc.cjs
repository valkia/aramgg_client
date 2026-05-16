const vue = require('eslint-plugin-vue')

module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
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
