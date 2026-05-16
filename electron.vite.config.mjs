import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// Plugin to handle Node.js built-in modules
const nodeBuiltinsPlugin = () => ({
  name: 'node-builtins',
  resolveId(id) {
    const builtins = ['fs', 'path', 'os', 'crypto', 'stream', 'util', 'events', 'buffer']
    if (builtins.includes(id)) {
      return { id, external: true }
    }
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node18',
      lib: {
        entry: 'src/main/main.js',
        formats: ['es']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'main.js'
        },
        external: ['electron', 'electron-store', 'axios', 'fs', 'path', 'https']
      },
      outDir: 'dist-electron',
      emptyOutDir: false
    },
    resolve: {
      // 添加 TypeScript 支持
      extensions: ['.ts', '.js', '.mjs', '.json']
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node18',
      lib: {
        entry: 'src/preload/preload.js',
        formats: ['es']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'preload.mjs'
        }
      },
      outDir: 'dist-electron',
      emptyOutDir: false
    }
  },
  renderer: {
    root: 'src/renderer',
    publicDir: path.resolve(import.meta.dirname || process.cwd(), 'public'),
    build: {
      outDir: path.resolve(import.meta.dirname || process.cwd(), 'dist'),
      rollupOptions: {
        input: {
          index: path.resolve(import.meta.dirname || process.cwd(), 'src/renderer/index.html')
        }
      },
      commonjsOptions: {
        transformMixedEsModules: true
      }
    },
    server: {
      port: 5173,
      strictPort: false,
      fs: {
        strict: false
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || process.cwd(), 'src/renderer'),
        'src': path.resolve(import.meta.dirname || process.cwd(), 'src/renderer')
      },
      // 添加 TypeScript 支持
      extensions: ['.ts', '.js', '.mjs', '.vue', '.json']
    },
    optimizeDeps: {
      exclude: ['electron', 'electron-store', 'electron-log', 'electron-is-dev', 'fs-extra', 'cheerio']
    },
    plugins: [vue(), nodeBuiltinsPlugin()]
  }
})
