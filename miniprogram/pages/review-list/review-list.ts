import { api } from '../../utils/api'
import { formatDateTime } from '../../utils/format'

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书',
  dianping: '大众点评',
}

const STATUS_TEXT: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

Page({
  data: {
    items: [] as any[],
  },

  onShow() {
    this.load()
  },

  async load() {
    try {
      const res = await api.listMyReviews()
      const items = res.items.map((it: any) => ({
        ...it,
        platformName: PLATFORM_NAMES[it.platform] || it.platform,
        statusText: STATUS_TEXT[it.status] || it.status,
        timeText: formatDateTime(it.createdAt),
        rejectText: it.status === 'rejected' ? it.rejectReason : '',
        specialText: it.isSpecial ? '（特别录入）' : '',
      }))
      this.setData({ items })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  previewImage(e: any) {
    const urls = e.currentTarget.dataset.urls as string[]
    const current = e.currentTarget.dataset.current as string
    wx.previewImage({ urls, current })
  },
})
