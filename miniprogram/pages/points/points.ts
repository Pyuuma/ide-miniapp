import { api, HonorEntry, PointEntry } from '../../utils/api'
import { getSession, setSession } from '../../utils/session'
import { formatDateTime } from '../../utils/format'
import { syncTabBar } from '../../utils/tabbar'

interface PointViewItem {
  id: string
  deltaText: string
  sourceText: string
  growthText: string
  noteText: string
  balanceAfter: number
  timeText: string
}

interface HonorViewItem {
  id: string
  deltaText: string
  sourceText: string
  noteText: string
  timeText: string
}

const SOURCE_LABELS: Record<string, string> = {
  consumption: '消费积分',
  review_bonus: '评论加分',
  manual_adjust: '手动调整',
  redemption: '积分兑换',
}

const HONOR_SOURCE_LABELS: Record<string, string> = {
  event_award: '赛事发放',
  manual_adjust: '手动调整',
}

Page({
  data: {
    tab: 'points' as 'points' | 'honor',
    points: 0,
    growth: 0,
    honor: 0,
    levelName: '',
    items: [] as PointViewItem[],
    honorItems: [] as HonorViewItem[],
    sourceType: '',
    page: 1,
    hasMore: true,
    loading: false,
    honorPage: 1,
    honorHasMore: true,
    honorLoading: false,
  },

  onShow() {
    syncTabBar(this)
    this.load(true)
  },

  onPullDownRefresh() {
    Promise.all([this.load(true), this.loadHonor(true)]).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.tab === 'honor') {
      if (this.data.honorHasMore && !this.data.honorLoading) this.loadHonor(false)
    } else if (this.data.hasMore && !this.data.loading) {
      this.load(false)
    }
  },

  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab as 'points' | 'honor'
    this.setData({ tab }, () => {
      if (tab === 'honor' && !this.data.honorItems.length) this.loadHonor(true)
    })
  },

  async load(reset: boolean) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const page = reset ? 1 : this.data.page + 1
      const res = await api.listPointEntries({
        page,
        pageSize: 20,
        sourceType: this.data.sourceType,
      })
      const items = res.entries.map((e: PointEntry) => this.toViewItem(e))
      this.setData({
        points: res.points,
        growth: res.growth,
        honor: res.honor,
        levelName: res.levelName,
        items: reset ? items : this.data.items.concat(items),
        page,
        hasMore: page * res.pageSize < res.total,
      })
      const session = getSession()
      if (session && session.member.points !== res.points) {
        session.member.points = res.points
        session.member.growth = res.growth
        session.member.honor = res.honor
        session.member.levelName = res.levelName
        setSession(session)
      }
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  toViewItem(e: PointEntry): PointViewItem {
    return {
      id: e._id,
      deltaText: (e.pointsDelta !== undefined ? e.pointsDelta : e.delta) > 0
        ? `+${e.pointsDelta !== undefined ? e.pointsDelta : e.delta}`
        : String(e.pointsDelta !== undefined ? e.pointsDelta : e.delta),
      sourceText: SOURCE_LABELS[e.sourceType] || e.sourceType,
      growthText: (e.growthDelta !== undefined ? e.growthDelta : (e.sourceType === 'consumption' || e.sourceType === 'review_bonus' ? e.delta : 0)) > 0
        ? `成长值 +${e.growthDelta !== undefined ? e.growthDelta : (e.sourceType === 'consumption' || e.sourceType === 'review_bonus' ? e.delta : 0)}`
        : '',
      noteText: (e.detail || e.note || '').trim(),
      balanceAfter: e.balanceAfter,
      timeText: formatDateTime(e.createdAt),
    }
  },

  async loadHonor(reset: boolean) {
    if (this.data.honorLoading) return
    this.setData({ honorLoading: true })
    try {
      const page = reset ? 1 : this.data.honorPage + 1
      const res = await api.listHonorEntries({ page, pageSize: 20 })
      const items = res.entries.map((e: HonorEntry) => this.toHonorViewItem(e))
      this.setData({
        honor: res.honor,
        points: res.points,
        growth: res.growth,
        honorItems: reset ? items : this.data.honorItems.concat(items),
        honorPage: page,
        honorHasMore: page * res.pageSize < res.total,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ honorLoading: false })
    }
  },

  toHonorViewItem(e: HonorEntry): HonorViewItem {
    return {
      id: e._id,
      deltaText: e.honorDelta > 0 ? `+${e.honorDelta}` : String(e.honorDelta),
      sourceText: HONOR_SOURCE_LABELS[e.sourceType] || e.sourceType,
      noteText: (e.detail || e.note || '').trim(),
      timeText: formatDateTime(e.createdAt),
    }
  },

  onFilter(e: any) {
    const sourceType = e.currentTarget.dataset.type as string
    this.setData({ sourceType }, () => this.load(true))
  },

  onTapGrowth() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' })
  },

  onTapMall() {
    wx.navigateTo({ url: '/pages/mall/mall' })
  },
})
