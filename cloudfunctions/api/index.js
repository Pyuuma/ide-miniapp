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
  'events',
  'event_registrations',
  'redemption_items',
  'honor_entries',
]

const DEFAULT_CONFIG = {
  storeInfo: {
    name: 'ide·我有更好的想法',
    contact: 'ide·我有更好的想法',
  },
  pointTiers: [
    { id: 'tier_4h', name: '4小时', points: 2, defaultAmount: 58 },
    { id: 'tier_day', name: '全天不限时', points: 3, defaultAmount: 88 },
  ],
  consumptionLimit: {
    period: 'week',
    resetDay: 1,
    resetHour: 4,
    maxCount: 4,
  },
  memberDayBonus: {
    enabled: true,
    label: '会员日',
    weekdays: [2, 4],
    points: 1,
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
    '本小程序由 {{storeName}} 运营，用于会员登录、积分与等级管理、消费记录、评论加分审核、赛事报名、荣誉值发放与积分兑换等业务。\n\n' +
    '我们会收集并存储您的微信身份标识、昵称、头像、签名、积分、荣誉值、消费记录、赛事报名信息及兑换记录，仅用于本店会员服务，不会向第三方出售您的个人信息。\n\n' +
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

function sanitizeInt(value, min, max) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return null
  if (min !== undefined && n < min) return null
  if (max !== undefined && n > max) return null
  return n
}

function parseDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function validateImages(value) {
  const images = Array.isArray(value)
    ? value.filter(s => typeof s === 'string' && s.startsWith('cloud://'))
    : []
  if (!images.length) throw new Error('请至少上传一张图片')
  if (images.length > 9) throw new Error('图片最多上传 9 张')
  return images
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
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

// 中国时区的星期几（0 = 周日，1 = 周一 … 6 = 周六）
function chinaWeekday(at) {
  const offsetMs = 8 * 60 * 60 * 1000
  const local = new Date((at ? at.getTime() : Date.now()) + offsetMs)
  return local.getUTCDay()
}

// 会员日：当天是否为配置的会员日、规则分值；是否真的加分由操作者勾选决定
function memberDayInfo(config, at) {
  const rule = config.memberDayBonus || {}
  const label = rule.label || '会员日'
  const enabled = !!rule.enabled
  if (!enabled) return { enabled: false, isMemberDay: false, points: 0, label }
  const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays.map(Number) : []
  const isMemberDay = weekdays.includes(chinaWeekday(at))
  const points = Math.max(0, Math.floor(Number(rule.points) || 0))
  return { enabled, isMemberDay, points, label }
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
    memberDayBonus: {
      ...DEFAULT_CONFIG.memberDayBonus,
      ...(stored.memberDayBonus || {}),
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
    honor: m.honor || 0,
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
  const honorDelta = o.honorDelta || 0
  const growthAfter = (member.growth || 0) + growthDelta
  const pointsAfter = (member.points || 0) + pointsDelta
  const honorAfter = (member.honor || 0) + honorDelta
  const level = calcLevel(growthAfter, o.config)
  await t
    .collection('members')
    .doc(o.memberId)
    .update({
      data: {
        growth: growthAfter,
        points: pointsAfter,
        honor: honorAfter,
        level: level.id,
        levelName: level.name,
        updatedAt: ts,
      },
    })
  let pointEntryId = ''
  if (growthDelta !== 0 || pointsDelta !== 0) {
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
    pointEntryId = peRes._id
  }
  if (honorDelta !== 0) {
    await t.collection('honor_entries').add({
      data: {
        memberId: o.memberId,
        honorDelta,
        honorAfter,
        sourceType: o.sourceType,
        sourceId: o.sourceId,
        subtype: o.subtype || 'normal',
        note: o.note || '',
        detail: o.detail || '',
        actorId: o.actorId,
        createdAt: ts,
      },
    })
  }
  const changes = []
  if (pointsDelta !== 0) changes.push(pointsDelta > 0 ? 'points_increase' : 'points_decrease')
  if (growthDelta !== 0) changes.push('growth_increase')
  if (honorDelta !== 0) changes.push('honor_increase')
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
      honorDelta,
      reason: o.reason || '',
      specialFlag: !!o.specialFlag,
      metadata: {
        sourceType: o.sourceType,
        sourceId: o.sourceId,
        subtype: o.subtype || 'normal',
        ...(o.metadata || {}),
      },
      createdAt: ts,
    },
  })
  return { pointEntryId, pointsAfter, growthAfter, honorAfter, level }
}

