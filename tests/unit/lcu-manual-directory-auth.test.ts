import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLcuAuthFromManualDirectory } from '../../src/main/services/lcu/manual-directory-auth.ts'

const tempDirs: string[] = []

async function createTempLeagueDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aramgg-lcu-manual-'))
  tempDirs.push(tempDir)
  await mkdir(path.join(tempDir, 'LeagueClient'), { recursive: true })
  return tempDir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      rm(tempDir, { recursive: true, force: true })
    )
  )
})

describe('LCU manual directory auth discovery', () => {
  it('extracts auth from a lockfile in the configured League directory', async () => {
    const leagueDir = await createTempLeagueDir()
    await writeFile(
      path.join(leagueDir, 'lockfile'),
      'LeagueClient:1234:58123:manual-lock-token:https'
    )

    const [token, port, url] = await discoverLcuAuthFromManualDirectory(leagueDir)

    expect(token).toBe('manual-lock-token')
    expect(port).toBe('58123')
    expect(url).toBe('https://riot:manual-lock-token@127.0.0.1:58123')
  })

  it('extracts auth from LeagueClientUx logs under the LeagueClient directory', async () => {
    const leagueDir = await createTempLeagueDir()
    await writeFile(
      path.join(leagueDir, 'LeagueClient', '2026-06-11T00-00-00_1000_LeagueClientUx.log'),
      'Creating ux window with url https://riot:manual-log-token@127.0.0.1:58124/bootstrap.html.'
    )

    const [token, port, url] = await discoverLcuAuthFromManualDirectory(leagueDir)

    expect(token).toBe('manual-log-token')
    expect(port).toBe('58124')
    expect(url).toBe('https://riot:manual-log-token@127.0.0.1:58124')
  })

  it('can recover when the saved path points at the LeagueClient subdirectory', async () => {
    const leagueDir = await createTempLeagueDir()
    await writeFile(
      path.join(leagueDir, 'lockfile'),
      'LeagueClient:1234:58125:parent-lock-token:https'
    )

    const [token, port] = await discoverLcuAuthFromManualDirectory(
      path.join(leagueDir, 'LeagueClient')
    )

    expect(token).toBe('parent-lock-token')
    expect(port).toBe('58125')
  })
})
