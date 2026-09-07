import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../src/main/modules/app-store.ts', () => ({
  default: { get: mocks.get },
}))

import {
  shouldHideChampionInsightOnGameStart,
  shouldKeepChampionInsightOnTop,
  shouldShowChampionDetails,
} from '../../src/main/modules/user-preferences.ts'

describe('user preferences', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('defaults Champion Details visibility to enabled', () => {
    mocks.get.mockReturnValue(undefined)
    expect(shouldShowChampionDetails()).toBe(true)
    expect(mocks.get).toHaveBeenCalledWith('championInsight.showDetails')
  })

  it('disables Champion Details only for an explicit false value', () => {
    mocks.get.mockReturnValue(false)
    expect(shouldShowChampionDetails()).toBe(false)

    mocks.get.mockReturnValue(true)
    expect(shouldShowChampionDetails()).toBe(true)
  })

  it('restores the previous hide-on-game-start preference and defaults to enabled', () => {
    expect(shouldHideChampionInsightOnGameStart()).toBe(true)
    expect(mocks.get).toHaveBeenCalledWith('championInsight.hideOnGameStart')
    mocks.get.mockReturnValue(false)
    expect(shouldHideChampionInsightOnGameStart()).toBe(false)
  })

  it('only enables always-on-top when the user has enabled it', () => {
    expect(shouldKeepChampionInsightOnTop()).toBe(false)
    expect(mocks.get).toHaveBeenCalledWith('championInsight.alwaysOnTop')
    mocks.get.mockReturnValue(true)
    expect(shouldKeepChampionInsightOnTop()).toBe(true)
    mocks.get.mockReturnValue(false)
    expect(shouldKeepChampionInsightOnTop()).toBe(false)
  })
})