// 事务内：更新会员荣誉值 + 写荣誉值明细 + 写审计记录（赛事发放等纯荣誉场景）
async function applyHonor(t, o) {
  const ts = now()
  const memRes = await t.collection('members').doc(o.memberId).get()
  const member = memRes.data || {}
  const honorDelta = o.honorDelta || 0
  const honorAfter = (member.honor || 0) + honorDelta
  await t
    .collection('members')
    .doc(o.memberId)
    .update({ data: { honor: honorAfter, updatedAt: ts } })
  await t.collection('honor_entries').add({
    data: {
      memberId: o.memberId,
      honorDelta,
      honorAfter,
      sourceType: o.sourceType,
      sourceId: o.sourceId,
      subtype: o.subtype || 'normal',
      note: o.note || '',
      detail: o.detail || '',
      actorId: o.actorId,
      createdAt: ts,
    },
  })
  await t.collection('audit_logs').add({
    data: {
      actorId: o.actorId,
      actorNickname: o.actorNickname || '',
      actionType: o.actionType,
      targetType: o.targetType,
      targetId: o.targetId,
      targetMemberId: o.memberId,
      targetMemberNickname: o.targetMemberNickname || member.nickname || '',
      changeType: 'honor_increase',
      delta: 0,
      growthDelta: 0,
      honorDelta,
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
  return { honorAfter }
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
        honor: 0,
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
  if (member.honor === undefined || member.honor === null) {
    member.honor = 0
    migrated.honor = 0
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
  const basePoints = Math.max(0, Math.floor(Number(tier.points) || 0))
  const memberDay = memberDayInfo(config)
  // 是否加会员日分由操作者勾选决定：配置日默认勾选，非配置日默认不勾，但都可手动调整
  const memberDayApplied = memberDay.enabled && event.applyMemberDayBonus === true
  const bonusPoints = memberDayApplied ? memberDay.points : 0
  const totalPoints = basePoints + bonusPoints
  const detail =
    tier.name +
    (bonusPoints ? `（${memberDay.label} +${bonusPoints}）` : '') +
    (note ? '，' + note : '')
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
        points: basePoints,
        memberDayBonus: bonusPoints,
        isMemberDay: memberDay.isMemberDay,
        memberDayApplied,
        totalPoints,
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
      growthDelta: totalPoints,
      pointsDelta: totalPoints,
      sourceType: 'consumption',
      sourceId: addRes._id,
      subtype: overLimit ? 'special' : 'normal',
      note,
      detail,
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
      bonusPoints,
      totalPoints,
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
    honor: member.honor || 0,
    levelName: member.levelName || '青铜',
  })
}

async function actionListHonorEntries(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const where = { memberId: member._id }
  const countRes = await db.collection('honor_entries').where(where).count()
  const res = await db
    .collection('honor_entries')
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
    honor: member.honor || 0,
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
    } else if (changeType === 'honor_increase') {
      where.changeType = _.in([
        'honor_increase',
        'growth_increase+honor_increase',
        'points_increase+honor_increase',
        'points_increase+growth_increase+honor_increase',
      ])
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
  const honorDelta = Math.floor(Number(event.honorDelta) || 0)
  if (growthDelta < 0 || pointsDelta < 0 || honorDelta < 0) {
    throw new Error('成长值、积分与荣誉值只能增加，不能为负数')
  }
  if (growthDelta === 0 && pointsDelta === 0 && honorDelta === 0) {
    throw new Error('请至少填写成长值、积分或荣誉值')
  }
  const reason = sanitize(event.reason, 200)
  if (!reason) throw new Error('原因必填')
  let result = null
  await db.runTransaction(async t => {
    const applied = await applyPoints(t, {
      memberId: member._id,
      growthDelta,
      pointsDelta,
      honorDelta,
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
    result = {
      pointsAfter: applied.pointsAfter,
      growthAfter: applied.growthAfter,
      honorAfter: applied.honorAfter,
    }
  })
  return ok(result)
}

// 管理员用积分兑换优惠券/桌游等（扣减积分，成长值不变）
async function actionRedeemPoints(openid, event) {
  const config = await requireAdmin(openid)
  const member = await getMemberById(sanitize(event.memberId, 64))
  if (!member) throw new Error('会员不存在')
  const actor = await getMemberByOpenid(openid)
  let points = Math.floor(Number(event.points) || 0)
  const itemId = sanitize(event.itemId, 64)
  const optionId = sanitize(event.optionId, 64)
  let item = null
  let option = null
  if (itemId && optionId) {
    const itemRes = await db.collection('redemption_items').doc(itemId).get().catch(() => null)
    item = itemRes && itemRes.data
    if (!item) throw new Error('商品不存在')
    option = (item.options || []).find(o => o.id === optionId)
    if (!option) throw new Error('兑换选项不存在')
    if (points <= 0) points = Math.floor(Number(option.points) || 0)
  }
  if (points <= 0) throw new Error('兑换积分必须大于 0')
  if ((member.points || 0) < points) {
    throw new Error(`积分不足（当前 ${member.points || 0} 分）`)
  }
  const templateItem = item ? `${item.title} · ${option.name}` : ''
  const itemName = sanitize(event.item, 100) || templateItem
  if (!itemName) throw new Error('请填写兑换内容')
  const note = sanitize(event.note, 200)
  const reason = itemName + (note ? '，' + note : '')
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
      detail: itemName,
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'redeem_points',
      targetType: 'member',
      targetId: member._id,
      targetMemberNickname: member.nickname,
      reason,
      specialFlag: false,
      metadata: {
        itemId: item ? item._id : '',
        optionId: option ? option.id : '',
        optionName: option ? option.name : '',
      },
      config,
    })
    result = {
      pointsAfter: applied.pointsAfter,
      growthAfter: applied.growthAfter,
      itemName,
    }
  })
  return ok(result)
}

