import { describe, expect, it, vi } from 'vitest'
import {
  parseLcuAuthFromCommandLine,
  parseLcuAuthFromLogContent,
  parseLcuAuthFromLockfile,
  queryLeagueClientProcessesWithRunner,
  shouldUseDiscoveryCache,
} from '../../src/main/services/lcu/process-auth-discovery.ts'

describe('LCU process auth discovery', () => {
  it('extracts auth from LeagueClientUx command line arguments', () => {
    const [token, port, url] = parseLcuAuthFromCommandLine(
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" --app-port=58123 --remoting-auth-token=test-token-123 --app-name=LeagueClientUx'
    )

    expect(token).toBe('test-token-123')
    expect(port).toBe('58123')
    expect(url).toBe('https://riot:test-token-123@127.0.0.1:58123')
  })

  it('supports quoted values', () => {
    const [token, port] = parseLcuAuthFromCommandLine(
      '"LeagueClientUx.exe" --app-port="62222" --remoting-auth-token="quoted-token"'
    )

    expect(token).toBe('quoted-token')
    expect(port).toBe('62222')
  })

  it('supports fully quoted launch arguments', () => {
    const [token, port] = parseLcuAuthFromCommandLine(
      '"LeagueClientUx.exe" "--app-port=63729" "--remoting-auth-token=whole-arg-token"'
    )

    expect(token).toBe('whole-arg-token')
    expect(port).toBe('63729')
  })

  it('rejects missing or invalid port values', () => {
    expect(parseLcuAuthFromCommandLine('--remoting-auth-token=abc')).toEqual([null, null, null])
    expect(parseLcuAuthFromCommandLine('--app-port=70000 --remoting-auth-token=abc')).toEqual([
      null,
      null,
      null,
    ])
  })

  it('extracts auth from lockfile content', () => {
    const [token, port, url] = parseLcuAuthFromLockfile(
      'LeagueClient:1234:58123:lockfile-token:https'
    )

    expect(token).toBe('lockfile-token')
    expect(port).toBe('58123')
    expect(url).toBe('https://riot:lockfile-token@127.0.0.1:58123')
  })

  it('rejects malformed lockfile content', () => {
    expect(parseLcuAuthFromLockfile('')).toEqual([null, null, null])
    expect(parseLcuAuthFromLockfile('LeagueClient:1234:not-a-port:token:https')).toEqual([
      null,
      null,
      null,
    ])
    expect(parseLcuAuthFromLockfile('LeagueClient:1234:58123:token:file')).toEqual([
      null,
      null,
      null,
    ])
  })

  it('extracts auth from LeagueClientUx log command line entries', () => {
    const [token, port, url] = parseLcuAuthFromLogContent(
      '000000.000| OKAY| Command line arguments: --remoting-auth-token=log-token --app-port=58124 --app-name=LeagueClient'
    )

    expect(token).toBe('log-token')
    expect(port).toBe('58124')
    expect(url).toBe('https://riot:log-token@127.0.0.1:58124')
  })

  it('extracts auth from LeagueClientUx log bootstrap URLs', () => {
    const [token, port, url] = parseLcuAuthFromLogContent(
      'Creating ux window with url https://riot:url-token@127.0.0.1:58125/bootstrap.html.'
    )

    expect(token).toBe('url-token')
    expect(port).toBe('58125')
    expect(url).toBe('https://riot:url-token@127.0.0.1:58125')
  })

  it('falls back to Get-Process when the CIM query times out', async () => {
    const timeoutError = Object.assign(new Error('process query timed out'), {
      code: 'ETIMEDOUT',
      killed: true,
    })
    const runner = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(JSON.stringify({
        Name: 'LeagueClientUx.exe',
        ProcessId: 4321,
        ExecutablePath: 'C:\\Riot Games\\League of Legends\\LeagueClientUx.exe',
        CommandLine: null,
      }))

    const result = await queryLeagueClientProcessesWithRunner(runner)

    expect(runner).toHaveBeenCalledTimes(2)
    expect(result.records).toEqual([
      expect.objectContaining({
        Name: 'LeagueClientUx.exe',
        ProcessId: 4321,
        ExecutablePath: 'C:\\Riot Games\\League of Legends\\LeagueClientUx.exe',
      }),
    ])
    expect(result.attempts).toEqual([
      expect.objectContaining({
        strategy: 'get-cim-instance',
        timeoutMs: 8000,
        succeeded: false,
        error: expect.objectContaining({ timedOut: true, code: 'ETIMEDOUT' }),
      }),
      expect.objectContaining({
        strategy: 'get-process',
        timeoutMs: 4000,
        succeeded: true,
        usableRecordCount: 1,
      }),
    ])
  })

  it('merges fallback paths into process records with restricted CIM metadata', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        Name: 'LeagueClientUx.exe',
        ProcessId: 4321,
        ExecutablePath: null,
        CommandLine: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        Name: 'LeagueClientUx.exe',
        ProcessId: 4321,
        ExecutablePath: 'D:\\League\\LeagueClientUx.exe',
        CommandLine: null,
      }))

    const result = await queryLeagueClientProcessesWithRunner(runner)

    expect(runner).toHaveBeenCalledTimes(2)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toEqual(expect.objectContaining({
      ProcessId: 4321,
      ExecutablePath: 'D:\\League\\LeagueClientUx.exe',
    }))
  })

  it('caches successful discovery results and bypasses the cache on force refresh', () => {
    const now = 100_000
    expect(shouldUseDiscoveryCache(now - 1000, now, false)).toBe(true)
    expect(shouldUseDiscoveryCache(0, now, false)).toBe(false)
    expect(shouldUseDiscoveryCache(now - 61_000, now, false)).toBe(false)
    expect(shouldUseDiscoveryCache(now - 1000, now, true)).toBe(false)
  })
})
