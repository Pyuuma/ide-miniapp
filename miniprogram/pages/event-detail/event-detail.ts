import { api, EventInfo } from '../../utils/api'
import { renderMarkdown } from '../../utils/markdown'
import { formatDateTime } from '../../utils/format'

Page({
  data: {
    id: '',
    event: null as EventInfo | null,
    html: '',
    myRegistrationId: '',
    registerState: 'open' as 'not_started' | 'open' | 'closed',
    registerWindowText: '',
    capacityText: '',
    submitting: false,
  },

  onLoad(options: any) {
    this.setData({ id: options.id || '' }, () => this.load())
  },

  async load() {
    try {
      const res = await api.getEvent(this.data.id)
      const e = res.event
      this.setData({
        event: e,
        html: renderMarkdown(e.contentMarkdown || ''),
        myRegistrationId: res.myRegistration ? res.myRegistration._id : '',
        registerState: e.registerState || 'open',
        registerWindowText:
          (e.registerStart ? formatDateTime(e.registerStart) : '发布后') +
          ' — ' +
          (e.registerDeadline ? formatDateTime(e.registerDeadline) : '赛事结束'),
        capacityText: e.capacity
          ? `${e.registrationCount}/${e.capacity} 人`
          : `${e.registrationCount} 人报名`,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onPreviewImage(e: any) {
    const event = this.data.event
    if (!event) return
    wx.previewImage({ urls: event.images, current: e.currentTarget.dataset.src })
  },

  async onRegister() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await api.registerEvent(this.data.id)
      wx.showToast({ title: '报名成功', icon: 'success' })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '报名失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onCancel() {
    if (this.data.submitting) return
    wx.showModal({
      title: '取消报名？',
      content: '取消后如需参加请重新报名。',
      success: res => {
        if (res.confirm) this.doCancel()
      },
    })
  },

  async doCancel() {
    this.setData({ submitting: true })
    try {
      await api.cancelEventRegistration(this.data.myRegistrationId)
      wx.showToast({ title: '已取消', icon: 'success' })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '取消失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
