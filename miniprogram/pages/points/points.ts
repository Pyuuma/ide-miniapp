import { api, HonorEntry, PointEntry } from '../../utils/api'
import { updateMemberBalances } from '../../utils/session'
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

  pointsRequest: 0,
  honorRequest: 0,
  balanceRequest: 0,

  onShow() {
    syncTabBar(this)
    this.refreshCurrentTab()
  },

  refreshCurrentTab() {
    return this.data.tab === 'honor' ? this.loadHonor(true) : this.load(true)
  },

  onPullDownRefresh() {
    this.refreshCurrentTab().finally(() => wx.stopPullDownRefresh())
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
    if (tab === this.data.tab) return
    this.setData({ tab }, () => this.refreshCurrentTab())
  },

  async load(reset: boolean) {
    if (this.data.loading && !reset) return
    const request = ++this.pointsRequest
    const balanceRequest = ++this.balanceRequest
    this.setData({ loading: true })
    try {
      const page = reset ? 1 : this.data.page + 1
      const res = await api.listPointEntries({
        page,
        pageSize: 20,
        sourceType: this.data.sourceType,
      })
      if (request !== this.pointsRequest) return
      const items = res.entries.map((e: PointEntry) => this.toViewItem(e))
      this.syncBalances(res, balanceRequest)
      this.setData({
        items: reset ? items : this.data.items.concat(items),
        page,
        hasMore: page * res.pageSize < res.total,
      })
    } catch (e: any) {
      if (request === this.pointsRequest) wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      if (request === this.pointsRequest) this.setData({ loading: false })
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
    if (this.data.honorLoading && !reset) return
    const request = ++this.honorRequest
    const balanceRequest = ++this.balanceRequest
    this.setData({ honorLoading: true })
    try {
      const page = reset ? 1 : this.data.honorPage + 1
      const res = await api.listHonorEntries({ page, pageSize: 20 })
      if (request !== this.honorRequest) return
      const items = res.entries.map((e: HonorEntry) => this.toHonorViewItem(e))
      this.syncBalances(res, balanceRequest)
      this.setData({
        honorItems: reset ? items : this.data.honorItems.concat(items),
        honorPage: page,
        honorHasMore: page * res.pageSize < res.total,
      })
    } catch (e: any) {
      if (request === this.honorRequest) wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      if (request === this.honorRequest) this.setData({ honorLoading: false })
    }
  },

  syncBalances(balances: { points: number; growth: number; honor: number; level: string; levelName: string }, request: number) {
    // 两个明细接口可能交错返回，仅最新发出的请求更新共享余额。
    if (request !== this.balanceRequest) return
    this.setData({ points: balances.points, growth: balances.growth, honor: balances.honor, levelName: balances.levelName })
    updateMemberBalances(balances)
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
