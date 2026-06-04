import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
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

async function main() {
  const packEnv = await createPackEnv()
  const packageVersion = await getPackageVersion()

  const buildResult = await run('electron-vite', ['build'], {
    env: packEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (buildResult.code !== 0) {
    process.exit(buildResult.code ?? 1)
  }

  await cleanRootPackageArtifacts(packageVersion)

  const packResult = await run('electron-builder', ['--publish', 'never'], {
    env: packEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (packResult.code === 0) {
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
    console.warn(`\nPackage artifacts were written to fallback output: ${fallbackOutput}\n`)
  }

  process.exit(fallbackResult.code ?? 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
