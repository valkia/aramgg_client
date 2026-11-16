export const DEFAULT_AUGMENT_SLOT_COUNT = 3
export const MAX_AUGMENT_SLOT_COUNT = 4

export type AugmentSlotCount = typeof DEFAULT_AUGMENT_SLOT_COUNT | typeof MAX_AUGMENT_SLOT_COUNT

export function isAugmentSlotCount(count: unknown): count is AugmentSlotCount {
    return count === DEFAULT_AUGMENT_SLOT_COUNT || count === MAX_AUGMENT_SLOT_COUNT
}

export function isAugmentSlotIndex(slot: unknown, slotCount: AugmentSlotCount = MAX_AUGMENT_SLOT_COUNT): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < slotCount
}
