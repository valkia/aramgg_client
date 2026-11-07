import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { TencentAugmentSource } from './tencent-augment-source.ts'
import { isTencentRegion } from './tencent-log-codec.ts'
import { watchTencentLog } from './tencent-log-watch.ts'
import logger from '../../modules/logger.ts'
import { isGameDiagnosticsEnabled } from '../diagnostics/diagnostic-settings.ts'

const execute = promisify(execFile)

export function parseTencentLogDirectory(command: string): string | null {
  const match = command.match(/(?:^|\s)--logDir(?:=|\s+)(?:"([^"]+)"|([^\s]+))/i)
  const directory = match?.[1] ?? match?.[2]
  return directory && /^[A-Za-z]:[\\/]/.test(directory) && !directory.includes('\0') && directory.length < 4096
    ? path.win32.join(directory, 'iCreateLogs', 'main.log') : null
}

async function readable(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

/** No game path setting, remote auth, or SDK execution is needed. */
export function createTencentAugmentSource(
  selected: ConstructorParameters<typeof TencentAugmentSource>[0]['selected'],
  candidatesReady?: ConstructorParameters<typeof TencentAugmentSource>[0]['candidatesReady'],
): TencentAugmentSource {
  let lastDiscovery = 0
  let discovered: string | null = null
  return new TencentAugmentSource({
    supported: process.platform === 'win32' && process.env.ARAMGG_TENCENT_AUGMENTS !== '0',
    readIdentity: async () => {
      const { getLCUServiceInstance } = await import('../lcu/lcu-service.ts')
      const lcu = getLCUServiceInstance()
      if (!lcu.isActive()) return null
      const region = await lcu.getReadOnlyJsonEndpoint('/riotclient/region-locale')
      if (region?.status !== 200 || typeof region.data?.region !== 'string') return null
      // Avoid even reading summoner identity or external files on other regions.
      if (!isTencentRegion(region.data.region)) return { region: region.data.region, puuid: '' }
      const summoner = await lcu.getCurrentSummoner()
      return typeof summoner?.puuid === 'string' ? { region: region.data.region, puuid: summoner.puuid } : null
    },
    locate: async () => {
      const local = process.env.LOCALAPPDATA
      if (local) {
        const file = path.join(local, 'icreate-sdk', 'lol', 'iCreateLogs', 'main.log')
        if (await readable(file)) return file
      }
      if (discovered && await readable(discovered)) return discovered
      if (Date.now() - lastDiscovery < 60_000) return null
      lastDiscovery = Date.now()
      try {
        const script = 'Get-CimInstance Win32_Process -Filter "Name=\'icreateLol.exe\'" | Select-Object CommandLine | ConvertTo-Json -Compress'
        const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 3000, maxBuffer: 128 * 1024, windowsHide: true })
        const values: unknown = JSON.parse(stdout.trim() || '[]')
        for (const item of Array.isArray(values) ? values : [values]) {
          if (!item || typeof item.CommandLine !== 'string') continue
          const file = parseTencentLogDirectory(item.CommandLine)
          if (file && await readable(file)) { discovered = file; return file }
        }
      } catch { /* Missing component or denied process access leaves OCR available. */ }
      return null
    },
    catalogue: async () => {
      const { getDataLocale, loadAugmentBaseForOcrLocale } = await import('../../data-loader.ts')
      return (await loadAugmentBaseForOcrLocale(getDataLocale())).augments
    },
    watch: watchTencentLog,
    selected,
    candidatesReady,
    diagnostic: (event, details) => {
      // Source status is already deduplicated by TencentAugmentSource.
      if (event === 'source-status') logger.info('[tencent augments]', { event, ...details })
      else if (isGameDiagnosticsEnabled()) logger.debug('[tencent augments]', { event, ...details })
    },
  })
}
