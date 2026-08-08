import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  LocalMatchHistoryRecentMatch,
  LocalMatchHistoryStat,
  LocalMatchHistorySummary,
} from '../../../shared/ipc-contract.ts'
import { getMatchHistoryDataDir } from '../../modules/app-paths.ts'
import logger from '../../modules/logger.ts'
import type LCUService from '../lcu/lcu-service.ts'
import {
  BACKGROUND_MATCHED_MATCH_LIMIT,
  BACKGROUND_MATCHED_PLAYER_LIMIT,
  BACKGROUND_REQUEST_PACING_MS,
  getBackgroundCurrentMatchLimit,
} from './collection-policy.ts'
import {
  MATCH_HISTORY_DEV_DIAGNOSTICS_ENABLED,
  logMatchHistoryDev,
} from './dev-diagnostics.ts'
import { buildLocalMatchHistorySummary, isHextechAramGame } from './statistics.ts'
import { compactLocalMatchHistoryData } from './storage/retention.ts'
import {
  SGP_MATCH_HISTORY_MAX_PAGE_SIZE,
  SgpMatchHistoryInterruptedError,
  SgpMatchHistoryService,
} from './sgp-match-history-service.ts'
import {
  claimMatchHistoryUploadBatch,
  getGameKey,
  getNextPendingMatchHistoryUploadPlatform,
  queueGameForUpload,
  resolveMatchHistoryUploadBatch,
} from './upload-outbox.ts'
import {
  LOCAL_MATCH_HISTORY_SCHEMA_VERSION,
  type ClaimedMatchHistoryUploadSample,
  type LocalMatchHistoryData,
  type MatchHistoryUploadTelemetry,
  type MatchHistoryCollectionSource,
  type MatchHistoryUploadOutboxEntry,
  type MatchHistoryUploadResolution,
  type StoredMatchHistoryGame,
  type StoredMatchHistoryParticipant,
  type StoredMatchHistoryPlayer,
  type UploadedMatchHistoryTombstone,
} from './types.ts'

const HISTORY_PAGE_SIZE = SGP_MATCH_HISTORY_MAX_PAGE_SIZE
const HISTORY_PAGE_OVERLAP = 20
const MAX_RETURNED_STAT_ROWS = 50
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYLOAD_HASH_PATTERN = /^[a-f0-9]{64}$/
const UPLOAD_SOURCE_KEY_PATTERN = /^match-history:v1:[A-Z0-9]{2,16}:[0-9]+$/

type AnyRecord = Record<string, unknown>

type CollectionOutcome = {
  playerKey: string
  gameCount: number
  failed: boolean
  interrupted: boolean
}

type PlayerTarget = {
  playerKey: string
  puuid: string
  platformId: string
  source: MatchHistoryCollectionSource
}

type PlayerScanOptions = {
  matchLimit: number
  shouldContinue?: () => Promise<boolean>
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function asPositiveInteger(value: unknown): number | null {
  const numberValue = asFiniteNumber(value, 0)
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null
}

function asNonNegativeInteger(value: unknown): number {
  const numberValue = asFiniteNumber(value, 0)
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0
}

function normalizeInstallationId(value: unknown): string {
  return typeof value === 'string' && INSTALLATION_ID_PATTERN.test(value)
    ? value.toLowerCase()
    : randomUUID()
}

function normalizeUploadedGameTombstones(value: unknown): Record<string, UploadedMatchHistoryTombstone> {
  if (!isRecord(value)) return {}
  const tombstones: Record<string, UploadedMatchHistoryTombstone> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!UPLOAD_SOURCE_KEY_PATTERN.test(key)
      || !isRecord(entry)
      || !PAYLOAD_HASH_PATTERN.test(asString(entry.payloadHash))) continue
    const uploadedAt = asFiniteNumber(entry.uploadedAt)
    if (uploadedAt <= 0) continue
    tombstones[key] = { payloadHash: asString(entry.payloadHash), uploadedAt }
  }
  return tombstones
}

function isValidPuuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(value)
}

function normalizePlatformId(value: unknown, fallback = 'UNKNOWN'): string {
  const platformId = asString(value).toUpperCase()
  return /^[A-Z0-9-]{2,24}$/.test(platformId) ? platformId : fallback
}

function getPlayerKey(platformId: string, puuid: string): string {
  return `${platformId}:${puuid}`
}

function createEmptyData(): LocalMatchHistoryData {
  return {
    schemaVersion: LOCAL_MATCH_HISTORY_SCHEMA_VERSION,
    updatedAt: 0,
    installationId: randomUUID(),
    activePlatformId: null,
    currentPlayerKey: null,
    players: {},
    games: {},
    uploadOutbox: {},
    uploadedGameTombstones: {},
  }
}

