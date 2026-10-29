import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { loadDataApiConfig } from './data-loader.ts'
import logger from './modules/logger.ts'
import { allowMainWindowClose } from './modules/window-manager.ts'
import {
  normalizeTrustedUpdateFeedUrl,
  parseTrustedPublisherNames,
  parseTrustedUpdateOrigins,
} from './security/update-trust.ts'

const { autoUpdater, CancellationToken } = electronUpdater
type UpdateCancellationToken = InstanceType<typeof CancellationToken>

type UpdatePhase =
  | 'uninitialized'
  | 'disabled'
  | 'no-feed'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'installing'

type UpdateProgress = {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

type UpdateState = {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string
  feedUrl: string
  feedConfigured: boolean
  autoUpdateEnabled: boolean
  manualDownloadUrl: string
  available: boolean
  downloaded: boolean
  gamePhase: string
  downloadDeferred: boolean
  progress: UpdateProgress | null
  error: string
  message: string
  lastCheckedAt: string
  canCheck: boolean
  canInstall: boolean
}

type InitializeOptions = {
  isDev: boolean
}

type RefreshOptions = {
  force?: boolean
  reason?: string
}

type UpdateActionResult = {
  success: boolean
  data: UpdateState
  error?: string
}

const UPDATE_STATUS_CHANNEL = 'app-update-status-changed'
const DEV_UPDATE_CHECK_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.ARAMGG_ALLOW_DEV_UPDATE_CHECK || '')
)
const AUTO_UPDATE_ENV_VALUE = String(process.env.ARAMGG_ENABLE_AUTO_UPDATE || '').trim()
const AUTO_UPDATE_ENV_CONFIGURED = AUTO_UPDATE_ENV_VALUE.length > 0
const AUTO_UPDATE_ENV_ENABLED = /^(1|true|yes)$/i.test(AUTO_UPDATE_ENV_VALUE)
const UPDATE_DOWNLOAD_BLOCKED_PHASES = new Set(['GameStart', 'InProgress'])

// Temporary unsigned-update bridge. Keep the feed origin pinned while Windows
// publisher verification is disabled. Once signed installers and matching
// publisher names are verified end to end, restore this and package.json's
// win.verifyUpdateCodeSignature to true.
const REQUIRE_SIGNED_WINDOWS_UPDATES = false
const BUILTIN_TRUSTED_UPDATE_ORIGINS: readonly string[] = ['https://cdn.dtodo.cn']
const BUILTIN_TRUSTED_UPDATE_PUBLISHERS: readonly string[] = []
const DEV_TRUSTED_UPDATE_ORIGINS = DEV_UPDATE_CHECK_ENABLED
  ? String(process.env.ARAMGG_UPDATE_ALLOWED_ORIGINS || '').split(',')
  : []
const DEV_TRUSTED_UPDATE_PUBLISHERS = DEV_UPDATE_CHECK_ENABLED
  ? String(process.env.ARAMGG_UPDATE_PUBLISHER_NAMES || '').split(',')
  : []
const TRUSTED_UPDATE_ORIGINS = parseTrustedUpdateOrigins(
  [...BUILTIN_TRUSTED_UPDATE_ORIGINS, ...DEV_TRUSTED_UPDATE_ORIGINS],
  DEV_UPDATE_CHECK_ENABLED
)
const TRUSTED_UPDATE_PUBLISHERS = parseTrustedPublisherNames([
  ...BUILTIN_TRUSTED_UPDATE_PUBLISHERS,
  ...DEV_TRUSTED_UPDATE_PUBLISHERS,
])

let initialized = false
let isDevRuntime = false
let configuredFeedUrl = ''
let installCleanup: (() => Promise<void> | void) | null = null
let checkForUpdatesPromise: Promise<UpdateActionResult> | null = null
let downloadUpdatePromise: Promise<UpdateActionResult> | null = null
let activeDownloadCancellationToken: UpdateCancellationToken | null = null
let installingDownloadedUpdate = false
let currentGamePhase = ''
let downloadDeferredByGame = false

let updateState: UpdateState = {
  phase: 'uninitialized',
  currentVersion: app.getVersion(),
  latestVersion: '',
  feedUrl: '',
  feedConfigured: false,
  autoUpdateEnabled: false,
  manualDownloadUrl: '',
  available: false,
  downloaded: false,
  gamePhase: '',
  downloadDeferred: false,
  progress: null,
  error: '',
  message: '自动更新初始化中',
  lastCheckedAt: '',
  canCheck: false,
  canInstall: false,
}

