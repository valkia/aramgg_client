// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateState, ClientVersionInfo } from '../../src/shared/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  handlers: new Set<(state: unknown) => void>(),
}))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  electronAPI: {
    appUpdate: { getState: mocks.getState, check: mocks.check, install: mocks.install },
    events: { on: (_channel: string, callback: (state: unknown) => void) => {
      mocks.handlers.add(callback)
      return () => mocks.handlers.delete(callback)
    } },
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
import { useAppUpdate } from '../../src/renderer/composables/use-app-update.ts'

const WINDOWS_INSTALLER_URL = 'https://example.com/aramgg_client-setup.exe'
let app: ReturnType<typeof createApp> | null = null
let root: HTMLDivElement

beforeEach(() => {
  mocks.handlers.clear()
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => {
  app?.unmount()
  app = null
  root.remove()
})

async function mountWithState(state: AppUpdateState) {
  mocks.getState.mockResolvedValue({ success: true, data: state })
  const versionInfo: Ref<ClientVersionInfo | null> = ref({ downloadUrl: WINDOWS_INSTALLER_URL })
  let update!: ReturnType<typeof useAppUpdate>
  app = createApp(defineComponent({
    setup() {
      update = useAppUpdate(versionInfo)
      return () => h('div')
    },
  }))
  app.mount(root)
  await Promise.resolve()
  await nextTick()
  return update
}

describe('app update composable', () => {
  it('falls back to the version download URL before the main process has a manual URL', async () => {
    // 主进程初始/配置读取失败时 manualDownloadUrl 为空，Windows 仍需保留版本信息里的下载入口。
    for (const phase of ['uninitialized', 'disabled']) {
      const update = await mountWithState({ phase, manualDownloadUrl: '' })
      expect(update.manualUpdateDownloadUrl.value).toBe(WINDOWS_INSTALLER_URL)
      expect(update.showManualDownloadLink.value).toBe(true)
      expect(update.showCheckUpdateAction.value).toBe(true)
      app?.unmount()
      app = null
    }
  })

  it('prefers the manual URL from the update state when present', async () => {
    const update = await mountWithState({ phase: 'disabled', manualDownloadUrl: 'https://example.com/latest.exe' })
    expect(update.manualUpdateDownloadUrl.value).toBe('https://example.com/latest.exe')
  })

  it('hides Windows download and check actions only when the platform is unsupported', async () => {
    const update = await mountWithState({ phase: 'disabled', manualDownloadUrl: '', platformUnsupported: true })
    expect(update.manualUpdateDownloadUrl.value).toBe('')
    expect(update.showManualDownloadLink.value).toBe(false)
    expect(update.showCheckUpdateAction.value).toBe(false)
  })
})
