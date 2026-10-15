// Real page methods and API modules; minimal wx adapter, not a WeChat renderer.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runtime, deferred, tick } = require('./ui-helpers.cjs')

const balances = overrides => ({ entries: [], total: 0, page: 1, pageSize: 20,
  points: 10, growth: 50, honor: 20, level: 'silver', levelName: '白银', ...overrides })
const session = { member: { id:'m', points:10, growth:10, honor:0,
  level:'bronze', levelName:'青铜', nickname:'正在编辑的昵称', signature:'保留资料' },
  isAdmin:false, isSuperAdmin:false, needSetup:false }

test('login coalesces in-flight calls and permits later refresh', async () => {
  const first = deferred()
  let requests = 0
  const r = runtime({}, { cloud:{callFunction: () => {
    requests++
    return requests === 1 ? first.promise : Promise.resolve({result:{ok:true,data:session}})
  }} })
  const { api } = r.load('miniprogram/utils/api.ts', true)
  const a = api.login(), b = api.login()
  assert.equal(a, b)
  assert.equal(requests, 1)
  first.resolve({result:{ok:true,data:session}})
  await Promise.all([a,b])
  await api.login()
  assert.equal(requests, 2)
})

test('login failure clears pending request and API preserves business error codes', async () => {
  let requests = 0
  const r = runtime({}, {cloud:{callFunction: async () => {
    if (++requests === 1) return {result:{ok:false,error:'额度已满',code:'CONSUMPTION_LIMIT_REACHED'}}
    return {result:{ok:true,data:session}}
  }}})
  const { api } = r.load('miniprogram/utils/api.ts', true)
  await assert.rejects(api.login(), e => e.code === 'CONSUMPTION_LIMIT_REACHED')
  await api.login()
  assert.equal(requests, 2)
})

test('unchanged points still refresh growth, honor and level without replacing profile', async () => {
  const r = runtime({listPointEntries:async()=>balances()})
  r.storage.set('member_session_v1', structuredClone(session))
  const p = r.loadPage('miniprogram/pages/points/points.ts')
  await p.load(true)
  const stored = r.storage.get('member_session_v1').member
  assert.equal(stored.growth, 50)
  assert.equal(stored.honor, 20)
  assert.equal(stored.level, 'silver')
  assert.equal(stored.nickname, session.member.nickname)
  assert.equal(stored.signature, session.member.signature)
})

test('returning to honor tab refreshes history even when cached entries exist', async () => {
  let requests = 0
  const r = runtime({listHonorEntries:async()=>{requests++;return balances()}})
  const p = r.loadPage('miniprogram/pages/points/points.ts')
  p.data.tab = 'honor'
  p.data.honorItems = [{id:'old'}]
  p.onShow()
  await tick()
  assert.equal(requests, 1)
  assert.equal(p.data.honorItems.length, 0)
})

test('older balance response cannot overwrite newer tab balances', async () => {
  const old = deferred()
  const r = runtime({listPointEntries:()=>old.promise,listHonorEntries:async()=>balances({honor:99})})
  r.storage.set('member_session_v1', structuredClone(session))
  const p = r.loadPage('miniprogram/pages/points/points.ts')
  const oldLoad = p.load(true)
  await p.loadHonor(true)
  old.resolve(balances({honor:1}))
  await oldLoad
  assert.equal(p.data.honor, 99)
  assert.equal(r.storage.get('member_session_v1').member.honor, 99)
})

test('quota error opens reason input without losing consumption form', async () => {
  const r = runtime({createConsumption:async()=>{throw {code:'CONSUMPTION_LIMIT_REACHED'}},
    memberUsage:async()=>({member:{id:'m'},usage:{used:4,max:4,period:'week'}})})
  const p = r.loadPage('miniprogram/pages/admin/scan/scan.ts')
  Object.assign(p.data,{member:{id:'m'},usage:{used:3,max:4,period:'week'},selectedTierId:'tier_4h',
    amount:'88',note:'需要保留的备注',codeToken:'token'})
  await p.onSubmit()
  assert.equal(p.data.showSpecialReason, true)
  assert.equal(p.data.usage.used, 4)
  assert.equal(p.data.selectedTierId, 'tier_4h')
  assert.equal(p.data.amount, '88')
  assert.equal(p.data.note, '需要保留的备注')
  assert.equal(p.data.codeToken, 'token')
})

