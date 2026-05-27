const getAugmentId = (augment) => augment?.augmentId ?? augment?.id

const getOrderIndex = (augment, fallbackIndex, order) => {
  if (Number.isInteger(augment?.detectedSlot)) {
    return augment.detectedSlot
  }

  const id = getAugmentId(augment)
  if (id != null) {
    const detectedIndex = order.get(String(id))
    if (detectedIndex != null) {
      return detectedIndex
    }
  }

  return fallbackIndex
}

export function sortAugmentsByDetectedOrder(augments = [], detectedAugments = []) {
  const order = new Map()

  detectedAugments.forEach((augment, index) => {
    const id = getAugmentId(augment)
    if (id != null) {
      order.set(String(id), index)
    }
  })

  if (order.size === 0) {
    return augments
  }

  return augments
    .map((augment, index) => ({ augment, index }))
    .sort((a, b) => {
      const aOrder = getOrderIndex(a.augment, a.index, order)
      const bOrder = getOrderIndex(b.augment, b.index, order)
      return aOrder - bOrder
    })
    .map(({ augment }) => augment)
}
