import { api, PointEntry } from '../../utils/api'
import { getSession, setSession } from '../../utils/session'
import { formatDateTime } from '../../utils/format'

interface PointViewItem {
  id: string
  deltaText: string
  sourceText: string
  growthText: string
  noteText: string
  balanceAfter: number
  timeText: string
}

const SOURCE_LABELS: Record<string, string> = {
  consumption: '消费积分',
  review_bonus: '评论加分',
  manual_adjust: '手动调整',
  redemption: '积分兑换',
}

Page({
  data: {
    points: 0,
    growth: 0,
    levelName: '',
    items: [] as PointViewItem[],
    sourceType: '',
    page: 1,
    hasMore: true,
    loading: false,
  },

  onShow() {
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(false)
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
      levelName: res.levelName,
        items: reset ? items : this.data.items.concat(items),
        page,
        hasMore: page * res.pageSize < res.total,
      })
      const session = getSession()
      if (session && session.member.points !== res.points) {
        session.member.points = res.points
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

  onFilter(e: any) {
    const sourceType = e.currentTarget.dataset.type as string
    this.setData({ sourceType }, () => this.load(true))
  },

  onTapGrowth() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' })
  },
})
