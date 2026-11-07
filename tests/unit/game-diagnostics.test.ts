import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  directory: vi.fn(() => '/isolated/game-diagnostics'),
  reader: vi.fn(() => ({ read: vi.fn(), close: vi.fn() })),
  construct: vi.fn(), phase: vi.fn(), stop: vi.fn(async () => {}),
  subscribe: vi.fn(), info: vi.fn(), warn: vi.fn(),
}))
vi.mock('../../src/main/modules/app-paths.ts', () => ({ getGameDiagnosticCaptureDir: mocks.directory }))
vi.mock('../../src/main/modules/logger.ts', () => ({
  default: { info: mocks.info, warn: mocks.warn }, subscribeLogEvents: mocks.subscribe,
}))
vi.mock('../../src/main/services/diagnostics/augment-api-capture.ts', () => ({ createLocalGameReader: mocks.reader }))
vi.mock('../../src/main/services/diagnostics/game-diagnostic-session.ts', () => ({
  GameDiagnosticSession: class {
    constructor(options: unknown) { mocks.construct(options) }
    observePhase = mocks.phase
    stop = mocks.stop
  },
}))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
afterEach(() => vi.unstubAllEnvs())

describe('optional detailed game capture', () => {
  it.each([undefined, '0', 'true'])('does not create directories, readers, subscriptions or a capture without opt-in: %s', async (flag) => {
    vi.stubEnv('ARAMGG_GAME_DIAGNOSTICS', flag)
    const { startGameDiagnostics, observeGameDiagnosticPhase, stopGameDiagnostics } = await import('../../src/main/services/diagnostics/game-diagnostics.ts')
    startGameDiagnostics({ packaged: true })
    observeGameDiagnosticPhase('ChampSelect', 'test')
    observeGameDiagnosticPhase('InProgress', 'test')
    await stopGameDiagnostics('app-quit')
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.reader).not.toHaveBeenCalled()
    expect(mocks.construct).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.phase).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('starts one unified recorder and forwards lifecycle events when explicitly enabled', async () => {
    vi.stubEnv('ARAMGG_GAME_DIAGNOSTICS', '1')
    const { startGameDiagnostics, observeGameDiagnosticPhase, stopGameDiagnostics } = await import('../../src/main/services/diagnostics/game-diagnostics.ts')
    startGameDiagnostics({ packaged: true })
    startGameDiagnostics({ packaged: true })
    observeGameDiagnosticPhase('InProgress', 'test')
    await stopGameDiagnostics('app-quit')
    expect(mocks.reader).toHaveBeenCalledTimes(1)
    expect(mocks.construct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subscribe: mocks.subscribe }))
    expect(mocks.phase).toHaveBeenCalledWith('InProgress', 'test')
    expect(mocks.stop).toHaveBeenCalledWith('app-quit')
  })
})