function getHistoryPlatformId(payload: unknown, fallbackPlatformId: string): string {
  return isRecord(payload)
    ? normalizePlatformId(payload.platformId, fallbackPlatformId)
    : fallbackPlatformId
}

export function normalizeGame(gamePayload: unknown, fallbackPlatformId: string, collectedAt: number): StoredMatchHistoryGame | null {
  if (!isRecord(gamePayload)) {
    return null
  }

  const gameId = asPositiveInteger(gamePayload.gameId)
  const rawParticipants = Array.isArray(gamePayload.participants) ? gamePayload.participants : []
  if (!gameId || !rawParticipants.length) {
    return null
  }

  const platformId = normalizePlatformId(gamePayload.platformId, fallbackPlatformId)
  const identityByParticipantId = new Map<number, AnyRecord>()
  const identities = Array.isArray(gamePayload.participantIdentities) ? gamePayload.participantIdentities : []
  for (const identity of identities) {
    if (!isRecord(identity)) {
      continue
    }

    const participantId = asPositiveInteger(identity.participantId)
    const player = isRecord(identity.player) ? identity.player : null
    if (participantId && player) {
      identityByParticipantId.set(participantId, player)
    }
  }

  const participants: StoredMatchHistoryParticipant[] = []
  for (const rawParticipant of rawParticipants) {
    if (!isRecord(rawParticipant)) {
      continue
    }

    const participantId = asPositiveInteger(rawParticipant.participantId)
    const championId = asPositiveInteger(rawParticipant.championId)
    // LCU nests end-of-game values under stats; SGP SUMMARY exposes them flat.
    const stats = isRecord(rawParticipant.stats) ? rawParticipant.stats : rawParticipant
    if (!participantId || !championId) {
      continue
    }

    const identity = identityByParticipantId.get(participantId) || rawParticipant
    const puuid = isValidPuuid(identity.puuid) ? identity.puuid : null
    const itemIds = [
      stats.item0,
      stats.item1,
      stats.item2,
      stats.item3,
      stats.item4,
      stats.item5,
      stats.item6,
    ].map(asPositiveInteger).filter((itemId): itemId is number => itemId !== null)
    const augmentIds = [
      stats.playerAugment1,
      stats.playerAugment2,
      stats.playerAugment3,
      stats.playerAugment4,
      stats.playerAugment5,
      stats.playerAugment6,
    ].map(asPositiveInteger).filter((augmentId): augmentId is number => augmentId !== null)

    participants.push({
      participantId,
      puuid,
      gameName: asString(identity.riotIdGameName) || asString(identity.gameName) || asString(identity.summonerName),
      tagLine: asString(identity.riotIdTagline) || asString(identity.tagLine),
      championId,
      teamId: asNonNegativeInteger(rawParticipant.teamId),
      playerSubteamId: asNonNegativeInteger(stats.playerSubteamId),
      subteamPlacement: asNonNegativeInteger(stats.subteamPlacement),
      win: stats.win === true,
      gameEndedInEarlySurrender: stats.gameEndedInEarlySurrender === true,
      kills: asNonNegativeInteger(stats.kills),
      deaths: asNonNegativeInteger(stats.deaths),
      assists: asNonNegativeInteger(stats.assists),
      items: itemIds,
      augments: augmentIds,
    })
  }

  if (!participants.length) {
    return null
  }

  return {
    gameKey: getGameKey(platformId, gameId),
    platformId,
    gameId,
    gameCreation: asFiniteNumber(gamePayload.gameCreation, collectedAt),
    gameDuration: asNonNegativeInteger(gamePayload.gameDuration),
    gameMode: asString(gamePayload.gameMode),
    gameModeMutators: Array.isArray(gamePayload.gameModeMutators)
      ? gamePayload.gameModeMutators.map(asString).filter(Boolean)
      : [],
    gameType: asString(gamePayload.gameType),
    gameVersion: asString(gamePayload.gameVersion),
    mapId: asNonNegativeInteger(gamePayload.mapId),
    queueId: asNonNegativeInteger(gamePayload.queueId),
    endOfGameResult: asString(gamePayload.endOfGameResult),
    participants,
    collectedAt,
  }
}

function getItemName(item: unknown): string {
  if (!isRecord(item)) {
    return ''
  }

  if (typeof item.name === 'string') {
    return item.name
  }

  if (isRecord(item.name)) {
    return asString(item.name.zh_CN) || asString(item.name.zh_cn) || asString(item.name.en_us)
  }

  return ''
}

