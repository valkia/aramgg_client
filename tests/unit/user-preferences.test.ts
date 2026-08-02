import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../src/main/modules/app-store.ts', () => ({
  default: { get: mocks.get },
}))

import { shouldShowChampionDetails } from '../../src/main/modules/user-preferences.ts'

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
})
