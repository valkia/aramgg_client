import { app, type BrowserWindow, type Rectangle } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import logger from './logger.ts'

type NativeCapture = {
  success: boolean
  error?: string
  buffer?: Buffer
  width: number
  height: number
  windowId: number
  windowName: string
  windowLayer: number
  onScreen: boolean
  bounds: Rectangle
}
export type MacTabState = { authorized: boolean; listening: boolean; gameFrontmost: boolean; held: boolean }
type MacCaptureBinding = {
  tabState(enabled: boolean): MacTabState
  requestTabAccess(): boolean
  captureGame(width: number, height: number, timeoutMs: number): Promise<NativeCapture>
  inspectOverlay(handle: Buffer): Record<string, number | boolean>
}
const require = createRequire(import.meta.url)
let binding: MacCaptureBinding | null | undefined
let lastWindow: NativeCapture | null = null
let lastWindowAt = 0
let lastSourceKey = ''
let probeInFlight: Promise<NativeCapture | null> | null = null

function getBinding(): MacCaptureBinding | null {
  if (process.platform !== 'darwin') return null
  if (binding !== undefined) return binding
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'mac-capture', 'aramgg_capture.node')
    : path.join(app.getAppPath(), '.runtime', 'mac-capture', 'aramgg_capture.node')
  binding = null
  try {
    if (existsSync(file)) binding = require(file) as MacCaptureBinding
    else logger.warn('[mac-capture] native backend missing; game-window-only fallback enabled')
  } catch (error) {
    logger.warn('[mac-capture] native backend unavailable:', error instanceof Error ? error.message : String(error))
  }
  return binding
}

function rememberWindow(result: NativeCapture): NativeCapture {
  lastWindow = result.success ? { ...result, buffer: undefined } : null
  lastWindowAt = Date.now()
  const sourceKey = result.success
    ? `${result.windowId}:${result.windowLayer}:${result.onScreen}:${JSON.stringify(result.bounds)}`
    : result.error || 'unknown'
  if (sourceKey !== lastSourceKey) {
    lastSourceKey = sourceKey
    logger.info('[mac-capture] game window state', result.success ? {
      backend: 'ScreenCaptureKit', windowId: result.windowId, title: result.windowName,
      layer: result.windowLayer, onScreen: result.onScreen, bounds: result.bounds,
    } : { backend: 'ScreenCaptureKit', error: result.error })
  }
  return result
}

export async function captureMacGameWindow(width: number, height: number, timeoutMs: number) {
  const native = getBinding()
  if (!native) return null
  return rememberWindow(await native.captureGame(width, height, Math.max(100, Math.min(timeoutMs || 2500, 10000))))
}

export async function getMacGameWindowInfo(): Promise<NativeCapture | null> {
  if (!getBinding()) return null
  if (lastWindow && Date.now() - lastWindowAt < 1000) return lastWindow
  if (!probeInFlight) {
    probeInFlight = captureMacGameWindow(0, 0, 2000).finally(() => { probeInFlight = null })
  }
  return probeInFlight
}

export function getMacCaptureDiagnostics(window?: BrowserWindow) {
  let overlay: Record<string, number | boolean> | null = null
  try {
    if (window && !window.isDestroyed()) overlay = getBinding()?.inspectOverlay(window.getNativeWindowHandle()) || null
  } catch (error) {
    logger.debug('[mac-capture] overlay inspection unavailable:', error instanceof Error ? error.message : String(error))
  }
  return { game: lastWindow ? { id: lastWindow.windowId, layer: lastWindow.windowLayer, onScreen: lastWindow.onScreen } : null, overlay }
}

export function getMacTabState(enabled: boolean): MacTabState | null {
  return getBinding()?.tabState(enabled) || null
}

export function requestMacTabAccess(): boolean {
  return getBinding()?.requestTabAccess() || false
}
