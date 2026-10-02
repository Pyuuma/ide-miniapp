import { api } from '../../../utils/api'
import { getSession } from '../../../utils/session'

Page({
  data: {
    pendingCount: 0,
    loading: true,
  },

  onShow() {
    this.bootstrap()
  },

  async bootstrap() {
    const session = getSession()
    if (!session || !session.isAdmin) {
      wx.showToast({ title: '需要管理员权限', icon: 'none' })
      wx.navigateBack({
        fail: () => wx.reLaunch({ url: '/pages/index/index' }),
      })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await api.listReviewSubmissions('pending')
      this.setData({ pendingCount: res.items.length })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goScan() {
    wx.navigateTo({ url: '/pages/admin/scan/scan' })
  },

  goReview() {
    wx.navigateTo({ url: '/pages/admin/review/review' })
  },

  goAudit() {
    wx.navigateTo({ url: '/pages/admin/audit/audit' })
  },

  goAdjust() {
    wx.navigateTo({ url: '/pages/admin/adjust/adjust' })
  },

  goEvents() {
    wx.navigateTo({ url: '/pages/admin/event-list/event-list' })
  },

  goItems() {
    wx.navigateTo({ url: '/pages/admin/item-list/item-list' })
  },
})
