import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import logger from '../../src/main/modules/logger.ts'
import { LCUService } from '../../src/main/services/lcu/lcu-service.ts'
import { getLcuToken } from '../../src/main/services/lcu/token-loader.ts'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
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

const connectionRefused = (port: number) => Object.assign(
  new Error(`connect ECONNREFUSED 127.0.0.1:${port}`),
  {
    code: 'ECONNREFUSED',
    errno: -4078,
    syscall: 'connect',
    address: '127.0.0.1',
    port,
  }
)

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LCU connection verification and recovery', () => {
  it('rejects discovered credentials when their endpoint is unreachable', async () => {
    vi.mocked(getLcuToken).mockResolvedValue([
      'stale-private-token',
      '57195',
      'https://riot:stale-private-token@127.0.0.1:57195',
    ])
    vi.mocked(axios.get).mockRejectedValue(connectionRefused(57195))
    const service = new LCUService({ failCooldown: 0 })

    const auth = await service.getAuthToken(true)

    expect(auth).toBeNull()
    expect(service.isActive()).toBe(false)
    expect(service.getUrl()).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      '[LCU connection] endpoint probe failed',
      expect.objectContaining({
        context: 'auth-candidate-verification',
        port: '57195',
        code: 'ECONNREFUSED',
        sensitiveValuesLogged: false,
      })
    )
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('stale-private-token')
  })

  it('respects the failure cooldown after a forced discovery fails', async () => {
    vi.mocked(getLcuToken).mockResolvedValue([
      'stale-private-token',
      '57195',
      'https://riot:stale-private-token@127.0.0.1:57195',
    ])
    vi.mocked(axios.get).mockRejectedValue(connectionRefused(57195))
    const service = new LCUService({ failCooldown: 10000 })

    expect(await service.getAuthToken(true)).toBeNull()
    expect(await service.getAuthToken(false)).toBeNull()

    expect(getLcuToken).toHaveBeenCalledTimes(1)
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  it('rate limits alternating diagnostics by signature and reports suppressed repeats', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'))
    vi.mocked(getLcuToken).mockResolvedValue([
      'stale-private-token',
      '57195',
      'https://riot:stale-private-token@127.0.0.1:57195',
    ])
    vi.mocked(axios.get).mockRejectedValue(connectionRefused(57195))
    const service = new LCUService({ failCooldown: 0 })

    await service.getAuthToken(true)
    await service.getAuthToken(true)

    expect(logger.warn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(5 * 60 * 1000)
    await service.getAuthToken(true)

    expect(logger.warn).toHaveBeenCalledTimes(4)
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      '[LCU connection] endpoint probe failed',
      expect.objectContaining({ suppressedSinceLastLog: 1 })
    )
    expect(logger.warn).toHaveBeenNthCalledWith(
      4,
      '[LCU connection] cached auth invalidated',
      expect.objectContaining({ suppressedSinceLastLog: 1 })
    )
  })

  it('clears rejected auth and force-discovers a new endpoint after ECONNREFUSED', async () => {
    vi.mocked(getLcuToken)
      .mockResolvedValueOnce([
        'first-token',
        '57195',
        'https://riot:first-token@127.0.0.1:57195',
      ])
      .mockResolvedValueOnce([
        'second-token',
        '58123',
        'https://riot:second-token@127.0.0.1:58123',
      ])
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(connectionRefused(57195))
      .mockResolvedValueOnce({ status: 200 })
    const service = new LCUService({ failCooldown: 0 })

    expect(await service.getAuthToken(true)).toEqual(expect.objectContaining({ port: '57195' }))
    expect(await service.getCurrentSummoner()).toBeNull()

    expect(getLcuToken).toHaveBeenCalledTimes(2)
    expect(service.isActive()).toBe(true)
    expect(service.getUrl()).toBe('https://127.0.0.1:58123')
    expect(logger.info).toHaveBeenCalledWith(
      '[LCU connection] forced rediscovery recovered connection',
      expect.objectContaining({
        context: 'current-summoner',
        connected: true,
        previousPort: '57195',
        discoveredPort: '58123',
        rediscoveredSamePort: false,
      })
    )
  })

  it('invalidates a cached connection when a status check fails', async () => {
    vi.mocked(getLcuToken).mockResolvedValue([
      'status-token',
      '59000',
      'https://riot:status-token@127.0.0.1:59000',
    ])
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(connectionRefused(59000))
    const service = new LCUService({ failCooldown: 0 })

    expect(await service.getAuthToken(true)).not.toBeNull()
    expect(await service.getLcuStatus()).toBe(false)

    expect(service.isActive()).toBe(false)
    expect(service.getUrl()).toBeNull()
  })
})
