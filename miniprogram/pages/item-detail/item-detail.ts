import { api, RedemptionItem } from '../../utils/api'
import { renderMarkdown } from '../../utils/markdown'

Page({
  data: {
    id: '',
    item: null as RedemptionItem | null,
    html: '',
    contact: '',
    submitting: false,
  },

  onLoad(options: any) {
    this.setData({ id: options.id || '' }, () => this.load())
  },

  async load() {
    try {
      const res = await api.getRedemptionItem(this.data.id)
      this.setData({
        item: res.item,
        html: renderMarkdown(res.item.contentMarkdown || ''),
        contact: res.contact,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onPreviewImage(e: any) {
    const item = this.data.item
    if (!item) return
    wx.previewImage({ urls: item.images, current: e.currentTarget.dataset.src })
  },

  onTapOption(e: any) {
    const index = e.currentTarget.dataset.index as number
    const item = this.data.item
    if (!item) return
    const option = item.options[index]
    if (!option) return
    wx.showModal({
      title: '联系工作人员兑换',
      content: `「${item.title} · ${option.name}」需 ${option.points} 积分。请直接联系工作人员完成兑换：${this.data.contact || '店铺工作人员'}`,
      confirmText: '复制联系方式',
      cancelText: '知道了',
      success: res => {
        if (res.confirm && this.data.contact) {
          wx.setClipboardData({ data: this.data.contact })
        }
      },
    })
  },
})