// 排行榜：按 type 取成长值或荣誉值（成长值为主、默认进入）；TOP N + 自己前后各若干名
async function actionLeaderboard(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const type = event && event.type === 'honor' ? 'honor' : 'growth'
  const config = await loadConfig()
  const lb = config.leaderboard || {}
  const topCount = Math.max(1, Math.min(100, lb.topCount || 20))
  const aroundCount = Math.max(1, Math.min(20, lb.aroundCount || 5))
  const metric = type === 'honor' ? 'honor' : 'growth'
  const myValue = member[metric] || 0
  const myPoints = member.points || 0
  const myCreated = member.createdAt
  const gtValue = await db
    .collection('members')
    .where({ [metric]: _.gt(myValue) })
    .count()
  const eqValue = await db
    .collection('members')
    .where({ [metric]: myValue, points: _.gt(myPoints) })
    .count()
  let eqAll = 0
  if (myCreated) {
    const res = await db
      .collection('members')
      .where({ [metric]: myValue, points: myPoints, createdAt: _.lt(myCreated) })
      .count()
    eqAll = res.total
  }
  const rank = gtValue.total + eqValue.total + eqAll + 1
  const start = Math.max(0, rank - 1 - aroundCount)
  const limit = aroundCount * 2 + 1
  const baseQuery = db
    .collection('members')
    .orderBy(metric, 'desc')
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
      honor: m.honor || 0,
      value: m[metric] || 0,
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
    type,
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

// ---------------- 赛事 ----------------

async function activeRegistrationCount(eventId) {
  const res = await db
    .collection('event_registrations')
    .where({ eventId, status: 'registered' })
    .count()
  return res.total
}

function eventRegisterState(ev, at) {
  const ts = at || Date.now()
  if (ev.status !== 'published') return 'closed'
  if (ev.registerStart && ts < ev.registerStart.getTime()) return 'not_started'
  if (ev.registerDeadline && ts >= ev.registerDeadline.getTime()) return 'closed'
  return 'open'
}

async function actionListEvents(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const res = await db
    .collection('events')
    .where({ status: _.in(['published', 'ended']) })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  const events = res.data
  const ids = events.map(e => e._id)
  const myIds = new Set()
  if (ids.length) {
    const regRes = await db
      .collection('event_registrations')
      .where({ eventId: _.in(ids), memberId: member._id, status: 'registered' })
      .limit(100)
      .get()
    regRes.data.forEach(r => myIds.add(r.eventId))
  }
  const items = []
  for (const e of events) {
    items.push({
      ...e,
      images: e.images || [],
      registrationCount: await activeRegistrationCount(e._id),
      myRegistered: myIds.has(e._id),
      registerState: eventRegisterState(e),
    })
  }
  return ok({ items })
}

async function actionGetEvent(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const id = sanitize(event.id, 64)
  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  if (ev.status === 'draft') throw new Error('赛事不存在')
  const regRes = await db
    .collection('event_registrations')
    .where({ eventId: id, memberId: member._id, status: 'registered' })
    .limit(1)
    .get()
  return ok({
    event: {
      ...ev,
      images: ev.images || [],
      registrationCount: await activeRegistrationCount(id),
      registerState: eventRegisterState(ev),
    },
    myRegistration: regRes.data[0] || null,
  })
}

async function actionRegisterEvent(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const id = sanitize(event.id, 64)
  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  if (ev.status !== 'published') throw new Error('该赛事当前不可报名')
  if (ev.registerStart && ev.registerStart.getTime() > Date.now()) throw new Error('报名尚未开始')
  if (ev.registerDeadline && ev.registerDeadline.getTime() <= Date.now()) throw new Error('报名已截止')
  const dup = await db
    .collection('event_registrations')
    .where({ eventId: id, memberId: member._id, status: 'registered' })
    .count()
  if (dup.total > 0) throw new Error('你已报名该赛事')
  const count = await activeRegistrationCount(id)
  if (ev.capacity && count >= ev.capacity) throw new Error('名额已满')
  const addRes = await db.collection('event_registrations').add({
    data: {
      eventId: id,
      memberId: member._id,
      status: 'registered',
      registeredBy: member._id,
      source: 'member',
      createdAt: now(),
    },
  })
  return ok({ id: addRes._id, registrationCount: count + 1 })
}

async function actionCancelEventRegistration(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const id = sanitize(event.id, 64)
  const regRes = await db.collection('event_registrations').doc(id).get().catch(() => null)
  if (!regRes || !regRes.data) throw new Error('报名记录不存在')
  const reg = regRes.data
  if (reg.memberId !== member._id) throw new Error('只能取消自己的报名')
  if (reg.status !== 'registered') throw new Error('该报名记录已取消或移除')
  const evRes = await db.collection('events').doc(reg.eventId).get().catch(() => null)
  const ev = evRes && evRes.data
  if (ev && ev.status === 'ended') throw new Error('赛事已结束，无法取消')
  if (ev && ev.registerDeadline && ev.registerDeadline.getTime() <= Date.now()) {
    throw new Error('报名已截止，无法取消')
  }
  const ts = now()
  await db
    .collection('event_registrations')
    .doc(id)
    .update({ data: { status: 'cancelled', cancelledAt: ts } })
  return ok({ id })
}

async function actionListMyEventRegistrations(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const res = await db
    .collection('event_registrations')
    .where({ memberId: member._id, status: 'registered' })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  const regs = res.data
  const ids = [...new Set(regs.map(r => r.eventId))]
  const events = {}
  if (ids.length) {
    const evRes = await db.collection('events').where({ _id: _.in(ids) }).get()
    evRes.data.forEach(e => {
      events[e._id] = e
    })
  }
  const items = []
  for (const r of regs) {
    const ev = events[r.eventId]
    if (!ev) continue
    items.push({
      registrationId: r._id,
      eventId: ev._id,
      title: ev.title,
      cover: (ev.images || [])[0] || '',
      status: ev.status,
      registerDeadline: ev.registerDeadline,
      capacity: ev.capacity,
      registrationCount: await activeRegistrationCount(ev._id),
      createdAt: r.createdAt,
    })
  }
  return ok({ items })
}

async function actionListAdminEvents(openid) {
  await requireAdmin(openid)
  const res = await db
    .collection('events')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
  const items = []
  for (const e of res.data) {
    items.push({ ...e, registrationCount: await activeRegistrationCount(e._id) })
  }
  return ok({ items })
}

async function actionSaveEvent(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const id = sanitize(event.id, 64)
  const title = sanitize(event.title, 50)
  if (!title) throw new Error('赛事标题必填')
  const images = validateImages(event.images)
  const contentMarkdown = sanitize(event.contentMarkdown, 10000)
  if (!contentMarkdown) throw new Error('赛事说明必填')
  const status = ['draft', 'published', 'ended'].includes(event.status) ? event.status : 'draft'
  const registerStart = parseDate(event.registerStart)
  const registerDeadline = parseDate(event.registerDeadline)
  if (registerStart && registerDeadline && registerStart.getTime() >= registerDeadline.getTime()) {
    throw new Error('报名开始时间必须早于报名截止时间')
  }
  const rawCapacity = event.capacity
  const capacity =
    rawCapacity === '' || rawCapacity === null || rawCapacity === undefined
      ? null
      : sanitizeInt(rawCapacity, 1, 100000)
  if (rawCapacity !== '' && rawCapacity !== null && rawCapacity !== undefined && capacity === null) {
    throw new Error('名额上限必须是正整数')
  }
  const ts = now()
  const audit = {
    actorId: openid,
    actorNickname: actor ? actor.nickname : '',
    actionType: 'event_save',
    targetType: 'event',
    targetMemberId: '',
    targetMemberNickname: '',
    changeType: 'none',
    delta: 0,
    reason: '',
    specialFlag: false,
    metadata: { title, status },
    createdAt: ts,
  }
  if (id) {
    const oldRes = await db.collection('events').doc(id).get().catch(() => null)
    if (!oldRes || !oldRes.data) throw new Error('赛事不存在')
    await db.collection('events').doc(id).update({
      data: {
        title,
        images,
        contentMarkdown,
        status,
        registerStart,
        registerDeadline,
        capacity,
        updatedBy: openid,
        updatedAt: ts,
      },
    })
    await db.collection('audit_logs').add({ data: { ...audit, targetId: id } })
    return ok({ id })
  }
  const addRes = await db.collection('events').add({
    data: {
      title,
      images,
      contentMarkdown,
      status,
      registerStart,
      registerDeadline,
      capacity,
      createdBy: openid,
      updatedBy: openid,
      createdAt: ts,
      updatedAt: ts,
    },
  })
  await db.collection('audit_logs').add({ data: { ...audit, targetId: addRes._id } })
  return ok({ id: addRes._id })
}

async function actionDeleteEvent(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const id = sanitize(event.id, 64)
  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  if (ev.status !== 'draft') throw new Error('仅草稿状态可删除')
  await db
    .collection('event_registrations')
    .where({ eventId: id })
    .remove()
    .catch(() => {})
  await db.collection('events').doc(id).remove()
  await db.collection('audit_logs').add({
    data: {
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'event_delete',
      targetType: 'event',
      targetId: id,
      targetMemberId: '',
      targetMemberNickname: '',
      changeType: 'none',
      delta: 0,
      reason: ev.title,
      specialFlag: false,
      metadata: {},
      createdAt: now(),
    },
  })
  return ok({ id })
}

async function actionListEventRoster(openid, event) {
  await requireAdmin(openid)
  const id = sanitize(event.id, 64)
  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  const regRes = await db
    .collection('event_registrations')
    .where({ eventId: id, status: 'registered' })
    .orderBy('createdAt', 'asc')
    .limit(500)
    .get()
  const memberIds = [...new Set(regRes.data.map(r => r.memberId))]
  const members = {}
  if (memberIds.length) {
    const mRes = await db.collection('members').where({ _id: _.in(memberIds) }).get()
    mRes.data.forEach(m => {
      members[m._id] = toPublicMember(m)
    })
  }
  const items = regRes.data.map(r => ({
    registrationId: r._id,
    member: members[r.memberId] || {
      id: r.memberId,
      nickname: '未知会员',
      accountName: '',
      honor: 0,
    },
    registeredBy: r.registeredBy,
    source: r.source,
    createdAt: r.createdAt,
  }))
  return ok({
    event: ev,
    items,
    total: await activeRegistrationCount(id),
  })
}

async function actionAddEventRegistration(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const eventId = sanitize(event.eventId, 64)
  const memberId = sanitize(event.memberId, 64)
  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  const member = await getMemberById(memberId)
  if (!member) throw new Error('会员不存在')
  const dup = await db
    .collection('event_registrations')
    .where({ eventId, memberId, status: 'registered' })
    .count()
  if (dup.total > 0) throw new Error('该会员已报名此赛事')
  const ts = now()
  const addRes = await db.collection('event_registrations').add({
    data: {
      eventId,
      memberId,
      status: 'registered',
      registeredBy: openid,
      source: 'admin',
      createdAt: ts,
    },
  })
  await db.collection('audit_logs').add({
    data: {
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'event_roster_add',
      targetType: 'event_registration',
      targetId: addRes._id,
      targetMemberId: memberId,
      targetMemberNickname: member.nickname,
      changeType: 'none',
      delta: 0,
      reason: `赛事补录：${ev.title}`,
      specialFlag: false,
      metadata: { eventId },
      createdAt: ts,
    },
  })
  return ok({ id: addRes._id })
}

async function actionRemoveEventRegistration(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const id = sanitize(event.id, 64)
  const regRes = await db.collection('event_registrations').doc(id).get().catch(() => null)
  if (!regRes || !regRes.data) throw new Error('报名记录不存在')
  const reg = regRes.data
  if (reg.status !== 'registered') throw new Error('该报名记录已移除或取消')
  const evRes = await db.collection('events').doc(reg.eventId).get().catch(() => null)
  const ev = evRes && evRes.data
  const member = await getMemberById(reg.memberId)
  const ts = now()
  await db
    .collection('event_registrations')
    .doc(id)
    .update({ data: { status: 'removed', removedAt: ts, removedBy: openid } })
  await db.collection('audit_logs').add({
    data: {
      actorId: openid,
      actorNickname: actor ? actor.nickname : '',
      actionType: 'event_roster_remove',
      targetType: 'event_registration',
      targetId: id,
      targetMemberId: reg.memberId,
      targetMemberNickname: member ? member.nickname : '',
      changeType: 'none',
      delta: 0,
      reason: ev ? `移除赛事名单：${ev.title}` : '',
      specialFlag: false,
      metadata: { eventId: reg.eventId },
      createdAt: ts,
    },
  })
  return ok({ id })
}

async function actionAwardEventHonor(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const eventId = sanitize(event.eventId, 64)
  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (!evRes || !evRes.data) throw new Error('赛事不存在')
  const ev = evRes.data
  const rawItems = Array.isArray(event.items) ? event.items : []
  if (!rawItems.length) throw new Error('请选择至少一位会员')
  const normalized = []
  const seen = new Set()
  for (const it of rawItems) {
    const memberId = sanitize(it.memberId, 64)
    const honor = sanitizeInt(it.honor, 1, 1000000)
    if (!memberId || honor === null) throw new Error('荣誉值必须是正整数')
    if (seen.has(memberId)) continue
    seen.add(memberId)
    normalized.push({ memberId, honor })
  }
  const regRes = await db
    .collection('event_registrations')
    .where({ eventId, status: 'registered' })
    .limit(1000)
    .get()
  const rosterIds = new Set(regRes.data.map(r => r.memberId))
  for (const it of normalized) {
    if (!rosterIds.has(it.memberId)) throw new Error('所选会员不在赛事名单中')
  }
  const members = {}
  const mRes = await db
    .collection('members')
    .where({ _id: _.in(normalized.map(i => i.memberId)) })
    .get()
  mRes.data.forEach(m => {
    members[m._id] = m
  })
  const note = sanitize(event.note, 200)
  const reason = `赛事发放：${ev.title}` + (note ? '，' + note : '')
  let awarded = []
  await db.runTransaction(async t => {
    for (const it of normalized) {
      const member = members[it.memberId]
      const applied = await applyHonor(t, {
        memberId: it.memberId,
        honorDelta: it.honor,
        sourceType: 'event_award',
        sourceId: eventId,
        subtype: 'event',
        note: reason,
        detail: ev.title,
        actorId: openid,
        actorNickname: actor ? actor.nickname : '',
        actionType: 'event_award',
        targetType: 'event',
        targetId: eventId,
        targetMemberNickname: member ? member.nickname : '',
        reason,
        specialFlag: false,
      })
      awarded.push({ memberId: it.memberId, honorAfter: applied.honorAfter })
    }
  })
  return ok({ count: awarded.length, awarded, eventId })
}

// ---------------- 积分商品 ----------------

async function actionListRedemptionItems(openid) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const res = await db
    .collection('redemption_items')
    .where({ status: 'on' })
    .orderBy('sort', 'asc')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
  const config = await loadConfig()
  return ok({
    items: res.data.map(i => ({
      ...i,
      images: i.images || [],
      options: i.options || [],
    })),
    contact: (config.storeInfo || {}).contact || '',
  })
}

