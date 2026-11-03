import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

if (process.platform !== 'darwin') process.exit(0)
const root = path.resolve(import.meta.dirname, '..')
const cache = path.join(os.homedir(), 'Library', 'Caches', 'node-gyp')
const candidates = [
  process.env.npm_config_nodedir && path.join(process.env.npm_config_nodedir, 'include', 'node'),
  path.resolve(process.execPath, '..', '..', 'include', 'node'),
  path.join(cache, process.versions.node, 'include', 'node'),
  ...(existsSync(cache) ? readdirSync(cache).map(version => path.join(cache, version, 'include', 'node')) : []),
].filter(Boolean)
let headers = candidates.find(candidate => existsSync(path.join(candidate, 'node_api.h')))
if (!headers) {
  const require = createRequire(import.meta.url)
  const installed = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'install', '--ensure'], { stdio: 'inherit' })
  if (installed.status !== 0) process.exit(installed.status || 1)
  headers = path.join(cache, process.versions.node, 'include', 'node')
}
const outputDir = path.join(root, '.runtime', 'mac-capture')
mkdirSync(outputDir, { recursive: true })
const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).stdout.trim()
const built = spawnSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks',
  '-isysroot', sdk, '-isystem', path.join(sdk, 'usr', 'include', 'c++', 'v1'),
  '-mmacosx-version-min=14.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64',
  '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-I', headers,
  '-framework', 'CoreGraphics', '-framework', 'AppKit', '-framework', 'ScreenCaptureKit', '-framework', 'ImageIO',
  path.join(root, 'native', 'macos', 'game-capture.mm'),
  '-o', path.join(outputDir, 'aramgg_capture.node')], { stdio: 'inherit' })
if (built.status !== 0) process.exit(built.status || 1)
console.log('[mac-capture] built ScreenCaptureKit game-window backend')