test('member-code errors are not misclassified as a quota failure', async () => {
  const r = runtime({createConsumption:async()=>{throw {message:'会员码已过期'}}})
  const p = r.loadPage('miniprogram/pages/admin/scan/scan.ts')
  Object.assign(p.data,{member:{id:'m'},usage:{used:0,max:4},selectedTierId:'tier_4h'})
  await p.onSubmit()
  assert.equal(p.data.showSpecialReason, false)
  assert.match(r.calls.at(-1)[1].title,/已过期/)
})

test('processed reviews use server filtering and paginate with server total', async () => {
  const requests=[]
  const r = runtime({listReviewSubmissions:async(status,options)=>{
    requests.push([status,options.page])
    return {items:[{_id:`r${options.page}`,status:'approved',monthUsage:{used:1,max:1,points:3,period:'month'}}],
      page:options.page,pageSize:20,total:21}
  }})
  const p = r.loadPage('miniprogram/pages/admin/review/review.ts')
  p.data.tab='processed'
  await p.load(true)
  assert.equal(p.data.total,21)
  assert.equal(p.data.hasMore,true)
  await p.load(false)
  assert.deepEqual(requests,[['processed',1],['processed',2]])
  assert.equal(p.data.items.length,2)
  assert.equal(p.data.hasMore,false)
})

test('home pending badge shows total rather than current page length', async () => {
  const r = runtime({listReviewSubmissions:async()=>({items:[],total:73,page:1,pageSize:20})})
  r.storage.set('member_session_v1',{...session,isAdmin:true})
  const p = r.loadPage('miniprogram/pages/admin/home/home.ts')
  await p.bootstrap()
  assert.equal(p.data.pendingCount,73)
})

test('concurrent review quota failure opens special approval input', async () => {
  const r=runtime({reviewAction:async()=>{throw {code:'REVIEW_LIMIT_REACHED'}}})
  const p=r.loadPage('miniprogram/pages/admin/review/review.ts')
  await p.doApprove('r1','')
  assert.equal(p.data.panel.id,'r1')
  assert.equal(p.data.panel.special,true)
  assert.equal(p.data.submitting,false)
})

test('draft registration shows an unavailable placeholder and cannot navigate', async () => {
  const r=runtime({listEvents:async()=>({items:[]}),listMyEventRegistrations:async()=>({items:[{
    registrationId:'r',eventId:'e',status:'draft',title:'草稿内部标题',cover:'private-cover',registrationCount:1,
  }]})})
  const p=r.loadPage('miniprogram/pages/events/events.ts')
  await p.load()
  const row=p.data.myItems[0]
  assert.equal(row.title,'赛事暂不可用')
  assert.equal(row.cover,'')
  p.onTapItem({currentTarget:{dataset:{id:row.eventId,unavailable:row.unavailable}}})
  assert.equal(r.calls.filter(([kind])=>kind==='navigate').length,0)
})

test('switching review tab ignores an older pending response', async () => {
  const old=deferred()
  const r=runtime({listReviewSubmissions:status=>status==='pending'?old.promise:Promise.resolve({
    items:[{_id:'done',status:'approved',monthUsage:{used:1,max:1,points:3}}],total:1,page:1,pageSize:20,
  })})
  const p=r.loadPage('miniprogram/pages/admin/review/review.ts')
  const loading=p.load(true)
  p.switchTab({currentTarget:{dataset:{tab:'processed'}}})
  await tick()
  old.resolve({items:[{_id:'old',status:'pending',monthUsage:{used:0,max:1,points:3}}],total:100,page:1,pageSize:20})
  await loading
  assert.equal(p.data.items[0]._id,'done')
  assert.equal(p.data.total,1)
})

for (const fields of [
  {deadlineDate:'2026-11-01'}, {deadlineTime:'12:00'},
  {registerStartDate:'2026-11-01'}, {registerStartTime:'12:00'},
  {registerStartDate:'2026-11-02',registerStartTime:'12:00',deadlineDate:'2026-11-01',deadlineTime:'12:00'},
]) test(`incomplete/reversed event dates never reach save: ${JSON.stringify(fields)}`, async () => {
  let saves=0
  const r=runtime({saveEvent:async()=>{saves++}})
  const p=r.loadPage('miniprogram/pages/admin/event-edit/event-edit.ts')
  Object.assign(p.data,{title:'赛事',images:['cloud://existing'],contentMarkdown:'说明',...fields})
  await p.onSave()
  assert.equal(saves,0)
  assert(r.calls.some(([kind])=>kind==='toast'))
})

