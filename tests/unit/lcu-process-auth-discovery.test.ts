import { describe, expect, it } from 'vitest'
import {
  parseLcuAuthFromCommandLine,
  parseLcuAuthFromLogContent,
  parseLcuAuthFromLockfile,
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
})
