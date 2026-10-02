import { api } from '../../../utils/api'
import { formatDateTime } from '../../../utils/format'

Page({
  data: {
    eventId: '',
    eventTitle: '',
    total: 0,
    capacityText: '',
    items: [] as any[],
    selectAll: false,
    showAward: false,
    uniform: '',
    awardItems: [] as any[],
    note: '',
    submitting: false,
    memberQ: '',
    memberResults: [] as any[],
    showMemberPicker: false,
  },

  onLoad(options: any) {
    this.setData({ eventId: options.id || '' }, () => this.load())
  },

  async load() {
    try {
      const res = await api.listEventRoster(this.data.eventId)
      const items = res.items.map(it => ({
        registrationId: it.registrationId,
        memberId: it.member.id,
        nickname: it.member.nickname,
        accountName: it.member.accountName,
        honor: it.member.honor,
        timeText: formatDateTime(it.createdAt),
        selected: false,
      }))
      this.setData({
        eventTitle: res.event.title,
        total: res.total,
        capacityText: res.event.capacity ? ` / ${res.event.capacity}` : '',
        items,
        selectAll: false,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  toggleSelect(e: any) {
    const registrationId = e.currentTarget.dataset.id as string
    const items = this.data.items.map((it: any) =>
      it.registrationId === registrationId ? { ...it, selected: !it.selected } : it
    )
    this.setData({ items, selectAll: items.every((it: any) => it.selected) })
  },

  toggleSelectAll() {
    const selectAll = !this.data.selectAll
    const items = this.data.items.map((it: any) => ({ ...it, selected: selectAll }))
    this.setData({ items, selectAll })
  },

  openAward() {
    const selected = this.data.items.filter((it: any) => it.selected)
    if (!selected.length) {
      wx.showToast({ title: '请先勾选会员', icon: 'none' })
      return
    }
    const awardItems = selected.map((it: any) => ({
      memberId: it.memberId,
      nickname: it.nickname,
      honor: '',
    }))
    this.setData({ showAward: true, awardItems, uniform: '', note: '' })
  },

  closeAward() {
    this.setData({ showAward: false })
  },

  onUniformInput(e: any) {
    const uniform = e.detail.value
    const awardItems = this.data.awardItems.map((it: any) => ({ ...it, honor: uniform }))
    this.setData({ uniform, awardItems })
  },

  onAwardItemInput(e: any) {
    const index = e.currentTarget.dataset.index as number
    const awardItems = this.data.awardItems.slice()
    awardItems[index] = { ...awardItems[index], honor: e.detail.value }
    this.setData({ awardItems })
  },

  onNoteInput(e: any) {
    this.setData({ note: e.detail.value })
  },

  async submitAward() {
    if (this.data.submitting) return
    const items = this.data.awardItems.map((it: any) => ({
      memberId: it.memberId,
      honor: Number(it.honor),
    }))
    if (items.some(it => !it.honor || it.honor <= 0)) {
      wx.showToast({ title: '每位会员的荣誉值必须是正整数', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const res = await api.awardEventHonor({
        eventId: this.data.eventId,
        items,
        note: this.data.note,
      })
      wx.showToast({ title: `已为 ${res.count} 人发放`, icon: 'success' })
      this.setData({ showAward: false })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '发放失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onMemberSearchInput(e: any) {
    this.setData({ memberQ: e.detail.value })
  },

  openMemberPicker() {
    this.setData({ showMemberPicker: true, memberResults: [], memberQ: '' })
  },

  async onMemberSearch() {
    if (!this.data.memberQ.trim()) return
    try {
      const res = await api.findMembers(this.data.memberQ.trim())
      this.setData({ memberResults: res.members, showMemberPicker: true })
    } catch (e: any) {
      wx.showToast({ title: e.message || '搜索失败', icon: 'none' })
    }
  },

  async pickMember(e: any) {
    const memberId = e.currentTarget.dataset.id as string
    this.setData({ submitting: true })
    try {
      await api.addEventRegistration(this.data.eventId, memberId)
      wx.showToast({ title: '已补录', icon: 'success' })
      this.setData({ showMemberPicker: false, memberResults: [], memberQ: '' })
      this.load()
    } catch (err: any) {
      wx.showToast({ title: err.message || '补录失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  closeMemberPicker() {
    this.setData({ showMemberPicker: false, memberResults: [] })
  },

  onRemove(e: any) {
    const registrationId = e.currentTarget.dataset.id as string
    wx.showModal({
      title: '移除名单？',
      content: '移除后该会员需重新报名或由管理员补录。',
      success: res => {
        if (res.confirm) this.doRemove(registrationId)
      },
    })
  },

  async doRemove(registrationId: string) {
    this.setData({ submitting: true })
    try {
      await api.removeEventRegistration(registrationId)
      wx.showToast({ title: '已移除', icon: 'success' })
      this.load()
    } catch (e: any) {
      wx.showToast({ title: e.message || '移除失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  noop() {},
})
