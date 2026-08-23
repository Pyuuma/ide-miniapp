const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const CODE_TTL_MS = 60 * 1000
const ACCOUNT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{4,19}$/
const REQUIRED_COLLECTIONS = [
  'members',
  'configs',
  'consumption_records',
  'review_submissions',
  'point_entries',
  'audit_logs',
  'member_codes',
]

const DEFAULT_CONFIG = {
  storeInfo: {
    name: 'ide·我有更好的想法',
    contact: 'ide·我有更好的想法',
  },
  pointTiers: [
    { id: 'tier_4h', name: '4小时', points: 3, defaultAmount: 58 },
    { id: 'tier_day', name: '全天', points: 4, defaultAmount: 88 },
  ],
  consumptionLimit: {
    period: 'week',
    resetDay: 1,
    resetHour: 4,
    maxCount: 4,
  },
  reviewBonuses: [
    { platform: 'xiaohongshu', points: 3, period: 'month', maxCount: 1 },
    { platform: 'dianping', points: 3, period: 'month', maxCount: 1 },
  ],
  levelThresholds: [
    { id: 'bronze', name: '青铜', minPoints: 0 },
    { id: 'silver', name: '白银', minPoints: 100 },
    { id: 'gold', name: '黄金', minPoints: 300 },
    { id: 'black', name: '黑金', minPoints: 800 },
  ],
  leaderboard: {
    topCount: 20,
    aroundCount: 5,
  },
  admins: [],
  privacyText:
    '欢迎使用 {{storeName}} 会员小程序（下称“本小程序”）。\n\n' +
    '本小程序由 {{storeName}} 运营，用于会员登录、积分与等级管理、消费记录、评论加分审核等业务。\n\n' +
    '我们会收集并存储您的微信身份标识、昵称、头像、签名、积分及消费记录，仅用于本店会员服务，不会向第三方出售您的个人信息。\n\n' +
    '如对本小程序的数据处理有疑问，请联系：{{contact}}。',
}

// ---------------- 基础工具 ----------------

function ok(data) {
  return { ok: true, data }
}

function fail(error, code) {
  return { ok: false, error, code }
}

function now() {
  return new Date()
}

function sanitize(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function calcLevel(points, config) {
  const thresholds = (config.levelThresholds || [])
    .slice()
    .sort((a, b) => (a.minPoints || 0) - (b.minPoints || 0))
  let level = thresholds[0] || { id: 'bronze', name: '青铜', minPoints: 0 }
  for (const t of thresholds) {
    if (points >= (t.minPoints || 0)) level = t
  }
  return level
}

// 周期起点：period=week 时按规则里的 resetDay（周一=1）+ resetHour（04:00）计算
function periodStart(rule, at = new Date()) {
  const offsetMs = 8 * 60 * 60 * 1000
  const local = new Date(at.getTime() + offsetMs)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const date = local.getUTCDate()
  const weekday = local.getUTCDay()
  const hour = rule.resetHour != null ? rule.resetHour : 0
  let startLocal
  if (rule.period === 'week') {
    const daysSinceMonday = (weekday + 6) % 7
    startLocal = Date.UTC(year, month, date - daysSinceMonday, hour, 0, 0)
  } else {
    startLocal = Date.UTC(year, month, 1, hour, 0, 0)
  }
  return new Date(startLocal - offsetMs)
}

// 后端替换占位符后下发，前端不做展示替换
function resolveDisplay(config) {
  const copy = JSON.parse(JSON.stringify(config))
  const { name, contact } = copy.storeInfo || {}
  const walk = obj => {
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      if (typeof value === 'string') {
        obj[key] = value
          .replace(/\{\{storeName\}\}/g, name || '')
          .replace(/\{\{contact\}\}/g, contact || '')
      } else if (value && typeof value === 'object') {
        walk(value)
      }
    }
    return obj
  }
  return walk(copy)
}

function mergeConfig(stored) {
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    storeInfo: { ...DEFAULT_CONFIG.storeInfo, ...(stored.storeInfo || {}) },
    consumptionLimit: {
      ...DEFAULT_CONFIG.consumptionLimit,
      ...(stored.consumptionLimit || {}),
    },
    leaderboard: {
      ...DEFAULT_CONFIG.leaderboard,
      ...(stored.leaderboard || {}),
    },
  }
}

