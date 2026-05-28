import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const rootDir = import.meta.dirname || process.cwd()

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src/renderer'),
      src: path.resolve(rootDir, 'src/renderer'),
    },
    extensions: ['.ts', '.js', '.mjs', '.vue', '.json'],
  },
  test: {
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
})
