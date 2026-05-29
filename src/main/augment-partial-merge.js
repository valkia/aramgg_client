export function getAugmentIds(augments = []) {
    return augments.slice(0, 3).map(augment => {
        if (augment?.id == null) {
            return null
        }

        return String(augment.id)
    }).filter(Boolean)
}

export function createEmptyAugmentSlot(slot) {
    return {
        id: null,
        name: '',
        rarity: 'unknown',
        confidence: null,
        detectedSlot: slot,
        missing: true,
    }
}

function normalizeSlotText(text) {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、：；（）【】《》“”‘’]/g, '')
}

export function hasMeaningfulSlotText(text) {
    const normalized = normalizeSlotText(text)
    if (!normalized) {
        return false
    }

    const cjkCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
    return cjkCount >= 2 || normalized.length >= 4
}

const TITLE_FINGERPRINT_CHANGE_THRESHOLD = 18
const HEX_BIT_COUNTS = new Map([
    ['0', 0], ['1', 1], ['2', 1], ['3', 2],
    ['4', 1], ['5', 2], ['6', 2], ['7', 3],
    ['8', 1], ['9', 2], ['a', 2], ['b', 3],
    ['c', 2], ['d', 3], ['e', 3], ['f', 4],
])

export function getFingerprintHammingDistance(left, right) {
    const a = String(left || '').toLowerCase()
    const b = String(right || '').toLowerCase()
    if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) {
        return null
    }

    let distance = 0
    for (let index = 0; index < a.length; index++) {
        const xor = (parseInt(a[index], 16) ^ parseInt(b[index], 16)).toString(16)
        distance += HEX_BIT_COUNTS.get(xor) ?? 0
    }
    return distance
}

function hasTitleFingerprintChanged(currentFingerprint, previousFingerprint) {
    const distance = getFingerprintHammingDistance(currentFingerprint, previousFingerprint)
    return distance != null && distance >= TITLE_FINGERPRINT_CHANGE_THRESHOLD
}

function getChangedUnmatchedSlots({
    slotDiagnostics = [],
    lastDetectedAugments = [],
    lastDetectedSlotFingerprints = [],
    hasStablePreviousId = false,
} = {}) {
    if (!hasStablePreviousId) {
        return []
    }

    return slotDiagnostics
        .filter(diagnostic => {
            const slot = diagnostic?.slot
            if (!Number.isInteger(slot) || slot < 0 || slot >= 3) {
                return false
            }

            const previousAugment = lastDetectedAugments[slot]
            return previousAugment?.id != null &&
                diagnostic.matchedId == null &&
                hasMeaningfulSlotText(diagnostic.text) &&
                hasTitleFingerprintChanged(diagnostic.titleFingerprint, lastDetectedSlotFingerprints[slot])
        })
        .map(diagnostic => diagnostic.slot)
}

export function mergePartialAugments({
    augments = [],
    slotDiagnostics = [],
    lastDetectedAugmentIds = [],
    lastDetectedAugments = [],
    lastDetectedSlotFingerprints = [],
} = {}) {
    if (augments.length >= 3) {
        return null
    }

    if (lastDetectedAugmentIds.length === 0) {
        return null
    }

    const partialIds = new Set(getAugmentIds(augments))
    const hasStablePreviousId = [...partialIds].some(id => lastDetectedAugmentIds.includes(id))
    const changedUnmatchedSlots = getChangedUnmatchedSlots({
        slotDiagnostics,
        lastDetectedAugments,
        lastDetectedSlotFingerprints,
        hasStablePreviousId,
    })
    const hasDetectedSlot = augments.some(augment => Number.isInteger(augment?.detectedSlot))
    if (!hasDetectedSlot && changedUnmatchedSlots.length === 0) {
        return null
    }

    const hasNewId = partialIds.size > 0 && [...partialIds].some(id => !lastDetectedAugmentIds.includes(id))
    if (!hasNewId && changedUnmatchedSlots.length === 0) {
        return null
    }

    const merged = [0, 1, 2].map(createEmptyAugmentSlot)
    for (const augment of augments) {
        if (Number.isInteger(augment?.detectedSlot) && augment.detectedSlot >= 0 && augment.detectedSlot < 3) {
            merged[augment.detectedSlot] = augment
        }
    }

    return {
        augments: merged.slice(0, 3),
        reason: hasNewId ? 'new-id' : 'slot-visual-changed',
        changedUnmatchedSlots,
    }
}
