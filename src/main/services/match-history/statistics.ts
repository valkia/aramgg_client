import type {
  LocalMatchHistoryOverview,
  LocalMatchHistoryRecentMatch,
  LocalMatchHistoryStat,
  LocalMatchHistorySummary,
} from '../../../shared/ipc-contract.ts'
import type {
  LocalMatchHistoryData,
  StoredMatchHistoryGame,
  StoredMatchHistoryParticipant,
} from './types.ts'

export const HEXTECH_ARAM_GAME_MODE = 'KIWI'

/**
 * 海克斯大乱斗 / ARAM: Mayhem is exposed by the client as KIWI. The fallback
 * covers client versions that only expose a Kiwi/Mayhem mutator plus augment slots.
 */
export function isHextechAramGame(game: StoredMatchHistoryGame): boolean {
  const mode = game.gameMode.toUpperCase()
  if (mode === HEXTECH_ARAM_GAME_MODE) {
    return true
  }

  const hasMayhemMutator = Array.isArray(game.gameModeMutators) && game.gameModeMutators.some((mutator) =>
    /(?:kiwi|mayhem)/i.test(mutator),
  )
  const hasAugments = game.participants.some((participant) => participant.augments.some((augmentId) => augmentId > 0))
  return game.mapId === 12 && hasMayhemMutator && hasAugments
}

function isCountableGame(game: StoredMatchHistoryGame, participant: StoredMatchHistoryParticipant): boolean {
  return !game.endOfGameResult.startsWith('Abort_') && !participant.gameEndedInEarlySurrender
}

function formatPlayerName(gameName: string, tagLine: string): string {
  if (!gameName) {
    return ''
  }

  return tagLine ? `${gameName}#${tagLine}` : gameName
}

function getActivePlatformGames(data: LocalMatchHistoryData): StoredMatchHistoryGame[] {
  if (!data.activePlatformId) {
    return []
  }

  return Object.values(data.games).filter((game) => game.platformId === data.activePlatformId)
}

type Aggregate = {
  championId: number
  subjectId: number
  samples: number
  wins: number
}

function buildStatRows(
  games: StoredMatchHistoryGame[],
  includes: (game: StoredMatchHistoryGame) => boolean,
  values: (participant: StoredMatchHistoryParticipant) => number[],
): LocalMatchHistoryStat[] {
  const aggregates = new Map<string, Aggregate>()

  for (const game of games) {
    if (!includes(game)) {
      continue
    }

    for (const participant of game.participants) {
      if (!isCountableGame(game, participant)) {
        continue
      }

      const subjectIds = new Set(values(participant).filter((value) => Number.isInteger(value) && value > 0))
      for (const subjectId of subjectIds) {
        const key = `${participant.championId}:${subjectId}`
        const aggregate = aggregates.get(key) || {
          championId: participant.championId,
          subjectId,
          samples: 0,
          wins: 0,
        }
        aggregate.samples += 1
        if (participant.win) {
          aggregate.wins += 1
        }
        aggregates.set(key, aggregate)
      }
    }
  }

  return [...aggregates.values()]
    .map((aggregate) => ({
      championId: aggregate.championId,
      subjectId: aggregate.subjectId,
      samples: aggregate.samples,
      wins: aggregate.wins,
      winRate: aggregate.samples ? aggregate.wins / aggregate.samples : 0,
    }))
    .sort((left, right) =>
      right.samples - left.samples ||
      right.winRate - left.winRate ||
      left.championId - right.championId ||
      left.subjectId - right.subjectId,
    )
}

function buildRecentMatches(
  games: StoredMatchHistoryGame[],
  currentPlayerPuuid: string | null,
): LocalMatchHistoryRecentMatch[] {
  if (!currentPlayerPuuid) {
    return []
  }

  return games
    .map((game) => {
      const participant = game.participants.find((item) => item.puuid === currentPlayerPuuid)
      if (!participant) {
        return null
      }

      return {
        gameId: game.gameId,
        gameCreation: game.gameCreation,
        gameMode: game.gameMode || (isHextechAramGame(game) ? HEXTECH_ARAM_GAME_MODE : String(game.queueId)),
        queueId: game.queueId,
        championId: participant.championId,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        win: participant.win,
        subteamPlacement: participant.subteamPlacement > 0 ? participant.subteamPlacement : null,
      } satisfies LocalMatchHistoryRecentMatch
    })
    .filter((match): match is LocalMatchHistoryRecentMatch => match !== null)
    .sort((left, right) => right.gameCreation - left.gameCreation)
    .slice(0, 8)
}

export function buildLocalMatchHistorySummary(data: LocalMatchHistoryData): LocalMatchHistorySummary {
  const activeGames = getActivePlatformGames(data)
  const currentPlayer = data.currentPlayerKey ? data.players[data.currentPlayerKey] : null
  const activePlayers = Object.values(data.players)
    .filter((player) => player.platformId === data.activePlatformId)
  const overview: LocalMatchHistoryOverview = {
    platformId: data.activePlatformId,
    gameCount: activeGames.length,
    playerCount: activePlayers.length,
    hextechAramGameCount: activeGames.filter(isHextechAramGame).length,
    availableMatchedPlayerCount: activePlayers.filter(
      (player) => player.isDirectEncounter === true && !player.isCurrentUser && !player.lastHistoryScanAt,
    ).length,
    pendingUploadCount: Object.values(data.uploadOutbox).filter(
      (entry) => entry.platformId === data.activePlatformId && (
        entry.status === 'pending' || entry.status === 'uploading'
      ),
    ).length,
  }

  return {
    updatedAt: data.updatedAt,
    currentPlayer: currentPlayer
      ? {
          name: formatPlayerName(currentPlayer.gameName, currentPlayer.tagLine),
        }
      : null,
    overview,
    recentMatches: buildRecentMatches(activeGames, currentPlayer?.puuid || null),
    augmentStats: buildStatRows(activeGames, isHextechAramGame, (participant) => participant.augments),
    itemStats: buildStatRows(activeGames, isHextechAramGame, (participant) => participant.items),
  }
}
