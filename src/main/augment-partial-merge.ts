import { DEFAULT_AUGMENT_SLOT_COUNT, isAugmentSlotIndex, MAX_AUGMENT_SLOT_COUNT } from '../shared/augment-slots.ts'
import type { AugmentSlotCount } from '../shared/augment-slots.ts'

export type PartialAugment = {
    id?: string | number | null
    name?: string
    rarity?: string
    confidence?: number | null
    detectedSlot?: number
    missing?: boolean
    [key: string]: unknown
}

export type AugmentSlotDiagnostic = {
    slot?: number
    matchedId?: string | number | null
    text?: unknown
    titleFingerprint?: unknown
}

type InitialPartialSelectionOptions = {
    slotCount?: AugmentSlotCount
    augments?: PartialAugment[]
    slotDiagnostics?: AugmentSlotDiagnostic[]
    minimumKnownAugments?: number
}

type MergePartialAugmentsOptions = {
    slotCount?: AugmentSlotCount
    augments?: PartialAugment[]
    slotDiagnostics?: AugmentSlotDiagnostic[]
    lastDetectedAugmentIds?: string[]
    lastDetectedAugments?: PartialAugment[]
    lastDetectedSlotFingerprints?: unknown[]
}

export function getAugmentIds(augments: PartialAugment[] = []): string[] {
    return augments.map(augment => {
        if (augment?.id == null || augment.missing) {
            return null
        }

        return String(augment.id)
    }).filter((id): id is string => Boolean(id))
}

// Include gaps and the layout size in comparisons, even when known IDs are identical.
export function getAugmentSlotIds(augments: PartialAugment[] = []): Array<string | null> {
    return augments.map(augment => augment?.id == null || augment.missing ? null : String(augment.id))
}

export function createEmptyAugmentSlot(slot: number): PartialAugment {
    return {
        id: null,
        name: '',
        rarity: 'unknown',
        confidence: null,
        detectedSlot: slot,
        missing: true,
    }
}

function normalizeSlotText(text: unknown): string {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、：；（）【】《》“”‘’]/g, '')
}

export function hasMeaningfulSlotText(text: unknown): boolean {
    const normalized = normalizeSlotText(text)
    if (!normalized) {
        return false
    }

    const cjkCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
    return cjkCount >= 2 || normalized.length >= 4
}

function findSlotDiagnostic(
    slotDiagnostics: AugmentSlotDiagnostic[] = [],
    slot: number
): AugmentSlotDiagnostic | null {
    return (slotDiagnostics || []).find(diagnostic => diagnostic?.slot === slot) || null
}

export function createInitialPartialAugmentSelection({
    slotCount = DEFAULT_AUGMENT_SLOT_COUNT,
    augments = [],
    slotDiagnostics = [],
    minimumKnownAugments = 2,
}: InitialPartialSelectionOptions = {}) {
    const knownAugments = augments.filter(augment =>
        augment?.id != null && isAugmentSlotIndex(augment.detectedSlot, slotCount)
    )

    if (knownAugments.length < minimumKnownAugments || knownAugments.length >= slotCount) {
        return null
    }

    const knownSlots = new Set(knownAugments.map(augment => augment.detectedSlot))
    const merged = Array.from({ length: slotCount }, (_, slot) => createEmptyAugmentSlot(slot))
    const missingSlots = [...merged.keys()].filter(slot => !knownSlots.has(slot))
    const hasMeaningfulUnmatchedTitle = missingSlots.some(slot => {
        const diagnostic = findSlotDiagnostic(slotDiagnostics, slot)
        return diagnostic?.matchedId == null && hasMeaningfulSlotText(diagnostic?.text)
    })

    // The four-card layout is confirmed from the frames, even with one unreadable title.
    const oneUnreadFourCardSlot = slotCount === MAX_AUGMENT_SLOT_COUNT && missingSlots.length === 1
    if (!hasMeaningfulUnmatchedTitle && !oneUnreadFourCardSlot) {
        return null
    }

    for (const augment of knownAugments) {
        const slot = augment.detectedSlot
        if (isAugmentSlotIndex(slot, slotCount)) {
            merged[slot] = augment
        }
    }

    return {
        augments: merged,
        reason: 'unmatched-title-slot',
        missingSlots,
    }
}

