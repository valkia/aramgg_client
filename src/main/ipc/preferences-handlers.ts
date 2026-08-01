import type { AppStoreKey, SupportedDataLocale } from '../../shared/ipc-contract.ts'
import {
  DEFAULT_DATA_LOCALE,
  SUPPORTED_DATA_LOCALES,
  getDataLocale,
  normalizeDataLocale,
  prepareDataLocale,
  setDataLocale,
} from '../data-loader.ts'
import { changeDataLocale } from '../modules/data-locale-controller.ts'
import store from '../modules/app-store.ts'
import logger from '../modules/logger.ts'
import { notifyAllWindows } from '../modules/window-manager.ts'
import { trustedIpcMain as ipcMain } from '../security/trusted-ipc.ts'

const APP_LOCALE_KEY = 'app.locale'
const RENDERER_STORE_KEYS = new Set<AppStoreKey>([
  'lastSelectedChampionId',
  'itemSets.autoApplyAram',
  'augments.showTopOverlay',
  'augments.showSidePanel',
  'postGameShare.autoShow',
])

function assertRendererStoreKey(key: unknown): asserts key is AppStoreKey {
  if (typeof key !== 'string' || !RENDERER_STORE_KEYS.has(key as AppStoreKey)) {
    throw new Error('Unsupported renderer store key')
  }
}

export function registerPreferencesIpcHandlers(): void {
  const storedLocale = store.get(APP_LOCALE_KEY)
  const startupLocale = normalizeDataLocale(storedLocale || DEFAULT_DATA_LOCALE)
  setDataLocale(DEFAULT_DATA_LOCALE)

  const startupDataLocalePromise = prepareDataLocale(startupLocale)
    .then((prepared) => {
      setDataLocale(prepared.locale)
      store.set(APP_LOCALE_KEY, prepared.locale)
      logger.info('[locale] startup data locale activated', prepared)
      return prepared
    })
    .catch((error: Error) => {
      setDataLocale(DEFAULT_DATA_LOCALE)
      store.set(APP_LOCALE_KEY, DEFAULT_DATA_LOCALE)
      logger.warn('[locale] stored data locale unavailable; reset to default:', {
        requestedLocale: startupLocale,
        locale: DEFAULT_DATA_LOCALE,
        error: error.message,
      })
      return { locale: DEFAULT_DATA_LOCALE, dataVersion: '' }
    })

  ipcMain.handle('store-get', (_event, key: unknown) => {
    assertRendererStoreKey(key)
    return store.get(key)
  })

  ipcMain.handle('store-set', (_event, key: unknown, value: unknown) => {
    assertRendererStoreKey(key)
    store.set(key, value)
  })

  ipcMain.handle('store-delete', (_event, key: unknown) => {
    assertRendererStoreKey(key)
    store.delete(key)
  })

  ipcMain.handle('locale-get', async () => {
    await startupDataLocalePromise
    return {
      locale: getDataLocale(),
      supportedLocales: SUPPORTED_DATA_LOCALES,
    }
  })

  ipcMain.handle('locale-set', async (_event, locale: unknown) => {
    await startupDataLocalePromise
    const normalizedLocale = normalizeDataLocale(locale) as SupportedDataLocale
    const prepared = await changeDataLocale(normalizedLocale, {
      prepare: prepareDataLocale,
      persist: (preparedLocale) => store.set(APP_LOCALE_KEY, preparedLocale),
      activate: setDataLocale,
      notify: (payload) => notifyAllWindows('locale-changed', payload),
    })

    logger.info('[locale] data locale changed', {
      locale: prepared.locale,
      dataVersion: prepared.dataVersion,
    })

    return {
      locale: prepared.locale,
      dataVersion: prepared.dataVersion,
      supportedLocales: SUPPORTED_DATA_LOCALES,
    }
  })
}