function migrateLegacyData(parsed: AnyRecord): LocalMatchHistoryData {
  const migrated = createEmptyData()
  const legacyPlayers = isRecord(parsed.players) ? parsed.players : {}
  const legacyGames = isRecord(parsed.games) ? parsed.games : {}
  const legacyCurrentPuuid = isValidPuuid(parsed.currentPlayerPuuid) ? parsed.currentPlayerPuuid : null

  migrated.activePlatformId = legacyCurrentPuuid ? 'UNKNOWN' : null
  migrated.currentPlayerKey = legacyCurrentPuuid ? getPlayerKey('UNKNOWN', legacyCurrentPuuid) : null
  for (const playerValue of Object.values(legacyPlayers)) {
    if (!isRecord(playerValue) || !isValidPuuid(playerValue.puuid)) {
      continue
    }

    const puuid = playerValue.puuid
    const platformId = 'UNKNOWN'
    const playerKey = getPlayerKey(platformId, puuid)
    migrated.players[playerKey] = {
      playerKey,
      puuid,
      platformId,
      gameName: asString(playerValue.gameName),
      tagLine: asString(playerValue.tagLine),
      summonerId: asPositiveInteger(playerValue.summonerId),
      isCurrentUser: puuid === legacyCurrentPuuid || playerValue.isCurrentUser === true,
      firstSeenAt: asFiniteNumber(playerValue.firstSeenAt),
      lastSeenAt: asFiniteNumber(playerValue.lastSeenAt),
      historyCollectedAt: asFiniteNumber(playerValue.historyCollectedAt) || null,
      lastHistoryScanAt: asFiniteNumber(playerValue.historyCollectedAt) || null,
      collectionSource: playerValue.collectionSource === 'current' || playerValue.collectionSource === 'matched'
        ? playerValue.collectionSource
        : null,
    }
  }

  for (const gameValue of Object.values(legacyGames)) {
    const game = normalizeGame(gameValue, 'UNKNOWN', asFiniteNumber((gameValue as AnyRecord)?.collectedAt, Date.now()))
    if (!game) {
      continue
    }

    migrated.games[game.gameKey] = game
    queueGameForUpload(migrated, game)
  }
  migrated.updatedAt = asFiniteNumber(parsed.updatedAt)
  markDirectEncounterPlayers(migrated)
  return migrated
}

function markDirectEncounterPlayers(data: LocalMatchHistoryData): void {
  const currentPlayer = data.currentPlayerKey ? data.players[data.currentPlayerKey] : null
  if (!currentPlayer) {
    return
  }

  currentPlayer.isDirectEncounter = true
  for (const game of Object.values(data.games)) {
    if (
      game.platformId !== currentPlayer.platformId ||
      !game.participants.some((participant) => participant.puuid === currentPlayer.puuid)
    ) {
      continue
    }

    for (const participant of game.participants) {
      if (!participant.puuid) {
        continue
      }
      const player = data.players[getPlayerKey(game.platformId, participant.puuid)]
      if (player) {
        player.isDirectEncounter = true
      }
    }
  }
}

class LocalMatchHistoryRepository {
  private dataPromise: Promise<LocalMatchHistoryData> | null = null
  private writeTail: Promise<void> = Promise.resolve()
  private pendingWriteCount = 0

  async getData(): Promise<LocalMatchHistoryData> {
    if (!this.dataPromise) {
      this.dataPromise = this.loadData()
    }

    return this.dataPromise
  }

  async save(data: LocalMatchHistoryData, reason = 'unspecified'): Promise<void> {
    const compaction = compactLocalMatchHistoryData(data)
    data.updatedAt = Date.now()
    const filePath = path.join(getMatchHistoryDataDir(), 'records-v1.json')
    const serializeStartedAt = performance.now()
    const payload = JSON.stringify(data)
    const serializeDurationMs = Math.round((performance.now() - serializeStartedAt) * 10) / 10
    const payloadBytes = MATCH_HISTORY_DEV_DIAGNOSTICS_ENABLED
      ? Buffer.byteLength(payload)
      : 0
    this.pendingWriteCount += 1
    logMatchHistoryDev('repository serialize completed', {
      reason,
      serializeDurationMs,
      payloadBytes,
      gameCount: Object.keys(data.games).length,
      playerCount: Object.keys(data.players).length,
      outboxCount: Object.keys(data.uploadOutbox).length,
      pendingWriteCount: this.pendingWriteCount,
      compaction,
    })
    if (serializeDurationMs >= 50) {
      logger.warn('[match-history] local repository serialization was slow', {
        reason,
        serializeDurationMs,
        gameCount: Object.keys(data.games).length,
        sensitiveValuesLogged: false,
      })
    }

    this.writeTail = this.writeTail
      .catch(() => undefined)
      .then(async () => {
        const writeStartedAt = performance.now()
        await mkdir(path.dirname(filePath), { recursive: true })
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
        await writeFile(temporaryPath, payload, 'utf8')
        await rename(temporaryPath, filePath)
        logMatchHistoryDev('repository atomic write completed', {
          reason,
          payloadBytes,
          writeDurationMs: Math.round((performance.now() - writeStartedAt) * 10) / 10,
        })
      })
      .finally(() => {
        this.pendingWriteCount = Math.max(0, this.pendingWriteCount - 1)
      })

    await this.writeTail
  }

