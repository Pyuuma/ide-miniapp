import { api, RedemptionItem } from '../../../utils/api'

Page({
  data: {
    items: [] as any[],
    loading: false,
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await api.listAdminRedemptionItems()
      const items = res.items.map((it: RedemptionItem) => ({
        id: it._id,
        title: it.title,
        cover: (it.images || [])[0] || '',
        statusText: it.status === 'on' ? '上架中' : '已下架',
        optionText: `${(it.options || []).length} 个选项`,
      }))
      this.setData({ items })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/admin/item-edit/item-edit' })
  },

  onEdit(e: any) {
    wx.navigateTo({ url: `/pages/admin/item-edit/item-edit?id=${e.currentTarget.dataset.id}` })
  },
})
