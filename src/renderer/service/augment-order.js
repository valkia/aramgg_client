const getAugmentId = (augment) => augment?.augmentId ?? augment?.id

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
      const aOrder = order.get(String(getAugmentId(a.augment)))
      const bOrder = order.get(String(getAugmentId(b.augment)))

      if (aOrder == null && bOrder == null) {
        return a.index - b.index
      }
      if (aOrder == null) {
        return 1
      }
      if (bOrder == null) {
        return -1
      }

      return aOrder - bOrder
    })
    .map(({ augment }) => augment)
}
