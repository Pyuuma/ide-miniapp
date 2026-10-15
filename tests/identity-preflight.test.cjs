const {test} = require('node:test')
const assert = require('node:assert/strict')
const {inspectMemberIdentities} = require('../scripts/check-member-identities.cjs')

test('identity preflight scans all pages, reports normalized collisions and never needs writes', async () => {
  const rows=Array.from({length:101},(_,i)=>({openid:`identity-${i}`,accountName:`member${i}`}))
  rows.push({openid:'identity-0',accountName:'MEMBER0'}, {openid:'',accountName:'bad'})
  const offsets=[]
  const db={collection(name){
    assert.equal(name,'members')
    let offset=0,limit=100
    const q={field(){return q},orderBy(){return q},skip(value){offset=value;offsets.push(value);return q},
      limit(value){limit=value;return q},async get(){return {data:rows.slice(offset,offset+limit)}}}
    return q
  }}
  assert.deepEqual(await inspectMemberIdentities(db),{members:103,duplicateOpenids:1,duplicateAccountNames:1,
    invalidOpenids:1,invalidAccountNames:1,nonCanonicalAccountNames:1})
  assert.deepEqual(offsets,[0,100])
})
