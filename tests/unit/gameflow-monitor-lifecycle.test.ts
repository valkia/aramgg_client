import { describe, expect, it } from 'vitest'
import { getLolPathChangeMonitorAction } from '../../src/main/modules/gameflow-monitor-lifecycle.ts'

describe('gameflow monitor lifecycle', () => {
  it('ignores empty or unchanged LoL path updates', () => {
    expect(getLolPathChangeMonitorAction({
      newPath: '',
      oldPath: '',
      monitorRunning: false,
    })).toBe('ignore')

    expect(getLolPathChangeMonitorAction({
      newPath: 'E:\\wegame\\League of Legends',
      oldPath: 'E:\\wegame\\League of Legends',
      monitorRunning: true,
    })).toBe('ignore')
  })

  it('starts the monitor after a LoL path is configured post-startup', () => {
    expect(getLolPathChangeMonitorAction({
      newPath: 'E:\\wegame\\League of Legends',
      oldPath: '',
      monitorRunning: false,
    })).toBe('start')
  })

  it('restarts the monitor when an existing LoL path changes', () => {
    expect(getLolPathChangeMonitorAction({
      newPath: 'E:\\wegame\\League of Legends',
      oldPath: 'D:\\WeGameApps\\英雄联盟',
      monitorRunning: true,
    })).toBe('restart')
  })
})
