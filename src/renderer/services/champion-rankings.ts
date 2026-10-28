import type { ChampionRankingEntry } from '../../shared/ipc-contract.ts'

export type ChampionSortKey = 'tier' | 'winRate' | 'pickRate' | 'numGames'
export type ChampionSortDirection = 'ascending' | 'descending'

const searchText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().trim()

export function filterChampionRankings(rows: ChampionRankingEntry[], keyword: string): ChampionRankingEntry[] {
  const terms = searchText(keyword).split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((row) => {
    const haystack = searchText([row.name, row.alias, row.title].join(' '))
    return terms.every((term) => haystack.includes(term))
  })
}

export function sortChampionRankings(
  rows: ChampionRankingEntry[], key: ChampionSortKey, direction: ChampionSortDirection
): ChampionRankingEntry[] {
  return [...rows].sort((left, right) => {
    const a = left[key]
    const b = right[key]
    if (a === null && b !== null) return 1
    if (a !== null && b === null) return -1
    const compared = a !== null && b !== null ? a - b : 0
    return (direction === 'ascending' ? compared : -compared) || left.championId - right.championId
  })
}