  private async loadData(): Promise<LocalMatchHistoryData> {
    const filePath = path.join(getMatchHistoryDataDir(), 'records-v1.json')
    const loadStartedAt = performance.now()
    try {
      const content = await readFile(filePath, 'utf8')
      const parseStartedAt = performance.now()
      const parsed = JSON.parse(content) as unknown
      logMatchHistoryDev('repository loaded', {
        payloadBytes: Buffer.byteLength(content),
        readAndParseDurationMs: Math.round((performance.now() - loadStartedAt) * 10) / 10,
        parseDurationMs: Math.round((performance.now() - parseStartedAt) * 10) / 10,
      })
      if (!isRecord(parsed)) {
        throw new Error('Local match-history file is not an object')
      }

      if (parsed.schemaVersion === 1) {
        logger.info('[match-history] migrating local records to region-aware schema v2')
        return migrateLegacyData(parsed)
      }

      if (
        parsed.schemaVersion === LOCAL_MATCH_HISTORY_SCHEMA_VERSION &&
        isRecord(parsed.players) &&
        isRecord(parsed.games) &&
        isRecord(parsed.uploadOutbox)
      ) {
        const data = {
          schemaVersion: LOCAL_MATCH_HISTORY_SCHEMA_VERSION,
          updatedAt: asFiniteNumber(parsed.updatedAt),
          installationId: normalizeInstallationId(parsed.installationId),
          activePlatformId: typeof parsed.activePlatformId === 'string'
            ? normalizePlatformId(parsed.activePlatformId)
            : null,
          currentPlayerKey: typeof parsed.currentPlayerKey === 'string' ? parsed.currentPlayerKey : null,
          players: parsed.players as Record<string, StoredMatchHistoryPlayer>,
          games: parsed.games as Record<string, StoredMatchHistoryGame>,
          uploadOutbox: parsed.uploadOutbox as Record<string, MatchHistoryUploadOutboxEntry>,
          uploadedGameTombstones: normalizeUploadedGameTombstones(parsed.uploadedGameTombstones),
        } satisfies LocalMatchHistoryData
        Object.values(data.uploadOutbox).forEach((entry) => {
          if (entry.status === 'uploading') {
            entry.status = 'pending'
          }
          entry.nextAttemptAt ??= null
          entry.lastErrorCode ??= null
        })
        Object.values(data.games).forEach((game) => {
          if (!Array.isArray(game.gameModeMutators)) {
            game.gameModeMutators = []
          }
          queueGameForUpload(data, game)
        })
        markDirectEncounterPlayers(data)
        return data
      }

      logger.warn('[match-history] ignored an unsupported local record schema')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn('[match-history] failed to read local records:', (error as Error).message)
      }
    }

    return createEmptyData()
  }
}

export class LocalMatchHistoryService {
  private readonly repository = new LocalMatchHistoryRepository()
  private readonly sgpMatchHistoryService: SgpMatchHistoryService
  private operationTail: Promise<void> = Promise.resolve()

  constructor(private readonly lcuService: LCUService) {
    this.sgpMatchHistoryService = new SgpMatchHistoryService(lcuService)
  }

  async getLocalSummary(): Promise<LocalMatchHistorySummary> {
    return this.enrichSummary(buildLocalMatchHistorySummary(await this.repository.getData()))
  }

  runBackgroundBatch(): Promise<LocalMatchHistorySummary> {
    return this.enqueue('background-batch', () => this.runBackgroundBatchInternal())
  }

  getNextPendingUploadPlatform(now = Date.now()): Promise<string | null> {
    return this.enqueue('upload-next-platform', async () => (
      getNextPendingMatchHistoryUploadPlatform(await this.repository.getData(), now)
    ))
  }

