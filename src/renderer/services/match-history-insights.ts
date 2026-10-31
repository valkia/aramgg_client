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
    performance: summarizePerformance(completed),
    streak,
    streakResult: first?.result ?? null,
  }
}

function isStat(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function average(values: number[]) {
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, samples: values.length }
}

function summarizePerformance(matches: readonly HextechAramMatchHistoryMatch[]) {
  const damage: number[] = []
  const participation: number[] = []
  const gold: number[] = []
  const goldShare: number[] = []
  for (const match of matches) {
    const participants = match.participants || []
    const currentPlayers = participants.filter((player) => player.isCurrentPlayer)
    if (currentPlayers.length !== 1) continue
    const current = currentPlayers[0]
    const hasUniqueIdentity = (player: HextechAramMatchParticipant) =>
      Number.isSafeInteger(player.participantId) && player.participantId > 0
      && participants.filter((entry) => entry.participantId === player.participantId).length === 1
      && (!player.playerKey || participants.filter((entry) => entry.playerKey === player.playerKey).length === 1)
    // Ambiguous identity cannot establish whose individual performance this is.
    if (!hasUniqueIdentity(current) || current.championId !== match.championId || current.result !== match.result) continue
    if (isStat(current.damageToChampions)) damage.push(current.damageToChampions)
    if (isStat(current.goldEarned)) gold.push(current.goldEarned)

    const team = participants.filter((player) => player.teamId === current.teamId)
    if (![100, 200].includes(current.teamId) || team.length !== 5
      || !team.every((player) => hasUniqueIdentity(player) && player.result === match.result)) continue

    // Raw nullable stats avoid treating normalizeGame's display fallback zero as measured data.
    const kills = team.map((player) => player.participationStats?.kills)
    const assists = current.participationStats?.assists
    if (kills.every(isStat) && isStat(assists)) {
      const teamKills = kills.reduce((sum, value) => sum + value, 0)
      const takedowns = current.participationStats!.kills! + assists
      if (Number.isSafeInteger(teamKills) && teamKills > 0 && takedowns <= teamKills) participation.push(takedowns / teamKills * 100)
    }
    const teamGold = team.map((player) => player.goldEarned)
    if (teamGold.every(isStat)) {
      const totalGold = teamGold.reduce((sum, value) => sum + value, 0)
      if (Number.isSafeInteger(totalGold) && totalGold > 0) goldShare.push(current.goldEarned! / totalGold * 100)
    }
  }
  return { damage: average(damage), participation: average(participation), gold: average(gold), goldShare: average(goldShare) }
}

export function perMinute(value: number | null, gameDuration: number) {
  if (!isStat(value) || !Number.isFinite(gameDuration) || gameDuration <= 0) return null
  const rate = value / gameDuration * 60
  return Number.isFinite(rate) ? rate : null
}

export function buildScoreboardTeams(participants: readonly HextechAramMatchParticipant[], gameDuration = 0) {
  const teams = new Map<number, HextechAramMatchParticipant[]>()
  for (const participant of participants) {
    const team = teams.get(participant.teamId) || []
    if (!team.some((entry) => entry.participantId === participant.participantId)) team.push(participant)
    teams.set(participant.teamId, team)
  }
  return [...teams.entries()].map(([teamId, players]) => {
    // A repeated identity or conflicting result cannot establish a complete team.
    const complete = players.length === 5 && (teamId === 100 || teamId === 200)
      && players.every((player) => Number.isSafeInteger(player.participantId) && player.participantId > 0
        && participants.filter((entry) => entry.participantId === player.participantId).length === 1
        && (!player.playerKey || participants.filter((entry) => entry.playerKey === player.playerKey).length === 1)
        && player.result === players[0].result)
    const total = (values: (number | null | undefined)[]) => {
      if (!complete || !values.every(isStat)) return null
      const sum = values.reduce((sum, value) => sum + value, 0)
      return Number.isSafeInteger(sum) ? sum : null
    }
    const damage = total(players.map((player) => player.damageToChampions))
    const taken = total(players.map((player) => player.damageTaken))
    const heal = total(players.map((player) => player.totalHeal))
    const gold = total(players.map((player) => player.goldEarned))
    const kills = total(players.map((player) => player.participationStats?.kills))
    const share = (value: number | null, sum: number | null) =>
      isStat(value) && sum !== null && sum > 0 ? value / sum * 100 : null
    const topDamage = damage !== null && damage > 0 ? Math.max(...players.map((player) => player.damageToChampions!)) : null
    return {
      teamId,
      isCurrentTeam: players.some((player) => player.isCurrentPlayer),
      result: players.every((player) => player.result === players[0].result) ? players[0].result : null,
      complete, kills, damage, taken, heal, gold,
      players: [...players].sort((a, b) => a.participantId - b.participantId).map((player) => {
        const rawKills = player.participationStats?.kills
        const assists = player.participationStats?.assists
        const takedowns = isStat(rawKills) && isStat(assists) ? rawKills + assists : null
        return {
          ...player,
          damageShare: share(player.damageToChampions, damage),
          takenShare: share(player.damageTaken, taken),
          healShare: share(player.totalHeal, heal),
          goldPerMinute: perMinute(player.goldEarned, gameDuration),
          csPerMinute: perMinute(player.minionsKilled, gameDuration),
          killParticipation: kills !== null && kills > 0 && takedowns !== null && takedowns <= kills ? takedowns / kills * 100 : null,
          isTopDamage: topDamage !== null && player.damageToChampions === topDamage,
        }
      }),
    }
  }).sort((a, b) => Number(b.isCurrentTeam) - Number(a.isCurrentTeam) || a.teamId - b.teamId)
}