function isGameBlockingUpdate(phase = currentGamePhase): boolean {
  return UPDATE_DOWNLOAD_BLOCKED_PHASES.has(phase)
}

function getDownloadedUpdateMessage(): string {
  return '更新已下载，退出或重启应用时会自动安装'
}

function getDeferredDownloadMessage(): string {
  return '对局进行中，结束后继续下载更新'
}

function createUpdateState(patch: Partial<UpdateState> = {}): UpdateState {
  const phase = patch.phase || updateState?.phase || 'uninitialized'
  const feedUrl = patch.feedUrl ?? updateState?.feedUrl ?? ''
  const feedConfigured = patch.feedConfigured ?? Boolean(feedUrl)
  const autoUpdateEnabled = patch.autoUpdateEnabled ?? updateState?.autoUpdateEnabled ?? false
  const currentVersion = app.getVersion()
  const gamePhase = patch.gamePhase ?? updateState?.gamePhase ?? currentGamePhase
  const downloadDeferred = patch.downloadDeferred ?? updateState?.downloadDeferred ?? downloadDeferredByGame
  const busy = phase === 'checking' || phase === 'available' || phase === 'downloading' || phase === 'installing'

  return {
    phase,
    currentVersion,
    latestVersion: patch.latestVersion ?? updateState?.latestVersion ?? '',
    feedUrl,
    feedConfigured,
    autoUpdateEnabled,
    manualDownloadUrl: patch.manualDownloadUrl ?? updateState?.manualDownloadUrl ?? '',
    available: patch.available ?? updateState?.available ?? false,
    downloaded: patch.downloaded ?? updateState?.downloaded ?? false,
    gamePhase,
    downloadDeferred,
    progress: patch.progress ?? updateState?.progress ?? null,
    error: patch.error ?? updateState?.error ?? '',
    message: patch.message ?? updateState?.message ?? '',
    lastCheckedAt: patch.lastCheckedAt ?? updateState?.lastCheckedAt ?? '',
    canCheck: patch.canCheck ?? (autoUpdateEnabled && isRuntimeUpdateAllowed() && feedConfigured && !busy && phase !== 'downloaded'),
    canInstall: patch.canInstall ?? phase === 'downloaded',
  }
}

function setUpdateState(patch: Partial<UpdateState>): UpdateState {
  if (Object.prototype.hasOwnProperty.call(patch, 'gamePhase')) {
    currentGamePhase = patch.gamePhase || ''
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'downloadDeferred')) {
    downloadDeferredByGame = patch.downloadDeferred === true
  }

  updateState = createUpdateState(patch)
  broadcastUpdateState()
  return updateState
}

function broadcastUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATUS_CHANNEL, updateState)
    }
  }
}

function isRuntimeUpdateAllowed(): boolean {
  return app.isPackaged || DEV_UPDATE_CHECK_ENABLED
}

function normalizeFeedUrl(value: unknown): string {
  return normalizeTrustedUpdateFeedUrl(
    value,
    TRUSTED_UPDATE_ORIGINS,
    DEV_UPDATE_CHECK_ENABLED
  )
}

function configureUpdateSignatureVerification(): void {
  const updater = autoUpdater as typeof autoUpdater & {
    verifyUpdateCodeSignature?: (
      publisherNames: string[],
      filePath: string
    ) => Promise<string | null>
  }

  if (!REQUIRE_SIGNED_WINDOWS_UPDATES) {
    updater.verifyUpdateCodeSignature = async () => null
    logger.warn('[update] Windows update signature verification is temporarily disabled')
    return
  }

  if (TRUSTED_UPDATE_PUBLISHERS.length === 0) {
    throw new Error('自动更新未配置受信任的 Windows 发布者名称')
  }

  const defaultVerifier = updater.verifyUpdateCodeSignature?.bind(updater)
  if (!defaultVerifier) {
    throw new Error('当前平台不支持 Windows 更新签名校验')
  }

  updater.verifyUpdateCodeSignature = (_publisherNames, filePath) =>
    defaultVerifier(TRUSTED_UPDATE_PUBLISHERS, filePath)
}

function getClientConfig(config: any): any {
  return config?.client || config?.electron || {}
}

function getUpdateFeedCandidate(config: any): string {
  return (
    process.env.ARAMGG_UPDATE_FEED_URL ||
    getClientConfig(config).updateFeedUrl ||
    config?.electron?.updateFeedUrl ||
    ''
  )
}

