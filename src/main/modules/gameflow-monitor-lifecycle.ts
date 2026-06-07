export type LolPathChangeMonitorAction = 'ignore' | 'start' | 'restart'

export function getLolPathChangeMonitorAction({
  newPath,
  oldPath,
  monitorRunning,
}: {
  newPath?: string | null
  oldPath?: string | null
  monitorRunning: boolean
}): LolPathChangeMonitorAction {
  if (!newPath || newPath === oldPath) {
    return 'ignore'
  }

  return monitorRunning ? 'restart' : 'start'
}
