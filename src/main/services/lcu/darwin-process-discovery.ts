import path from 'node:path'

export type DarwinLeagueProcess = {
  Name: string
  ProcessId: number
  ExecutablePath: string
  CommandLine: string
}

// ps prints executable paths with spaces without quoting them. Arguments start at --.
export function parseDarwinLeagueProcesses(stdout: string): DarwinLeagueProcess[] {
  const records: DarwinLeagueProcess[] = []
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!match) continue
    const commandLine = match[2]
    const executablePath = commandLine.split(/\s+--/)[0].replace(/^"(.*)"$/, '$1')
    const name = path.posix.basename(executablePath)
    if (!['LeagueClient', 'LeagueClientUx'].includes(name)) continue
    records.push({
      Name: name,
      ProcessId: Number(match[1]),
      ExecutablePath: executablePath,
      CommandLine: commandLine,
    })
  }
  return records
}

export function getDarwinLeagueRoot(executablePath: string): string | null {
  const marker = '/Contents/LoL/'
  const index = executablePath.indexOf(marker)
  return index < 0 ? null : executablePath.slice(0, index + marker.length - 1)
}