  getUploadTelemetry(): Promise<MatchHistoryUploadTelemetry> {
    return this.enqueue('upload-telemetry', async () => {
      const data = await this.repository.getData()
      return {
        installationId: data.installationId,
        pendingUploadCount: Object.values(data.uploadOutbox).filter(
          (entry) => entry.status === 'pending' || entry.status === 'uploading',
        ).length,
      }
    })
  }

  claimUploadBatch(
    platformId: string,
    limit: number,
    now = Date.now(),
  ): Promise<ClaimedMatchHistoryUploadSample[]> {
    return this.enqueue('upload-claim', async () => {
      const data = await this.repository.getData()
      const claimed = claimMatchHistoryUploadBatch(data, platformId, limit, now)
      await this.repository.save(data, 'upload-claim')
      return claimed
    })
  }

  resolveUploadBatch(resolutions: MatchHistoryUploadResolution[], now = Date.now()): Promise<void> {
    return this.enqueue('upload-resolve', async () => {
      const data = await this.repository.getData()
      resolveMatchHistoryUploadBatch(data, resolutions, now)
      await this.repository.save(data, 'upload-resolve')
    })
  }

  private enqueue<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const queuedAt = performance.now()
    const run = async (): Promise<T> => {
      const startedAt = performance.now()
      logMatchHistoryDev('operation started', {
        name,
        queueWaitDurationMs: Math.round((startedAt - queuedAt) * 10) / 10,
      })
      try {
        return await operation()
      } finally {
        logMatchHistoryDev('operation completed', {
          name,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        })
      }
    }
    const result = this.operationTail.then(run, run)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async runBackgroundBatchInternal(): Promise<LocalMatchHistorySummary> {
    if (!await this.isSafeBackgroundPhase()) {
      return this.getLocalSummary()
    }

    const data = await this.repository.getData()
    let currentPlayer: PlayerTarget
    try {
      currentPlayer = await this.resolveCurrentPlayer(data)
    } catch (error) {
      logger.debug('[match-history] background collection skipped: current player unavailable', {
        error: error instanceof Error ? error.message : String(error),
      })
      return this.getLocalSummary()
    }

    const shouldContinue = () => this.isSafeBackgroundPhase()
    const currentMatchLimit = getBackgroundCurrentMatchLimit(
      data.players[currentPlayer.playerKey]?.historyScanLimit,
    )
    logMatchHistoryDev('background collection batch prepared', {
      platformId: currentPlayer.platformId,
      currentMatchLimit,
      matchedPlayerLimit: BACKGROUND_MATCHED_PLAYER_LIMIT,
      matchedMatchLimit: BACKGROUND_MATCHED_MATCH_LIMIT,
      concurrency: 1,
    })
    const currentOutcome = await this.scanPlayerHistory(currentPlayer, {
      matchLimit: currentMatchLimit,
      shouldContinue,
    })
    if (!currentOutcome.failed && !currentOutcome.interrupted && await shouldContinue()) {
      const candidates = this.getMatchedPlayerCandidates(
        data,
        data.activePlatformId || currentPlayer.platformId,
      ).slice(0, BACKGROUND_MATCHED_PLAYER_LIMIT)

      for (const candidate of candidates) {
        await wait(BACKGROUND_REQUEST_PACING_MS)
        if (!await shouldContinue()) {
          break
        }
        const outcome = await this.scanPlayerHistory({
          playerKey: candidate.playerKey,
          puuid: candidate.puuid,
          platformId: candidate.platformId,
          source: 'matched',
        }, {
          matchLimit: BACKGROUND_MATCHED_MATCH_LIMIT,
          shouldContinue,
        })
        if (outcome.failed || outcome.interrupted) {
          break
        }
      }
    }

    return this.getLocalSummary()
  }

