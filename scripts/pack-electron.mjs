import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === 'win32',
      ...options,
    })

    let output = ''

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(chunk)
    })

    child.on('close', (code) => {
      resolve({ code, output })
    })
  })
}

function isWinUnpackedLockFailure(output) {
  return (
    /build[\\/]+win-unpacked/i.test(output) &&
    /(being used by another process|Access is denied|Unable to commit changes|ERR_ELECTRON_BUILDER_CANNOT_EXECUTE)/i.test(output)
  )
}

function createFallbackOutputDir() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')

  return path.join('build', `pack-${timestamp}`)
}

async function main() {
  const buildResult = await run('electron-vite', ['build'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (buildResult.code !== 0) {
    process.exit(buildResult.code ?? 1)
  }

  const packResult = await run('electron-builder', [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (packResult.code === 0) {
    return
  }

  if (!isWinUnpackedLockFailure(packResult.output)) {
    process.exit(packResult.code ?? 1)
  }

  const fallbackOutput = createFallbackOutputDir()
  console.warn(
    `\nDefault build output is locked. Retrying electron-builder with output: ${fallbackOutput}\n`
  )

  const fallbackResult = await run(
    'electron-builder',
    [`--config.directories.output=${fallbackOutput}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  process.exit(fallbackResult.code ?? 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
