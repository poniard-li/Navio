import {describe,it,expect} from 'vitest'
import {mergeProfileChanges} from './profile-patch'
describe('local edits across subscription refresh',()=>{
  it('preserves new upstream nodes while applying a changed local field',()=>{
    const base={proxies:[{name:'A',server:'old',port:80}]}
    const local={proxies:[{name:'A',server:'old',port:443}]}
    const incoming={proxies:[{name:'A',server:'new',port:80},{name:'B',server:'other',port:80}]}
    expect(mergeProfileChanges(base,local,incoming)).toEqual({value:{proxies:[{name:'A',server:'new',port:443},{name:'B',server:'other',port:80}]},conflicts:[]})
  })
  it('reports concurrent field edits and keeps local value for review',()=>{
    expect(mergeProfileChanges({port:80},{port:443},{port:8080})).toEqual({value:{port:443},conflicts:['/port']})
  })
  it('keeps local deletions and detects upstream changed deleted entries',()=>{
    const base={proxies:[{name:'A',port:80}]},local={proxies:[]}
    expect(mergeProfileChanges(base,local,base)).toEqual({value:local,conflicts:[]})
    expect(mergeProfileChanges(base,local,{proxies:[{name:'A',port:81}]}).conflicts).toEqual(['/proxies[A]'])
  })
  it('does not silently merge conflicting ordered rules',()=>{
    expect(mergeProfileChanges(['MATCH,DIRECT'],['MATCH,GLOBAL'],['DOMAIN,a.test,DIRECT','MATCH,DIRECT']).conflicts).toEqual(['/'])
  })
})