test('complete event date pairs retain explicit China timezone', async () => {
  let saved
  const r=runtime({saveEvent:async value=>{saved=value}})
  const p=r.loadPage('miniprogram/pages/admin/event-edit/event-edit.ts')
  Object.assign(p.data,{title:'赛事',images:['cloud://existing'],contentMarkdown:'说明',
    registerStartDate:'2026-11-01',registerStartTime:'10:00',deadlineDate:'2026-11-02',deadlineTime:'18:00'})
  await p.onSave()
  assert.equal(saved.registerStart,'2026-11-01T10:00:00+08:00')
  assert.equal(saved.registerDeadline,'2026-11-02T18:00:00+08:00')
})

test('all super pages are registered and each has all four WeChat source files', () => {
  const root=path.resolve(__dirname,'..')
  const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'))
  for (const route of ['pages/admin/super/super','pages/admin/super-admins/super-admins','pages/admin/super-config/super-config']) {
    assert(app.pages.includes(route),`unregistered route ${route}`)
    for(const ext of ['ts','wxml','scss','json'])assert(fs.existsSync(path.join(root,'miniprogram',`${route}.${ext}`)))
  }
})

function superFixture() {
  let config={storeInfo:{name:'店铺',contact:'联系'},pointTiers:[{id:'tier',name:'普通',points:2,defaultAmount:58}],
    consumptionLimit:{period:'week',resetDay:1,resetHour:4,maxCount:4},
    memberDayBonus:{enabled:true,label:'会员日',weekdays:[2,4],points:1},
    reviewBonuses:[{platform:'review',name:'评论',points:3,period:'month',maxCount:1}],
    levelThresholds:[{id:'bronze',name:'青铜',minPoints:0}],leaderboard:{topCount:20,aroundCount:5},privacyText:'隐私'}
  let admins=[]
  const r=runtime({getSuperConsole:async()=>({config,admins,superAdmins:[]}),
    saveAdmins:async names=>{admins=names.map(openid=>({openid,member:null}));return {admins:names}},
    saveSuperConfig:async value=>{config=structuredClone(value);return {keys:Object.keys(value)}}})
  r.storage.set('member_session_v1',{...session,isAdmin:true,isSuperAdmin:true})
  return r
}

test('saving administrators in their page preserves the open rules page edits', async () => {
  const r=superFixture()
  const config=r.loadPage('miniprogram/pages/admin/super-config/super-config.ts')
  await config.load()
  config.onStoreNameInput({detail:{value:'尚未保存的店铺名'}})
  const admins=r.loadPage('miniprogram/pages/admin/super-admins/super-admins.ts')
  await admins.load()
  admins.data.candidates=[{openid:'new-admin',nickname:'管理',accountName:'admin',isSuperAdmin:false}]
  admins.pickCandidate({currentTarget:{dataset:{index:0}}})
  await admins.onSaveAdmins()
  assert.equal(config.data.storeName,'尚未保存的店铺名')
  assert.equal(config.data.dirty,true)
  assert.equal(config.originalConfig.storeInfo.name,'店铺')
  assert.equal(admins.data.dirty,false)
})

test('saving rules in their page preserves administrator page edits', async () => {
  const r=superFixture()
  const admins=r.loadPage('miniprogram/pages/admin/super-admins/super-admins.ts')
  await admins.load()
  admins.data.candidates=[{openid:'new-admin',nickname:'管理',accountName:'admin',isSuperAdmin:false}]
  admins.pickCandidate({currentTarget:{dataset:{index:0}}})
  const config=r.loadPage('miniprogram/pages/admin/super-config/super-config.ts')
  await config.load()
  config.onStoreNameInput({detail:{value:'新店铺名'}})
  await config.doSaveConfig(config.buildConfig())
  assert.equal(admins.data.admins[0].openid,'new-admin')
  assert.equal(admins.data.dirty,true)
  assert.equal(admins.originalAdmins.length,0)
  assert.equal(config.data.dirty,false)
})

test('both separate super pages reject ordinary administrators before loading data', async () => {
  for(const route of ['super-admins/super-admins','super-config/super-config']){
    let reads=0
    const r=runtime({getSuperConsole:async()=>{reads++}})
    r.storage.set('member_session_v1',{...session,isAdmin:true,isSuperAdmin:false})
    const p=r.loadPage(`miniprogram/pages/admin/${route}.ts`)
    p.onLoad()
    await tick()
    assert.equal(reads,0)
    assert(r.calls.some(([kind])=>kind==='back'))
  }
})