async function loadConfig() {
  try {
    const res = await db.collection('configs').doc('default').get()
    return mergeConfig(res.data)
  } catch (e) {
    await db.collection('configs').doc('default').set({ data: DEFAULT_CONFIG })
    return DEFAULT_CONFIG
  }
}

async function ensureCollections() {
  for (const name of REQUIRED_COLLECTIONS) {
    try {
      await db.createCollection(name)
    } catch (e) {
      // 集合已存在时忽略；若确实创建失败，后续请求会再次暴露真实错误
    }
  }
}

async function requireAdmin(openid) {
  const config = await loadConfig()
  if (!(config.admins || []).includes(openid)) {
    throw new Error('需要管理员权限')
  }
  return config
}

async function getMemberByOpenid(openid) {
  const res = await db.collection('members').where({ openid }).limit(1).get()
  return res.data[0] || null
}

async function getMemberById(id) {
  try {
    const res = await db.collection('members').doc(id).get()
    return res.data
  } catch (e) {
    return null
  }
}

function toPublicMember(m) {
  if (!m) return null
  return {
    id: m._id,
    accountName: m.accountName,
    accountNameChanged: !!m.accountNameChanged,
    nickname: m.nickname,
    avatar: m.avatar || '',
    signature: m.signature || '',
    points: m.points || 0,
    growth: m.growth || 0,
    leaderboardAnon: !!m.leaderboardAnon,
    level: m.level || 'bronze',
    levelName: m.levelName || '青铜',
    createdAt: m.createdAt,
  }
}

async function genUniqueAccountName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 5; i++) {
    let s = 'u'
    for (let j = 0; j < 8; j++) {
      s += chars[crypto.randomInt(chars.length)]
    }
    const exists = await db.collection('members').where({ accountName: s }).count()
    if (!exists.total) return s
  }
  throw new Error('账号名生成失败，请重试')
}

async function consumptionUsage(memberId, config) {
  const rule = config.consumptionLimit || {}
  const start = periodStart(rule)
  const res = await db
    .collection('consumption_records')
    .where({ memberId, createdAt: _.gte(start) })
    .count()
  return {
    used: res.total,
    max: rule.maxCount || 0,
    period: rule.period || 'week',
  }
}

async function reviewMonthUsage(memberId, platform, config) {
  const rule = (config.reviewBonuses || []).find(r => r.platform === platform)
  if (!rule) return { used: 0, max: 0, points: 0 }
  const start = periodStart({ period: rule.period || 'month', resetHour: 0 })
  const res = await db
    .collection('review_submissions')
    .where({ memberId, platform, status: 'approved', createdAt: _.gte(start) })
    .count()
  return {
    used: res.total,
    max: rule.maxCount || 0,
    points: rule.points || 0,
  }
}

// 事务内：更新会员成长值/积分/等级 + 写积分明细 + 写审计记录
async function applyPoints(t, o) {
  const ts = now()
  const memRes = await t.collection('members').doc(o.memberId).get()
  const member = memRes.data || {}
  const growthDelta = o.growthDelta || 0
  const pointsDelta = o.pointsDelta || 0
  const growthAfter = (member.growth || 0) + growthDelta
  const pointsAfter = (member.points || 0) + pointsDelta
  const level = calcLevel(growthAfter, o.config)
  await t
    .collection('members')
    .doc(o.memberId)
    .update({
      data: {
        growth: growthAfter,
        points: pointsAfter,
        level: level.id,
        levelName: level.name,
        updatedAt: ts,
      },
    })
  const peRes = await t.collection('point_entries').add({
    data: {
      memberId: o.memberId,
      growthDelta,
      growthAfter,
      pointsDelta,
      pointsAfter,
      delta: pointsDelta,
      balanceAfter: pointsAfter,
      sourceType: o.sourceType,
      sourceId: o.sourceId,
      subtype: o.subtype || 'normal',
      note: o.note || '',
      detail: o.detail || '',
      createdAt: ts,
    },
  })
  const changes = []
  if (pointsDelta !== 0) changes.push(pointsDelta > 0 ? 'points_increase' : 'points_decrease')
  if (growthDelta !== 0) changes.push('growth_increase')
  await t.collection('audit_logs').add({
    data: {
      actorId: o.actorId,
      actorNickname: o.actorNickname || '',
      actionType: o.actionType,
      targetType: o.targetType,
      targetId: o.targetId,
      targetMemberId: o.memberId,
      targetMemberNickname: o.targetMemberNickname || member.nickname || '',
      changeType: changes.join('+') || 'none',
      delta: pointsDelta,
      growthDelta,
      reason: o.reason || '',
      specialFlag: !!o.specialFlag,
      metadata: {
        sourceType: o.sourceType,
        sourceId: o.sourceId,
        subtype: o.subtype || 'normal',
      },
      createdAt: ts,
    },
  })
  return { pointEntryId: peRes._id, pointsAfter, growthAfter, level }
}