function getManualDownloadUrl(config: any): string {
  return (
    getClientConfig(config).downloadUrl ||
    config?.electron?.downloadUrl ||
    ''
  )
}

function getLatestVersionHint(config: any): string {
  return (
    getClientConfig(config).latestVersion ||
    config?.electron?.latestVersion ||
    ''
  )
}

function getAutoUpdateEnabled(config: any): boolean {
  if (AUTO_UPDATE_ENV_CONFIGURED) {
    return AUTO_UPDATE_ENV_ENABLED
  }

  return getClientConfig(config).autoUpdateEnabled === true || config?.electron?.autoUpdateEnabled === true
}

function normalizeProgress(progress: ProgressInfo): UpdateProgress {
  const percent = Number(progress.percent)
  const transferred = Number(progress.transferred)
  const total = Number(progress.total)
  const bytesPerSecond = Number(progress.bytesPerSecond)

  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    transferred: Number.isFinite(transferred) ? transferred : 0,
    total: Number.isFinite(total) ? total : 0,
    bytesPerSecond: Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0,
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error || '自动更新失败')
}

function applyUpdateInfo(info: UpdateInfo | UpdateDownloadedEvent | null | undefined): void {
  if (!info) {
    return
  }

  setUpdateState({
    latestVersion: info.version || updateState.latestVersion,
  })
}

function deferDownloadUntilGameEnds(message = getDeferredDownloadMessage()): UpdateState {
  return setUpdateState({
    phase: updateState.downloaded ? 'downloaded' : 'available',
    available: updateState.available,
    downloaded: updateState.downloaded,
    downloadDeferred: !updateState.downloaded,
    progress: updateState.downloaded ? updateState.progress : null,
    error: '',
    message: updateState.downloaded ? getDownloadedUpdateMessage() : message,
  })
}

function cancelActiveDownloadForGame(): void {
  if (!activeDownloadCancellationToken || activeDownloadCancellationToken.cancelled) {
    return
  }

  logger.info('[update] cancelling active download because game is in progress', {
    gamePhase: currentGamePhase,
  })
  downloadDeferredByGame = true
  activeDownloadCancellationToken.cancel()
}

function shouldDownloadAvailableUpdate(): boolean {
  return (
    updateState.autoUpdateEnabled &&
    updateState.feedConfigured &&
    updateState.available &&
    !updateState.downloaded &&
    isRuntimeUpdateAllowed()
  )
}

function scheduleAppUpdateDownload(reason: string): void {
  if (!shouldDownloadAvailableUpdate()) {
    return
  }

  if (isGameBlockingUpdate()) {
    if (updateState.phase === 'downloading') {
      cancelActiveDownloadForGame()
    }
    deferDownloadUntilGameEnds()
    return
  }

  void downloadAppUpdate(reason)
}

