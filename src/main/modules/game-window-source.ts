type NamedSource = { name: string }

export function findGameWindowSource<T extends NamedSource>(sources: T[]): T | null {
  const score = (source: T): number => {
    const name = source.name.toLowerCase()
    if (/aramgg|lol_tips_client|champr/.test(name)) return 0
    // Riot's Mac gameplay window includes "Client" in its title.
    if (name === 'league of legends (tm) client') return 100
    // The launcher may also be called League of Legends. Never OCR the client.
    if (/client/.test(name)) return 0
    if (name === 'league of legends' || name === 'leagueoflegends' || name === '英雄联盟') return 100
    return /league of legends|英雄联盟/.test(name) ? 80 : 0
  }
  return sources.reduce<T | null>((best, source) =>
    score(source) > (best ? score(best) : 0) ? source : best, null)
}

export function hasDarwinGameProcess(stdout: string): boolean {
  return stdout.split('\n').some(line =>
    /(?:^|\/)(?:LeagueofLegends|League of Legends)$/.test(line.trim()))
}
