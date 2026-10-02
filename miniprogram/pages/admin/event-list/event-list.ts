import { api, EventInfo } from '../../../utils/api'

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  ended: '已结束',
}

Page({
  data: {
    tab: 'all',
    items: [] as any[],
    loading: false,
  },

  onShow() {
    this.load()
  },

  switchTab(e: any) {
    this.setData({ tab: e.currentTarget.dataset.tab }, () => this.load())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await api.listAdminEvents()
      const items = res.items
        .filter((e: EventInfo) => (this.data.tab === 'all' ? true : e.status === this.data.tab))
        .map((e: EventInfo) => ({
          id: e._id,
          title: e.title,
          statusText: STATUS_LABELS[e.status] || e.status,
          status: e.status,
          countText: `${e.registrationCount} 人报名`,
        }))
      this.setData({ items })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/admin/event-edit/event-edit' })
  },

  onEdit(e: any) {
    wx.navigateTo({ url: `/pages/admin/event-edit/event-edit?id=${e.currentTarget.dataset.id}` })
  },

  onRoster(e: any) {
    wx.navigateTo({ url: `/pages/admin/event-roster/event-roster?id=${e.currentTarget.dataset.id}` })
  },
})
