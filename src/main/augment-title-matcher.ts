// Lightweight OCR title matching helpers. Keep this module free of image/OCR imports
// so unit tests do not initialize the analyzer stack.

const OCR_TITLE_MAX_EXTRA_NORMALIZED_CHARS = 8
const OCR_PUNCTUATION_PATTERN = /[\s"'“”‘’`.,，。:：;；!！?？、|｜/\\()[\]{}<>《》【】「」『』\-_=+~·•]/g

const MATCH_BLACKLIST = new Set([
  '攻击', '防御', '生命', '法术', '魔法', '伤害', '护甲',
  '技能', '冷却', '移速', '暴击', '吸血', '穿透',
  '功能', '能力', '效果', '被动', '主动', '额外',
  '持续', '提供', '增加', '获得', '造成',
])

const OCR_NAME_ALIASES = new Map([
  ['一板一眼', ['板一眼']],
])

type AugmentTitleRecord = {
  id?: string | number
  name?: string
  rarity?: string
  iconPath?: string
}

type FuzzyMatch = {
  index: number
  distance: number
  matchLen: number
  alias?: string
}

type MatchCandidate = {
  augmentData: AugmentTitleRecord
  match: FuzzyMatch
  start: number
  end: number
  matchLen: number
}

export function normalizeOcrTitleText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(OCR_PUNCTUATION_PATTERN, '')
}

export function isLikelyTitleSlotText(rawText: unknown, match?: AugmentTitleRecord | null): boolean {
  const normalizedText = normalizeOcrTitleText(rawText)
  const normalizedName = normalizeOcrTitleText(match?.name)

  if (!normalizedText || !normalizedName) {
    return false
  }

  return normalizedText.length <= normalizedName.length + OCR_TITLE_MAX_EXTRA_NORMALIZED_CHARS
}

function editDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1])
    }
  }

  return matrix[a.length][b.length]
}

function fuzzyFind(text: string, name: string): FuzzyMatch | null {
  const nameLen = name.length
  const textLen = text.length

  if (nameLen === 0 || textLen < nameLen) {
    return null
  }

  const exactIndex = text.indexOf(name)
  if (exactIndex !== -1) {
    return { index: exactIndex, distance: 0, matchLen: nameLen }
  }

  const aliases = OCR_NAME_ALIASES.get(name) || []
  for (const alias of aliases) {
    const normalizedAlias = normalizeOcrTitleText(alias)
    const aliasIndex = text.indexOf(normalizedAlias)
    if (aliasIndex !== -1) {
      return {
        index: aliasIndex,
        distance: 0,
        matchLen: normalizedAlias.length,
        alias,
      }
    }
  }

  if (nameLen <= 2) {
    return null
  }

  const maxDistance = nameLen === 3 ? 1 : Math.floor(nameLen / 3)
  let bestMatch: FuzzyMatch | null = null

  for (let i = 0; i <= textLen - nameLen; i++) {
    const window = text.slice(i, i + nameLen)
    const dist = editDistance(window, name)
    if (dist <= maxDistance && (!bestMatch || dist < bestMatch.distance)) {
      bestMatch = { index: i, distance: dist, matchLen: nameLen }
    }
  }

  return bestMatch
}

function getAugmentVersionPriority(augmentData: AugmentTitleRecord): number {
  const id = Number(augmentData.id) || 0
  return id >= 1000 ? id + 100000 : id
}

function buildMatchEntries(augments: AugmentTitleRecord[] = []) {
  const scannedNames = new Set()

  return augments
    .slice()
    .sort((a, b) => {
      const aLen = normalizeOcrTitleText(a.name).length
      const bLen = normalizeOcrTitleText(b.name).length
      if (bLen !== aLen) {
        return bLen - aLen
      }
      return getAugmentVersionPriority(b) - getAugmentVersionPriority(a)
    })
    .map((augmentData) => ({
      augmentData,
      normalizedName: normalizeOcrTitleText(augmentData.name),
    }))
    .filter(({ augmentData, normalizedName }) => {
      const name = augmentData.name || ''
      if (!normalizedName || MATCH_BLACKLIST.has(name) || MATCH_BLACKLIST.has(normalizedName)) {
        return false
      }
      if (scannedNames.has(normalizedName)) {
        return false
      }

      scannedNames.add(normalizedName)
      return true
    })
}

function rangesOverlap(a: MatchCandidate, b: MatchCandidate): boolean {
  return a.start < b.end && b.start < a.end
}

export function matchAugmentTitleRecords(recognizedText: string, augments: AugmentTitleRecord[] = []) {
  if (!recognizedText || recognizedText.trim() === '') {
    return []
  }

  const normalizedText = normalizeOcrTitleText(recognizedText)
  const candidates: MatchCandidate[] = []

  for (const { augmentData, normalizedName } of buildMatchEntries(augments)) {
    const match = fuzzyFind(normalizedText, normalizedName)
    if (!match) {
      continue
    }

    candidates.push({
      augmentData,
      match,
      start: match.index,
      end: match.index + match.matchLen,
      matchLen: match.matchLen,
    })
  }

  candidates.sort((a, b) => {
    if (a.match.distance !== b.match.distance) {
      return a.match.distance - b.match.distance
    }
    if (a.matchLen !== b.matchLen) {
      return b.matchLen - a.matchLen
    }
    const priorityDiff = getAugmentVersionPriority(b.augmentData) - getAugmentVersionPriority(a.augmentData)
    return priorityDiff || a.start - b.start
  })

  const selectedCandidates: MatchCandidate[] = []
  for (const candidate of candidates) {
    if (!selectedCandidates.some(selected => rangesOverlap(candidate, selected))) {
      selectedCandidates.push(candidate)
    }
  }

  selectedCandidates.sort((a, b) => a.start - b.start)

  return selectedCandidates.slice(0, 3).map((candidate) => ({
    id: candidate.augmentData.id,
    name: candidate.augmentData.name,
    rarity: candidate.augmentData.rarity,
    iconPath: candidate.augmentData.iconPath,
    confidence: candidate.match.distance === 0 ? 0.95 : 0.80,
    matchedText: recognizedText,
  }))
}
