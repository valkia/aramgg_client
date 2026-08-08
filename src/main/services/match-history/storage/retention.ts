import type { LocalMatchHistoryData } from '../types.ts'

export const MAX_STORED_MATCH_HISTORY_GAMES = 2_000
export const MAX_UPLOADED_MATCH_HISTORY_TOMBSTONES = 50_000
export const MAX_REJECTED_MATCH_HISTORY_ENTRIES = 1_000
export const MAX_STORED_MATCH_HISTORY_PLAYERS = 5_000

export type MatchHistoryCompactionResult = {
  removedGames: number
  removedOutboxEntries: number
  removedTombstones: number
  removedPlayers: number
}

function sourceKey(platformId: string, gameId: number): string {
  return `match-history:v1:${platformId}:${gameId}`
}

function moveUploadedEntriesToTombstones(data: LocalMatchHistoryData): number {
  let moved = 0
  for (const [key, entry] of Object.entries(data.uploadOutbox)) {
    if (entry.status !== 'uploaded') continue
    data.uploadedGameTombstones[key] = {
      payloadHash: entry.payloadHash,
      uploadedAt: entry.uploadedAt ?? entry.lastAttemptAt ?? entry.queuedAt,
    }
    delete data.uploadOutbox[key]
    moved += 1
  }
  return moved
}

/**
 * Bounds completed local data while preserving every item that can still be uploaded.
 * Uploaded hashes remain as compact tombstones so repeated SGP windows stay idempotent.
 */
export function compactLocalMatchHistoryData(data: LocalMatchHistoryData): MatchHistoryCompactionResult {
  const before = {
    games: Object.keys(data.games).length,
    outbox: Object.keys(data.uploadOutbox).length,
    tombstones: Object.keys(data.uploadedGameTombstones).length,
    players: Object.keys(data.players).length,
  }
  const movedUploadedEntries = moveUploadedEntriesToTombstones(data)

  const activeGameKeys = new Set(Object.values(data.uploadOutbox)
    .filter((entry) => entry.status === 'pending' || entry.status === 'uploading')
    .map((entry) => `${entry.platformId}:${entry.gameId}`))
  if (before.games > MAX_STORED_MATCH_HISTORY_GAMES) {
    const keptGameKeys = new Set(activeGameKeys)
    const completedGameSlots = Math.max(0, MAX_STORED_MATCH_HISTORY_GAMES - activeGameKeys.size)
    const completedGames = Object.entries(data.games)
      .filter(([key]) => !activeGameKeys.has(key))
      .sort(([, left], [, right]) => right.gameCreation - left.gameCreation || right.collectedAt - left.collectedAt)
    for (const [key] of completedGames.slice(0, completedGameSlots)) keptGameKeys.add(key)
    for (const key of Object.keys(data.games)) {
      if (!keptGameKeys.has(key)) delete data.games[key]
    }
  }

  const keptSourceKeys = new Set(Object.values(data.games)
    .map((game) => sourceKey(game.platformId, game.gameId)))
  const requiredRejected = new Set(Object.entries(data.uploadOutbox)
    .filter(([key, entry]) => entry.status === 'rejected' && keptSourceKeys.has(key))
    .map(([key]) => key))
  const rejectedSlots = Math.max(0, MAX_REJECTED_MATCH_HISTORY_ENTRIES - requiredRejected.size)
  const recentRejected = Object.entries(data.uploadOutbox)
    .filter(([key, entry]) => entry.status === 'rejected' && !requiredRejected.has(key))
    .sort(([, left], [, right]) => (
      (right.lastAttemptAt ?? right.queuedAt) - (left.lastAttemptAt ?? left.queuedAt)
    ))
    .slice(0, rejectedSlots)
  const keptRejected = new Set([...requiredRejected, ...recentRejected.map(([key]) => key)])
  for (const [key, entry] of Object.entries(data.uploadOutbox)) {
    if (entry.status === 'rejected' && !keptRejected.has(key)) delete data.uploadOutbox[key]
  }

  if (Object.keys(data.uploadedGameTombstones).length > MAX_UPLOADED_MATCH_HISTORY_TOMBSTONES) {
    const requiredTombstones = new Set(Object.keys(data.uploadedGameTombstones)
      .filter((key) => keptSourceKeys.has(key)))
    const tombstoneSlots = Math.max(0, MAX_UPLOADED_MATCH_HISTORY_TOMBSTONES - requiredTombstones.size)
    const recentTombstones = Object.entries(data.uploadedGameTombstones)
      .filter(([key]) => !requiredTombstones.has(key))
      .sort(([, left], [, right]) => right.uploadedAt - left.uploadedAt)
      .slice(0, tombstoneSlots)
    const keptTombstones = new Set([...requiredTombstones, ...recentTombstones.map(([key]) => key)])
    for (const key of Object.keys(data.uploadedGameTombstones)) {
      if (!keptTombstones.has(key)) delete data.uploadedGameTombstones[key]
    }
  }

  if (before.players > MAX_STORED_MATCH_HISTORY_PLAYERS) {
    const requiredPlayers = new Set<string>()
    if (data.currentPlayerKey) requiredPlayers.add(data.currentPlayerKey)
    for (const game of Object.values(data.games)) {
      for (const participant of game.participants) {
        if (participant.puuid) requiredPlayers.add(`${game.platformId}:${participant.puuid}`)
      }
    }
    for (const player of Object.values(data.players)) {
      if (player.isDirectEncounter && !player.isCurrentUser && !player.lastHistoryScanAt) {
        requiredPlayers.add(player.playerKey)
      }
    }
    const playerSlots = Math.max(0, MAX_STORED_MATCH_HISTORY_PLAYERS - requiredPlayers.size)
    const recentPlayers = Object.values(data.players)
      .filter((player) => !requiredPlayers.has(player.playerKey))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, playerSlots)
    const keptPlayers = new Set([...requiredPlayers, ...recentPlayers.map((player) => player.playerKey)])
    for (const key of Object.keys(data.players)) {
      if (!keptPlayers.has(key)) delete data.players[key]
    }
  }

  return {
    removedGames: before.games - Object.keys(data.games).length,
    removedOutboxEntries: before.outbox - Object.keys(data.uploadOutbox).length,
    removedTombstones: before.tombstones + movedUploadedEntries - Object.keys(data.uploadedGameTombstones).length,
    removedPlayers: before.players - Object.keys(data.players).length,
  }
}
