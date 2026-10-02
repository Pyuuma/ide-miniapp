import { AdminCandidate, api, EditableConfig, SuperAdminEntry } from '../../../utils/api'
import { getSession } from '../../../utils/session'

const WEEKDAY_OPTIONS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
]

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书',
  dianping: '大众点评',
}

interface AdminRow {
  openid: string
  label: string
}

Page({
  data: {
    loading: true,
    savingConfig: false,
    savingAdmins: false,
    showDiff: false,
    diffLines: [] as string[],

    storeName: '',
    storeContact: '',

    nextKey: 1,
    tiers: [] as Array<{
      key: number
      id: string
      name: string
      points: string
      defaultAmount: string
    }>,

    period: 'week',
    periodIndex: 0,
    periodOptions: [
      { id: 'week', name: '按周' },
      { id: 'month', name: '按月' },
    ],
    resetDay: '',
    resetDayIndex: 1,
    weekOptions: WEEKDAY_OPTIONS,
    resetHour: '',
    maxCount: '',

    memberDayEnabled: false,
    memberDayLabel: '',
    memberDayPoints: '',
    weekdays: WEEKDAY_OPTIONS.map(w => ({ ...w, on: false })),

    reviews: [] as Array<{
      key: number
      platform: string
      name: string
      points: string
      period: string
      maxCount: string
    }>,

    levels: [] as Array<{ key: number; id: string; name: string; minPoints: string }>,

    topCount: '',
    aroundCount: '',

    privacyText: '',

    admins: [] as AdminRow[],
    adminQuery: '',
    candidates: [] as AdminCandidate[],
    showCandidates: false,
    searchingAdmin: false,
    superAdmins: [] as AdminRow[],
  },

  originalConfig: null as EditableConfig | null,
  pendingConfig: null as EditableConfig | null,

  onLoad() {
    const session = getSession()
    if (!session || !session.isSuperAdmin) {
      wx.showToast({ title: '需要超级管理员权限', icon: 'none' })
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    wx.showLoading({ title: '加载中' })
    try {
      const res = await api.getSuperConsole()
      const config = res.config
      const limit = config.consumptionLimit || ({} as any)
      const memberDay = config.memberDayBonus || ({} as any)
      const leaderboard = config.leaderboard || ({} as any)
      let key = 1
      this.setData({
        storeName: (config.storeInfo && config.storeInfo.name) || '',
        storeContact: (config.storeInfo && config.storeInfo.contact) || '',
        tiers: (config.pointTiers || []).map(t => ({
          key: key++,
          id: t.id,
          name: t.name,
          points: String(t.points),
          defaultAmount: String(t.defaultAmount),
        })),
        period: limit.period === 'month' ? 'month' : 'week',
        periodIndex: limit.period === 'month' ? 1 : 0,
        resetDay: String(limit.resetDay == null ? 1 : limit.resetDay),
        resetDayIndex: Number(limit.resetDay == null ? 1 : limit.resetDay),
        resetHour: String(limit.resetHour == null ? 4 : limit.resetHour),
        maxCount: String(limit.maxCount == null ? 4 : limit.maxCount),
        memberDayEnabled: !!memberDay.enabled,
        memberDayLabel: memberDay.label || '会员日',
        memberDayPoints: String(memberDay.points == null ? 1 : memberDay.points),
        weekdays: WEEKDAY_OPTIONS.map(w => ({
          ...w,
          on: (memberDay.weekdays || []).indexOf(w.value) >= 0,
        })),
        reviews: (config.reviewBonuses || []).map(r => ({
          key: key++,
          platform: r.platform,
          name: r.name || PLATFORM_NAMES[r.platform] || r.platform,
          points: String(r.points),
          period: r.period === 'week' ? 'week' : 'month',
          maxCount: String(r.maxCount),
        })),
        levels: (config.levelThresholds || []).map(l => ({
          key: key++,
          id: l.id,
          name: l.name,
          minPoints: String(l.minPoints),
        })),
        topCount: String(leaderboard.topCount == null ? 20 : leaderboard.topCount),
        aroundCount: String(leaderboard.aroundCount == null ? 5 : leaderboard.aroundCount),
        privacyText: config.privacyText || '',
        nextKey: key,
        admins: res.admins.map(toAdminRow),
        superAdmins: res.superAdmins.map(toAdminRow),
      })
      this.originalConfig = this.buildConfig()
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  },

  // ---------- 门店信息 ----------
  onStoreNameInput(e: any) {
    this.setData({ storeName: e.detail.value })
  },

  onStoreContactInput(e: any) {
    this.setData({ storeContact: e.detail.value })
  },

  // ---------- 消费档位 ----------
  onTierNameInput(e: any) {
    this.updateRow('tiers', e.currentTarget.dataset.index, { name: e.detail.value })
  },

  onTierPointsInput(e: any) {
    this.updateRow('tiers', e.currentTarget.dataset.index, { points: e.detail.value })
  },

  onTierAmountInput(e: any) {
    this.updateRow('tiers', e.currentTarget.dataset.index, { defaultAmount: e.detail.value })
  },

  addTier() {
    const tiers = this.data.tiers.concat({
      key: this.data.nextKey,
      id: '',
      name: '',
      points: '0',
      defaultAmount: '0',
    })
    this.setData({ tiers, nextKey: this.data.nextKey + 1 })
  },

  removeTier(e: any) {
    const index = e.currentTarget.dataset.index as number
    const tiers = this.data.tiers.slice()
    tiers.splice(index, 1)
    this.setData({ tiers })
  },

  // ---------- 周期限制 ----------
  onPeriodChange(e: any) {
    const index = Number(e.detail.value)
    this.setData({ periodIndex: index, period: index === 1 ? 'month' : 'week' })
  },

  onResetDayChange(e: any) {
    const index = Number(e.detail.value)
    this.setData({ resetDayIndex: index, resetDay: String(index) })
  },

  onResetHourInput(e: any) {
    this.setData({ resetHour: e.detail.value })
  },

  onMaxCountInput(e: any) {
    this.setData({ maxCount: e.detail.value })
  },

  // ---------- 会员日 ----------
  onMemberDayToggle(e: any) {
    this.setData({ memberDayEnabled: !!e.detail.value })
  },

  onMemberDayLabelInput(e: any) {
    this.setData({ memberDayLabel: e.detail.value })
  },

  onMemberDayPointsInput(e: any) {
    this.setData({ memberDayPoints: e.detail.value })
  },

  toggleWeekday(e: any) {
    const value = Number(e.currentTarget.dataset.value)
    const weekdays = this.data.weekdays.map(w => (w.value === value ? { ...w, on: !w.on } : w))
    this.setData({ weekdays })
  },

  // ---------- 评论加分 ----------
  onReviewNameInput(e: any) {
    this.updateRow('reviews', e.currentTarget.dataset.index, { name: e.detail.value })
  },

  onReviewPointsInput(e: any) {
    this.updateRow('reviews', e.currentTarget.dataset.index, { points: e.detail.value })
  },

  onReviewMaxInput(e: any) {
    this.updateRow('reviews', e.currentTarget.dataset.index, { maxCount: e.detail.value })
  },

  onReviewPeriodTap(e: any) {
    const index = Number(e.currentTarget.dataset.index)
    const period = e.currentTarget.dataset.period === 'week' ? 'week' : 'month'
    this.updateRow('reviews', index, { period })
  },

  addReview() {
    const reviews = this.data.reviews.concat({
      key: this.data.nextKey,
      platform: '',
      name: '',
      points: '0',
      period: 'month',
      maxCount: '1',
    })
    this.setData({ reviews, nextKey: this.data.nextKey + 1 })
  },

  removeReview(e: any) {
    const index = Number(e.currentTarget.dataset.index)
    const reviews = this.data.reviews.slice()
    reviews.splice(index, 1)
    this.setData({ reviews })
  },

  // ---------- 等级门槛 ----------
  onLevelNameInput(e: any) {
    this.updateRow('levels', e.currentTarget.dataset.index, { name: e.detail.value })
  },

  onLevelMinInput(e: any) {
    this.updateRow('levels', e.currentTarget.dataset.index, { minPoints: e.detail.value })
  },

  addLevel() {
    const levels = this.data.levels.concat({
      key: this.data.nextKey,
      id: '',
      name: '',
      minPoints: '0',
    })
    this.setData({ levels, nextKey: this.data.nextKey + 1 })
  },

  removeLevel(e: any) {
    const index = e.currentTarget.dataset.index as number
    const levels = this.data.levels.slice()
    levels.splice(index, 1)
    this.setData({ levels })
  },

  // ---------- 排行榜 ----------
  onTopCountInput(e: any) {
    this.setData({ topCount: e.detail.value })
  },

  onAroundCountInput(e: any) {
    this.setData({ aroundCount: e.detail.value })
  },

  // ---------- 隐私文案 ----------
  onPrivacyInput(e: any) {
    this.setData({ privacyText: e.detail.value })
  },

  updateRow(key: 'tiers' | 'reviews' | 'levels', index: number, patch: Record<string, unknown>) {
    const list = (this.data as any)[key].slice()
    list[index] = { ...list[index], ...patch }
    this.setData({ [key]: list } as any)
  },

  buildConfig(): EditableConfig {
    return {
      storeInfo: { name: this.data.storeName.trim(), contact: this.data.storeContact.trim() },
      pointTiers: this.data.tiers.map(t => ({
        id: t.id,
        name: t.name.trim(),
        points: Number(t.points),
        defaultAmount: Number(t.defaultAmount),
      })),
      consumptionLimit: {
        period: this.data.period,
        resetDay: Number(this.data.resetDay),
        resetHour: Number(this.data.resetHour),
        maxCount: Number(this.data.maxCount),
      },
      memberDayBonus: {
        enabled: this.data.memberDayEnabled,
        label: this.data.memberDayLabel.trim(),
        weekdays: this.data.weekdays.filter(w => w.on).map(w => w.value),
        points: Number(this.data.memberDayPoints),
      },
      reviewBonuses: this.data.reviews.map(r => ({
        platform: r.platform,
        name: r.name.trim(),
        points: Number(r.points),
        period: r.period,
        maxCount: Number(r.maxCount),
      })),
      levelThresholds: this.data.levels.map(l => ({
        id: l.id,
        name: l.name.trim(),
        minPoints: Number(l.minPoints),
      })),
      leaderboard: {
        topCount: Number(this.data.topCount),
        aroundCount: Number(this.data.aroundCount),
      },
      privacyText: this.data.privacyText.trim(),
    }
  },

  onSaveConfig() {
    if (this.data.savingConfig) return
    const config = this.buildConfig()
    const diff = diffConfig(this.originalConfig, config)
    if (!diff.length) {
      wx.showToast({ title: '没有需要保存的修改', icon: 'none' })
      return
    }
    this.pendingConfig = config
    this.setData({ showDiff: true, diffLines: diff })
  },

  closeDiff() {
    this.pendingConfig = null
    this.setData({ showDiff: false, diffLines: [] })
  },

  confirmSave() {
    const config = this.pendingConfig
    if (!config) return
    this.closeDiff()
    this.doSaveConfig(config)
  },

  noop() {},

  async doSaveConfig(config: EditableConfig) {
    this.setData({ savingConfig: true })
    try {
      await api.saveSuperConfig(config)
      wx.showToast({ title: '配置已保存', icon: 'success' })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ savingConfig: false })
    }
  },

  // ---------- 管理员名单 ----------
  onAdminQueryInput(e: any) {
    const adminQuery = e.detail.value
    this.setData({
      adminQuery,
      candidates: adminQuery.trim() ? this.data.candidates : [],
      showCandidates: adminQuery.trim() ? this.data.showCandidates : false,
    })
  },

  async searchAdmins() {
    const q = this.data.adminQuery.trim()
    if (!q) {
      wx.showToast({ title: '请输入账号 ID / 账号名 / openid', icon: 'none' })
      return
    }
    this.setData({ searchingAdmin: true })
    try {
      const res = await api.searchAdminCandidates(q)
      this.setData({ candidates: res.items, showCandidates: true })
      if (!res.items.length) wx.showToast({ title: '没有匹配的会员', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ searchingAdmin: false })
    }
  },

  pickCandidate(e: any) {
    const index = Number(e.currentTarget.dataset.index)
    const candidate = this.data.candidates[index]
    if (!candidate) return
    if (candidate.isSuperAdmin) {
      wx.showToast({ title: '该会员已是超级管理员', icon: 'none' })
      return
    }
    if (this.data.admins.some(a => a.openid === candidate.openid)) {
      wx.showToast({ title: '该会员已在管理员名单中', icon: 'none' })
      return
    }
    const admins = this.data.admins.concat({
      openid: candidate.openid,
      label: `${candidate.nickname || '未命名'} @${candidate.accountName || '-'}`,
    })
    this.setData({ admins, candidates: [], showCandidates: false, adminQuery: '' })
  },

  closeCandidates() {
    this.setData({ showCandidates: false, candidates: [] })
  },

  removeAdmin(e: any) {
    const index = e.currentTarget.dataset.index as number
    const admins = this.data.admins.slice()
    admins.splice(index, 1)
    this.setData({ admins })
  },

  async onSaveAdmins() {
    if (this.data.savingAdmins) return
    this.setData({ savingAdmins: true })
    try {
      await api.saveAdmins(this.data.admins.map(a => a.openid))
      wx.showToast({ title: '管理员名单已保存', icon: 'success' })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ savingAdmins: false })
    }
  },

  copyOpenid(e: any) {
    wx.setClipboardData({ data: e.currentTarget.dataset.openid })
  },
})

