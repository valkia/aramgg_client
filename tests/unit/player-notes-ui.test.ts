// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../../src/renderer/i18n/messages.ts'
import PlayerNoteEditor from '../../src/renderer/components/PlayerNoteEditor.vue'
import PlayerNotesBackup from '../../src/renderer/components/PlayerNotesBackup.vue'
import { createPlayerNotesStore, PLAYER_NOTES_KEY } from '../../src/renderer/services/player-notes-store.ts'
import type { ElectronAPI, PlayerNote } from '../../src/shared/ipc-contract.ts'

const key = `HN1:${'a'.repeat(64)}`
const note: PlayerNote = { playerKey: key, playerName: 'Player#CN1', label: 'friendly', text: 'Original', updatedAt: 1 }
let wrapper: VueWrapper
afterEach(() => { wrapper?.unmount() })

function setup() {
  const api = { list: vi.fn().mockResolvedValue({ success: true, notes: [note] }), save: vi.fn(), remove: vi.fn(), exportBackup: vi.fn(), previewImport: vi.fn(), applyImport: vi.fn(), cancelImport: vi.fn().mockResolvedValue({ success: true }) } satisfies ElectronAPI['playerNotes']
  const store = createPlayerNotesStore(api)
  wrapper = mount(defineComponent({ components: { PlayerNoteEditor }, setup: () => ({ key }), template: '<div><PlayerNoteEditor :player-key="key" player-name="Player#CN1"/><PlayerNoteEditor :player-key="key" player-name="Player#CN1"/></div>' }), { global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })], provide: { [PLAYER_NOTES_KEY as symbol]: store } } })
  return { api, store }
}

describe('player notes UI', () => {
  it('shares one lazy load and updates all appearances only after saving succeeds', async () => {
    const { api } = setup()
    await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('New note')
    api.save.mockResolvedValueOnce({ success: true, notes: [{ ...note, text: 'New note' }] })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.findAll('p').filter((entry) => entry.text() === 'New note')).toHaveLength(2)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ playerKey: key, text: 'New note' }))
  })

  it('keeps the draft and saved copy intact on failure and supports retry and delete', async () => {
    const { api, store } = setup()
    await flushPromises()
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Retry me')
    api.save.mockRejectedValueOnce(new Error('disk full'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(store.byKey.value.get(key)?.text).toBe('Original')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Retry me')
    expect(wrapper.get('[role="alert"]').text()).toContain('unchanged')
    api.remove.mockResolvedValueOnce({ success: true, notes: [] })
    await wrapper.findAll('button').find((entry) => entry.text() === 'Delete note')!.trigger('click')
    await flushPromises()
    expect(store.notes.value).toEqual([])
    expect(wrapper.text()).not.toContain('Original')
  })

  it('allows a new load after a synchronous bridge failure', async () => {
    const api = { list: vi.fn().mockImplementationOnce(() => { throw new Error('no preload') }).mockResolvedValue({ success: true, notes: [note] }), save: vi.fn(), remove: vi.fn(), exportBackup: vi.fn(), previewImport: vi.fn(), applyImport: vi.fn(), cancelImport: vi.fn().mockResolvedValue({ success: true }) }
    const store = createPlayerNotesStore(api)
    expect(await store.load()).toBe(false)
    expect(await store.load()).toBe(true)
    expect(store.notes.value).toHaveLength(1)
  })

  it('requires import confirmation, preserves the preview on failure, and updates the shared store on success', async () => {
    const api = { list: vi.fn().mockResolvedValue({ success: true, notes: [note] }), save: vi.fn(), remove: vi.fn(), exportBackup: vi.fn().mockResolvedValue({ success: true, canceled: true }), previewImport: vi.fn().mockResolvedValue({ success: true, preview: { token: 'token', total: 1, added: 0, kept: 1, samples: [note] } }), applyImport: vi.fn().mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true, notes: [note] }), cancelImport: vi.fn().mockResolvedValue({ success: true }) }
    const store = createPlayerNotesStore(api)
    await store.load()
    wrapper = mount(PlayerNotesBackup, { global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })], provide: { [PLAYER_NOTES_KEY as symbol]: store } } })
    const click = async (label: string) => { await wrapper.findAll('button').find((button) => button.text() === label)!.trigger('click'); await flushPromises() }
    await click('Export notes')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    await click('Import notes')
    expect(wrapper.text()).toContain('Import preview')
    expect(api.applyImport).not.toHaveBeenCalled()
    await click('Confirm import')
    expect(wrapper.get('[role="alert"]').text()).toContain('unchanged')
    expect(store.notes.value).toEqual([note])
    await click('Confirm import')
    expect(wrapper.text()).toContain('Import complete')
    expect(api.applyImport).toHaveBeenCalledWith('token')
    await click('Import notes')
    await click('Cancel')
    expect(api.cancelImport).toHaveBeenCalledWith('token')
  })
})