// ---------------- 动作实现 ----------------

async function actionLogin(openid) {
  const config = await loadConfig()
  let member = await getMemberByOpenid(openid)
  if (!member) {
    const accountName = await genUniqueAccountName()
    const ts = now()
    const res = await db.collection('members').add({
      data: {
        openid,
        accountName,
        accountNameChanged: false,
        nickname: accountName,
        avatar: '',
        signature: '',
        points: 0,
        growth: 0,
        leaderboardAnon: false,
        level: 'bronze',
        levelName: '青铜',
        roles: [],
        createdAt: ts,
        updatedAt: ts,
      },
    })
    member = await getMemberById(res._id)
  }
  // 旧数据迁移：成长值默认等于已有积分；排行榜默认实名
  const migrated = {}
  if (member.growth === undefined || member.growth === null) {
    member.growth = member.points || 0
    migrated.growth = member.growth
  }
  if (member.leaderboardAnon === undefined) {
    member.leaderboardAnon = false
    migrated.leaderboardAnon = false
  }
  const level = calcLevel(member.growth, config)
  if (member.level !== level.id || member.levelName !== level.name) {
    member.level = level.id
    member.levelName = level.name
    migrated.level = level.id
    migrated.levelName = level.name
  }
  if (Object.keys(migrated).length) {
    await db.collection('members').doc(member._id).update({
      data: { ...migrated, updatedAt: now() },
    })
  }
  return ok({
    member: toPublicMember(member),
    isAdmin: (config.admins || []).includes(openid),
    needSetup: !member.accountNameChanged,
  })
}

async function actionRenameAccountName(openid, event) {
  const raw = sanitize(event.accountName, 20)
  if (!ACCOUNT_NAME_RE.test(raw)) {
    throw new Error('账号名需以字母开头，可含英文字母、数字、下划线、横线，长度 5–20')
  }
  const accountName = raw.toLowerCase()
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  if (member.accountNameChanged) throw new Error('账号名只能修改一次')
  const dup = await db.collection('members').where({ accountName }).count()
  if (dup.total > 0) throw new Error('该账号名已被占用')
  const ts = now()
  await db
    .collection('members')
    .doc(member._id)
    .update({ data: { accountName, accountNameChanged: true, updatedAt: ts } })
  await db.collection('audit_logs').add({
    data: {
      actorId: openid,
      actorNickname: member.nickname || accountName,
      actionType: 'account_rename',
      targetType: 'member',
      targetId: member._id,
      targetMemberId: member._id,
      targetMemberNickname: member.nickname || accountName,
      changeType: 'none',
      delta: 0,
      reason: '',
      specialFlag: false,
      metadata: { from: member.accountName, to: accountName },
      createdAt: ts,
    },
  })
  const updated = await getMemberById(member._id)
  return ok({ member: toPublicMember(updated) })
}

