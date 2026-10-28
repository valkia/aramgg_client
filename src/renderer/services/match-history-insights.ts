import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'

export function summarizeMatches(matches: readonly HextechAramMatchHistoryMatch[]) {
  const ordered = [...new Map(matches.map((match) => [match.gameId, match])).values()]
    .sort((a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId)
  const completed = ordered.filter((match) => match.result !== 'remake')
  const wins = completed.filter((match) => match.result === 'win').length
  const total = completed.reduce((sum, match) => ({
    kills: sum.kills + match.kills,
    deaths: sum.deaths + match.deaths,
    assists: sum.assists + match.assists,
  }), { kills: 0, deaths: 0, assists: 0 })
  const first = ordered[0]
  let streak = 0
  if (first && first.result !== 'remake') {
    for (const match of ordered) {
      if (match.result !== first.result) break
      streak += 1
    }
  }
  return {
    ordered,
    completed: completed.length,
    wins,
    losses: completed.length - wins,
    remakes: ordered.length - completed.length,
    winRate: completed.length ? wins / completed.length * 100 : null,
    kda: completed.length ? (total.kills + total.assists) / Math.max(1, total.deaths) : null,
    averageKills: completed.length ? total.kills / completed.length : 0,
    averageDeaths: completed.length ? total.deaths / completed.length : 0,
    averageAssists: completed.length ? total.assists / completed.length : 0,
    streak,
    streakResult: first?.result ?? null,
  }
}
