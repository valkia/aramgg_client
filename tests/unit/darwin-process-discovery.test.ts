import { describe, expect, it } from 'vitest'
import { getDarwinLeagueRoot, parseDarwinLeagueProcesses } from '../../src/main/services/lcu/darwin-process-discovery.ts'
import { findDarwinGameWindowSource, findGameWindowSource, hasDarwinGameProcess } from '../../src/main/modules/game-window-source.ts'

describe('Mac League discovery', () => {
  it('finds both client processes in paths with spaces and ignores helpers and other commands', () => {
    const records = parseDarwinLeagueProcesses([
      ' 101 /Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClient --app-port=12345',
      ' 102 /Applications/League of Legends.app/Contents/LoL/League of Legends.app/Contents/MacOS/LeagueClientUx --remoting-auth-token=fixture --app-port=12345',
      ' 103 /Applications/League of Legends.app/Contents/LoL/LeagueClientUx Helper --type=renderer',
      ' 104 /bin/echo LeagueClientUx --app-port=12345',
    ].join('\n'))
    expect(records.map(r => r.Name)).toEqual(['LeagueClient', 'LeagueClientUx'])
    expect(records[1].ProcessId).toBe(102)
    expect(getDarwinLeagueRoot(records[1].ExecutablePath)).toBe('/Applications/League of Legends.app/Contents/LoL')
  })

  it('supports custom install directories and does not infer roots for unrelated paths', () => {
    const [record] = parseDarwinLeagueProcesses(' 222 /Volumes/Games/League.app/Contents/LoL/LeagueClient --app-port=22222')
    expect(getDarwinLeagueRoot(record.ExecutablePath)).toBe('/Volumes/Games/League.app/Contents/LoL')
    expect(getDarwinLeagueRoot('/bin/LeagueClient')).toBeNull()
    expect(parseDarwinLeagueProcesses('garbage\n')).toEqual([])
  })
})

describe('game capture source selection', () => {
  it('recognizes the installed Mac game executable but not the UX client', () => {
    expect(hasDarwinGameProcess('/Applications/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends')).toBe(true)
    expect(hasDarwinGameProcess('/Applications/League of Legends.app/Contents/LoL/League of Legends.app/Contents/MacOS/LeagueClientUx')).toBe(false)
  })
  it('selects gameplay even when the launcher and assistant occur first', () => {
    const game = { name: 'League of Legends', id: 'game' }
    expect(findDarwinGameWindowSource([
      { name: 'League of Legends Client', id: 'client' },
      { name: 'ARAMGG League of Legends', id: 'assistant' },
      game,
    ])).toBe(game)
  })
  it('does not mistake a lone launcher for a game window', () => {
    expect(findDarwinGameWindowSource([{ name: 'LeagueClientUx' }])).toBeNull()
    expect(findDarwinGameWindowSource([{ name: '英雄联盟' }])?.name).toBe('英雄联盟')
  })
  it('recognizes the observed Mac gameplay title despite the Client suffix', () => {
    const game = { name: 'League of Legends (TM) Client', id: 'mac-game' }
    expect(findDarwinGameWindowSource([
      { name: 'LeagueClientUx', id: 'launcher' },
      game,
    ])).toBe(game)
  })
  it('keeps the original Windows ranking so gameplay always beats the launcher', () => {
    const game = { name: 'League of Legends (TM) Client', id: 'game' }
    const launcher = { name: 'League of Legends', id: 'launcher' }
    expect(findGameWindowSource([launcher, game], 'win32')).toBe(game)
    expect(findGameWindowSource([game, launcher], 'win32')).toBe(game)
    expect(findGameWindowSource([{ name: 'aramgg_client' }], 'win32')).toBeNull()
    expect(findGameWindowSource([{ name: 'League Client' }], 'win32')?.name).toBe('League Client')
  })
  it('dispatches to the Mac ranking only on darwin', () => {
    const sources = [{ name: 'League Client' }]
    expect(findGameWindowSource(sources, 'darwin')).toBeNull()
    expect(findGameWindowSource(sources, 'win32')).toBe(sources[0])
  })
})