  private async resolveCurrentPlayer(data: LocalMatchHistoryData): Promise<PlayerTarget> {
    const currentSummoner = await this.lcuService.getCurrentSummoner()
    const currentPuuid = isRecord(currentSummoner) && isValidPuuid(currentSummoner.puuid)
      ? currentSummoner.puuid
      : null
    if (!currentPuuid) {
      throw new Error('当前客户端没有返回可用的玩家 PUUID')
    }

    const reportedPlatformId = normalizePlatformId(
      isRecord(currentSummoner)
        ? currentSummoner.platformId ?? currentSummoner.currentPlatformId
        : undefined,
    )
    const knownCurrentPlayer = Object.values(data.players).find(
      (player) => player.puuid === currentPuuid && player.isCurrentUser && player.platformId !== 'UNKNOWN',
    )
    let platformId = reportedPlatformId === 'UNKNOWN'
      ? knownCurrentPlayer?.platformId || reportedPlatformId
      : reportedPlatformId
    if (platformId === 'UNKNOWN') {
      // SGP routing needs the platform once. This one-item LCU index request is
      // only a bootstrap; all match payload collection below uses SGP SUMMARY.
      const platformBootstrap = await this.lcuService.getCurrentSummonerMatchHistory(0, 0)
      platformId = getHistoryPlatformId(platformBootstrap, platformId)
    }
    if (platformId === 'UNKNOWN') {
      throw new Error('当前客户端没有返回可用的区服标识，无法路由 SGP')
    }

    const playerKey = getPlayerKey(platformId, currentPuuid)
    data.activePlatformId = platformId
    data.currentPlayerKey = playerKey
    for (const player of Object.values(data.players)) {
      if (player.platformId === platformId && player.playerKey !== playerKey && player.isCurrentUser) {
        player.isCurrentUser = false
      }
    }
    this.upsertPlayer(data, {
      playerKey,
      puuid: currentPuuid,
      platformId,
      gameName: isRecord(currentSummoner)
        ? asString(currentSummoner.gameName) || asString(currentSummoner.displayName)
        : '',
      tagLine: isRecord(currentSummoner) ? asString(currentSummoner.tagLine) : '',
      summonerId: isRecord(currentSummoner) ? asPositiveInteger(currentSummoner.summonerId) : null,
      isCurrentUser: true,
      isDirectEncounter: true,
      source: 'current',
      collectedAt: Date.now(),
    })

    return {
      playerKey,
      puuid: currentPuuid,
      platformId,
      source: 'current',
    }
  }

  private async scanPlayerHistory(
    target: PlayerTarget,
    options: PlayerScanOptions,
  ): Promise<CollectionOutcome> {
    const data = await this.repository.getData()
    let resolvedTarget = target
    const gameIds = new Set<number>()
    let gameCount = 0
    let interrupted = false
    let failed = false
    let startIndex = 0

    logMatchHistoryDev('player scan started', {
      source: resolvedTarget.source,
      platformId: resolvedTarget.platformId,
      matchLimit: options.matchLimit,
      pageSize: Math.min(HISTORY_PAGE_SIZE, options.matchLimit),
    })
    while (startIndex < options.matchLimit) {
      if (options.shouldContinue && !await options.shouldContinue()) {
        interrupted = true
        break
      }

      const requestCount = Math.min(HISTORY_PAGE_SIZE, options.matchLimit - startIndex)
      let pageGames: AnyRecord[]
      try {
        pageGames = await this.sgpMatchHistoryService.getHextechAramSummaries(
          resolvedTarget.puuid,
          resolvedTarget.platformId,
          startIndex,
          requestCount,
          options.shouldContinue,
        )
      } catch (error) {
        if (error instanceof SgpMatchHistoryInterruptedError) {
          interrupted = true
          break
        }
        logger.warn('[match-history] SGP player summary request failed', {
          source: resolvedTarget.source,
          platformId: resolvedTarget.platformId,
          error: error instanceof Error ? error.message : String(error),
          sensitiveValuesLogged: false,
        })
        failed = true
        break
      }

      const processingStartedAt = performance.now()
      const collectedAt = Date.now()
      let invalidGameCount = 0
      let nonHextechGameCount = 0
      let duplicateGameCount = 0
      let pageNewGameCount = 0
      for (const pageGame of pageGames) {
        const game = normalizeGame(pageGame, resolvedTarget.platformId, collectedAt)
        if (!game) {
          invalidGameCount += 1
          continue
        }
        if (!isHextechAramGame(game)) {
          nonHextechGameCount += 1
          continue
        }
        if (gameIds.has(game.gameId)) {
          duplicateGameCount += 1
          continue
        }

        if (resolvedTarget.source === 'current') {
          resolvedTarget = this.rehomeCurrentPlayerForPlatform(data, resolvedTarget, game.platformId)
        }
        gameIds.add(game.gameId)
        const wasStored = Boolean(data.games[game.gameKey])
        this.upsertGame(data, game, resolvedTarget.source === 'current')
        if (!wasStored) {
          gameCount += 1
          pageNewGameCount += 1
        }
      }

      const processingDurationMs = Math.round((performance.now() - processingStartedAt) * 10) / 10
      logMatchHistoryDev('SGP summary page normalized', {
        source: resolvedTarget.source,
        platformId: resolvedTarget.platformId,
        startIndex,
        requestedCount: requestCount,
        returnedCount: pageGames.length,
        acceptedCount: pageGames.length - invalidGameCount - nonHextechGameCount - duplicateGameCount,
        newGameCount: pageNewGameCount,
        invalidGameCount,
        nonHextechGameCount,
        duplicateGameCount,
        processingDurationMs,
      })
      if (processingDurationMs >= 75) {
        logger.warn('[match-history] SGP summary normalization was slow', {
          source: resolvedTarget.source,
          platformId: resolvedTarget.platformId,
          returnedCount: pageGames.length,
          processingDurationMs,
          sensitiveValuesLogged: false,
        })
      }

      const isLastPage = pageGames.length < requestCount || startIndex + requestCount >= options.matchLimit
      // Persist intermediate pages only. The final page is persisted once below
      // together with player scan metadata, avoiding duplicate full-file writes.
      if (!isLastPage) {
        await this.repository.save(data, 'sgp-intermediate-page')
      }
      if (isLastPage) {
        break
      }
      startIndex += Math.max(1, requestCount - HISTORY_PAGE_OVERLAP)
    }

    const collectedAt = Date.now()
    const player = data.players[resolvedTarget.playerKey]
    if (player) {
      player.historyCollectedAt = collectedAt
      player.collectionSource = resolvedTarget.source
      player.lastSeenAt = collectedAt
      if (!failed && !interrupted) {
        player.lastHistoryScanAt = collectedAt
        player.historyScanLimit = Math.max(player.historyScanLimit ?? 0, options.matchLimit)
      }
    }

    await this.repository.save(data, 'sgp-player-scan-complete')
    logger.info('[match-history] SGP player summaries collected', {
      source: resolvedTarget.source,
      gameCount,
      platformId: resolvedTarget.platformId,
      listedGameCount: gameIds.size,
      failed,
      interrupted,
    })
    return { playerKey: resolvedTarget.playerKey, gameCount, failed, interrupted }
  }

