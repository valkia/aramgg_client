import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCipheriv } from 'node:crypto'
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTencentLogKey, decodeTencentLogLine, isTencentRegion } from '../../src/main/services/augments/tencent-log-codec.ts'
import { TencentAugmentState } from '../../src/main/services/augments/tencent-augment-state.ts'
import { TencentLogTail } from '../../src/main/services/augments/tencent-log-tail.ts'
import { TencentAugmentSource } from '../../src/main/services/augments/tencent-augment-source.ts'
import { watchTencentLog } from '../../src/main/services/augments/tencent-log-watch.ts'
import { parseTencentLogDirectory } from '../../src/main/services/augments/tencent-augment-runtime.ts'

vi.mock('../../src/main/modules/logger.ts', () => ({ default: { debug: vi.fn() } }))

const puuid = 'synthetic-current-player'
const catalogue = [{ id: 2005, key: 'ARAM_InfernoTriggered', name: 'A' }, { id: 1079, key: 'ARAM_SymphonyofWar', name: 'B' }, { id: 1361, key: 'ARAM_Quest_VoidImmolation', name: 'C' }]
const keys = catalogue.map(a => a.key)
const offers = { dwSubCmd: 693, form: 'game', params: { astAugments: [...keys, '', ''].map(szAugmentName => ({ szAugmentName, chSpellSlot: -1 })) } }
const pick = { dwSubCmd: 694, form: 'game', params: { dwAugmentIndex: 2 } }
let now: number
let directory: string
let file: string
const sources: TencentAugmentSource[] = []

function line(event: unknown, at = now, account = puuid): string {
  const date = new Date(at)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  const key = createTencentLogKey(account)
  const cipher = createCipheriv('aes-128-cbc', key, key)
  const encrypted = Buffer.concat([cipher.update('game-log-> ' + JSON.stringify(event)), cipher.final()]).toString('hex')
  return `[${stamp}] [info] ${encrypted}\n`
}

function createSource(overrides: Record<string, unknown> = {}) {
  const options = {
    supported: true,
    readIdentity: vi.fn(async () => ({ region: 'TENCENT', puuid })),
    locate: vi.fn(async () => file),
    watch: vi.fn(() => vi.fn()),
    catalogue: vi.fn(async () => catalogue),
    selected: vi.fn(), candidatesReady: vi.fn(), diagnostic: vi.fn(), now: () => now, ...overrides,
  }
  const source = new TencentAugmentSource(options)
  sources.push(source)
  source.start()
  return { source, options }
}

beforeEach(async () => {
  vi.useFakeTimers()
  now = new Date(2026, 10, 7, 18, 16, 50).getTime()
  directory = await mkdtemp(path.join(os.tmpdir(), 'aramgg-tencent-test-'))
  file = path.join(directory, 'main.log')
  await writeFile(file, '')
})
afterEach(async () => {
  sources.splice(0).forEach(source => source.stop())
  vi.restoreAllMocks()
  vi.useRealTimers()
  // Only remove the test-owned directory created above, never a caller path.
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('aramgg-tencent-test-')) throw new Error('Unexpected fixture directory')
  await rm(directory, { recursive: true, force: true })
})