const TITLE_FINGERPRINT_CHANGE_THRESHOLD = 18
const HEX_BIT_COUNTS = new Map([
    ['0', 0], ['1', 1], ['2', 1], ['3', 2],
    ['4', 1], ['5', 2], ['6', 2], ['7', 3],
    ['8', 1], ['9', 2], ['a', 2], ['b', 3],
    ['c', 2], ['d', 3], ['e', 3], ['f', 4],
])

export function getFingerprintHammingDistance(left: unknown, right: unknown): number | null {
    const a = String(left || '').toLowerCase()
    const b = String(right || '').toLowerCase()
    if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) {
        return null
    }

    let distance = 0
    for (let index = 0; index < a.length; index++) {
        const xor = (parseInt(a.charAt(index), 16) ^ parseInt(b.charAt(index), 16)).toString(16)
        distance += HEX_BIT_COUNTS.get(xor) ?? 0
    }
    return distance
}

function hasTitleFingerprintChanged(
    currentFingerprint: unknown,
    previousFingerprint: unknown
): boolean {
    const distance = getFingerprintHammingDistance(currentFingerprint, previousFingerprint)
    return distance != null && distance >= TITLE_FINGERPRINT_CHANGE_THRESHOLD
}

function getChangedUnmatchedSlots({
    slotCount = DEFAULT_AUGMENT_SLOT_COUNT,
    slotDiagnostics = [],
    lastDetectedAugments = [],
    lastDetectedSlotFingerprints = [],
    hasStablePreviousId = false,
}: MergePartialAugmentsOptions & { hasStablePreviousId?: boolean } = {}): number[] {
    if (!hasStablePreviousId) {
        return []
    }

    return slotDiagnostics.flatMap((diagnostic) => {
        const slot = diagnostic.slot
        if (!isAugmentSlotIndex(slot, slotCount)) {
            return []
        }

        const previousAugment = lastDetectedAugments[slot]
        const changed = previousAugment?.id != null &&
                diagnostic.matchedId == null &&
                hasMeaningfulSlotText(diagnostic.text) &&
                hasTitleFingerprintChanged(diagnostic.titleFingerprint, lastDetectedSlotFingerprints[slot])
        return changed ? [slot] : []
    })
}

export function mergePartialAugments({
    slotCount = DEFAULT_AUGMENT_SLOT_COUNT,
    augments = [],
    slotDiagnostics = [],
    lastDetectedAugmentIds = [],
    lastDetectedAugments = [],
    lastDetectedSlotFingerprints = [],
}: MergePartialAugmentsOptions = {}) {
    if (augments.length >= slotCount || (lastDetectedAugments.length > 0 && lastDetectedAugments.length !== slotCount)) {
        return null
    }

    if (lastDetectedAugmentIds.length === 0) {
        return null
    }

    const partialIds = new Set(getAugmentIds(augments))
    const hasStablePreviousId = [...partialIds].some(id => lastDetectedAugmentIds.includes(id))
    const changedUnmatchedSlots = getChangedUnmatchedSlots({
        slotCount,
        slotDiagnostics,
        lastDetectedAugments,
        lastDetectedSlotFingerprints,
        hasStablePreviousId,
    })
    const hasDetectedSlot = augments.some(augment => isAugmentSlotIndex(augment?.detectedSlot, slotCount))
    if (!hasDetectedSlot && changedUnmatchedSlots.length === 0) {
        return null
    }

    const hasNewId = partialIds.size > 0 && [...partialIds].some(id => !lastDetectedAugmentIds.includes(id))
    if (!hasNewId && changedUnmatchedSlots.length === 0) {
        return null
    }

    const merged = Array.from({ length: slotCount }, (_, slot) => createEmptyAugmentSlot(slot))
    for (const augment of augments) {
        if (isAugmentSlotIndex(augment?.detectedSlot, slotCount)) {
            merged[augment.detectedSlot] = augment
        }
    }

    return {
        augments: merged,
        reason: hasNewId ? 'new-id' : 'slot-visual-changed',
        changedUnmatchedSlots,
    }
}
