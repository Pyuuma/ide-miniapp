import { api, EventInfo, EventRegistrationInfo } from '../../utils/api'
import { formatDate } from '../../utils/format'
import { syncTabBar } from '../../utils/tabbar'

// 其他页面用 switchTab 打开“活动”时，通过这个 key 指定默认分段
const OPEN_TAB_KEY = 'events_open_tab'

Page({
  data: {
    tab: 'all' as 'all' | 'mine',
    items: [] as any[],
    myItems: [] as any[],
    loading: false,
  },

  onShow() {
    syncTabBar(this)
    const wanted = wx.getStorageSync(OPEN_TAB_KEY)
    if (wanted === 'all' || wanted === 'mine') {
      wx.removeStorageSync(OPEN_TAB_KEY)
      this.setData({ tab: wanted })
    }
    this.load()
  },

  switchSegment(e: any) {
    const tab = e.currentTarget.dataset.tab as 'all' | 'mine'
    if (tab === this.data.tab) return
    this.setData({ tab })
  },

  goAll() {
    this.setData({ tab: 'all' })
  },

  async load() {
    this.setData({ loading: true })
    try {
      const [allRes, mineRes] = await Promise.all([
        api.listEvents(),
        api.listMyEventRegistrations(),
      ])
      const items = allRes.items.map((e: EventInfo) => ({
        id: e._id,
        title: e.title,
        cover: (e.images || [])[0] || '',
        statusText:
          e.status === 'ended'
            ? '已结束'
            : e.myRegistered
            ? '已报名'
            : e.registerState === 'not_started'
            ? '报名未开始'
            : e.registerState === 'closed'
            ? '报名已截止'
            : '报名中',
        windowText:
          (e.registerStart ? `报名 ${formatDate(e.registerStart)} 起` : '发布后即可报名') +
          (e.registerDeadline ? `，${formatDate(e.registerDeadline)} 截止` : ''),
        countText: e.capacity
          ? `已报名 ${e.registrationCount}/${e.capacity}`
          : `${e.registrationCount} 人报名`,
        ended: e.status === 'ended',
      }))
      const myItems = mineRes.items.map((it: EventRegistrationInfo) => {
        const unavailable = !!it.unavailable || ['published', 'ended'].indexOf(it.status) < 0
        return {
          registrationId: it.registrationId,
          eventId: it.eventId,
          unavailable,
          title: unavailable ? '赛事暂不可用' : it.title,
          cover: unavailable ? '' : it.cover,
          statusText: unavailable ? '暂不可用' : it.status === 'ended' ? '已结束' : '已报名',
          deadlineText: unavailable ? '请联系管理员了解报名安排' : it.registerDeadline ? `截止 ${formatDate(it.registerDeadline)}` : '报名中',
          countText: unavailable ? '' : it.capacity
            ? `已报名 ${it.registrationCount}/${it.capacity}`
            : `${it.registrationCount} 人报名`,
        }
      })
      this.setData({ items, myItems })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onTapItem(e: any) {
    if (e.currentTarget.dataset.unavailable) return
    wx.navigateTo({ url: `/pages/event-detail/event-detail?id=${e.currentTarget.dataset.id}` })
  },
})
