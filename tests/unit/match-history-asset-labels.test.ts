import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HextechAramQueryService } from '../../src/main/services/match-history/hextech-aram-query-service.ts'
import type LCUService from '../../src/main/services/lcu/lcu-service.ts'

const localData = vi.hoisted(() => ({
  getDataLocale: vi.fn(), loadAugmentDetail: vi.fn(), loadChampionRoster: vi.fn(), loadItems: vi.fn(),
}))
const { getSummaries } = vi.hoisted(() => ({ getSummaries: vi.fn() }))
vi.mock('../../src/main/data-loader.ts', () => localData)
vi.mock('../../src/main/services/match-history/sgp-match-history-service.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/main/services/match-history/sgp-match-history-service.ts')>(),
  SgpMatchHistoryService: class { getHextechAramSummaries = getSummaries },
}))
const puuid = '11111111-1111-1111-1111-111111111111'
const lcu = { getCurrentSummoner: vi.fn().mockResolvedValue({ puuid, platformId: 'HN1' }) } as unknown as LCUService

beforeEach(() => {
  localData.loadChampionRoster.mockResolvedValue([])
  getSummaries.mockResolvedValue([{
    gameId: 1, gameCreation: 1_000, gameDuration: 900, gameMode: 'KIWI', queueId: 2400,
    participants: [{ participantId: 1, puuid, championId: 103, teamId: 100, win: true, playerAugment1: 18, playerAugment2: 42, item0: 1001 }],
  }])
})

describe('local match-history asset labels', () => {
  it.each([
    ['zh-CN', '鞋子', '移动速度'], ['en-US', 'Boots', 'Move speed'], ['zh-TW', '鞋子', '跑速'],
  ])('uses the committed %s dataset for both list and participant descriptions', async (locale, name, description) => {
    localData.getDataLocale.mockReturnValue(locale)
    localData.loadAugmentDetail.mockResolvedValue({
      18: { name: 'Lotus', description: { [locale.replace('-', '_')]: description }, rarity: 'kPrismatic' },
      42: { name: 'Upgrade', description: null, tooltip: '<mainText>Fallback tooltip</mainText>', rarity: 'kGold' },
    })
    // loadItems' compatibility wrapper aliases all contain the selected dataset's text.
    localData.loadItems.mockResolvedValue([{ id: 1001, name: { zh_CN: name, zh_cn: name, en_us: name }, description: { zh_CN: description, zh_cn: description, en_us: description } }])
    const page = await new HextechAramQueryService(lcu).queryCurrent()
    for (const loader of [localData.loadChampionRoster, localData.loadAugmentDetail, localData.loadItems]) {
      expect(loader).toHaveBeenCalledWith(locale)
    }
    expect(getSummaries).toHaveBeenCalledTimes(1)
    const match = page.matches[0]
    expect(match.items).toEqual([{ id: 1001, name, description }])
    expect(match.augments).toEqual([
      { id: 18, name: 'Lotus', description, rarity: 'kPrismatic' },
      { id: 42, name: 'Upgrade', description: '<mainText>Fallback tooltip</mainText>', rarity: 'kGold' },
    ])
    expect(match.participants?.[0].items).toEqual(match.items)
    expect(match.participants?.[0].augments).toEqual(match.augments)
  })

  it('keeps unknown assets usable when local labels are unavailable', async () => {
    localData.getDataLocale.mockReturnValue('en-US')
    localData.loadAugmentDetail.mockRejectedValue(new Error('Local data unavailable'))
    localData.loadItems.mockResolvedValue([])
    const match = (await new HextechAramQueryService(lcu).queryCurrent()).matches[0]
    expect(match.items).toEqual([{ id: 1001 }])
    expect(match.augments).toEqual([{ id: 18 }, { id: 42 }])
  })
})
