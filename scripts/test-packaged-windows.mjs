import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Copy the unpacked release to isolate install-side data as well as Electron userData.
const source = path.resolve(process.argv[2] || 'build/win-unpacked')
const output = path.resolve(process.argv[3] || 'build/release-smoke')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'aramgg-release-smoke-'))
const destination = path.join(temporary, path.basename(source))
await mkdir(output, { recursive: true })
await rm(path.join(output, 'report.json'), { force: true })
let timedOut = false
let stdout = ''
let stderr = ''
try {
  await cp(source, destination, { recursive: true, verbatimSymlinks: true })
  const executable = process.platform === 'darwin'
    ? path.join(destination, 'Contents/MacOS/aramgg_client')
    : path.join(destination, 'aramgg_client.exe')
  const userData = path.join(temporary, 'user-data')
  await mkdir(userData, { recursive: true })
  const env = { ...process.env, NODE_ENV: 'production', ARAMGG_RELEASE_SMOKE_TEST: '1',
    ARAMGG_RELEASE_SMOKE_OUTPUT: output, ARAMGG_RELEASE_SMOKE_DATA_DIR: userData,
    APPDATA: path.join(temporary, 'app-data') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, ['--release-smoke-test', `--user-data-dir=${userData}`], {
    cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (data) => { stdout += data })
  child.stderr.on('data', (data) => { stderr += data })
  const timer = setTimeout(() => {
    timedOut = true
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    } else {
      child.kill('SIGKILL')
    }
  }, 75000)
  let code
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
  } finally {
    clearTimeout(timer)
  }
  let report
  try {
    report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'))
  } catch (error) {
    throw new Error(`Packaged app produced no valid report: exit=${code}, timeout=${timedOut}. See ${output}/stderr.log`, { cause: error })
  }
  const expectedRoutes = ['#/display', '#/augment-overlay', '#/floating-overlay', '#/augment-side-panel']
  if (timedOut || code !== 0 || !report.passed || !report.packaged ||
      report.platform !== process.platform || report.windows?.length !== 4 ||
      expectedRoutes.some((route) => !report.windows.some((window) => window.route === route))) {
    throw new Error(`Packaged smoke failed: exit=${code}, timeout=${timedOut}\n${JSON.stringify(report, null, 2)}`)
  }
  console.log(`Packaged ${report.platform} ${report.version}: all four windows ready in ${report.durationMs}ms`)
  console.log(`Report and screenshots: ${output}`)
} finally {
  await writeFile(path.join(output, 'stdout.log'), stdout)
  await writeFile(path.join(output, 'stderr.log'), stderr)
  // Copy logs even when startup fails before the in-app report can be written.
  for (const [name, directory] of [
    ['install-data', path.join(temporary, 'aramgg_client-data')],
    ['user-data', path.join(temporary, 'user-data')],
    ['bootstrap', path.join(temporary, 'app-data')],
  ]) {
    try { await cp(directory, path.join(output, `${name}-logs`), { recursive: true }) }
    catch (error) { if (error.code !== 'ENOENT') console.warn(`Could not retain ${name}: ${error.message}`) }
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}
