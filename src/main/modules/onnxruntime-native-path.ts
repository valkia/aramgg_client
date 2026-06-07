import path from 'path'
import { existsSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ONNXRUNTIME_NATIVE_DIR_PARTS = ['bin', 'napi-v6']

let preparedNativeDir: string | null = null

function toAsarUnpackedPath(candidate: string) {
  return candidate.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

function getOnnxruntimePackageDir() {
  try {
    return path.dirname(require.resolve('onnxruntime-node/package.json'))
  } catch {
    return null
  }
}

function uniquePaths(paths: Array<string | null | undefined>) {
  return [...new Set(paths.filter(Boolean) as string[])]
}

export function getOnnxruntimeNativeDirCandidates({
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  moduleDir = import.meta.dirname,
  platform = process.platform,
  arch = process.arch,
  packageDir = getOnnxruntimePackageDir(),
  configuredDir = process.env.ARAMGG_ONNXRUNTIME_NATIVE_DIR,
}: {
  resourcesPath?: string
  cwd?: string
  moduleDir?: string
  platform?: string
  arch?: string
  packageDir?: string | null
  configuredDir?: string
} = {}) {
  const nativeParts = [...ONNXRUNTIME_NATIVE_DIR_PARTS, platform, arch]
  const packageNativeDir = packageDir
    ? path.join(packageDir, ...nativeParts)
    : null

  return uniquePaths([
    configuredDir,
    packageNativeDir ? toAsarUnpackedPath(packageNativeDir) : null,
    packageNativeDir,
    resourcesPath
      ? path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', ...nativeParts)
      : null,
    path.join(cwd, 'node_modules', 'onnxruntime-node', ...nativeParts),
    path.resolve(moduleDir, '..', '..', 'node_modules', 'onnxruntime-node', ...nativeParts),
  ])
}

function isUsableNativeDir(nativeDir: string) {
  return (
    existsSync(path.join(nativeDir, 'onnxruntime_binding.node')) &&
    existsSync(path.join(nativeDir, 'onnxruntime.dll'))
  )
}

function prependPathDirectory(nativeDir: string) {
  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)

  if (!pathEntries.some(entry => path.resolve(entry) === path.resolve(nativeDir))) {
    process.env.PATH = [nativeDir, ...pathEntries].join(path.delimiter)
  }
}

export function ensureOnnxruntimeNativeDllPath(log = console) {
  if (process.platform !== 'win32') {
    return null
  }

  if (preparedNativeDir) {
    return preparedNativeDir
  }

  const candidates = getOnnxruntimeNativeDirCandidates()
  const nativeDir = candidates.find(isUsableNativeDir) || null

  if (!nativeDir) {
    log.warn?.('ONNX Runtime native directory not found', { candidates })
    return null
  }

  prependPathDirectory(nativeDir)
  preparedNativeDir = nativeDir
  log.info?.('ONNX Runtime native directory prepared', { nativeDir })
  return nativeDir
}
