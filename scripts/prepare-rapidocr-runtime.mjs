import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PYTHON_VERSION = '3.11.9'
const RUNTIME_LAYOUT_VERSION = '2'
const PYTHON_ZIP_NAME = `python-${PYTHON_VERSION}-embed-amd64.zip`
const PYTHON_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ZIP_NAME}`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

const SOURCE_DIR = path.join(ROOT_DIR, 'resources', 'rapidocr')
const RUNTIME_DIR = path.join(ROOT_DIR, '.runtime', 'rapidocr')
const CACHE_DIR = path.join(ROOT_DIR, '.runtime', 'cache')
const PYTHON_DIR = path.join(RUNTIME_DIR, 'python')
const WORKER_DIR = path.join(RUNTIME_DIR, 'worker')
const REQUIREMENTS_PATH = path.join(SOURCE_DIR, 'requirements.txt')
const WORKER_SOURCE_PATH = path.join(SOURCE_DIR, 'rapidocr-worker.py')
const MARKER_PATH = path.join(RUNTIME_DIR, '.prepared.json')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { allowFailure = false, ...spawnOptions } = options
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      windowsHide: true,
      ...spawnOptions,
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve(code)
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function downloadFile(url, targetPath) {
  if (existsSync(targetPath)) {
    return
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        downloadFile(response.headers.location, targetPath).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed (${response.statusCode}): ${url}`))
        return
      }

      const file = createWriteStream(targetPath)
      response.pipe(file)
      file.on('finish', () => {
        file.close(resolve)
      })
      file.on('error', reject)
    })

    request.on('error', reject)
  })
}

async function hashFiles(filePaths) {
  const hash = createHash('sha256')
  hash.update(PYTHON_VERSION)
  hash.update(RUNTIME_LAYOUT_VERSION)

  for (const filePath of filePaths) {
    hash.update(await fs.readFile(filePath))
  }

  return hash.digest('hex')
}

async function readMarker() {
  try {
    return JSON.parse(await fs.readFile(MARKER_PATH, 'utf8'))
  } catch {
    return null
  }
}

async function isRuntimeReady(fingerprint) {
  const marker = await readMarker()
  return (
    marker?.fingerprint === fingerprint &&
    existsSync(path.join(PYTHON_DIR, 'python.exe')) &&
    existsSync(path.join(WORKER_DIR, 'rapidocr-worker.py'))
  )
}

async function extractPython(zipPath) {
  if (existsSync(path.join(PYTHON_DIR, 'python.exe'))) {
    return
  }

  await fs.rm(PYTHON_DIR, { recursive: true, force: true })
  await fs.mkdir(PYTHON_DIR, { recursive: true })
  const escapedZipPath = `'${zipPath.replace(/'/g, "''")}'`
  const escapedPythonDir = `'${PYTHON_DIR.replace(/'/g, "''")}'`
  await run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath ${escapedZipPath} -DestinationPath ${escapedPythonDir} -Force`,
  ])
}

async function enableSitePackages() {
  const entries = await fs.readdir(PYTHON_DIR)
  const pthFile = entries.find(entry => /^python\d+\._pth$/i.test(entry))

  if (!pthFile) {
    throw new Error('Python embeddable _pth file was not found')
  }

  const pthPath = path.join(PYTHON_DIR, pthFile)
  let content = await fs.readFile(pthPath, 'utf8')
  content = content.replace(/^#import site$/m, 'import site')

  if (!content.includes('Lib/site-packages')) {
    content += '\nLib/site-packages\n'
  }

  await fs.writeFile(pthPath, content)
}

async function ensurePip() {
  const pythonExe = path.join(PYTHON_DIR, 'python.exe')
  const pipCheckCode = await run(pythonExe, ['-m', 'pip', '--version'], {
    allowFailure: true,
    stdio: 'ignore',
  })

  if (pipCheckCode === 0) {
    return
  }

  const getPipPath = path.join(CACHE_DIR, 'get-pip.py')
  await downloadFile(GET_PIP_URL, getPipPath)
  await run(pythonExe, [getPipPath])
}

async function installRequirements() {
  const pythonExe = path.join(PYTHON_DIR, 'python.exe')
  await run(pythonExe, [
    '-m',
    'pip',
    'install',
    '--no-cache-dir',
    '-r',
    REQUIREMENTS_PATH,
  ])
}

async function pruneRuntimeBuildTools() {
  const sitePackagesDir = path.join(PYTHON_DIR, 'Lib', 'site-packages')
  const removableEntries = [
    'Scripts',
    path.join('Lib', 'site-packages', '_distutils_hack'),
    path.join('Lib', 'site-packages', 'distutils-precedence.pth'),
  ]

  let sitePackageEntries = []
  try {
    sitePackageEntries = await fs.readdir(sitePackagesDir)
  } catch {
    sitePackageEntries = []
  }

  for (const entry of sitePackageEntries) {
    if (/^(pip|setuptools|wheel)(-|$|\.)/i.test(entry)) {
      removableEntries.push(path.join('Lib', 'site-packages', entry))
    }
  }

  await Promise.all(removableEntries.map(entry =>
    fs.rm(path.join(PYTHON_DIR, entry), { recursive: true, force: true })
  ))
}

async function copyWorker() {
  await fs.mkdir(WORKER_DIR, { recursive: true })
  await fs.copyFile(WORKER_SOURCE_PATH, path.join(WORKER_DIR, 'rapidocr-worker.py'))
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('RapidOCR packaged runtime is currently prepared for Windows only')
  }

  const force = process.argv.includes('--force')
  const fingerprint = await hashFiles([REQUIREMENTS_PATH, WORKER_SOURCE_PATH])

  if (!force && await isRuntimeReady(fingerprint)) {
    console.log('RapidOCR runtime is already prepared.')
    return
  }

  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.mkdir(RUNTIME_DIR, { recursive: true })

  const pythonZipPath = path.join(CACHE_DIR, PYTHON_ZIP_NAME)
  console.log(`Preparing RapidOCR runtime with Python ${PYTHON_VERSION}...`)
  await downloadFile(PYTHON_ZIP_URL, pythonZipPath)
  await fs.rm(PYTHON_DIR, { recursive: true, force: true })
  await fs.rm(WORKER_DIR, { recursive: true, force: true })
  await extractPython(pythonZipPath)
  await enableSitePackages()
  await ensurePip()
  await installRequirements()
  await pruneRuntimeBuildTools()
  await copyWorker()

  await fs.writeFile(MARKER_PATH, JSON.stringify({
    fingerprint,
    pythonVersion: PYTHON_VERSION,
    preparedAt: new Date().toISOString(),
  }, null, 2))

  console.log(`RapidOCR runtime prepared at ${RUNTIME_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