async function actionGetRedemptionItem(openid, event) {
  const member = await getMemberByOpenid(openid)
  if (!member) throw new Error('请先登录')
  const id = sanitize(event.id, 64)
  const res = await db.collection('redemption_items').doc(id).get().catch(() => null)
  if (!res || !res.data || res.data.status !== 'on') throw new Error('商品不存在')
  const config = await loadConfig()
  return ok({
    item: { ...res.data, images: res.data.images || [], options: res.data.options || [] },
    contact: (config.storeInfo || {}).contact || '',
  })
}

async function actionListAdminRedemptionItems(openid) {
  await requireAdmin(openid)
  const res = await db
    .collection('redemption_items')
    .orderBy('sort', 'asc')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
  return ok({
    items: res.data.map(i => ({
      ...i,
      images: i.images || [],
      options: i.options || [],
    })),
  })
}

async function actionSaveRedemptionItem(openid, event) {
  await requireAdmin(openid)
  const actor = await getMemberByOpenid(openid)
  const id = sanitize(event.id, 64)
  const title = sanitize(event.title, 50)
  if (!title) throw new Error('商品标题必填')
  const images = validateImages(event.images)
  const contentMarkdown = sanitize(event.contentMarkdown, 10000)
  if (!contentMarkdown) throw new Error('商品说明必填')
  const status = event.status === 'off' ? 'off' : 'on'
  const sort = sanitizeInt(event.sort, 0, 999999) || 0
  const rawOptions = Array.isArray(event.options) ? event.options : []
  if (!rawOptions.length) throw new Error('请至少添加一个兑换选项')
  const options = []
  for (const raw of rawOptions) {
    const name = sanitize(raw.name, 50)
    const points = sanitizeInt(raw.points, 1, 1000000)
    if (!name) throw new Error('兑换选项名称必填')
    if (points === null) throw new Error('兑换选项积分必须是正整数')
    options.push({ id: sanitize(raw.id, 64) || randomId('opt'), name, points })
  }
  const ts = now()
  const audit = {
    actorId: openid,
    actorNickname: actor ? actor.nickname : '',
    actionType: 'redemption_item_save',
    targetType: 'redemption_item',
    targetMemberId: '',
    targetMemberNickname: '',
    changeType: 'none',
    delta: 0,
    reason: '',
    specialFlag: false,
    metadata: { title, status, optionCount: options.length },
    createdAt: ts,
  }
  if (id) {
    const oldRes = await db.collection('redemption_items').doc(id).get().catch(() => null)
    if (!oldRes || !oldRes.data) throw new Error('商品不存在')
    await db.collection('redemption_items').doc(id).update({
      data: {
        title,
        images,
        contentMarkdown,
        status,
        sort,
        options,
        updatedBy: openid,
        updatedAt: ts,
      },
    })
    await db.collection('audit_logs').add({ data: { ...audit, targetId: id } })
    return ok({ id })
  }
  const addRes = await db.collection('redemption_items').add({
    data: {
      title,
      images,
      contentMarkdown,
      status,
      sort,
      options,
      createdBy: openid,
      updatedBy: openid,
      createdAt: ts,
      updatedAt: ts,
    },
  })
  await db.collection('audit_logs').add({ data: { ...audit, targetId: addRes._id } })
  return ok({ id: addRes._id })
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
        return await actionLeaderboard(OPENID, event)
      case 'updateLeaderboardAnon':
        return await actionUpdateLeaderboardAnon(OPENID, event)
      case 'listHonorEntries':
        return await actionListHonorEntries(OPENID, event)
      case 'listEvents':
        return await actionListEvents(OPENID)
      case 'getEvent':
        return await actionGetEvent(OPENID, event)
      case 'registerEvent':
        return await actionRegisterEvent(OPENID, event)
      case 'cancelEventRegistration':
        return await actionCancelEventRegistration(OPENID, event)
      case 'listMyEventRegistrations':
        return await actionListMyEventRegistrations(OPENID)
      case 'listAdminEvents':
        return await actionListAdminEvents(OPENID)
      case 'saveEvent':
        return await actionSaveEvent(OPENID, event)
      case 'deleteEvent':
        return await actionDeleteEvent(OPENID, event)
      case 'listEventRoster':
        return await actionListEventRoster(OPENID, event)
      case 'addEventRegistration':
        return await actionAddEventRegistration(OPENID, event)
      case 'removeEventRegistration':
        return await actionRemoveEventRegistration(OPENID, event)
      case 'awardEventHonor':
        return await actionAwardEventHonor(OPENID, event)
      case 'listRedemptionItems':
        return await actionListRedemptionItems(OPENID)
      case 'getRedemptionItem':
        return await actionGetRedemptionItem(OPENID, event)
      case 'listAdminRedemptionItems':
        return await actionListAdminRedemptionItems(OPENID)
      case 'saveRedemptionItem':
        return await actionSaveRedemptionItem(OPENID, event)
      default:
        return fail('未知操作')
    }
  }
  try {
    return await dispatch()
  } catch (e) {
    // 数据库集合缺失时自动创建并重试一次，避免首次部署需要手动建库
    const errText = `${(e && e.message) || ''} ${(e && e.errCode) || ''} ${(e && e.code) || ''}`
    if (/collection not exist|collection_not_exist|-502005/i.test(errText)) {
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
