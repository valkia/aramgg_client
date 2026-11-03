import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const electron = process.env.ARAMGG_ELECTRON_BINARY || (await import('electron')).default
await mkdir(path.join(root, '.runtime'), { recursive: true })
const output = await mkdtemp(path.join(root, '.runtime/champion-rankings-smoke-'))
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aramgg-champion-rankings-window-'))
await build({ entryPoints: [path.join(root, 'tests/electron/champion-rankings-window-harness.ts')], outfile: path.join(output, 'main.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' })
const child = spawn(electron, [path.join(output, 'main.mjs')], {
  cwd: root, env: { ...process.env, ARAMGG_RANKINGS_SMOKE_ROOT: root, ARAMGG_RANKINGS_SMOKE_OUTPUT: output, ARAMGG_RANKINGS_SMOKE_DATA: dataDir, ARAMGG_ANALYTICS_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { logs += chunk.toString() })
const timer = setTimeout(() => child.kill('SIGKILL'), 45000)
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
clearTimeout(timer)
await writeFile(path.join(output, 'electron.log'), logs)
let report
try { report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) } catch { report = { passed: false, failures: ['No report written'], exitCode: code } }
console.log(JSON.stringify({ ...report, output, dataDir }, null, 2))
if (code !== 0 || !report.passed) process.exitCode = 1