function toAdminRow(entry: SuperAdminEntry): AdminRow {
  const member = entry.member
  const label = member ? `${member.nickname} @${member.accountName}` : '未注册/未登录过'
  return { openid: entry.openid, label }
}

function weekdayLabel(value: number): string {
  const hit = WEEKDAY_OPTIONS.find(w => w.value === value)
  return hit ? hit.label : String(value)
}

function formatTiers(tiers: EditableConfig['pointTiers']): string {
  if (!tiers.length) return '（空）'
  return tiers.map(t => `${t.name} ${t.points}分/¥${t.defaultAmount}`).join('、')
}

function formatLimit(limit: EditableConfig['consumptionLimit']): string {
  const period = limit.period === 'month' ? '按月' : '按周'
  const day = limit.period === 'month' ? '' : `${weekdayLabel(limit.resetDay)} `
  return `${period} ${day}${limit.resetHour} 点重置，上限 ${limit.maxCount} 次`
}

function formatMemberDay(rule: EditableConfig['memberDayBonus']): string {
  if (!rule.enabled) return '已关闭'
  const days = rule.weekdays.map(weekdayLabel).join('/') || '无默认日'
  return `${rule.label} 额外 +${rule.points}，默认 ${days}`
}

function formatReviews(list: EditableConfig['reviewBonuses']): string {
  if (!list.length) return '（空）'
  return list
    .map(
      r =>
        `${r.name || PLATFORM_NAMES[r.platform] || r.platform} ${r.points}分/${r.period === 'week' ? '周' : '月'}${r.maxCount}次`
    )
    .join('、')
}