async function actionUpdateProfile(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const data = {}
  if (event.nickname !== undefined) {
    const nickname = sanitize(event.nickname, 20)
    if (!nickname) throw new Error('昵称不能为空')
    data.nickname = nickname
  }
  if (event.signature !== undefined) {
    data.signature = sanitize(event.signature, 50)
  }
  if (event.avatar !== undefined) {
    const avatar = String(event.avatar || '')
    if (avatar && !avatar.startsWith('cloud://')) throw new Error('头像地址无效')
    data.avatar = avatar
  }
  if (!Object.keys(data).length) throw new Error('没有需要更新的内容')
  data.updatedAt = now()
  await db.collection('members').doc(member._id).update({ data })
  const updated = await getMemberById(member._id)
  return ok({ member: toPublicMember(updated) })
}

async function actionGetConfig() {
  const config = await loadConfig()
  return ok(resolveDisplay(config))
}

async function actionIssueMemberCode(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const ts = now()
  await db
    .collection('member_codes')
    .where({ memberId: member._id, expiresAt: _.lt(ts) })
    .remove()
    .catch(() => {})
  const token = crypto.randomBytes(18).toString('hex')
  const expiresAt = new Date(ts.getTime() + CODE_TTL_MS)
  await db.collection('member_codes').add({
    data: { token, memberId: member._id, expiresAt, createdAt: ts },
  })
  return ok({ token, expiresAt: expiresAt.getTime() })
}

async function actionVerifyMemberCode(openid, event) {
  await requireAdmin(openid)
  const token = sanitize(event.token, 64)
  const res = await db.collection('member_codes').where({ token }).limit(1).get()
  const code = res.data[0]
  if (!code) throw new Error('会员码无效，请让会员刷新后重试')
  if (code.expiresAt.getTime() < Date.now()) {
    throw new Error('会员码已过期，请让会员刷新后重试')
  }
  const member = await getMemberById(code.memberId)
  if (!member) throw new Error('会员不存在')
  const config = await loadConfig()
  const usage = await consumptionUsage(member._id, config)
  return ok({ member: toPublicMember(member), usage })
}

async function actionMemberUsage(openid, event) {
  await requireAdmin(openid)
  const member = await getMemberById(sanitize(event.memberId, 64))
  if (!member) throw new Error('会员不存在')
  const config = await loadConfig()
  const usage = await consumptionUsage(member._id, config)
  return ok({ member: toPublicMember(member), usage })
}

async function actionFindMembers(openid, event) {
  await requireAdmin(openid)
  const q = sanitize(event.q, 40)
  let res
  if (!q) {
    res = await db.collection('members').orderBy('createdAt', 'desc').limit(20).get()
  } else {
    const rx = db.RegExp({ regexp: escapeRegExp(q), options: 'i' })
    res = await db
      .collection('members')
      .where(_.or([{ accountName: rx }, { nickname: rx }]))
      .limit(20)
      .get()
  }
  return ok({ members: res.data.map(toPublicMember) })
}

