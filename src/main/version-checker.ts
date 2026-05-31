// @ts-nocheck
import { app } from 'electron'
import { loadDataApiConfig } from './data-loader.ts'
import logger from './modules/logger.ts'

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

function isVersionLowerThan(currentVersion, targetVersion) {
  const comparison = compareVersion(currentVersion, targetVersion)
  return comparison.isNewer
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
  const minimumVersion = clientConfig.minimumVersion || ''
  const comparison = compareVersion(currentVersion, latestVersion)
  const isBelowMinimumVersion = minimumVersion
    ? isVersionLowerThan(currentVersion, minimumVersion)
    : false
  const shouldPrompt = comparison.shouldPrompt || isBelowMinimumVersion

  return {
    currentVersion,
    latestVersion,
    downloadUrl: clientConfig.downloadUrl || '',
    minimumVersion,
    dataVersion: config?.dataVersion || '',
    gamePatch: config?.gamePatch || '',
    apiRelease: config?.apiRelease ?? null,
    generatedAt: config?.generatedAt || '',
    publishedAt: config?.publishedAt || '',
    severity: comparison.severity,
    shouldPrompt,
    isNewer: comparison.isNewer,
    isBelowMinimumVersion,
    statusText: getSeverityText(comparison.severity),
  }
}

export async function checkForClientUpdate() {
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

  logger.info('[update] client update available', {
    currentVersion: versionInfo.currentVersion,
    latestVersion: versionInfo.latestVersion,
    minimumVersion: versionInfo.minimumVersion || null,
    severity: versionInfo.severity,
    isBelowMinimumVersion: versionInfo.isBelowMinimumVersion,
    hasDownloadUrl: !!versionInfo.downloadUrl,
  })

  return versionInfo
}
