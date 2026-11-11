export interface MergeResult {
  value: unknown
  conflicts: string[]
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const named = (v: unknown[]): v is (Record<string, unknown> & { name: string })[] =>
  v.every((x) => object(x) && typeof x.name === 'string') &&
  new Set(v.map((x) => (x as { name: string }).name)).size === v.length

// Apply a user's local delta to a new source. Colliding edits are surfaced to the UI.
export function mergeProfileChanges(
  base: unknown,
  local: unknown,
  incoming: unknown,
  path = ''
): MergeResult {
  if (same(base, local)) return { value: incoming, conflicts: [] }
  if (same(base, incoming) || same(local, incoming)) return { value: local, conflicts: [] }
  const conflicts: string[] = []
  if (object(base) && object(local) && object(incoming)) {
    const value: Record<string, unknown> = Object.create(null)
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(incoming)
    ])) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('配置包含不支持的键')
      const result = mergeProfileChanges(base[key], local[key], incoming[key], `${path}/${key}`)
      if (result.value !== undefined) value[key] = result.value
      conflicts.push(...result.conflicts)
    }
    return { value, conflicts }
  }
  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(incoming) &&
    named(base) &&
    named(local) &&
    named(incoming)
  ) {
    const lookup = (list: (Record<string, unknown> & { name: string })[]) =>
      new Map(list.map((v) => [v.name, v]))
    const b = lookup(base),
      l = lookup(local),
      r = lookup(incoming),
      value: unknown[] = []
    for (const name of new Set([
      ...incoming.map((v) => v.name),
      ...local.map((v) => v.name),
      ...base.map((v) => v.name)
    ])) {
      const result = mergeProfileChanges(b.get(name), l.get(name), r.get(name), `${path}[${name}]`)
      if (result.value !== undefined) value.push(result.value)
      conflicts.push(...result.conflicts)
    }
    return { value, conflicts }
  }
  return { value: local, conflicts: [path || '/'] }
}
