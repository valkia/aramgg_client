import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const ELECTRON_VITE_BIN = path.join(ROOT_DIR, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const ELECTRON_MODULE_DIR = path.join(ROOT_DIR, 'node_modules', 'electron')
const ELECTRON_PACKAGE_FILE = path.join(ELECTRON_MODULE_DIR, 'package.json')
const ELECTRON_VERSION_FILE = path.join(ELECTRON_MODULE_DIR, 'dist', 'version')

const env = { ...process.env }
if (env.ELECTRON_RUN_AS_NODE) {
  delete env.ELECTRON_RUN_AS_NODE
  console.warn('Removed ELECTRON_RUN_AS_NODE from dev environment before starting Electron.')
}

function ensureElectronRuntime() {
  if (process.env.ELECTRON_EXEC_PATH && fs.existsSync(process.env.ELECTRON_EXEC_PATH)) {
    return
  }

  const pathFile = path.join(ELECTRON_MODULE_DIR, 'path.txt')
  const installScript = path.join(ELECTRON_MODULE_DIR, 'install.js')
  const expectedExecutableName = getElectronPlatformPath()

  let executableName = ''
  if (fs.existsSync(pathFile)) {
    executableName = fs.readFileSync(pathFile, 'utf8').trim()
  }

  let installedVersion = ''
  if (fs.existsSync(ELECTRON_VERSION_FILE)) {
    installedVersion = fs.readFileSync(ELECTRON_VERSION_FILE, 'utf8').trim().replace(/^v/, '')
  }

  let packageVersion = ''
  if (fs.existsSync(ELECTRON_PACKAGE_FILE)) {
    packageVersion = JSON.parse(fs.readFileSync(ELECTRON_PACKAGE_FILE, 'utf8')).version
  }

  const executablePath = executableName
    ? path.join(ELECTRON_MODULE_DIR, 'dist', executableName)
    : ''

  if (
    executableName === expectedExecutableName &&
    installedVersion &&
    packageVersion &&
    installedVersion === packageVersion &&
    fs.existsSync(executablePath)
  ) {
    return
  }

  if (!fs.existsSync(installScript)) {
    throw new Error('Electron package is missing from node_modules. Run "npm install" first.')
  }

  console.warn('Electron runtime is missing; reinstalling Electron binary before dev startup...')
  const result = spawn(process.execPath, [installScript], {
    cwd: ROOT_DIR,
    env,
    stdio: 'inherit',
    windowsHide: false,
  })

  result.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    if (code !== 0) {
      console.error(`Electron runtime install failed with exit code ${code}.`)
      process.exit(code ?? 1)
    }

    startElectronVite()
  })

  result.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })

  return true
}

function getElectronPlatformPath() {
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || os.platform()

  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}.`)
  }
}

function startElectronVite() {
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
}

if (!ensureElectronRuntime()) {
  startElectronVite()
}