  private rehomeCurrentPlayerForPlatform(
    data: LocalMatchHistoryData,
    target: PlayerTarget,
    platformId: string,
  ): PlayerTarget {
    if (platformId === 'UNKNOWN' || platformId === target.platformId) {
      return target
    }

    const nextPlayerKey = getPlayerKey(platformId, target.puuid)
    const previousPlayer = data.players[target.playerKey]
    const existingPlayer = data.players[nextPlayerKey]
    if (previousPlayer) {
      data.players[nextPlayerKey] = {
        ...previousPlayer,
        ...existingPlayer,
        playerKey: nextPlayerKey,
        platformId,
        puuid: target.puuid,
        isCurrentUser: true,
        isDirectEncounter: true,
      }
      delete data.players[target.playerKey]
    }
    for (const game of Object.values(data.games)) {
      const belongsToCurrentPlayer = game.platformId === 'UNKNOWN' && game.participants.some(
        (participant) => participant.puuid === target.puuid,
      )
      if (!belongsToCurrentPlayer) {
        continue
      }

      const migratedGame = {
        ...game,
        platformId,
        gameKey: getGameKey(platformId, game.gameId),
      }
      delete data.games[game.gameKey]
      delete data.uploadOutbox[`lcu-match-history:v1:${game.platformId}:${game.gameId}`]
      delete data.uploadOutbox[`match-history:v1:${game.platformId}:${game.gameId}`]
      data.games[migratedGame.gameKey] = migratedGame
      queueGameForUpload(data, migratedGame)
    }
    data.activePlatformId = platformId
    data.currentPlayerKey = nextPlayerKey
    return {
      ...target,
      playerKey: nextPlayerKey,
      platformId,
    }
  }

  private getMatchedPlayerCandidates(
    data: LocalMatchHistoryData,
    platformId: string,
    onlyUnscanned = false,
  ): StoredMatchHistoryPlayer[] {
    return Object.values(data.players)
      .filter((player) =>
        !player.isCurrentUser &&
        player.isDirectEncounter === true &&
        player.platformId === platformId &&
        (!onlyUnscanned || !player.lastHistoryScanAt)
      )
      .sort((left, right) => {
        const leftPriority = left.lastHistoryScanAt || 0
        const rightPriority = right.lastHistoryScanAt || 0
        return leftPriority - rightPriority || left.firstSeenAt - right.firstSeenAt
      })
  }

