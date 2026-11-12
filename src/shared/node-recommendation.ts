interface Candidate {
  name: string
  type: string
}
const excludedTypes = new Set([
  'direct',
  'reject',
  'rejectdrop',
  'pass',
  'selector',
  'urltest',
  'fallback',
  'loadbalance',
  'smart',
  'relay'
])

export function recommendationCandidates<T extends Candidate>(nodes: T[], current: string): T[] {
  return nodes.filter(
    (node) =>
      node.name !== current && !excludedTypes.has(node.type.toLowerCase().replace(/[-_]/g, ''))
  )
}

export function recommendMeasuredNode(
  nodes: Candidate[],
  current: string,
  measurements: Record<string, number | null>,
  favorites: string[]
): { name: string; delay: number; favorite: boolean } | undefined {
  return recommendationCandidates(nodes, current)
    .filter(
      (node) => Number.isFinite(measurements[node.name]) && Number(measurements[node.name]) > 0
    )
    .map((node) => ({
      name: node.name,
      delay: measurements[node.name] as number,
      favorite: favorites.includes(node.name)
    }))
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || a.delay - b.delay || a.name.localeCompare(b.name)
    )[0]
}
