import { describe, expect, it } from 'vitest'
import { recommendationCandidates, recommendMeasuredNode } from './node-recommendation'
const nodes = [
  { name: 'current', type: 'Shadowsocks' },
  { name: 'favorite', type: 'Vmess' },
  { name: 'fast', type: 'Trojan' },
  { name: 'DIRECT', type: 'Direct' },
  { name: 'auto', type: 'URLTest' }
]
describe('current-group measured node recommendations', () => {
  it('prefers a reachable favorite over a faster unstarred node', () => {
    expect(
      recommendMeasuredNode(nodes, 'current', { favorite: 120, fast: 20, current: 1 }, ['favorite'])
    ).toEqual({ name: 'favorite', delay: 120, favorite: true })
  })
  it('falls back to the lowest positive delay and never picks an unmeasured or failed favorite', () => {
    expect(
      recommendMeasuredNode(nodes, 'current', { favorite: null, fast: 20, outside: 1 }, [
        'favorite'
      ])
    ).toEqual({ name: 'fast', delay: 20, favorite: false })
    expect(
      recommendMeasuredNode(nodes, 'current', { favorite: 0, fast: Number.NaN, outside: 1 }, [])
    ).toBeUndefined()
  })
  it('does not traverse automatic groups, choose DIRECT, or reuse the current node', () => {
    expect(recommendationCandidates(nodes, 'current').map((node) => node.name)).toEqual([
      'favorite',
      'fast'
    ])
    expect(
      recommendMeasuredNode(nodes, 'current', { DIRECT: 1, auto: 1, current: 1 }, [])
    ).toBeUndefined()
  })
})
