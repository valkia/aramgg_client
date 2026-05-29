import { sortAugmentsByDetectedOrder } from './augment-order.js'

export const getAugmentId = (augment) => augment?.augmentId ?? augment?.id ?? null

export const getAugmentKey = (augment, index) => {
  if (augment?.missing) {
    return `missing-${augment.detectedSlot ?? index}`
  }

  return getAugmentId(augment) || augment?.name || index
}

export const getAugmentScore = (augment) => {
  if (augment?.missing) return null

  if (augment?.recommendScore != null) {
    const score = Number(augment.recommendScore)
    if (Number.isFinite(score)) return score
  }

  if (augment?.winRate != null) {
    const winRate = Number(augment.winRate)
    if (Number.isFinite(winRate)) return winRate
  }

  return null
}

export const getTopPickKey = (augments = []) => {
  let bestIndex = -1
  let bestScore = null

  augments.forEach((augment, index) => {
    const score = getAugmentScore(augment)
    if (score == null) {
      return
    }

    if (bestScore == null || score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })

  return bestIndex >= 0 ? getAugmentKey(augments[bestIndex], bestIndex) : null
}

const getDetectedSlot = (augment, index) => Number.isInteger(augment?.detectedSlot)
  ? augment.detectedSlot
  : index

const createPreviousSlotMap = (augments = []) => {
  const previousBySlotAndId = new Map()

  augments.forEach((augment, index) => {
    if (!augment || augment.missing) {
      return
    }

    const id = getAugmentId(augment)
    const slot = getDetectedSlot(augment, index)
    if (id == null || slot < 0 || slot >= 3) {
      return
    }

    previousBySlotAndId.set(`${slot}:${id}`, augment)
  })

  return previousBySlotAndId
}

export const mapDetectedAugmentsForFallback = (augments = [], previousAugments = []) => {
  const previousBySlotAndId = createPreviousSlotMap(previousAugments)

  return augments.map((augment, index) => {
    const detectedSlot = getDetectedSlot(augment, index)
    if (augment?.missing) {
      return {
        augmentId: null,
        id: null,
        name: '',
        rarity: 'unknown',
        winRate: null,
        pickRate: null,
        playCount: 0,
        recommendScore: null,
        iconPath: null,
        detectedSlot,
        missing: true,
      }
    }

    const id = getAugmentId(augment)
    const previous = previousBySlotAndId.get(`${detectedSlot}:${id}`) || null

    return {
      ...previous,
      augmentId: id,
      id,
      name: augment?.name || previous?.name || '',
      rarity: augment?.rarity || previous?.rarity || 'unknown',
      winRate: augment?.winRate ?? previous?.winRate ?? null,
      pickRate: augment?.pickRate ?? previous?.pickRate ?? null,
      playCount: augment?.playCount ?? previous?.playCount ?? 0,
      recommendScore: augment?.recommendScore ?? previous?.recommendScore ?? null,
      iconPath: augment?.iconPath || augment?.iconUrl || previous?.iconPath || null,
      detectedSlot,
      missing: false,
    }
  })
}

export const mergeWinrateWithDetectedSlots = (
  winrateAugments = [],
  detectedAugments = [],
  previousAugments = []
) => {
  const fallbackSlots = sortAugmentsByDetectedOrder(
    mapDetectedAugmentsForFallback(detectedAugments, previousAugments),
    detectedAugments
  )
  const winrateById = new Map(
    winrateAugments
      .map(augment => [String(getAugmentId(augment)), augment])
      .filter(([id]) => id && id !== 'undefined' && id !== 'null')
  )

  return fallbackSlots.map(augment => {
    if (augment.missing) {
      return augment
    }

    const id = getAugmentId(augment)
    const winrate = winrateById.get(String(id))
    if (!winrate) {
      return augment
    }

    return {
      ...augment,
      ...winrate,
      id: winrate.id || winrate.augmentId || id,
      augmentId: winrate.augmentId || winrate.id || id,
      detectedSlot: augment.detectedSlot,
      missing: false,
    }
  })
}
