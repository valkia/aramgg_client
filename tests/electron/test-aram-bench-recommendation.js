import assert from 'node:assert/strict'
import {
  collectAramCandidateChampionIds,
  getAramBenchRecommendation,
} from '../../src/main/services/aram/bench-recommendation.ts'

function makeSnapshot(overrides = {}) {
  const selfChampionId = Object.hasOwn(overrides, 'selfChampionId') ? overrides.selfChampionId : 63
  const benchChampions = overrides.benchChampions ?? [
    { championId: 99 },
    { championId: 101 },
  ]

  return {
    connected: true,
    gameflowPhase: overrides.gameflowPhase ?? 'ChampSelect',
    isInChampSelect: (overrides.gameflowPhase ?? 'ChampSelect') === 'ChampSelect',
    champSelectSession: {},
    localPlayerCellId: 1,
    selfChampionId,
    benchEnabled: overrides.benchEnabled ?? benchChampions.length > 0,
    benchChampions,
    myTeam: overrides.myTeam ?? [{ cellId: 1, championId: selfChampionId }],
    actions: [],
    timer: null,
    status: 'ready',
    reason: null,
    updatedAt: Date.now(),
  }
}

const championStatsById = {
  63: {
    nameCN: '布兰德',
    winRate: 0.5,
    pickRate: 0.08,
    numGames: 2000,
    tier: 3,
  },
  99: {
    nameCN: '拉克丝',
    winRate: 0.56,
    pickRate: 0.1,
    numGames: 2500,
    tier: 1,
  },
  101: {
    nameCN: '泽拉斯',
    winRate: 0.51,
    pickRate: 0.07,
    numGames: 1200,
    tier: 2,
  },
  103: {
    nameCN: '阿狸',
    winRate: 0.6,
    pickRate: 0.09,
    numGames: 1800,
    tier: 1,
  },
}

const betterBench = getAramBenchRecommendation(makeSnapshot(), championStatsById)
assert.equal(betterBench.status, 'ready')
assert.equal(betterBench.currentChampion.championId, 63)
assert.equal(betterBench.recommendedChampion.championId, 99)
assert.ok(betterBench.deltaScore > 0)
assert.deepEqual(collectAramCandidateChampionIds(makeSnapshot()), [63, 99, 101])

const unknownGames = getAramBenchRecommendation(makeSnapshot(), Object.fromEntries(
  Object.entries(championStatsById).map(([id, stats]) => [id, { ...stats, numGames: null }])
))
const rankingEvidence = (result) => result.candidates.map(({ championId, score, confidence, dataAvailable }) => ({ championId, score, confidence, dataAvailable }))
assert.deepEqual(rankingEvidence(unknownGames), rankingEvidence(betterBench), 'Unavailable counts must not weaken otherwise identical strength metrics')
assert.equal(unknownGames.deltaScore, betterBench.deltaScore)
assert.equal(unknownGames.decisionReason, betterBench.decisionReason)
assert.ok(unknownGames.candidates.every((candidate) => candidate.games === null))

const noBench = getAramBenchRecommendation(
  makeSnapshot({ benchEnabled: false, benchChampions: [] }),
  championStatsById
)
assert.equal(noBench.status, 'no-bench')
assert.equal(noBench.recommendedChampion.championId, 63)

const noChampion = getAramBenchRecommendation(
  makeSnapshot({ selfChampionId: null, benchEnabled: false, benchChampions: [] }),
  championStatsById
)
assert.equal(noChampion.status, 'no-candidates')
assert.equal(noChampion.candidates.length, 0)

const duplicateBench = getAramBenchRecommendation(
  makeSnapshot({ benchChampions: [{ championId: 99 }, { championId: 99 }, { championId: 101 }] }),
  championStatsById
)
assert.equal(duplicateBench.candidates.filter((candidate) => candidate.championId === 99).length, 1)

const teammateSnapshot = makeSnapshot({
  myTeam: [
    { cellId: 1, championId: 63 },
    { cellId: 2, championId: 103 },
    { cellId: 3, championId: 0 },
  ],
})
const teammateRecommendation = getAramBenchRecommendation(teammateSnapshot, championStatsById)
const teammateCandidate = teammateRecommendation.candidates.find((candidate) => candidate.championId === 103)
assert.deepEqual(collectAramCandidateChampionIds(teammateSnapshot), [63, 99, 101, 103])
assert.equal(teammateRecommendation.status, 'ready')
assert.equal(teammateRecommendation.recommendedChampion.championId, 103)
assert.equal(teammateCandidate.source, 'teammate')
assert.equal(teammateCandidate.sourceLabel, '队友')
assert.equal(teammateCandidate.isTeammate, true)

const teammateOnly = getAramBenchRecommendation(
  makeSnapshot({
    benchEnabled: false,
    benchChampions: [],
    myTeam: [
      { cellId: 1, championId: 63 },
      { cellId: 2, championId: 103 },
    ],
  }),
  championStatsById
)
assert.equal(teammateOnly.status, 'ready')
assert.equal(teammateOnly.candidates.some((candidate) => candidate.source === 'teammate'), true)

const inactive = getAramBenchRecommendation(
  makeSnapshot({ gameflowPhase: 'Lobby' }),
  championStatsById
)
assert.equal(inactive.status, 'inactive')
assert.deepEqual(inactive.candidates, [])

const disconnected = getAramBenchRecommendation({
  connected: false,
  gameflowPhase: null,
  status: 'unavailable',
  reason: 'lcu-unavailable',
})
assert.equal(disconnected.status, 'inactive')
assert.equal(disconnected.reason, 'lcu-unavailable')

const missingData = getAramBenchRecommendation(makeSnapshot(), {})
assert.equal(missingData.status, 'ready')
assert.equal(missingData.recommendedChampion.championId, 63)
assert.ok(missingData.reasons.some((reason) => reason.includes('统计数据暂缺')))

console.log('ARAM bench recommendation tests passed')
