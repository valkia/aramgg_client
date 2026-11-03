type NamedSource = { name: string }

export function findGameWindowSource<T extends NamedSource>(
  sources: T[],
  platform: NodeJS.Platform = process.platform,
): T | null {
  return platform === 'darwin' ? findDarwinGameWindowSource(sources) : findDefaultGameWindowSource(sources)
}

// Windows 等平台保持原有打分：游戏窗口 "League of Legends (TM) Client" 稳定高于启动器 "League of Legends"。
export function findDefaultGameWindowSource<T extends NamedSource>(sources: T[]): T | null {
  const candidates = sources.map(source => {
    const name = source.name.toLowerCase()
    const isOwnWindow =
      name.includes('aramgg_client') ||
      name.includes('lol_tips_client') ||
      name.includes('champr')

    if (isOwnWindow) {
      return { source, score: 0 }
    }

    if (name.includes('league of legends') && name.includes('client')) {
      return { source, score: 100 }
    }

    if (name.includes('league of legends') || name.includes('英雄联盟')) {
      return { source, score: 80 }
    }

    if (name.includes('league') && name.includes('client')) {
      return { source, score: 60 }
    }

    return { source, score: 0 }
  })

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.score > 0 ? candidates[0].source : null
}

export function findDarwinGameWindowSource<T extends NamedSource>(sources: T[]): T | null {
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
