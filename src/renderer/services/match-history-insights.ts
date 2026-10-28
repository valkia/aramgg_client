import type { HextechAramMatchHistoryMatch, HextechAramMatchParticipant } from '../../shared/ipc-contract.ts'

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

export function buildScoreboardTeams(participants: readonly HextechAramMatchParticipant[]) {
  const teams = new Map<number, HextechAramMatchParticipant[]>()
  for (const participant of participants) {
    const team = teams.get(participant.teamId) || []
    if (!team.some((entry) => entry.participantId === participant.participantId)) team.push(participant)
    teams.set(participant.teamId, team)
  }
  return [...teams.entries()].map(([teamId, players]) => {
    // Incomplete SGP responses must not turn one visible player into "100% of the team".
    const complete = players.length === 5 && (teamId === 100 || teamId === 200)
    const total = (key: 'damageToChampions' | 'damageTaken' | 'goldEarned') =>
      complete && players.every((player) => player[key] !== null)
        ? players.reduce((sum, player) => sum + player[key]!, 0)
        : null
    const damage = total('damageToChampions')
    const gold = total('goldEarned')
    const kills = players.reduce((sum, player) => sum + player.kills, 0)
    const topDamage = damage !== null && damage > 0 ? Math.max(...players.map((player) => player.damageToChampions!)) : null
    return {
      teamId,
      isCurrentTeam: players.some((player) => player.isCurrentPlayer),
      result: players.every((player) => player.result === players[0].result) ? players[0].result : null,
      complete, kills, damage, gold,
      players: [...players].sort((a, b) => a.participantId - b.participantId).map((player) => ({
        ...player,
        damageShare: damage !== null && damage > 0 && player.damageToChampions !== null ? player.damageToChampions / damage * 100 : null,
        killParticipation: complete && kills > 0 ? Math.min(100, (player.kills + player.assists) / kills * 100) : null,
        isTopDamage: topDamage !== null && player.damageToChampions === topDamage,
      })),
    }
  }).sort((a, b) => Number(b.isCurrentTeam) - Number(a.isCurrentTeam) || a.teamId - b.teamId)
}
