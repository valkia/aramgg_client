import type { HextechAramMatchHistoryMatch, HextechAramMatchResult } from '../../shared/ipc-contract.ts'
import { isPlayerKey } from '../../shared/player-notes.ts'

export interface MatchEncounter {
  gameId: number
  gameCreation: number
  sameTeam: boolean
  result: HextechAramMatchResult
  championId: number
  championName?: string
  kills: number
  deaths: number
  assists: number
}

export interface RepeatedPlayer {
  playerKey: string
  playerName: string
  encounters: MatchEncounter[]
  sameTeam: number
  opponents: number
  wins: number
  losses: number
  remakes: number
}

export function buildMatchEncounters(matches: readonly HextechAramMatchHistoryMatch[]) {
  const unique = [...new Map(matches.map((match) => [match.gameId, match])).values()]
    .sort((a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId)
  const players = new Map<string, RepeatedPlayer>()
  let coveredMatches = 0
  for (const match of unique) {
    const participants = match.participants || []
    const current = participants.filter((player) => player.isCurrentPlayer)
    if (current.length !== 1 || ![100, 200].includes(current[0].teamId)) continue
    const known = participants.filter((player) => !player.isCurrentPlayer && isPlayerKey(player.playerKey)
      && player.playerKey !== current[0].playerKey && [100, 200].includes(player.teamId))
    const byKey = new Map(known.map((player) => [player.playerKey!, player]))
    // Conflicting copies cannot establish whether this player was a teammate or opponent.
    for (const player of known) if (byKey.get(player.playerKey!)?.teamId !== player.teamId) byKey.delete(player.playerKey!)
    if (!byKey.size) continue
    coveredMatches += 1
    for (const [playerKey, player] of byKey) {
      let entry = players.get(playerKey)
      if (!entry) {
        entry = { playerKey, playerName: player.playerName, encounters: [], sameTeam: 0, opponents: 0, wins: 0, losses: 0, remakes: 0 }
        players.set(playerKey, entry)
      }
      const sameTeam = player.teamId === current[0].teamId
      entry.encounters.push({ gameId: match.gameId, gameCreation: match.gameCreation, sameTeam, result: match.result,
        championId: player.championId, championName: player.championName, kills: player.kills, deaths: player.deaths, assists: player.assists })
      if (sameTeam) entry.sameTeam += 1
      else entry.opponents += 1
      if (match.result === 'win') entry.wins += 1
      else if (match.result === 'loss') entry.losses += 1
      else entry.remakes += 1
    }
  }
  return { totalMatches: unique.length, coveredMatches, players: [...players.values()]
    .filter((player) => player.encounters.length > 1)
    .sort((a, b) => b.encounters.length - a.encounters.length || b.encounters[0].gameCreation - a.encounters[0].gameCreation || a.playerKey.localeCompare(b.playerKey)) }
}