  private upsertGame(
    data: LocalMatchHistoryData,
    game: StoredMatchHistoryGame,
    discoverParticipants: boolean,
  ): void {
    data.games[game.gameKey] = game
    queueGameForUpload(data, game)
    if (!discoverParticipants) {
      return
    }

    for (const participant of game.participants) {
      if (!participant.puuid) {
        continue
      }

      const playerKey = getPlayerKey(game.platformId, participant.puuid)
      this.upsertPlayer(data, {
        playerKey,
        puuid: participant.puuid,
        platformId: game.platformId,
        gameName: participant.gameName,
        tagLine: participant.tagLine,
        summonerId: null,
        isCurrentUser: playerKey === data.currentPlayerKey,
        isDirectEncounter: true,
        source: null,
        collectedAt: game.collectedAt,
      })
    }
  }

  private upsertPlayer(data: LocalMatchHistoryData, params: {
    playerKey: string
    puuid: string
    platformId: string
    gameName: string
    tagLine: string
    summonerId: number | null
    isCurrentUser: boolean
    isDirectEncounter: boolean
    source: MatchHistoryCollectionSource | null
    collectedAt: number
  }): void {
    const existing = data.players[params.playerKey]
    data.players[params.playerKey] = {
      playerKey: params.playerKey,
      puuid: params.puuid,
      platformId: params.platformId,
      gameName: params.gameName || existing?.gameName || '',
      tagLine: params.tagLine || existing?.tagLine || '',
      summonerId: params.summonerId ?? existing?.summonerId ?? null,
      isCurrentUser: params.isCurrentUser || existing?.isCurrentUser || false,
      isDirectEncounter: params.isDirectEncounter || existing?.isDirectEncounter || false,
      firstSeenAt: existing?.firstSeenAt || params.collectedAt,
      lastSeenAt: params.collectedAt,
      historyCollectedAt: existing?.historyCollectedAt ?? null,
      lastHistoryScanAt: existing?.lastHistoryScanAt ?? null,
      historyScanLimit: existing?.historyScanLimit,
      collectionSource: params.source || existing?.collectionSource || null,
    }
  }

  private async isSafeBackgroundPhase(): Promise<boolean> {
    const phase = await this.lcuService.getGameflowPhase()
    return phase === 'None' || phase === 'Lobby'
  }

  private async enrichSummary(summary: LocalMatchHistorySummary): Promise<LocalMatchHistorySummary> {
    const trimmedSummary: LocalMatchHistorySummary = {
      ...summary,
      augmentStats: summary.augmentStats.slice(0, MAX_RETURNED_STAT_ROWS),
      itemStats: summary.itemStats.slice(0, MAX_RETURNED_STAT_ROWS),
    }
    if (!trimmedSummary.augmentStats.length && !trimmedSummary.itemStats.length && !trimmedSummary.recentMatches.length) {
      return trimmedSummary
    }

    try {
      const { loadAugmentDetail, loadChampionRoster, loadItems } = await import('../../data-loader.ts')
      const [champions, augmentsById, items] = await Promise.all([
        loadChampionRoster(),
        loadAugmentDetail(),
        loadItems(),
      ])
      const championNames = new Map<string, string>(
        champions.map((champion: AnyRecord) => [
          String(champion.championId ?? champion.id),
          asString(champion.nameCN) || asString(champion.nameEN),
        ]),
      )
      const augmentNames = new Map<string, string>(
        Object.entries(augmentsById).map(([id, augment]) => [id, asString((augment as AnyRecord).name)]),
      )
      const itemNames = new Map<string, string>(
        items.map((item: AnyRecord) => [String(item.id), getItemName(item)]),
      )
      const enrichRows = (rows: LocalMatchHistoryStat[], subjectNames: Map<string, string>) => rows.map((row) => ({
        ...row,
        championName: championNames.get(String(row.championId)) || undefined,
        subjectName: subjectNames.get(String(row.subjectId)) || undefined,
      }))
      const enrichMatch = (match: LocalMatchHistoryRecentMatch) => ({
        ...match,
        championName: championNames.get(String(match.championId)) || undefined,
      })

      return {
        ...trimmedSummary,
        augmentStats: enrichRows(trimmedSummary.augmentStats, augmentNames),
        itemStats: enrichRows(trimmedSummary.itemStats, itemNames),
        recentMatches: trimmedSummary.recentMatches.map(enrichMatch),
      }
    } catch (error) {
      logger.debug('[match-history] local labels unavailable:', error instanceof Error ? error.message : String(error))
      return trimmedSummary
    }
  }
}

let sharedLocalMatchHistoryService: LocalMatchHistoryService | null = null

export function getLocalMatchHistoryService(lcuService: LCUService): LocalMatchHistoryService {
  if (!sharedLocalMatchHistoryService) {
    sharedLocalMatchHistoryService = new LocalMatchHistoryService(lcuService)
  }

  return sharedLocalMatchHistoryService
}
