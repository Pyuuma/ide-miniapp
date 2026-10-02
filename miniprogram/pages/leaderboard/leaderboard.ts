import { api, LeaderboardData, LeaderboardEntry } from '../../utils/api'
import { getSession, setSession } from '../../utils/session'

type DisplayRow = LeaderboardEntry & { ellipsis?: boolean }

const TYPE_LABELS: Record<string, string> = {
  growth: '成长值',
  honor: '荣誉值',
}

Page({
  data: {
    type: 'growth' as 'growth' | 'honor',
    rows: [] as DisplayRow[],
    me: null as LeaderboardEntry | null,
    topCount: 20,
    aroundCount: 5,
    leaderboardAnon: false,
    showMeBar: false,
    loading: true,
    typeLabel: TYPE_LABELS.growth,
  },

  observer: null as any,

  onShow() {
    this.load()
  },

  onHide() {
    this.disconnectObserver()
  },

  onUnload() {
    this.disconnectObserver()
  },

  switchType(e: any) {
    const type = e.currentTarget.dataset.type as 'growth' | 'honor'
    if (type === this.data.type) return
    this.setData({ type, typeLabel: TYPE_LABELS[type] }, () => this.load())
  },

  async load() {
    this.disconnectObserver()
    this.setData({ loading: true, showMeBar: false })
    try {
      const res: LeaderboardData = await api.leaderboard(this.data.type)
      const rows = this.buildRows(res)
      this.setData(
        {
          rows,
          me: res.me,
          topCount: res.topCount,
          aroundCount: res.aroundCount,
          leaderboardAnon: res.leaderboardAnon,
        },
        () => this.setupObserver()
      )
      const session = getSession()
      if (session && session.member.leaderboardAnon !== res.leaderboardAnon) {
        session.member.leaderboardAnon = res.leaderboardAnon
        setSession(session)
      }
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 合并为单一榜单：TOP20 +（省略号）+ 前后各 N 名 +（省略号）
  buildRows(res: LeaderboardData): DisplayRow[] {
    const top = res.top || []
    const around = (res.around || []).slice().sort((a, b) => a.rank - b.rank)
    if (!res.me || res.me.rank <= res.topCount) {
      return top as DisplayRow[]
    }
    const seen = new Set<string>()
    const rows: DisplayRow[] = []
    top.forEach(item => {
      seen.add(item.id)
      rows.push(item as DisplayRow)
    })
    const lastTopRank = top.length ? top[top.length - 1].rank : 0
    const firstAroundRank = around.length ? around[0].rank : res.me.rank
    if (firstAroundRank > lastTopRank + 1) {
      rows.push({ id: 'ellipsis-before', rank: 0, nickname: '', accountName: '', growth: 0, honor: 0, value: 0, anonymous: false, isMe: false, ellipsis: true })
    }
    let lastShownRank = lastTopRank
    around.forEach(item => {
      if (seen.has(item.id)) return
      seen.add(item.id)
      rows.push(item as DisplayRow)
      lastShownRank = item.rank
    })
    if (!around.length) lastShownRank = res.me.rank
    if (lastShownRank < res.total) {
      rows.push({ id: 'ellipsis-after', rank: 0, nickname: '', accountName: '', growth: 0, honor: 0, value: 0, anonymous: false, isMe: false, ellipsis: true })
    }
    return rows
  },

  setupObserver() {
    if (!this.data.rows.some(r => r.isMe)) return
    this.observer = wx.createIntersectionObserver(this)
    this.observer.relativeToViewport().observe('#meRow', (res: any) => {
      // 自己的行滚出视口时，底部固定展示；在视口内则正常显示在榜单里
      this.setData({ showMeBar: !res.intersectionRatio })
    })
  },

  disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  },

  onTapMeBar() {
    wx.pageScrollTo({ selector: '#meRow', duration: 300 })
  },

  onGoProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },
})
