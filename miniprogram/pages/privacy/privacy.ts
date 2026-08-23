import { api } from '../../utils/api'

Page({
  data: {
    text: '',
  },

  onLoad() {
    this.load()
  },

  async load() {
    try {
      const config = await api.getConfig()
      this.setData({ text: config.privacyText })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
})
