import { api, RedemptionItem } from '../../utils/api'

Page({
  data: {
    items: [] as any[],
    points: 0,
    loading: false,
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const [res, balance] = await Promise.all([
        api.listRedemptionItems(),
        api.listPointEntries({ page: 1, pageSize: 1 }),
      ])
      const items = res.items.map((it: RedemptionItem) => ({
        id: it._id,
        title: it.title,
        cover: (it.images || [])[0] || '',
        options: it.options || [],
      }))
      this.setData({ items, points: balance.points })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onTapItem(e: any) {
    wx.navigateTo({ url: `/pages/item-detail/item-detail?id=${e.currentTarget.dataset.id}` })
  },
})