describe('Tencent log codec and selection state', () => {
  it('accepts only local absolute log directories from the component argument', () => {
    expect(parseTencentLogDirectory('icreateLol.exe --logDir "D:\\Tencent data\\lol" --other value'))
      .toBe('D:\\Tencent data\\lol\\iCreateLogs\\main.log')
    expect(parseTencentLogDirectory('icreateLol.exe --logDir=C:/Tencent/lol'))
      .toBe('C:\\Tencent\\lol\\iCreateLogs\\main.log')
    for (const command of ['--logDir relative', '--logDir C:relative', '--logDir "\\\\server\\share"', '--logDir', '--other D:\\data']) {
      expect(parseTencentLogDirectory(command)).toBeNull()
    }
  })
  it('keeps array order, empty slots and a separate zero-based pick index', () => {
    const record = decodeTencentLogLine(line(offers), createTencentLogKey(puuid))
    expect(record?.event).toEqual({ kind: 'candidates', at: now, keys: [...keys, '', ''] })
    expect(decodeTencentLogLine(line(pick), createTencentLogKey(puuid))?.event).toEqual({ kind: 'selected', at: now, index: 2 })
  })
  it('rejects wrong credentials, malformed schemas, TFT frames and huge lines', () => {
    const key = createTencentLogKey(puuid)
    expect(decodeTencentLogLine(line(offers, now, 'another-player'), key)).toBeNull()
    expect(decodeTencentLogLine(line({ ...offers, form: 'tft' }), key)).toBeNull()
    expect(decodeTencentLogLine(line({ ...pick, params: { dwAugmentIndex: '2' } }), key)).toBeNull()
    expect(decodeTencentLogLine(line({ ...offers, params: { astAugments: [{ szAugmentName: '../private' }] } }), key)).toBeNull()
    expect(decodeTencentLogLine('a'.repeat(300_000), key)).toBeNull()
    expect(isTencentRegion('zh-CN')).toBe(false)
    expect(isTencentRegion('TW2')).toBe(false)
  })
  it('retains candidates through an empty frame for pick mapping, without rendering them', () => {
    const state = new TencentAugmentState()
    state.heartbeat(now)
    state.observe({ kind: 'candidates', at: now, keys })
    expect(state.getCandidates(now, catalogue)?.map(a => a.id)).toEqual([2005, 1079, 1361])
    state.observe({ kind: 'candidates', at: now + 1, keys: ['', '', ''] })
    expect(state.getCandidates(now + 1, catalogue)).toBeNull()
    const event = { kind: 'selected' as const, at: now + 2, index: 2 }
    expect(state.observe(event)).toMatchObject({ selected: true, key: keys[2] })
    expect(state.observe(event)).toBeNull()
    state.observe({ kind: 'candidates', at: now, keys })
    expect(state.getCandidates(now + 2, catalogue)).toBeNull()
  })
  it('falls back for partial, unmapped, ambiguous, extra or stale candidates', () => {
    const state = new TencentAugmentState()
    state.heartbeat(now)
    state.observe({ kind: 'candidates', at: now, keys })
    expect(state.getCandidates(now, catalogue.slice(0, 2))).toBeNull()
    expect(state.getCandidates(now, [...catalogue, catalogue[0]])).toBeNull()
    expect(state.getCandidates(now + 15_001, catalogue)).toBeNull()
    state.heartbeat(now + 61_000)
    expect(state.getCandidates(now + 61_000, catalogue)).toBeNull()
    state.observe({ kind: 'candidates', at: now + 61_001, keys: [...keys, 'fourth'] })
    expect(state.getCandidates(now + 61_001, catalogue)).toBeNull()
  })
  it('does not infer the local selected augment from someone else in 696', () => {
    const state = new TencentAugmentState()
    expect(state.observe({ kind: 'owned', at: now, players: [{ netId: 42, keys: [keys[2]] }] })).toBeNull()
    expect(state.observe({ kind: 'selected', at: now + 1, index: 2 })).toMatchObject({ selected: true, key: null })
  })
  it('does not revive old candidates when game heartbeats resume after a gap', () => {
    const state = new TencentAugmentState()
    state.heartbeat(now)
    state.observe({ kind: 'candidates', at: now, keys })
    state.heartbeat(now + 16_000)
    expect(state.getCandidates(now + 16_000, catalogue)).toBeNull()
    expect(state.observe({ kind: 'selected', at: now + 16_001, index: 2 })).toMatchObject({ selected: true, key: null })
  })
})

