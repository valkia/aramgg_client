import { describe, expect, it } from 'vitest'
import { buildLocalMatchHistorySummary } from '../../src/main/services/match-history/statistics.ts'
import type { LocalMatchHistoryData, StoredMatchHistoryGame } from '../../src/main/services/match-history/types.ts'

const playerOne = '11111111-1111-1111-1111-111111111111'
const playerTwo = '22222222-2222-2222-2222-222222222222'

function game(overrides: Partial<StoredMatchHistoryGame>): StoredMatchHistoryGame {
  return {
    gameKey: 'HN10:1',
    platformId: 'HN10',
    gameId: 1,
    gameCreation: 100,
    gameDuration: 900,
    gameMode: 'ARAM',
    gameModeMutators: [],
    gameType: 'MATCHED_GAME',
    gameVersion: '16.15',
    mapId: 12,
    queueId: 450,
    endOfGameResult: 'GameComplete',
    collectedAt: 200,
    participants: [
      {
        participantId: 1,
        puuid: playerOne,
        gameName: 'Player One',
        tagLine: 'CN1',
        championId: 1,
        teamId: 100,
        playerSubteamId: 0,
        subteamPlacement: 0,
        win: true,
        gameEndedInEarlySurrender: false,
        kills: 10,
        deaths: 2,
        assists: 8,
        items: [1001, 1001, 2003],
        augments: [],
      },
    ],
    ...overrides,
  }
}

function participant(overrides: Partial<StoredMatchHistoryGame['participants'][number]> = {}) {
  return {
    participantId: 1,
    puuid: playerOne,
    gameName: 'Player One',
    tagLine: 'CN1',
    championId: 266,
    teamId: 100,
    playerSubteamId: 0,
    subteamPlacement: 0,
    win: true,
    gameEndedInEarlySurrender: false,
    kills: 4,
    deaths: 1,
    assists: 5,
    items: [223047, 2003],
    augments: [18, 42],
    ...overrides,
  }
}

function source(games: StoredMatchHistoryGame[]): LocalMatchHistoryData {
  return {
    schemaVersion: 2,
    updatedAt: 500,
    installationId: '11111111-1111-4111-8111-111111111111',
    activePlatformId: 'HN10',
    currentPlayerKey: `HN10:${playerOne}`,
    players: {
      [`HN10:${playerOne}`]: {
        playerKey: `HN10:${playerOne}`,
        puuid: playerOne,
        platformId: 'HN10',
        gameName: 'Player One',
        tagLine: 'CN1',
        summonerId: null,
        isCurrentUser: true,
        isDirectEncounter: true,
        firstSeenAt: 100,
        lastSeenAt: 500,
        historyCollectedAt: 500,
        lastHistoryScanAt: 500,
        collectionSource: 'current',
      },
      [`HN10:${playerTwo}`]: {
        playerKey: `HN10:${playerTwo}`,
        puuid: playerTwo,
        platformId: 'HN10',
        gameName: 'Player Two',
        tagLine: 'CN2',
        summonerId: null,
        isCurrentUser: false,
        isDirectEncounter: true,
        firstSeenAt: 100,
        lastSeenAt: 500,
        historyCollectedAt: null,
        lastHistoryScanAt: null,
        collectionSource: null,
      },
    },
    games: Object.fromEntries(games.map((entry) => [entry.gameKey, entry])),
    uploadOutbox: {},
    uploadedGameTombstones: {},
  }
}

describe('local match-history statistics', () => {
  it('counts only KIWI / Hextech ARAM, excluding normal ARAM and Arena', () => {
    const normalAram = game({ gameKey: 'HN10:1', gameId: 1 })
    const kiwiWin = game({
      gameKey: 'HN10:2',
      gameId: 2,
      gameMode: 'KIWI',
      gameModeMutators: ['aram_mayhem'],
      participants: [participant()],
    })
    const kiwiLoss = game({
      gameKey: 'HN10:3',
      gameId: 3,
      gameMode: 'KIWI',
      gameModeMutators: ['aram_mayhem'],
      participants: [participant({ win: false, augments: [18, 99] })],
    })
    const kiwiRemake = game({
      gameKey: 'HN10:4',
      gameId: 4,
      gameMode: 'KIWI',
      gameModeMutators: ['aram_mayhem'],
      participants: [participant({ gameEndedInEarlySurrender: true, items: [1001], augments: [18] })],
    })
    const arena = game({
      gameKey: 'HN10:5',
      gameId: 5,
      gameMode: 'CHERRY',
      mapId: 30,
      queueId: 1700,
      participants: [participant({ items: [9999], augments: [777] })],
    })

    const summary = buildLocalMatchHistorySummary(source([
      normalAram,
      kiwiWin,
      kiwiLoss,
      kiwiRemake,
      arena,
    ]))

    expect(summary.overview).toMatchObject({
      gameCount: 5,
      playerCount: 2,
      hextechAramGameCount: 3,
      availableMatchedPlayerCount: 1,
    })
    expect(summary.augmentStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ championId: 266, subjectId: 18, samples: 2, wins: 1, winRate: 0.5 }),
      expect.objectContaining({ championId: 266, subjectId: 42, samples: 1, wins: 1, winRate: 1 }),
      expect.objectContaining({ championId: 266, subjectId: 99, samples: 1, wins: 0, winRate: 0 }),
    ]))
    expect(summary.itemStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ championId: 266, subjectId: 223047, samples: 2, wins: 1, winRate: 0.5 }),
      expect.objectContaining({ championId: 266, subjectId: 2003, samples: 2, wins: 1, winRate: 0.5 }),
    ]))
    expect(summary.itemStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: 1001 }),
      expect.objectContaining({ subjectId: 9999 }),
    ]))
  })

  it('keeps the active platform separate when game IDs overlap across regions', () => {
    const hnGame = game({
      gameKey: 'HN10:1',
      gameId: 1,
      platformId: 'HN10',
      gameMode: 'KIWI',
      gameModeMutators: ['aram_mayhem'],
      participants: [participant()],
    })
    const naGame = game({
      gameKey: 'NA1:1',
      gameId: 1,
      platformId: 'NA1',
      gameMode: 'KIWI',
      gameModeMutators: ['aram_mayhem'],
      participants: [participant({ items: [9999] })],
    })

    const summary = buildLocalMatchHistorySummary(source([hnGame, naGame]))

    expect(summary.overview).toMatchObject({
      platformId: 'HN10',
      gameCount: 1,
      hextechAramGameCount: 1,
    })
    expect(summary.itemStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: 9999 }),
    ]))
  })
})