function registerAutoUpdaterEvents(): void {
  if (initialized) {
    return
  }

  initialized = true
  autoUpdater.logger = logger
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.forceDevUpdateConfig = DEV_UPDATE_CHECK_ENABLED && !app.isPackaged

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      phase: 'checking',
      error: '',
      progress: null,
      message: '正在检查更新',
    })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info('[update] app update available', {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      feedUrl: configuredFeedUrl,
    })
    setUpdateState({
      phase: 'available',
      latestVersion: info.version || updateState.latestVersion,
      available: true,
      downloaded: false,
      downloadDeferred: isGameBlockingUpdate(),
      progress: null,
      error: '',
      message: isGameBlockingUpdate() ? '发现新版本，等待对局结束后下载' : '发现新版本，正在后台下载',
    })
    scheduleAppUpdateDownload('update-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      phase: 'downloading',
      progress: normalizeProgress(progress),
      available: true,
      downloaded: false,
      downloadDeferred: false,
      error: '',
      message: '正在后台下载更新',
    })
  })

  autoUpdater.on('update-downloaded', (event) => {
    logger.info('[update] app update downloaded', {
      currentVersion: app.getVersion(),
      latestVersion: event.version,
      downloadedFile: event.downloadedFile || null,
    })
    setUpdateState({
      phase: 'downloaded',
      latestVersion: event.version || updateState.latestVersion,
      available: true,
      downloaded: true,
      downloadDeferred: false,
      progress: {
        percent: 100,
        transferred: updateState.progress?.transferred || 0,
        total: updateState.progress?.total || 0,
        bytesPerSecond: 0,
      },
      error: '',
      message: getDownloadedUpdateMessage(),
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    logger.info('[update] app update not available', {
      currentVersion: app.getVersion(),
      latestVersion: info.version || null,
      feedUrl: configuredFeedUrl,
    })
    setUpdateState({
      phase: 'not-available',
      latestVersion: info.version || updateState.latestVersion,
      available: false,
      downloaded: false,
      downloadDeferred: false,
      progress: null,
      error: '',
      lastCheckedAt: new Date().toISOString(),
      message: '当前已是最新',
    })
  })

  autoUpdater.on('update-cancelled', (info) => {
    logger.warn('[update] app update cancelled', {
      latestVersion: info.version || null,
      gamePhase: currentGamePhase || null,
    })
    if (isGameBlockingUpdate() && shouldDownloadAvailableUpdate()) {
      deferDownloadUntilGameEnds()
      return
    }

    setUpdateState({
      phase: 'idle',
      downloadDeferred: false,
      progress: null,
      error: '',
      message: '更新下载已取消',
    })
  })

  autoUpdater.on('error', (error) => {
    const message = getErrorMessage(error)
    logger.warn('[update] app update failed:', message)
    setUpdateState({
      phase: 'error',
      downloadDeferred: false,
      progress: null,
      error: message,
      message: '自动更新失败',
    })
  })
}

export function initializeAppUpdateService(options: InitializeOptions): void {
  isDevRuntime = options.isDev
  registerAutoUpdaterEvents()
  const runtimeAllowed = isRuntimeUpdateAllowed()
  setUpdateState({
    phase: 'disabled',
    autoUpdateEnabled: false,
    feedUrl: '',
    feedConfigured: false,
    message: runtimeAllowed ? '自动更新未启用' : '开发模式已跳过自动更新',
  })
}

export function setAppUpdateInstallCleanup(callback: () => Promise<void> | void): void {
  installCleanup = callback
}

export function isAppUpdateInstallInProgress(): boolean {
  return installingDownloadedUpdate
}

export function getAppUpdateState(): UpdateState {
  return createUpdateState()
}

export function setAppUpdateGamePhase(phase: string | null | undefined): UpdateState {
  const normalizedPhase = String(phase || '')

  if (normalizedPhase === currentGamePhase && updateState.gamePhase === normalizedPhase) {
    return getAppUpdateState()
  }

  const wasBlocking = isGameBlockingUpdate()
  const isBlocking = isGameBlockingUpdate(normalizedPhase)

  currentGamePhase = normalizedPhase

  if (isBlocking) {
    if (updateState.phase === 'downloading') {
      cancelActiveDownloadForGame()
    }

    if (!updateState.available && !updateState.downloaded) {
      return setUpdateState({
        gamePhase: normalizedPhase,
        downloadDeferred: false,
      })
    }

    return setUpdateState({
      gamePhase: normalizedPhase,
      downloadDeferred: updateState.available && !updateState.downloaded,
      message: updateState.downloaded ? getDownloadedUpdateMessage() : getDeferredDownloadMessage(),
    })
  }

  const shouldResumeDownload =
    wasBlocking &&
    updateState.downloadDeferred &&
    shouldDownloadAvailableUpdate()

  if (shouldResumeDownload) {
    setUpdateState({
      gamePhase: normalizedPhase,
      phase: 'available',
      downloadDeferred: false,
      error: '',
      message: '对局结束，继续下载更新',
    })
    scheduleAppUpdateDownload('game-ended')
    return getAppUpdateState()
  }

  return setUpdateState({
    gamePhase: normalizedPhase,
    downloadDeferred: false,
    message: updateState.downloaded ? getDownloadedUpdateMessage() : updateState.message,
  })
}

export async function refreshAppUpdateConfig(options: RefreshOptions = {}): Promise<UpdateActionResult> {
  // The upstream feed distributes Windows installers, not this local Mac port.
  if (process.platform === 'darwin') {
    setUpdateState({
      phase: 'disabled', autoUpdateEnabled: false, feedUrl: '', feedConfigured: false,
      manualDownloadUrl: '', available: false, downloaded: false, error: '',
      message: 'Mac 本地测试版请重新构建更新',
    })
    return { success: true, data: getAppUpdateState() }
  }
  let config: any = null

  try {
    config = await loadDataApiConfig({
      force: options.force === true,
      timeoutMs: options.force ? 10000 : 5000,
    })
  } catch (error) {
    if (!process.env.ARAMGG_UPDATE_FEED_URL) {
      const message = getErrorMessage(error)
      const autoUpdateEnabled = AUTO_UPDATE_ENV_CONFIGURED ? AUTO_UPDATE_ENV_ENABLED : false
      const autoUpdateUnavailable = !autoUpdateEnabled || !isRuntimeUpdateAllowed()
      logger.warn('[update] failed to load update config:', message)
      setUpdateState({
        phase: autoUpdateUnavailable ? 'disabled' : 'no-feed',
        autoUpdateEnabled,
        feedUrl: '',
        feedConfigured: false,
        available: false,
        downloaded: false,
        downloadDeferred: false,
        progress: null,
        error: message,
        message: autoUpdateUnavailable
          ? (isRuntimeUpdateAllowed() ? '自动更新未启用' : '开发模式已跳过自动更新')
          : '未读取到自动更新配置',
      })
      return {
        success: false,
        data: getAppUpdateState(),
        error: message,
      }
    }
  }

  const manualDownloadUrl = getManualDownloadUrl(config)
  const latestVersion = getLatestVersionHint(config)
  const autoUpdateEnabled = getAutoUpdateEnabled(config)

  if (!autoUpdateEnabled) {
    configuredFeedUrl = ''
    setUpdateState({
      phase: 'disabled',
      autoUpdateEnabled: false,
      manualDownloadUrl,
      latestVersion,
      feedUrl: '',
      feedConfigured: false,
      available: false,
      downloaded: false,
      downloadDeferred: false,
      progress: null,
      error: '',
      message: '自动更新未启用',
    })
    return {
      success: true,
      data: getAppUpdateState(),
    }
  }

  if (!isRuntimeUpdateAllowed()) {
    setUpdateState({
      phase: 'disabled',
      autoUpdateEnabled,
      manualDownloadUrl,
      latestVersion,
      feedUrl: '',
      feedConfigured: false,
      available: false,
      downloaded: false,
      downloadDeferred: false,
      progress: null,
      message: isDevRuntime ? '开发模式已跳过自动更新' : '自动更新不可用',
    })
    return {
      success: true,
      data: getAppUpdateState(),
    }
  }

  let feedUrl = ''
  try {
    configureUpdateSignatureVerification()
    feedUrl = normalizeFeedUrl(getUpdateFeedCandidate(config))
  } catch (error) {
    const message = getErrorMessage(error)
    setUpdateState({
      phase: 'error',
      autoUpdateEnabled,
      manualDownloadUrl,
      latestVersion,
      feedUrl: '',
      feedConfigured: false,
      available: false,
      downloaded: false,
      downloadDeferred: false,
      progress: null,
      error: message,
      message: '自动更新源配置无效',
    })
    return {
      success: false,
      data: getAppUpdateState(),
      error: message,
    }
  }

  if (!feedUrl) {
    configuredFeedUrl = ''
    setUpdateState({
      phase: 'no-feed',
      autoUpdateEnabled,
      manualDownloadUrl,
      latestVersion,
      feedUrl: '',
      feedConfigured: false,
      available: false,
      downloaded: false,
      downloadDeferred: false,
      progress: null,
      error: '',
      message: '未配置自动更新源',
    })
    return {
      success: true,
      data: getAppUpdateState(),
    }
  }

  if (feedUrl !== configuredFeedUrl) {
    configuredFeedUrl = feedUrl
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    })
    logger.info('[update] feed configured', {
      feedUrl,
      reason: options.reason || 'refresh',
    })
  }

  const shouldPreserveActivePhase = ['checking', 'available', 'downloading', 'downloaded', 'installing'].includes(
    updateState.phase
  )

  setUpdateState({
    phase: shouldPreserveActivePhase ? updateState.phase : 'idle',
    autoUpdateEnabled,
    manualDownloadUrl,
    latestVersion,
    feedUrl,
    feedConfigured: true,
    error: '',
    message: shouldPreserveActivePhase ? updateState.message : '自动更新待命',
  })

  return {
    success: true,
    data: getAppUpdateState(),
  }
}

