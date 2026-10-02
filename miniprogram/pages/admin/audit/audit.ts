import { api, AuditLogItem } from '../../../utils/api'
import { formatDateTime } from '../../../utils/format'

const ACTION_LABELS: Record<string, string> = {
  consumption_entry: '消费录入',
  review_approve: '评论审核通过',
  review_reject: '评论审核拒绝',
  account_rename: '账号名设置',
  manual_adjust: '手动调整',
  redeem_points: '积分兑换',
  event_award: '赛事荣誉发放',
  event_roster_add: '赛事补录',
  event_roster_remove: '赛事移除',
  event_save: '赛事保存',
  event_delete: '赛事删除',
  redemption_item_save: '商品保存',
}

const CHANGE_OPTIONS = [
  { id: 'all', name: '全部类型' },
  { id: 'points_increase', name: '积分增加' },
  { id: 'points_decrease', name: '积分扣减' },
  { id: 'growth_increase', name: '成长值增加' },
  { id: 'honor_increase', name: '荣誉值增加' },
  { id: 'none', name: '无积分变动' },
]

const TIME_OPTIONS = [
  { id: 'all', name: '全部时间' },
  { id: '7d', name: '近 7 天' },
  { id: '30d', name: '近 30 天' },
]

Page({
  data: {
    items: [] as any[],
    weekStats: { total: 0, special: 0, ratio: 0 },
    page: 1,
    hasMore: true,
    loading: false,
    changeOptions: CHANGE_OPTIONS,
    timeOptions: TIME_OPTIONS,
    changeType: 'all',
    timeRange: 'all',
    actorId: '',
    memberLabel: '',
    memberId: '',
    memberQ: '',
    memberResults: [] as any[],
    showMemberPicker: false,
  },

  onShow() {
    this.load(true)
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(false)
  },

  async load(reset: boolean) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const page = reset ? 1 : this.data.page + 1
      const res = await api.listAuditLogs({
        targetMemberId: this.data.memberId || undefined,
        actorId: this.data.actorId || undefined,
        changeType: this.data.changeType,
        timeRange: this.data.timeRange,
        page,
        pageSize: 20,
      })
      const items = res.items.map((it: AuditLogItem) => ({
        id: it._id,
        actionText: ACTION_LABELS[it.actionType] || it.actionType,
        actorText: it.actorNickname || it.actorId,
        targetText: it.targetMemberNickname || it.targetMemberId || '—',
        deltaText: it.delta > 0 ? `+${it.delta}` : it.delta === 0 ? '—' : String(it.delta),
        changeText: (() => {
          const ct = it.changeType
          if (ct === 'points_decrease') return '积分扣减'
          if (ct.includes('honor_increase') && ct.includes('points_increase') && ct.includes('growth_increase')) {
            return '积分+成长值+荣誉值增加'
          }
          if (ct.includes('honor_increase') && ct.includes('growth_increase')) return '成长值+荣誉值增加'
          if (ct.includes('honor_increase') && ct.includes('points_increase')) return '积分+荣誉值增加'
          if (ct.includes('honor_increase')) return '荣誉值增加'
          if (ct.includes('points_increase') && ct.includes('growth_increase')) return '积分+成长值增加'
          if (ct.includes('points_increase')) return '积分增加'
          if (ct.includes('growth_increase')) return '成长值增加'
          return '无变动'
        })(),
        growthText: it.growthDelta ? `成长值 +${it.growthDelta}` : '',
        honorText: it.honorDelta ? `荣誉值 +${it.honorDelta}` : '',
        reason: it.reason || '',
        special: it.specialFlag ? '特别录入' : '',
        timeText: formatDateTime(it.createdAt),
      }))
      this.setData({
        items: reset ? items : this.data.items.concat(items),
        page,
        hasMore: page * res.pageSize < res.total,
        weekStats: res.weekStats,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onChangeType(e: any) {
    this.setData({ changeType: e.currentTarget.dataset.id }, () => this.load(true))
  },

  onTimeRange(e: any) {
    this.setData({ timeRange: e.currentTarget.dataset.id }, () => this.load(true))
  },

  onActorInput(e: any) {
    this.setData({ actorId: e.detail.value })
  },

  onApplyFilters() {
    this.load(true)
  },

  onResetFilters() {
    this.setData(
      {
        changeType: 'all',
        timeRange: 'all',
        actorId: '',
        memberLabel: '',
        memberId: '',
        memberQ: '',
        memberResults: [],
      },
      () => this.load(true)
    )
  },

  onMemberSearchInput(e: any) {
    this.setData({ memberQ: e.detail.value })
  },

  async onMemberSearch() {
    if (!this.data.memberQ.trim()) return
    try {
      const res = await api.findMembers(this.data.memberQ.trim())
      this.setData({ memberResults: res.members, showMemberPicker: true })
    } catch (e: any) {
      wx.showToast({ title: e.message || '搜索失败', icon: 'none' })
    }
  },

  pickMember(e: any) {
    const id = e.currentTarget.dataset.id as string
    const name = e.currentTarget.dataset.name as string
    this.setData(
      {
        memberId: id,
        memberLabel: name,
        showMemberPicker: false,
        memberResults: [],
      },
      () => this.load(true)
    )
  },

  closeMemberPicker() {
    this.setData({ showMemberPicker: false, memberResults: [] })
  },

  noop() {},
})
