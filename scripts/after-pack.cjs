const { readdir, rm } = require('node:fs/promises')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])
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

module.exports = async function afterPack(context) {
  const localeResult = await pruneLocales(context.appOutDir)

  console.log(
    `[afterPack] removed ${localeResult.removed} Electron locale files; ` +
      'kept Electron runtime ffmpeg.dll; left app.asar.unpacked intact for Electron ASAR integrity'
  )
}
