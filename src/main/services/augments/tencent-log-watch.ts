import { watch } from 'node:fs'
import path from 'node:path'

/** Watch the parent so replacing main.log does not detach us from the new file. */
export function watchTencentLog(file: string, changed: () => void, failed: () => void): () => void {
  const basename = path.basename(file).toLowerCase()
  const watcher = watch(path.dirname(file), { persistent: false }, (_event, filename) => {
    if (filename === null || filename.toString().toLowerCase() === basename) changed()
  })
  watcher.on('error', failed)
  return () => { watcher.close() }
}
