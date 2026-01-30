import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

import path from 'path'

export default defineConfig({
  main: {
    build: {
      target: 'node18',
      lib: {
        entry: path.resolve(__dirname, 'electron/main.js'),
        formats: ['cjs']
      },
      outDir: 'dist-electron'
    },
    rollupOptions: {
      external: ['electron']
    }
  },
  preload: {
    build: {
      target: 'node18',
      lib: {
        entry: path.resolve(__dirname, 'electron/preload.js'),
        formats: ['cjs']
      },
      outDir: 'dist-electron'
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist',
      rollupOptions: {
        external: ['cheerio']
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    optimizeDeps: {
      exclude: ['cheerio']
    },
    plugins: [tailwindcss(), vue()]
  }
})