async function actionCreateConsumption(openid, event) {
  const config = await requireAdmin(openid)
  let memberId = sanitize(event.memberId, 64)
  if (event.codeToken) {
    const token = sanitize(event.codeToken, 64)
    const res = await db.collection('member_codes').where({ token }).limit(1).get()
    const code = res.data[0]
    if (!code || code.expiresAt.getTime() < Date.now()) {
      throw new Error('会员码无效或已过期，请重新扫码')
    }
    if (memberId && memberId !== code.memberId) throw new Error('会员信息不一致')
    memberId = code.memberId
  }
  if (!memberId) throw new Error('缺少会员信息')
  const member = await getMemberById(memberId)
  if (!member) throw new Error('会员不存在')
  const actor = await getMemberByOpenid(openid)
  const tier = (config.pointTiers || []).find(t => t.id === event.tierId)
  if (!tier) throw new Error('请选择消费档位')
  let amount = tier.defaultAmount
  if (event.amount !== undefined && event.amount !== null && String(event.amount).trim() !== '') {
    amount = Number(event.amount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('金额无效')
  }
  const note = sanitize(event.note, 200)
  const usage = await consumptionUsage(memberId, config)
  const overLimit = usage.used >= usage.max
  let specialReason = ''
  if (overLimit) {
    specialReason = sanitize(event.specialReason, 200)
    if (!specialReason) throw new Error('已超过本周录入上限，必须填写特别录入原因')
  }
  const ts = now()
  let result = null
  await db.runTransaction(async t => {
    const addRes = await t.collection('consumption_records').add({
      data: {
        memberId,
        tierId: tier.id,
        tierName: tier.name,
        points: tier.points,
        amount,
        note,
        operatorId: openid,
        operatorNickname: actor ? actor.nickname : '',
        isSpecial: overLimit,
        specialReason,
        codeToken: String(event.codeToken || ''),
        createdAt: ts,
      },
    })
    const applied = await applyPoints(t, {
      memberId,
      growthDelta: tier.points,
      pointsDelta: tier.points,
      sourceType: 'consumption',
      sourceId: addRes._id,
      subtype: overLimit ? 'special' : 'normal',
      note,
      detail: tier.name + (note ? '，' + note : ''),
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'consumption_entry',
      targetType: 'consumption_record',
      targetId: addRes._id,
      targetMemberNickname: member.nickname,
      reason: specialReason,
      specialFlag: overLimit,
      config,
    })
    result = {
      consumptionId: addRes._id,
      pointsAfter: applied.pointsAfter,
      growthAfter: applied.growthAfter,
      used: usage.used + 1,
      overLimit,
    }
  })
  return ok(result)
}

async function actionSubmitReview(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const platform = sanitize(event.platform, 20)
  if (!['xiaohongshu', 'dianping'].includes(platform)) throw new Error('请选择平台')
  const screenshots = Array.isArray(event.screenshots)
    ? event.screenshots.filter(s => typeof s === 'string' && s.startsWith('cloud://'))
    : []
  if (!screenshots.length) throw new Error('请至少上传一张评论截图')
  if (screenshots.length > 6) throw new Error('截图最多上传 6 张')
  const text = sanitize(event.text, 500)
  const link = sanitize(event.link, 500)
  const dup = await db
    .collection('review_submissions')
    .where({ memberId: member._id, platform, status: 'pending' })
    .count()
  if (dup.total > 0) throw new Error('该平台已有待审核的申请，请等待处理')
  const ts = now()
  const res = await db.collection('review_submissions').add({
    data: {
      memberId: member._id,
      platform,
      screenshots,
      text,
      link,
      status: 'pending',
      reviewedBy: '',
      reviewTime: null,
      isSpecial: false,
      specialReason: '',
      rejectReason: '',
      createdAt: ts,
    },
  })
  return ok({ id: res._id })
}

async function actionListMyReviews(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const res = await db
    .collection('review_submissions')
    .where({ memberId: member._id })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return ok({ items: res.data })
}

async function actionListReviewSubmissions(openid, event) {
  await requireAdmin(openid)
  const status = sanitize(event.status, 20)
  const where = status && status !== 'all' ? { status } : {}
  const res = await db
    .collection('review_submissions')
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  const items = res.data
  const memberIds = [...new Set(items.map(i => i.memberId))]
  const members = {}
  if (memberIds.length) {
    const mRes = await db
      .collection('members')
      .where({ _id: _.in(memberIds) })
      .get()
    mRes.data.forEach(m => {
      members[m._id] = toPublicMember(m)
    })
  }
  const config = await loadConfig()
  const enriched = []
  for (const item of items) {
    const monthUsage = await reviewMonthUsage(item.memberId, item.platform, config)
    const histRes = await db
      .collection('review_submissions')
      .where({
        memberId: item.memberId,
        platform: item.platform,
        status: 'approved',
        _id: _.neq(item._id),
      })
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get()
    enriched.push({
      ...item,
      member: members[item.memberId] || null,
      monthUsage,
      history: histRes.data.map(h => ({
        id: h._id,
        createdAt: h.createdAt,
        isSpecial: h.isSpecial,
        reviewTime: h.reviewTime,
      })),
    })
  }
  return ok({ items: enriched })
}

async function actionReviewAction(openid, event) {
  const config = await requireAdmin(openid)
  const id = sanitize(event.id, 64)
  const action = sanitize(event.subAction, 20)
  let subRes
  try {
    subRes = await db.collection('review_submissions').doc(id).get()
  } catch (e) {
    throw new Error('申请不存在')
  }
  const sub = subRes.data
  if (sub.status !== 'pending') throw new Error('该申请已处理')
  const member = await getMemberById(sub.memberId)
  if (!member) throw new Error('会员不存在')
  const actor = await getMemberByOpenid(openid)
  const ts = now()

  if (action === 'reject') {
    const reason = sanitize(event.reason, 200)
    if (!reason) throw new Error('拒绝原因必填')
    await db
      .collection('review_submissions')
      .doc(id)
      .update({ data: { status: 'rejected', reviewedBy: openid, reviewTime: ts, rejectReason: reason } })
    await db.collection('audit_logs').add({
      data: {
        actorId: openid,
        actorNickname: actor ? actor.nickname : '',
        actionType: 'review_reject',
        targetType: 'review_submission',
        targetId: id,
        targetMemberId: sub.memberId,
        targetMemberNickname: member.nickname,
        changeType: 'none',
        delta: 0,
        reason,
        specialFlag: false,
        metadata: { platform: sub.platform },
        createdAt: ts,
      },
    })
    return ok({ id })
  }

  if (action === 'approve') {
    const usage = await reviewMonthUsage(sub.memberId, sub.platform, config)
    const overLimit = usage.used >= usage.max
    let specialReason = ''
    if (overLimit) {
      specialReason = sanitize(event.specialReason, 200)
      if (!specialReason) throw new Error('该平台本月已达上限，必须填写特别录入原因')
    }
    await db.runTransaction(async t => {
      await t
        .collection('review_submissions')
        .doc(id)
        .update({
          data: {
            status: 'approved',
            reviewedBy: openid,
            reviewTime: ts,
            isSpecial: overLimit,
            specialReason,
            rejectReason: '',
          },
        })
      await applyPoints(t, {
        memberId: sub.memberId,
        growthDelta: usage.points || 0,
        pointsDelta: usage.points || 0,
        sourceType: 'review_bonus',
        sourceId: id,
        subtype: overLimit ? 'special' : 'normal',
        note: sub.text || (sub.platform === 'xiaohongshu' ? '小红书评论加分' : '大众点评评论加分'),
        actorId: openid,
        actorNickname: actor ? actor.nickname : '',
        actionType: 'review_approve',
        targetType: 'review_submission',
        targetId: id,
        targetMemberNickname: member.nickname,
        reason: specialReason,
        specialFlag: overLimit,
        config,
      })
    })
    return ok({ id })
  }

  throw new Error('未知操作')
}

async function actionListPointEntries(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const where = { memberId: member._id }
  if (event.sourceType) where.sourceType = sanitize(event.sourceType, 30)
  const countRes = await db.collection('point_entries').where(where).count()
  const res = await db
    .collection('point_entries')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  return ok({
    entries: res.data,
    total: countRes.total,
    page,
    pageSize,
    points: member.points || 0,
    growth: member.growth || 0,
    levelName: member.levelName || '青铜',
  })
}

async function actionListAuditLogs(openid, event) {
  const config = await requireAdmin(openid)
  const where = {}
  if (event.targetMemberId) where.targetMemberId = sanitize(event.targetMemberId, 64)
  if (event.actorId) where.actorId = sanitize(event.actorId, 64)
  const changeType = sanitize(event.changeType, 30)
  if (changeType && changeType !== 'all') {
    if (changeType === 'points_increase') {
      where.changeType = _.in(['points_increase', 'points_increase+growth_increase'])
    } else if (changeType === 'growth_increase') {
      where.changeType = _.in(['growth_increase', 'points_increase+growth_increase'])
    } else {
      where.changeType = changeType
    }
  }
  const timeRange = sanitize(event.timeRange, 10)
  if (timeRange === '7d') where.createdAt = _.gte(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  if (timeRange === '30d') where.createdAt = _.gte(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const countRes = await db.collection('audit_logs').where(where).count()
  const res = await db
    .collection('audit_logs')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  const start = periodStart(config.consumptionLimit || {})
  const weekTotalRes = await db
    .collection('consumption_records')
    .where({ createdAt: _.gte(start) })
    .count()
  const weekSpecialRes = await db
    .collection('consumption_records')
    .where({ createdAt: _.gte(start), isSpecial: true })
    .count()
  const total = weekTotalRes.total
  return ok({
    items: res.data,
    total: countRes.total,
    page,
    pageSize,
    weekStats: {
      total,
      special: weekSpecialRes.total,
      ratio: total ? Math.round((weekSpecialRes.total * 100) / total) : 0,
    },
  })
}

// 管理员手动新增成长值和/或积分（只能增加）
async function actionManualAdjust(openid, event) {
  const config = await requireAdmin(openid)
  const member = await getMemberById(sanitize(event.memberId, 64))
  if (!member) throw new Error('会员不存在')
  const actor = await getMemberByOpenid(openid)
  const growthDelta = Math.floor(Number(event.growthDelta) || 0)
  const pointsDelta = Math.floor(Number(event.pointsDelta) || 0)
  if (growthDelta < 0 || pointsDelta < 0) {
    throw new Error('成长值与积分只能增加，不能为负数')
  }
  if (growthDelta === 0 && pointsDelta === 0) {
    throw new Error('请至少填写成长值或积分')
  }
  const reason = sanitize(event.reason, 200)
  if (!reason) throw new Error('原因必填')
  let result = null
  await db.runTransaction(async t => {
    const applied = await applyPoints(t, {
      memberId: member._id,
      growthDelta,
      pointsDelta,
      sourceType: 'manual_adjust',
      sourceId: '',
      subtype: 'manual',
      note: reason,
      detail: reason,
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'manual_adjust',
      targetType: 'member',
      targetId: member._id,
      targetMemberNickname: member.nickname,
      reason,
      specialFlag: false,
      config,
    })
    result = { pointsAfter: applied.pointsAfter, growthAfter: applied.growthAfter }
  })
  return ok(result)
}

// 管理员用积分兑换优惠券/桌游等（扣减积分，成长值不变）
async function actionRedeemPoints(openid, event) {
  const config = await requireAdmin(openid)
  const member = await getMemberById(sanitize(event.memberId, 64))
  if (!member) throw new Error('会员不存在')
  const actor = await getMemberByOpenid(openid)
  const points = Math.floor(Number(event.points) || 0)
  if (points <= 0) throw new Error('兑换积分必须大于 0')
  if ((member.points || 0) < points) {
    throw new Error(`积分不足（当前 ${member.points || 0} 分）`)
  }
  const item = sanitize(event.item, 100)
  if (!item) throw new Error('请填写兑换内容')
  const note = sanitize(event.note, 200)
  const reason = item + (note ? '，' + note : '')
  let result = null
  await db.runTransaction(async t => {
    const applied = await applyPoints(t, {
      memberId: member._id,
      growthDelta: 0,
      pointsDelta: -points,
      sourceType: 'redemption',
      sourceId: '',
      subtype: 'redemption',
      note: reason,
      detail: item,
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'redeem_points',
      targetType: 'member',
      targetId: member._id,
      targetMemberNickname: member.nickname,
      reason,
      specialFlag: false,
      config,
    })
    result = { pointsAfter: applied.pointsAfter, growthAfter: applied.growthAfter }
  })
  return ok(result)
}

// 成长值排行榜：TOP N + 自己前后各若干名；匿名用户对他人隐藏昵称/账号名
async function actionLeaderboard(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const config = await loadConfig()
  const lb = config.leaderboard || {}
  const topCount = Math.max(1, Math.min(100, lb.topCount || 20))
  const aroundCount = Math.max(1, Math.min(20, lb.aroundCount || 5))
  const myGrowth = member.growth || 0
  const myPoints = member.points || 0
  const myCreated = member.createdAt
  const gtGrowth = await db.collection('members').where({ growth: _.gt(myGrowth) }).count()
  const eqGrowth = await db
    .collection('members')
    .where({ growth: myGrowth, points: _.gt(myPoints) })
    .count()
  let eqAll = 0
  if (myCreated) {
    const res = await db
      .collection('members')
      .where({ growth: myGrowth, points: myPoints, createdAt: _.lt(myCreated) })
      .count()
    eqAll = res.total
  }
  const rank = gtGrowth.total + eqGrowth.total + eqAll + 1
  const start = Math.max(0, rank - 1 - aroundCount)
  const limit = aroundCount * 2 + 1
  const baseQuery = db
    .collection('members')
    .orderBy('growth', 'desc')
    .orderBy('points', 'desc')
    .orderBy('createdAt', 'asc')
  const topRes = await baseQuery.limit(topCount).get()
  const aroundRes = await baseQuery.skip(start).limit(limit).get()
  const totalRes = await db.collection('members').count()
  const mask = m => {
    const hide = !!m.leaderboardAnon && m._id !== member._id
    return {
      id: m._id,
      nickname: hide ? '匿名用户' : m.nickname || '会员',
      accountName: hide ? '' : m.accountName || '',
      growth: m.growth || 0,
      anonymous: !!m.leaderboardAnon,
      isMe: m._id === member._id,
    }
  }
  return ok({
    top: topRes.data.map((m, i) => ({ ...mask(m), rank: i + 1 })),
    around: aroundRes.data.map((m, i) => ({ ...mask(m), rank: start + i + 1 })),
    me: { ...mask(member), rank },
    topCount,
    aroundCount,
    total: totalRes.total,
    leaderboardAnon: !!member.leaderboardAnon,
  })
}

// 设置排行榜匿名/实名（必须参与，仅决定是否向他人展示 ID）
async function actionUpdateLeaderboardAnon(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const anon = !!event.anon
  await db.collection('members').doc(member._id).update({
    data: { leaderboardAnon: anon, updatedAt: now() },
  })
  const updated = await getMemberById(member._id)
  return ok({ member: toPublicMember(updated), leaderboardAnon: anon })
}

// ---------------- 路由 ----------------

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const dispatch = async () => {
    switch (event.action) {
      case 'login':
        return await actionLogin(OPENID)
      case 'renameAccountName':
        return await actionRenameAccountName(OPENID, event)
      case 'updateProfile':
        return await actionUpdateProfile(OPENID, event)
      case 'getConfig':
        return await actionGetConfig()
      case 'issueMemberCode':
        return await actionIssueMemberCode(OPENID)
      case 'verifyMemberCode':
        return await actionVerifyMemberCode(OPENID, event)
      case 'memberUsage':
        return await actionMemberUsage(OPENID, event)
      case 'findMembers':
        return await actionFindMembers(OPENID, event)
      case 'createConsumption':
        return await actionCreateConsumption(OPENID, event)
      case 'submitReview':
        return await actionSubmitReview(OPENID, event)
      case 'listMyReviews':
        return await actionListMyReviews(OPENID)
      case 'listReviewSubmissions':
        return await actionListReviewSubmissions(OPENID, event)
      case 'reviewAction':
        return await actionReviewAction(OPENID, event)
      case 'listPointEntries':
        return await actionListPointEntries(OPENID, event)
      case 'listAuditLogs':
        return await actionListAuditLogs(OPENID, event)
      case 'manualAdjust':
        return await actionManualAdjust(OPENID, event)
      case 'redeemPoints':
        return await actionRedeemPoints(OPENID, event)
      case 'leaderboard':
        return await actionLeaderboard(OPENID)
      case 'updateLeaderboardAnon':
        return await actionUpdateLeaderboardAnon(OPENID, event)
      default:
        return fail('未知操作')
    }
  }
  try {
    return await dispatch()
  } catch (e) {
    // 数据库集合缺失时自动创建并重试一次，避免首次部署需要手动建库
    if (/collection not exists|-502005/.test(e.message || '')) {
      try {
        await ensureCollections()
      } catch (ignore) {
        // 忽略建集合失败，继续抛原始错误
      }
      try {
        return await dispatch()
      } catch (retryError) {
        return fail(retryError.message || '服务器错误')
      }
    }
    return fail(e.message || '服务器错误')
  }
}
