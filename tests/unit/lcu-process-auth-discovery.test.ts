import { describe, expect, it } from 'vitest'
import { parseLcuAuthFromCommandLine } from '../../src/main/services/lcu/process-auth-discovery.ts'

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
})
