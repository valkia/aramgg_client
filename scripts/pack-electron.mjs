import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'npm_config_all_proxy',
]

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === 'win32',
      ...options,
    })

    let output = ''

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(chunk)
    })

    child.on('close', (code) => {
      resolve({ code, output })
    })
  })
}

const MAC_CAPTURE_MODULE = path.join('.runtime', 'mac-capture', 'aramgg_capture.node')
const MAC_CAPTURE_EXPORTS = ['captureGame', 'inspectOverlay', 'requestScreenCaptureAccess']

function fail(message) {
  console.error(`\n[pack] ${message}`)
  process.exit(1)
}

// Node-API 模块与 Electron ABI 无关，可直接在打包脚本的 Node 进程中加载校验导出。
function verifyMacCaptureModule(file, label) {
  if (!existsSync(file)) {
    fail(`${label} 缺失：${file}`)
  }
  let binding
  try {
    binding = createRequire(import.meta.url)(path.resolve(file))
  } catch (error) {
    fail(`${label} 无法加载：${file}\n${error instanceof Error ? error.message : String(error)}`)
  }
  const missing = MAC_CAPTURE_EXPORTS.filter((name) => typeof binding?.[name] !== 'function')
  if (missing.length) {
    fail(`${label} 缺少导出 ${missing.join(', ')}：${file}`)
  }
  console.log(`[pack] verified ${label}: ${file}`)
}

// pack:mac 直接调用 electron-vite build，不会触发 npm 的 prebuild；
// 每次都删掉旧产物并显式编译，避免依赖之前 dev/build 留下的模块。
async function buildMacCaptureModule(env) {
  if (process.platform !== 'darwin') {
    fail('Mac 打包需要在 macOS 上编译 ScreenCaptureKit 原生模块')
  }
  await rm(MAC_CAPTURE_MODULE, { force: true })
  const result = await run('node', ['scripts/build-mac-capture.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.code !== 0) {
    fail(`Mac 原生截图模块编译失败（exit=${result.code}）`)
  }
  verifyMacCaptureModule(MAC_CAPTURE_MODULE, 'Mac 原生截图模块')
}

async function verifyPackagedMacCaptureModule() {
  const outputDir = path.resolve('build')
  const appDirs = (await readdir(outputDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => path.join(outputDir, entry.name, 'aramgg_client.app'))
    .filter((appDir) => existsSync(appDir))
  if (!appDirs.length) {
    fail(`未在 ${outputDir} 找到 Mac 应用包`)
  }
  for (const appDir of appDirs) {
    verifyMacCaptureModule(
      path.join(appDir, 'Contents', 'Resources', 'mac-capture', 'aramgg_capture.node'),
      '安装包内 Mac 原生截图模块',
    )
  }
}

function parseLocalProxy(value) {
  if (!value || typeof value !== 'string') {
    return null
  }

  const rawValue = value.trim()
  if (!rawValue) {
    return null
  }

  const valueWithProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(rawValue)
    ? rawValue
    : `http://${rawValue}`

  try {
    const url = new URL(valueWithProtocol)
    const host = url.hostname.toLowerCase()
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    const port = Number.parseInt(url.port, 10)

    if (!isLocalhost || !Number.isInteger(port)) {
      return null
    }

    return { host, port }
  } catch {
    return null
  }
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (isOpen) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(isOpen)
    }

    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function createPackEnv() {
  const env = { ...process.env }
  const localProxyEntries = []

  for (const key of PROXY_ENV_KEYS) {
    const proxy = parseLocalProxy(env[key])
    if (proxy) {
      localProxyEntries.push({ key, ...proxy })
    }
  }

  const checks = new Map()
  for (const proxy of localProxyEntries) {
    const checkKey = `${proxy.host}:${proxy.port}`
    if (!checks.has(checkKey)) {
      checks.set(checkKey, canConnect(proxy.host, proxy.port))
    }
  }

  const staleKeys = []
  for (const proxy of localProxyEntries) {
    const isOpen = await checks.get(`${proxy.host}:${proxy.port}`)
    if (!isOpen) {
      delete env[proxy.key]
      staleKeys.push(proxy.key)
    }
  }

  if (staleKeys.length > 0) {
    console.warn(
      `\nLocal proxy is configured but not reachable. Ignoring for this package run: ${staleKeys.join(', ')}\n`
    )
  }

  return env
}

function isWinUnpackedLockFailure(output) {
  return (
    /build[\\/]+win-unpacked/i.test(output) &&
    /(being used by another process|Access is denied|Unable to commit changes|ERR_ELECTRON_BUILDER_CANNOT_EXECUTE)/i.test(output)
  )
}

function createFallbackOutputDir() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')

  return path.join('build', `pack-${timestamp}`)
}

async function getPackageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
  return packageJson.version
}

