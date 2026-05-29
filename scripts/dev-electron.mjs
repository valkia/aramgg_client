import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const ELECTRON_VITE_BIN = path.join(ROOT_DIR, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

const env = { ...process.env }
if (env.ELECTRON_RUN_AS_NODE) {
  delete env.ELECTRON_RUN_AS_NODE
  console.warn('Removed ELECTRON_RUN_AS_NODE from dev environment before starting Electron.')
}

const child = spawn(process.execPath, [ELECTRON_VITE_BIN, 'dev', ...process.argv.slice(2)], {
  cwd: ROOT_DIR,
  env,
  stdio: 'inherit',
  windowsHide: false,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
