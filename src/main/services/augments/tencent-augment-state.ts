import type { TencentAugmentEvent } from './tencent-log-codec.ts'

export type AugmentEntry = { id: number | string; key?: string | null; name: string; rarity?: string; [key: string]: unknown }
export const TENCENT_SOURCE_STALE_MS = 15_000
export const TENCENT_CANDIDATE_MAX_AGE_MS = 60_000

export class TencentAugmentState {
  private candidates: { at: number; keys: string[] } | null = null
  private lastNonempty: { at: number; keys: string[] } | null = null
  private lastRecordAt = 0
  private lastEventAt = 0
  private lastSelectionAt = 0
  private seen = new Set<string>()

  get candidateObservedAt(): number | null { return this.candidates?.at ?? null }

  reset(): void {
    this.candidates = this.lastNonempty = null
    this.lastRecordAt = this.lastEventAt = this.lastSelectionAt = 0
    this.seen.clear()
  }

  heartbeat(at: number): void {
    if (this.lastRecordAt && at - this.lastRecordAt > TENCENT_SOURCE_STALE_MS) {
      this.candidates = this.lastNonempty = null
    }
    this.lastRecordAt = Math.max(this.lastRecordAt, at)
  }

  observe(event: TencentAugmentEvent): { selected: boolean; key: string | null; index: number | null } | null {
    const signature = `${event.at}:${JSON.stringify(event)}`
    if (this.seen.has(signature) || event.at < this.lastEventAt) return null
    this.seen.add(signature)
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!)
    this.lastEventAt = event.at
    if (event.kind === 'candidates') {
      if (event.at <= this.lastSelectionAt) return null
      this.candidates = event.keys.some(Boolean) ? { at: event.at, keys: event.keys } : null
      // A clear can precede the pick notification. Retain its mapping, never render it.
      if (this.candidates) this.lastNonempty = this.candidates
    } else if (event.kind === 'selected') {
      const previous = this.lastNonempty
      const key = previous && event.at - previous.at <= TENCENT_CANDIDATE_MAX_AGE_MS ? previous.keys[event.index] || null : null
      this.lastSelectionAt = event.at
      this.candidates = this.lastNonempty = null
      return { selected: true, key, index: event.index }
    }
    // 696 contains all players; never assume entry zero is the local player.
    return null
  }

  getCandidates(now: number, catalogue: AugmentEntry[]): AugmentEntry[] | null {
    if (now - this.lastRecordAt > TENCENT_SOURCE_STALE_MS) {
      this.candidates = this.lastNonempty = null
      return null
    }
    const offer = this.candidates
    if (!offer || now - offer.at > TENCENT_CANDIDATE_MAX_AGE_MS) return null
    if (offer.keys.length > 3 && offer.keys.slice(3).some(Boolean)) return null
    const result: AugmentEntry[] = []
    for (const [slot, key] of offer.keys.slice(0, 3).entries()) {
      const matches = catalogue.filter(a => a.key === key && Number.isSafeInteger(Number(a.id)) && Number(a.id) > 0)
      if (!key || matches.length !== 1 || !matches[0].name) return null
      result.push({ ...matches[0], detectedSlot: slot, missing: false, confidence: 1 })
    }
    return result.length === 3 ? result : null
  }
}
