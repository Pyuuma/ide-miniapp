import { api } from '../../../utils/api'
import { formatDateTime, timeAgo } from '../../../utils/format'

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书',
  dianping: '大众点评',
}

Page({
  data: {
    tab: 'pending',
    items: [] as any[],
    loading: false,
    panel: null as null | { type: 'approve' | 'reject'; id: string; special: boolean },
    reason: '',
    specialReason: '',
    submitting: false,
  },

  onShow() {
    this.load()
  },

  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab as string
    this.setData({ tab }, () => this.load())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const status = this.data.tab === 'pending' ? 'pending' : 'all'
      const res = await api.listReviewSubmissions(status)
      const items = res.items
        .filter((it: any) => (this.data.tab === 'pending' ? it.status === 'pending' : it.status !== 'pending'))
        .map((it: any) => this.toViewItem(it))
      this.setData({ items })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  toViewItem(it: any) {
    const lastApproved = it.history && it.history.length ? it.history[0] : null
    const historyText = lastApproved
      ? `最近通过：${formatDateTime(lastApproved.createdAt)}（${timeAgo(lastApproved.createdAt)}）`
      : '该会员此平台暂无历史通过记录'
    const usageText = `本月已通过 ${it.monthUsage.used} / ${it.monthUsage.max} 次`
    return {
      ...it,
      platformName: it.platformName || PLATFORM_NAMES[it.platform] || it.platform,
      memberName: it.member ? `${it.member.nickname} @${it.member.accountName}` : '未知会员',
      timeText: formatDateTime(it.createdAt),
      statusText: it.status === 'approved' ? '已通过' : it.status === 'rejected' ? '已拒绝' : '待审核',
      historyText,
      usageText,
      willOver: it.monthUsage.used >= it.monthUsage.max,
      specialText: it.isSpecial ? '特别录入' : '',
    }
  },

  openApprove(e: any) {
    const id = e.currentTarget.dataset.id as string
    const item = this.data.items.find((i: any) => i._id === id)
    if (!item) return
    if (item.willOver) {
      this.setData({ panel: { type: 'approve', id, special: true }, specialReason: '' })
    } else {
      wx.showModal({
        title: '确认通过？',
        content: `将为该会员增加 ${item.monthUsage.points} 分`,
        success: res => {
          if (res.confirm) this.doApprove(id, '')
        },
      })
    }
  },

  openReject(e: any) {
    const id = e.currentTarget.dataset.id as string
    this.setData({ panel: { type: 'reject', id, special: false }, reason: '' })
  },

  closePanel() {
    this.setData({ panel: null })
  },

  onReasonInput(e: any) {
    this.setData({ reason: e.detail.value })
  },

  onSpecialReasonInput(e: any) {
    this.setData({ specialReason: e.detail.value })
  },

  onPanelConfirm() {
    const panel = this.data.panel
    if (!panel) return
    if (panel.type === 'approve') {
      const reason = this.data.specialReason.trim()
      if (panel.special && !reason) {
        wx.showToast({ title: '请填写特别录入原因', icon: 'none' })
        return
      }
      this.doApprove(panel.id, reason)
    } else {
      const reason = this.data.reason.trim()
      if (!reason) {
        wx.showToast({ title: '拒绝原因必填', icon: 'none' })
        return
      }
      this.doReject(panel.id, reason)
    }
  },

  async doApprove(id: string, specialReason: string) {
    this.setData({ submitting: true })
    try {
      await api.reviewAction({ id, subAction: 'approve', specialReason })
      wx.showToast({ title: '已通过', icon: 'success' })
      this.setData({ panel: null })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async doReject(id: string, reason: string) {
    this.setData({ submitting: true })
    try {
      await api.reviewAction({ id, subAction: 'reject', reason })
      wx.showToast({ title: '已拒绝', icon: 'none' })
      this.setData({ panel: null })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  previewImage(e: any) {
    const urls = e.currentTarget.dataset.urls as string[]
    const current = e.currentTarget.dataset.current as string
    wx.previewImage({ urls, current })
  },

  noop() {},
})