export async function checkForAppUpdate(reason = 'manual'): Promise<UpdateActionResult> {
  if (checkForUpdatesPromise) {
    return checkForUpdatesPromise
  }

  checkForUpdatesPromise = (async () => {
    const configResult = await refreshAppUpdateConfig({
      force: reason === 'manual',
      reason,
    })

    if (!configResult.success || !updateState.autoUpdateEnabled || !updateState.feedConfigured || !isRuntimeUpdateAllowed()) {
      return {
        success: configResult.success,
        data: getAppUpdateState(),
        error: configResult.error,
      }
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      applyUpdateInfo(result?.updateInfo)
      setUpdateState({
        lastCheckedAt: new Date().toISOString(),
      })
      return {
        success: true,
        data: getAppUpdateState(),
      }
    } catch (error) {
      const message = getErrorMessage(error)
      logger.warn('[update] check failed:', message)
      setUpdateState({
        phase: 'error',
        progress: null,
        error: message,
        message: '检查更新失败',
      })
      return {
        success: false,
        data: getAppUpdateState(),
        error: message,
      }
    }
  })().finally(() => {
    checkForUpdatesPromise = null
  })

  return checkForUpdatesPromise
}

export async function downloadAppUpdate(reason = 'manual-download'): Promise<UpdateActionResult> {
  if (downloadUpdatePromise) {
    return downloadUpdatePromise
  }

  if (!updateState.autoUpdateEnabled || !updateState.feedConfigured) {
    const configResult = await refreshAppUpdateConfig({ force: true, reason })
    if (!configResult.success) {
      return configResult
    }

    if (!updateState.autoUpdateEnabled) {
      return {
        success: false,
        data: getAppUpdateState(),
        error: '自动更新未启用',
      }
    }

    if (!updateState.feedConfigured) {
      return configResult
    }
  }

  if (!shouldDownloadAvailableUpdate()) {
    return {
      success: false,
      data: getAppUpdateState(),
      error: updateState.downloaded ? '更新已下载完成' : '当前没有可下载的更新',
    }
  }

  if (isGameBlockingUpdate()) {
    deferDownloadUntilGameEnds()
    return {
      success: true,
      data: getAppUpdateState(),
    }
  }

  const cancellationToken = new CancellationToken()
  activeDownloadCancellationToken = cancellationToken

  downloadUpdatePromise = (async () => {
    try {
      logger.info('[update] downloading app update', {
        reason,
        latestVersion: updateState.latestVersion || null,
        feedUrl: configuredFeedUrl,
      })
      setUpdateState({
        phase: 'downloading',
        downloadDeferred: false,
        available: true,
        downloaded: false,
        error: '',
        message: '正在后台下载更新',
      })

      await autoUpdater.downloadUpdate(cancellationToken)

      return {
        success: true,
        data: getAppUpdateState(),
      }
    } catch (error) {
      if (cancellationToken.cancelled && isGameBlockingUpdate()) {
        deferDownloadUntilGameEnds()
        return {
          success: true,
          data: getAppUpdateState(),
        }
      }

      const message = getErrorMessage(error)
      logger.warn('[update] download failed:', message)
      setUpdateState({
        phase: 'error',
        downloadDeferred: false,
        progress: null,
        error: message,
        message: '下载更新失败',
      })
      return {
        success: false,
        data: getAppUpdateState(),
        error: message,
      }
    } finally {
      if (activeDownloadCancellationToken === cancellationToken) {
        activeDownloadCancellationToken = null
      }
      downloadUpdatePromise = null
    }
  })()

  return downloadUpdatePromise
}

export function shouldInstallDownloadedAppUpdateOnQuit(): boolean {
  return updateState.phase === 'downloaded' && updateState.downloaded && !installingDownloadedUpdate
}

export async function installDownloadedAppUpdate(reason = 'manual-install'): Promise<UpdateActionResult> {
  if (!updateState.downloaded) {
    return {
      success: false,
      data: getAppUpdateState(),
      error: '更新尚未下载完成',
    }
  }

  try {
    installingDownloadedUpdate = true
    logger.info('[update] installing downloaded update', {
      reason,
      latestVersion: updateState.latestVersion || null,
    })
    setUpdateState({
      phase: 'installing',
      message: '正在重启安装',
      canCheck: false,
      canInstall: false,
    })

    if (installCleanup) {
      await installCleanup()
    }

    allowMainWindowClose()
    autoUpdater.quitAndInstall(true, true)

    return {
      success: true,
      data: getAppUpdateState(),
    }
  } catch (error) {
    const message = getErrorMessage(error)
    installingDownloadedUpdate = false
    logger.warn('[update] install failed:', message)
    setUpdateState({
      phase: 'error',
      error: message,
      message: '重启安装失败',
    })
    return {
      success: false,
      data: getAppUpdateState(),
      error: message,
    }
  }
}
