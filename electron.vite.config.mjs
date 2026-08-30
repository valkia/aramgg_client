import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const OFFICIAL_DISTRIBUTION_CHANNEL = 'official'
const PRODUCTION_MATCH_HISTORY_UPLOAD_ORIGIN = 'https://aramgg.com'
const DEFAULT_MATCH_HISTORY_UPLOAD_ORIGIN = 'http://127.0.0.1:8787'

function resolveMatchHistoryBuildConfig() {
  const distributionChannel = String(
    process.env.ARAMGG_DISTRIBUTION_CHANNEL || 'local'
  ).trim().toLowerCase()
  const rawUploadOrigin = String(
    process.env.ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN || DEFAULT_MATCH_HISTORY_UPLOAD_ORIGIN
  ).trim()
  const uploadUrl = new URL(rawUploadOrigin)
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(uploadUrl.hostname)

  if (uploadUrl.protocol !== 'https:' && !(uploadUrl.protocol === 'http:' && isLocalhost)) {
    throw new Error(
      'ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN must use HTTPS, except for localhost development origins'
    )
  }

  if (
    uploadUrl.origin === PRODUCTION_MATCH_HISTORY_UPLOAD_ORIGIN &&
    distributionChannel !== OFFICIAL_DISTRIBUTION_CHANNEL
  ) {
    throw new Error(
      'Production match-history upload origin requires ARAMGG_DISTRIBUTION_CHANNEL=official'
    )
  }

  return {
    distributionChannel,
    uploadOrigin: uploadUrl.origin,
  }
}

const matchHistoryBuildConfig = resolveMatchHistoryBuildConfig()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    envPrefix: ['VITE_', 'ARAMGG_'],
    define: {
      'import.meta.env.ARAMGG_DISTRIBUTION_CHANNEL': JSON.stringify(
        matchHistoryBuildConfig.distributionChannel
      ),
      'import.meta.env.ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN': JSON.stringify(
        matchHistoryBuildConfig.uploadOrigin
      ),
    },
    build: {
      target: 'node24',
      sourcemap: false,
      lib: {
        entry: 'src/main/main.ts',
        formats: ['es']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'main.js'
        },
        external: ['electron', 'electron-store', 'axios', 'fs', 'path', 'https']
      },
      outDir: 'dist-electron',
      emptyOutDir: true
    },
    resolve: {
      // 添加 TypeScript 支持
      extensions: ['.ts', '.js', '.mjs', '.json']
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node24',
      sourcemap: false,
      lib: {
        entry: 'src/preload/preload.ts',
        formats: ['cjs']
      },
      rollupOptions: {
        output: {
          entryFileNames: 'preload.cjs'
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
      sourcemap: false,
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
      headers: {
        'Content-Security-Policy': "frame-ancestors 'none'"
      },
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
    plugins: [vue(), tailwindcss()]
  }
})
