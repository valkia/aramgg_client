import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LCUService } from '../../src/main/services/lcu/lcu-service.ts'
import { getLcuToken } from '../../src/main/services/lcu/token-loader.ts'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../src/main/modules/logger.ts', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/main/services/lcu/token-loader.ts', () => ({
  getLcuToken: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('LCU match-history reads', () => {
  it('reads the short-lived entitlements token without exposing it in logs', async () => {
    vi.mocked(getLcuToken).mockResolvedValue([
      'private-lcu-token',
      '57195',
      'https://riot:private-lcu-token@127.0.0.1:57195',
    ])
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({
        status: 200,
        data: { accessToken: 'private-entitlements-token' },
      })
    const service = new LCUService({ failCooldown: 0 })

    await expect(service.getEntitlementsAccessToken()).resolves.toBe('private-entitlements-token')
    expect(axios.get).toHaveBeenLastCalledWith(
      'https://127.0.0.1:57195/entitlements/v1/token',
      expect.objectContaining({
        proxy: false,
        timeout: 5_000,
      }),
    )
  })

  it('reads a matched player by PUUID with a bounded LCU page range', async () => {
    vi.mocked(getLcuToken).mockResolvedValue([
      'private-token',
      '57195',
      'https://riot:private-token@127.0.0.1:57195',
    ])
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({
        status: 200,
        data: { games: { games: [{ gameId: 1 }] } },
      })
    const service = new LCUService({ failCooldown: 0 })

    const result = await service.getSummonerMatchHistory(
      '11111111-1111-1111-1111-111111111111',
      0,
      80,
    )

    expect(result).toEqual({ games: { games: [{ gameId: 1 }] } })
    expect(axios.get).toHaveBeenLastCalledWith(
      'https://127.0.0.1:57195/lol-match-history/v1/products/lol/11111111-1111-1111-1111-111111111111/matches',
      expect.objectContaining({
        params: { begIndex: 0, endIndex: 49 },
        timeout: 10_000,
        proxy: false,
      }),
    )
  })

  it('rejects malformed player identifiers before building an LCU URL', async () => {
    const service = new LCUService({ failCooldown: 0 })

    await expect(service.getSummonerMatchHistory('../unsafe')).rejects.toThrow('Invalid match-history PUUID')
    expect(axios.get).not.toHaveBeenCalled()
  })
})