describe('bounded read-only tail and failover', () => {
  it('reads a file change before the polling deadline and coalesces a notification burst', async () => {
    vi.setSystemTime(now)
    let changed!: () => void
    const { source, options } = createSource({
      now: () => Date.now(),
      watch: vi.fn((_file, onChange) => { changed = onChange; return vi.fn() }),
    })
    await vi.advanceTimersByTimeAsync(0)
    await source.poll()
    const reads = vi.spyOn(TencentLogTail.prototype, 'read')
    await appendFile(file, line(offers))
    for (let i = 0; i < 30; i++) changed()
    await vi.advanceTimersByTimeAsync(49)
    expect(reads).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(options.candidatesReady).toHaveBeenCalledTimes(1), { interval: 5, timeout: 200 })
    expect(Date.now() - now).toBeLessThan(500)
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('rechecks changes received during a slow read without overlapping reads', async () => {
    vi.setSystemTime(now)
    let changed!: () => void
    const { source, options } = createSource({ now: () => Date.now(), watch: (_file, onChange) => { changed = onChange; return vi.fn() } })
    await vi.advanceTimersByTimeAsync(0)
    await source.poll()
    let finish!: (batch: { reset: boolean; lines: string[] }) => void
    const reads = vi.spyOn(TencentLogTail.prototype, 'read').mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    changed()
    await vi.advanceTimersByTimeAsync(50)
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1), { interval: 5, timeout: 200 })
    await appendFile(file, line(offers))
    for (let i = 0; i < 10; i++) changed()
    await vi.advanceTimersByTimeAsync(100)
    expect(reads).toHaveBeenCalledTimes(1)
    finish({ reset: false, lines: [] })
    await vi.waitFor(() => expect(options.candidatesReady).toHaveBeenCalledTimes(1), { interval: 5, timeout: 200 })
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('keeps polling when file watching cannot start or later fails, and ignores late callbacks', async () => {
    for (const failAtStart of [true, false]) {
      vi.setSystemTime(now)
      let changed: (() => void) | undefined
      let failed: (() => void) | undefined
      const close = vi.fn()
      const watch = vi.fn((_file, onChange, onError) => {
        if (failAtStart) throw new Error('watch access denied')
        changed = onChange
        failed = onError
        return close
      })
      const { source, options } = createSource({ now: () => Date.now(), watch })
      await vi.advanceTimersByTimeAsync(0)
      await source.poll()
      failed?.()
      await appendFile(file, line(offers))
      await vi.advanceTimersByTimeAsync(500)
      await vi.waitFor(() => expect(options.candidatesReady).toHaveBeenCalledTimes(1), { interval: 5, timeout: 200 })
      expect(options.diagnostic).toHaveBeenCalledWith('file-watch-status', { enabled: false, fallback: 'polling' })
      expect(watch).toHaveBeenCalledTimes(1)
      source.stop()
      if (!failAtStart) expect(close).toHaveBeenCalledTimes(1)
      changed?.()
      failed?.()
      await vi.advanceTimersByTimeAsync(1000)
      expect(options.candidatesReady).toHaveBeenCalledTimes(1)
      await writeFile(file, '')
    }
  })

  it('uses the OS directory watcher on an isolated log and closes it on stop', async () => {
    vi.useRealTimers()
    now = Date.now()
    const changed = vi.fn()
    const close = vi.fn()
    const { source, options } = createSource({
      now: () => Date.now(),
      watch: (watchedFile, onChange, onError) => {
        const stop = watchTencentLog(watchedFile, () => { changed(); onChange() }, onError)
        return () => { close(); stop() }
      },
    })
    await source.poll()
    now = Date.now()
    await appendFile(file, line(offers))
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 2000 })
    await vi.waitFor(() => expect(options.candidatesReady).toHaveBeenCalledTimes(1), { timeout: 2000 })
    source.stop()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('notifies once per mapped candidate change and never wakes for a pick in the same batch', async () => {
    const { source, options } = createSource()
    await appendFile(file, line(offers))
    await source.poll()
    expect(options.candidatesReady).toHaveBeenCalledExactlyOnceWith({ observedAt: now, receivedAt: now })
    now += 100
    await appendFile(file, line(offers))
    await source.poll()
    expect(options.candidatesReady).toHaveBeenCalledTimes(1)
    now += 100
    const reroll = { ...offers, params: { astAugments: [...keys].reverse().map(szAugmentName => ({ szAugmentName })) } }
    await appendFile(file, line(reroll))
    await source.poll()
    expect(options.candidatesReady).toHaveBeenCalledTimes(2)
    now += 100
    await appendFile(file, line(offers) + line(pick, now + 1))
    await source.poll()
    expect(options.candidatesReady).toHaveBeenCalledTimes(2)
  })

  it('wakes capture once the missing mapping arrives, but never after stop', async () => {
    let finish!: (entries: typeof catalogue) => void
    const { source, options } = createSource({ catalogue: () => new Promise(resolve => { finish = resolve }) })
    await appendFile(file, line(offers))
    await source.poll()
    expect(options.candidatesReady).not.toHaveBeenCalled()
    finish(catalogue)
    await Promise.resolve()
    expect(options.candidatesReady).toHaveBeenCalledTimes(1)
    source.stop()
    await source.poll()
    expect(options.candidatesReady).toHaveBeenCalledTimes(1)
  })
  it('does no discovery on unsupported platforms and falls back when the component is missing', async () => {
    const disabled = createSource({ supported: false })
    await disabled.source.poll()
    expect(disabled.options.readIdentity).not.toHaveBeenCalled()
    expect(disabled.options.locate).not.toHaveBeenCalled()
    expect(disabled.options.watch).not.toHaveBeenCalled()
    expect(disabled.source.getCandidates()).toBeNull()
    const missing = createSource({ locate: vi.fn(async () => null) })
    await missing.source.poll()
    expect(missing.source.getCandidates()).toBeNull()
    expect(missing.options.diagnostic).toHaveBeenCalledWith('source-status', { source: 'ocr', reason: 'logs-unavailable' })
  })
  it('buffers incomplete lines and observes appended bytes exactly once', async () => {
    const tail = new TencentLogTail(file)
    const text = line(offers)
    await appendFile(file, text.slice(0, 100))
    expect((await tail.read()).lines).toEqual([])
    await appendFile(file, text.slice(100))
    expect((await tail.read()).lines).toEqual([text.trimEnd()])
    expect((await tail.read()).lines).toEqual([])
  })
  it('detects rotation and same-file truncation followed by regrowth', async () => {
    const tail = new TencentLogTail(file)
    await writeFile(file, 'first\n')
    await tail.read()
    await rename(file, path.join(directory, 'main.old.log'))
    await writeFile(file, 'second\n')
    expect(await tail.read()).toMatchObject({ reset: true, lines: ['second'] })
    await writeFile(file, 'rewritten-and-longer\n')
    expect(await tail.read()).toMatchObject({ reset: true, lines: ['rewritten-and-longer'] })
  })
  it('bounds a backlog instead of loading an entire file', async () => {
    await writeFile(file, 'x'.repeat(512 * 1024) + '\nlast\n')
    const tail = new TencentLogTail(file)
    expect((await tail.read()).lines).toEqual(['last'])
  })
  it('never opens logs or loads data on overseas/unknown regions', async () => {
    for (const identity of [null, { region: 'NA', puuid }, { region: 'TW2', puuid }, { region: 'zh-CN', puuid }]) {
      const { source, options } = createSource({ readIdentity: vi.fn(async () => identity) })
      await source.poll()
      expect(options.locate).not.toHaveBeenCalled()
      expect(options.watch).not.toHaveBeenCalled()
      expect(options.catalogue).not.toHaveBeenCalled()
      expect(source.getCandidates()).toBeNull()
      source.stop()
    }
  })
  it('ignores pre-start records and maps a fresh pick even when the first owned snapshot is old', async () => {
    const { source, options } = createSource()
    await writeFile(file, line(offers, now - 1000) + line(pick, now - 500))
    await source.poll()
    expect(source.getCandidates()).toBeNull()
    expect(options.selected).not.toHaveBeenCalled()
    now += 100
    await appendFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()?.map(a => a.key)).toEqual(keys)
    now += 100
    const owned = { dwSubCmd: 696, form: 'game', params: { astPlayerHextechAugmentSelectionList: [{ dwHeroNetID: 42, astAugments: [] }] } }
    await appendFile(file, line(pick) + line(owned, now + 3))
    await source.poll()
    expect(options.selected).toHaveBeenCalledExactlyOnceWith({ at: now, index: 2, key: keys[2], id: 1361 })
    expect(source.getCandidates()).toBeNull()
    await source.poll()
    expect(options.selected).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(options.diagnostic.mock.calls)).not.toContain(puuid)
    expect(JSON.stringify(options.diagnostic.mock.calls)).not.toContain(directory)
  })
  it('still confirms a local pick when the augment catalogue cannot be loaded', async () => {
    const { source, options } = createSource({ catalogue: vi.fn(async () => { throw new Error('catalogue missing') }) })
    await appendFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()).toBeNull()
    now += 100
    await appendFile(file, line(pick))
    await source.poll()
    expect(options.selected).toHaveBeenCalledExactlyOnceWith({ at: now, index: 2, key: keys[2], id: null })
  })
  it('does not wait for a slow data load to observe a pick, or restore data after stop', async () => {
    let finish!: (entries: typeof catalogue) => void
    const { source, options } = createSource({ catalogue: () => new Promise(resolve => { finish = resolve }) })
    await appendFile(file, line(offers) + line(pick, now + 1))
    await source.poll()
    expect(options.selected).toHaveBeenCalledExactlyOnceWith({ at: now + 1, index: 2, key: keys[2], id: null })
    source.stop()
    finish(catalogue)
    await Promise.resolve()
    expect(source.getCandidates()).toBeNull()
  })
  it('falls back immediately after read failure and recovers on fresh records', async () => {
    const { source } = createSource()
    await appendFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()).not.toBeNull()
    await rm(file)
    now += 100
    await source.poll()
    expect(source.getCandidates()).toBeNull()
    now += 5100
    await writeFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()).not.toBeNull()
  })
  it('invalidates candidates after rotation without replaying a previous pick', async () => {
    const { source, options } = createSource()
    await appendFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()).not.toBeNull()
    await rename(file, path.join(directory, 'main.old.log'))
    await writeFile(file, line(offers) + line(pick, now + 1))
    now += 100
    await source.poll()
    expect(options.selected).not.toHaveBeenCalled()
    expect(source.getCandidates()).toBeNull()
    now += 100
    await appendFile(file, line(offers))
    await source.poll()
    expect(source.getCandidates()).not.toBeNull()
  })
  it('expires a stalled or undecodable stream without blocking OCR', async () => {
    const { source } = createSource()
    await appendFile(file, line(offers))
    await source.poll()
    now += 16_000
    await appendFile(file, line(offers, now, 'other-account'))
    await source.poll()
    expect(source.getCandidates()).toBeNull()
  })
  it('clears the old account and decodes only the new current identity', async () => {
    let account = puuid
    const { source } = createSource({ readIdentity: vi.fn(async () => ({ region: 'TENCENT', puuid: account })) })
    await appendFile(file, line(offers))
    await source.poll()
    account = 'synthetic-next-player'
    now += 16_000
    await source.poll()
    expect(source.getCandidates()).toBeNull()
    now += 100
    await appendFile(file, line(offers, now, account))
    await source.poll()
    expect(source.getCandidates()).not.toBeNull()
  })
  it('does not emit after stop while identity discovery is in flight', async () => {
    let finish!: (identity: { region: string; puuid: string }) => void
    const { source, options } = createSource({ readIdentity: () => new Promise(resolve => { finish = resolve }) })
    const pending = source.poll()
    source.stop()
    finish({ region: 'TENCENT', puuid })
    await pending
    expect(options.locate).not.toHaveBeenCalled()
    expect(source.getCandidates()).toBeNull()
  })
})
