// Read-only data preflight. Run only with the intended environment's SDK identity.
// Never prints openids, account names, profile data, or credentials. No writes.
async function inspectMemberIdentities(db) {
  const openids = new Set()
  const names = new Set()
  let offset = 0
  const summary = { members: 0, duplicateOpenids: 0, duplicateAccountNames: 0,
    invalidOpenids: 0, invalidAccountNames: 0, nonCanonicalAccountNames: 0 }
  for (;;) {
    const result = await db.collection('members').field({ openid: true, accountName: true })
      .orderBy('_id', 'asc').skip(offset).limit(100).get()
    for (const member of result.data) {
      summary.members++
      if (typeof member.openid !== 'string' || !member.openid.trim()) summary.invalidOpenids++
      else if (openids.has(member.openid)) summary.duplicateOpenids++
      else openids.add(member.openid)
      const name = member.accountName
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{4,19}$/.test(name)) summary.invalidAccountNames++
      else {
        const normalized = name.toLowerCase()
        if (normalized !== name) summary.nonCanonicalAccountNames++
        if (names.has(normalized)) summary.duplicateAccountNames++
        else names.add(normalized)
      }
    }
    offset += result.data.length
    if (result.data.length < 100) break
  }
  return summary
}

module.exports = { inspectMemberIdentities }

if (require.main === module) {
  const cloud = require('../cloudfunctions/api/node_modules/wx-server-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  inspectMemberIdentities(cloud.database()).then(summary => {
    console.log(JSON.stringify(summary, null, 2))
    console.log('此结果只检查数据；仍须在目标环境控制台确认两个唯一索引。')
    if (Object.entries(summary).some(([key, value]) => key !== 'members' && value > 0)) process.exitCode = 1
  }).catch(() => {
    console.error('只读身份预检失败。请检查目标环境的 SDK 身份和读取权限；未执行任何写入。')
    process.exitCode = 1
  })
}
