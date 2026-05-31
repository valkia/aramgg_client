const { readdir, rm } = require('node:fs/promises')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])
const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
])

async function pruneLocales(appOutDir) {
  const localesDir = path.join(appOutDir, 'locales')

  let entries = []
  try {
    entries = await readdir(localesDir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return { removed: 0 }
  }

  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.pak') || KEEP_LOCALES.has(entry.name)) {
      continue
    }

    await rm(path.join(localesDir, entry.name), { force: true })
    removed += 1
  }

  return { removed }
}

function getTargetArch(context) {
  if (typeof context.arch === 'string') {
    return context.arch
  }

  return ARCH_NAMES.get(context.arch) || process.arch
}

async function pruneOnnxRuntime(context) {
  const binDir = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6'
  )
  const targetPlatform = context.electronPlatformName || process.platform
  const targetArch = getTargetArch(context)

  let platforms = []
  try {
    platforms = await readdir(binDir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return { removed: 0, target: `${targetPlatform}/${targetArch}` }
  }

  let removed = 0
  for (const platformEntry of platforms) {
    if (!platformEntry.isDirectory()) {
      continue
    }

    const platformPath = path.join(binDir, platformEntry.name)
    if (platformEntry.name !== targetPlatform) {
      await rm(platformPath, { force: true, recursive: true })
      removed += 1
      continue
    }

    const archEntries = await readdir(platformPath, { withFileTypes: true })
    for (const archEntry of archEntries) {
      if (!archEntry.isDirectory() || archEntry.name === targetArch) {
        continue
      }

      await rm(path.join(platformPath, archEntry.name), { force: true, recursive: true })
      removed += 1
    }
  }

  return { removed, target: `${targetPlatform}/${targetArch}` }
}

module.exports = async function afterPack(context) {
  const [localeResult, onnxResult] = await Promise.all([
    pruneLocales(context.appOutDir),
    pruneOnnxRuntime(context),
  ])

  console.log(
    `[afterPack] removed ${localeResult.removed} Electron locale files; ` +
      `kept Electron runtime ffmpeg.dll; pruned ${onnxResult.removed} ONNX Runtime platform folders, ` +
      `kept ${onnxResult.target}`
  )
}