function formatLevels(list: EditableConfig['levelThresholds']): string {
  if (!list.length) return '（空）'
  return list.map(l => `${l.name}≥${l.minPoints}`).join('、')
}

// 保存前生成「旧 → 新」的差异说明，交给用户确认
function diffConfig(before: EditableConfig | null, after: EditableConfig): string[] {
  if (!before) return ['首次保存配置']
  const lines: string[] = []
  const compare = (label: string, a: unknown, b: unknown, describe: () => string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) lines.push(`${label}：${describe()}`)
  }
  compare(
    '门店信息',
    before.storeInfo,
    after.storeInfo,
    () => `${before.storeInfo.name}／${before.storeInfo.contact} → ${after.storeInfo.name}／${after.storeInfo.contact}`
  )
  compare(
    '消费档位',
    before.pointTiers,
    after.pointTiers,
    () => `${formatTiers(before.pointTiers)} → ${formatTiers(after.pointTiers)}`
  )
  compare(
    '次数限制',
    before.consumptionLimit,
    after.consumptionLimit,
    () => `${formatLimit(before.consumptionLimit)} → ${formatLimit(after.consumptionLimit)}`
  )
  compare(
    '会员日',
    before.memberDayBonus,
    after.memberDayBonus,
    () => `${formatMemberDay(before.memberDayBonus)} → ${formatMemberDay(after.memberDayBonus)}`
  )
  compare(
    '评论加分',
    before.reviewBonuses,
    after.reviewBonuses,
    () => `${formatReviews(before.reviewBonuses)} → ${formatReviews(after.reviewBonuses)}`
  )
  compare(
    '等级门槛',
    before.levelThresholds,
    after.levelThresholds,
    () => `${formatLevels(before.levelThresholds)} → ${formatLevels(after.levelThresholds)}`
  )
  compare(
    '排行榜',
    before.leaderboard,
    after.leaderboard,
    () =>
      `TOP${before.leaderboard.topCount}／前后${before.leaderboard.aroundCount} → TOP${after.leaderboard.topCount}／前后${after.leaderboard.aroundCount}`
  )
  compare(
    '隐私文案',
    before.privacyText,
    after.privacyText,
    () => `长度 ${before.privacyText.length} → ${after.privacyText.length}`
  )
  return lines
}