async function logPreparedClientData() {
  const localePointers = [
    ['zh-CN', 'current.json'],
    ['en-US', 'current.en-US.json'],
    ['zh-TW', 'current.zh-TW.json'],
  ]

  for (const [locale, fileName] of localePointers) {
    const currentJsonPath = path.join(process.cwd(), 'resources', 'client-data', fileName)
    const current = JSON.parse(await readFile(currentJsonPath, 'utf8'))
    if (current.locale !== locale) {
      throw new Error(
        `[pack] client-data locale mismatch in ${fileName}: expected ${locale}, got ${current.locale || 'missing'}`
      )
    }

    console.log(
      `[pack] client-data ready locale=${locale} dataVersion=${current.dataVersion || 'unknown'} ` +
        `gamePatch=${current.gamePatch || 'unknown'} generatedAt=${current.generatedAt || 'unknown'} ` +
        `files=${current.bundledFileCount ?? 'unknown'} shards=${current.bundledShardCount ?? 'unknown'}`
    )
  }
}

async function removeFileIfExists(filePath) {
  try {
    await rm(filePath, { force: true })
  } catch (error) {
    console.warn(`Could not remove stale package artifact ${filePath}: ${error.message}`)
  }
}

async function cleanRootPackageArtifacts(version) {
  const outputDir = path.join(process.cwd(), 'build')
  const artifactBaseName = `aramgg_client Setup ${version}`
  const artifactPaths = [
    path.join(outputDir, `${artifactBaseName}.exe`),
    path.join(outputDir, `${artifactBaseName}.exe.blockmap`),
    path.join(outputDir, `${artifactBaseName}.__uninstaller.exe`),
    path.join(outputDir, `aramgg_client-${version}-x64.nsis.7z`),
    path.join(outputDir, 'latest.yml'),
  ]

  await Promise.all(artifactPaths.map(removeFileIfExists))
}

async function copyFallbackArtifactIfExists(fallbackOutput, fileName) {
  const source = path.join(process.cwd(), fallbackOutput, fileName)
  const target = path.join(process.cwd(), 'build', fileName)

  try {
    await copyFile(source, target)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function mirrorFallbackOutput(fallbackOutput, version) {
  const fallbackRoot = path.join(process.cwd(), fallbackOutput)
  const rootOutput = path.join(process.cwd(), 'build')
  const fallbackUnpacked = path.join(fallbackRoot, 'win-unpacked')
  const rootUnpacked = path.join(rootOutput, 'win-unpacked')
  const artifactBaseName = `aramgg_client Setup ${version}`

  await rm(rootUnpacked, { recursive: true, force: true })
  await cp(fallbackUnpacked, rootUnpacked, { recursive: true })
  await mkdir(rootOutput, { recursive: true })

  await Promise.all([
    copyFallbackArtifactIfExists(fallbackOutput, `${artifactBaseName}.exe`),
    copyFallbackArtifactIfExists(fallbackOutput, `${artifactBaseName}.exe.blockmap`),
    copyFallbackArtifactIfExists(fallbackOutput, 'latest.yml'),
  ])

  const copiedArtifacts = await readdir(rootOutput)
  const expectedArtifactPrefix = `${artifactBaseName}.`
  const releaseArtifacts = copiedArtifacts.filter((fileName) => (
    fileName === 'latest.yml' || fileName.startsWith(expectedArtifactPrefix)
  ))

  console.warn(
    `\nPackage artifacts were mirrored to default output after fallback: ${releaseArtifacts.join(', ')}\n`
  )
}

async function main() {
  const packEnv = await createPackEnv()
  const packageVersion = await getPackageVersion()

  const clientDataResult = await run('node', ['scripts/fetch-client-data.mjs'], {
    env: packEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (clientDataResult.code !== 0) {
    process.exit(clientDataResult.code ?? 1)
  }
  await logPreparedClientData()

  const isMacPack = process.argv.includes('--mac')
  if (isMacPack) await buildMacCaptureModule(packEnv)

  const buildResult = await run('electron-vite', ['build'], {
    env: packEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (buildResult.code !== 0) {
    process.exit(buildResult.code ?? 1)
  }

  if (!isMacPack) await cleanRootPackageArtifacts(packageVersion)

  const platformArgs = isMacPack ? ['--mac'] : []
  if (process.env.ELECTRON_CACHE) {
    platformArgs.push(`--config.electronDownload.cache=${path.resolve(process.env.ELECTRON_CACHE)}`)
  }
  const packResult = await run('electron-builder', [...platformArgs, '--publish', 'never'], {
    env: packEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (packResult.code === 0) {
    if (isMacPack) await verifyPackagedMacCaptureModule()
    return
  }

  if (!isWinUnpackedLockFailure(packResult.output)) {
    process.exit(packResult.code ?? 1)
  }

  const fallbackOutput = createFallbackOutputDir()
  console.warn(
    `\nDefault build output is locked. Retrying electron-builder with output: ${fallbackOutput}\n`
  )

  const fallbackResult = await run(
    'electron-builder',
    ['--publish', 'never', `--config.directories.output=${fallbackOutput}`],
    {
      env: packEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  if (fallbackResult.code === 0) {
    await cleanRootPackageArtifacts(packageVersion)
    await mirrorFallbackOutput(fallbackOutput, packageVersion)
    console.warn(`\nPackage artifacts were written to fallback output: ${fallbackOutput}\n`)
  }

  process.exit(fallbackResult.code ?? 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
