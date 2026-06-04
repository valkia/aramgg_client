import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DATA_API_ORIGIN = process.env.ARAMGG_DATA_API_ORIGIN || 'https://data.dtodo.cn'
const DATA_API_PREFIX = '/api/client/v1'
const OUTPUT_DIR = process.env.ARAMGG_CLIENT_DATA_DIR || path.join('resources', 'client-data')
const DOWNLOAD_CONCURRENCY = Number.parseInt(process.env.ARAMGG_CLIENT_DATA_CONCURRENCY || '4', 10)
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.ARAMGG_CLIENT_DATA_TIMEOUT_MS || '60000', 10)
const REQUEST_RETRY_COUNT = Number.parseInt(process.env.ARAMGG_CLIENT_DATA_RETRIES || '3', 10)

const REQUIRED_DATA_PATHS = new Set([
  'augments.json',
  'champions.json',
  'items.json',
  'manifest.json',
  'champion-shards/index.json',
])

function getApiUrl(resourcePath) {
  if (/^https?:\/\//i.test(resourcePath)) {
    return resourcePath
  }

  const p = resourcePath.startsWith('/') ? resourcePath : `${DATA_API_PREFIX}/${resourcePath}`
  return new URL(p, DATA_API_ORIGIN).toString()
}

function normalizeDataPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function sanitizePathPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function isBundledDataPath(dataPath) {
  const normalizedPath = normalizeDataPath(dataPath)
  return REQUIRED_DATA_PATHS.has(normalizedPath) || normalizedPath.startsWith('champion-shards/')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchTextOnce(resourcePath) {
  const url = getApiUrl(resourcePath)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    return await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`)
    }

    throw new Error(`Failed to fetch ${url}: ${error.message}`)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(resourcePath) {
  let lastError = null

  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      return await fetchTextOnce(resourcePath)
    } catch (error) {
      lastError = error
      if (attempt < REQUEST_RETRY_COUNT) {
        console.warn(`[client-data] retry ${attempt}/${REQUEST_RETRY_COUNT}: ${error.message}`)
        await sleep(1000 * attempt)
      }
    }
  }

  throw lastError
}

async function fetchJson(resourcePath) {
  return JSON.parse(await fetchText(resourcePath))
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function getManifestFileEntries(manifest) {
  if (Array.isArray(manifest?.files)) {
    return manifest.files
  }

  if (manifest?.files && typeof manifest.files === 'object') {
    return Object.entries(manifest.files).map(([filePath, value]) => ({
      ...(value && typeof value === 'object' ? value : {}),
      path: filePath,
    }))
  }

  return []
}

function findManifestPath(manifest, logicalPath) {
  const normalizedPath = normalizeDataPath(logicalPath)
  const entry = getManifestFileEntries(manifest).find((file) => {
    const filePath = normalizeDataPath(file.path || file.url || '')
    return filePath === normalizedPath || filePath.endsWith(`/${normalizedPath}`)
  })

  return normalizeDataPath(entry?.path || normalizedPath)
}

async function writeTextFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function isExistingBundleComplete(versionDir, files) {
  for (const file of files) {
    const filePath = path.join(versionDir, file.path)

    try {
      const fileStat = await stat(filePath)
      if (file.bytes > 0 && fileStat.size !== file.bytes) {
        return false
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return false
      }

      throw error
    }
  }

  return true
}

async function runLimited(items, limit, worker) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  })

  await Promise.all(workers)
}

async function main() {
  const startedAt = Date.now()
  const config = await fetchJson(`${DATA_API_PREFIX}/config`)
  const dataVersion = String(config?.dataVersion || '')

  if (!dataVersion) {
    throw new Error('Remote client data config is missing dataVersion')
  }

  const manifestPath = config.manifest || `${DATA_API_PREFIX}/data/${encodeURIComponent(dataVersion)}/manifest.json`
  const manifestText = await fetchText(manifestPath)
  const manifest = JSON.parse(manifestText)
  const versionDir = path.join(OUTPUT_DIR, 'versions', sanitizePathPart(dataVersion))
  const manifestDataPath = findManifestPath(manifest, 'manifest.json')
  const entries = getManifestFileEntries(manifest)
    .map((entry) => ({
      path: normalizeDataPath(entry.path || entry.url || ''),
      url: entry.url || entry.path || '',
      bytes: Number(entry.bytes || 0),
    }))
    .filter((entry) => entry.path && isBundledDataPath(entry.path))

  const manifestEntry = {
    path: manifestDataPath,
    url: manifestPath,
    bytes: Buffer.byteLength(manifestText),
  }
  const filesByPath = new Map([[manifestEntry.path, manifestEntry]])
  for (const entry of entries) {
    filesByPath.set(entry.path, entry)
  }

  const files = [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  const existingPointer = await readJsonFile(path.join(OUTPUT_DIR, 'current.json'))

  if (
    String(existingPointer?.dataVersion || '') === dataVersion &&
    await isExistingBundleComplete(versionDir, files)
  ) {
    console.log(
      `[client-data] existing bundle for ${dataVersion} is complete; ` +
        `skipped download in ${Date.now() - startedAt}ms`
    )
    return
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(versionDir, { recursive: true })

  await runLimited(files, DOWNLOAD_CONCURRENCY, async (file) => {
    const content = file.path === manifestDataPath ? manifestText : await fetchText(file.url || file.path)
    await writeTextFile(path.join(versionDir, file.path), content)
  })

  await writeTextFile(
    path.join(OUTPUT_DIR, 'current.json'),
    JSON.stringify({
      schemaVersion: 3,
      dataVersion,
      gamePatch: config.gamePatch || '',
      generatedAt: config.generatedAt || '',
      manifest: config.manifest || manifestPath,
      activatedAt: new Date().toISOString(),
    })
  )

  const totalBytes = files.reduce((sum, file) => sum + (file.bytes || 0), 0)
  console.log(
    `[client-data] bundled ${files.length} files for ${dataVersion} ` +
      `(${(totalBytes / 1024 / 1024).toFixed(2)} MB) in ${Date.now() - startedAt}ms`
  )
}

main().catch((error) => {
  console.error(`[client-data] ${error.message}`)
  process.exit(1)
})
