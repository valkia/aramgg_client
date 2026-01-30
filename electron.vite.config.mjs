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
        entry: 'electron/main.js',
        formats: ['cjs']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'main.js'
        }
      },
      outDir: 'dist-electron'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node18',
      lib: {
        entry: 'electron/preload.js',
        formats: ['cjs']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'preload.js'
        }
      },
      outDir: 'dist-electron'
    }
  },
  renderer: {
    root: 'src',
    publicDir: path.resolve(import.meta.dirname || process.cwd(), 'public'),
    build: {
      outDir: path.resolve(import.meta.dirname || process.cwd(), 'dist'),
      rollupOptions: {
        input: {
          index: path.resolve(import.meta.dirname || process.cwd(), 'src/index.html')
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
        '@': path.resolve(import.meta.dirname || process.cwd(), 'src'),
        'src': path.resolve(import.meta.dirname || process.cwd(), 'src/src')
      }
    },
    optimizeDeps: {
      exclude: ['electron', 'electron-store', 'electron-log', 'electron-is-dev', 'fs-extra', 'cheerio']
    },
    plugins: [vue(), nodeBuiltinsPlugin()]
  }
})
