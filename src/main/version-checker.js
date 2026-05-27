import { app, dialog, shell } from 'electron'
import { loadDataApiConfig } from './data-loader.js'
import logger from './modules/logger.js'

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(String(version || '').trim())
  if (!match) {
    return null
  }

  return match.slice(1).map((part) => Number(part))
}

function compareVersion(currentVersion, latestVersion) {
  const current = parseVersion(currentVersion)
  const latest = parseVersion(latestVersion)

  if (!current || !latest) {
    return {
      severity: 'unknown',
      shouldPrompt: false,
      isNewer: false,
    }
  }

  const isNewer =
    latest[0] > current[0] ||
    (latest[0] === current[0] && latest[1] > current[1]) ||
    (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2])

  if (!isNewer) {
    return {
      severity: 'none',
      shouldPrompt: false,
      isNewer: false,
    }
  }

  if (latest[0] !== current[0]) {
    return {
      severity: 'major',
      shouldPrompt: true,
      isNewer: true,
    }
  }

  if (latest[1] !== current[1]) {
    return {
      severity: 'minor',
      shouldPrompt: true,
      isNewer: true,
    }
  }

  return {
    severity: 'patch',
    shouldPrompt: false,
    isNewer: true,
  }
}

function getSeverityText(severity) {
  if (severity === 'major') {
    return '最好更新'
  }

  if (severity === 'minor') {
    return '建议更新'
  }

  if (severity === 'patch') {
    return '有小版本更新'
  }

  return '已是最新'
}

export async function getVersionInfo() {
  const config = await loadDataApiConfig()
  const currentVersion = app.getVersion()
  const clientConfig = config?.client || config?.electron || {}
  const latestVersion = clientConfig.latestVersion || ''
  const comparison = compareVersion(currentVersion, latestVersion)

  return {
    currentVersion,
    latestVersion,
    downloadUrl: clientConfig.downloadUrl || '',
    minimumVersion: clientConfig.minimumVersion || '',
    dataVersion: config?.dataVersion || '',
    gamePatch: config?.gamePatch || '',
    apiRelease: config?.apiRelease ?? null,
    generatedAt: config?.generatedAt || '',
    publishedAt: config?.publishedAt || '',
    severity: comparison.severity,
    shouldPrompt: comparison.shouldPrompt,
    isNewer: comparison.isNewer,
    statusText: getSeverityText(comparison.severity),
  }
}

function canOpenDownloadUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export async function checkForClientUpdate(parentWindow) {
  let versionInfo

  try {
    versionInfo = await getVersionInfo()
  } catch (error) {
    logger.warn('Failed to check remote client version:', error.message)
    return null
  }

  if (!versionInfo.shouldPrompt) {
    return versionInfo
  }

  const message =
    versionInfo.severity === 'major'
      ? '检测到客户端大版本不一致，最好更新后继续使用。'
      : '检测到客户端功能版本不一致，建议更新。'

  const detail = [
    `当前版本：${versionInfo.currentVersion}`,
    `最新版本：${versionInfo.latestVersion}`,
    `数据版本：${versionInfo.dataVersion || '-'}`,
    `下载地址：${versionInfo.downloadUrl || '-'}`,
  ].join('\n')

  const result = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    title: '客户端更新提示',
    message,
    detail,
    buttons: ['去下载', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (result.response === 0 && canOpenDownloadUrl(versionInfo.downloadUrl)) {
    await shell.openExternal(versionInfo.downloadUrl)
  }

  return versionInfo
}
