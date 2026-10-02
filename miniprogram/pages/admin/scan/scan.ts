import { api, ConsumptionUsage, MemberInfo, PointTier, StoreConfig } from '../../../utils/api'
import { formatDateTime } from '../../../utils/format'

Page({
  data: {
    mode: 'scan' as 'scan' | 'search',
    member: null as MemberInfo | null,
    usage: null as ConsumptionUsage | null,
    tiers: [] as PointTier[],
    selectedTier: null as PointTier | null,
    selectedTierId: '',
    amount: '',
    note: '',
    specialReason: '',
    showSpecialReason: false,
    codeToken: '',
    q: '',
    results: [] as MemberInfo[],
    searching: false,
    submitting: false,
    memberDayEnabled: false,
    memberDayLabel: '会员日',
    memberDayPoints: 0,
    memberDayDefault: false,
    applyMemberDayBonus: false,
  },

  async onLoad() {
    try {
      const config: StoreConfig = await api.getConfig()
      const tiers = config.pointTiers
      const rule = config.memberDayBonus
      const memberDayEnabled = !!(rule && rule.enabled)
      const weekdays = (rule && rule.weekdays) || []
      const isMemberDay = memberDayEnabled && weekdays.indexOf(new Date().getDay()) >= 0
      this.setData({
        tiers,
        selectedTier: tiers.length ? tiers[0] : null,
        selectedTierId: tiers.length ? tiers[0].id : '',
        amount: tiers.length ? String(tiers[0].defaultAmount) : '',
        memberDayEnabled,
        memberDayLabel: (rule && rule.label) || '会员日',
        memberDayPoints: memberDayEnabled ? Math.max(0, Math.floor((rule && rule.points) || 0)) : 0,
        memberDayDefault: isMemberDay,
        applyMemberDayBonus: isMemberDay,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '配置加载失败', icon: 'none' })
    }
  },

  onScan() {
    wx.scanCode({
      scanType: ['qrCode'],
      success: res => {
        this.applyToken(res.result)
      },
      fail: () => {},
    })
  },

  async applyToken(token: string) {
    wx.showLoading({ title: '校验中' })
    try {
      const res = await api.verifyMemberCode(token)
      this.resetForm()
      this.setData({
        member: res.member,
        usage: res.usage,
        codeToken: token,
        showSpecialReason: res.usage.used >= res.usage.max,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '会员码无效', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  switchMode(e: any) {
    const mode = e.currentTarget.dataset.mode as 'scan' | 'search'
    this.setData({ mode })
  },

  onSearchInput(e: any) {
    this.setData({ q: e.detail.value })
  },

  async onSearch() {
    if (!this.data.q.trim()) return
    this.setData({ searching: true })
    try {
      const res = await api.findMembers(this.data.q.trim())
      this.setData({ results: res.members })
    } catch (e: any) {
      wx.showToast({ title: e.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ searching: false })
    }
  },

  async pickMember(e: any) {
    const memberId = e.currentTarget.dataset.id as string
    wx.showLoading({ title: '加载中' })
    try {
      const res = await api.memberUsage(memberId)
      this.resetForm()
      this.setData({
        member: res.member,
        usage: res.usage,
        codeToken: '',
        showSpecialReason: res.usage.used >= res.usage.max,
      })
    } catch (err: any) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  selectTier(e: any) {
    const id = e.currentTarget.dataset.id as string
    const tier = this.data.tiers.find(t => t.id === id)
    this.setData({
      selectedTier: tier || null,
      selectedTierId: id,
      amount: tier ? String(tier.defaultAmount) : '',
    })
  },

  onAmountInput(e: any) {
    this.setData({ amount: e.detail.value })
  },

  onNoteInput(e: any) {
    this.setData({ note: e.detail.value })
  },

  onSpecialReasonInput(e: any) {
    this.setData({ specialReason: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.data.member || !this.data.usage) {
      wx.showToast({ title: '请先选择会员', icon: 'none' })
      return
    }
    if (!this.data.selectedTierId) {
      wx.showToast({ title: '请选择档位', icon: 'none' })
      return
    }
    const overLimit = this.data.usage.used >= this.data.usage.max
    if (overLimit && !this.data.showSpecialReason) {
      this.setData({ showSpecialReason: true })
      wx.showModal({
        title: '本周录入已达上限',
        content: '继续录入将作为特别录入处理，必须填写原因并计入审计记录。',
        showCancel: false,
      })
      return
    }
    if (overLimit && !this.data.specialReason.trim()) {
      wx.showToast({ title: '请填写特别录入原因', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const amount = this.data.amount.trim() === '' ? undefined : Number(this.data.amount)
      await api.createConsumption({
        codeToken: this.data.codeToken || undefined,
        memberId: this.data.codeToken ? undefined : this.data.member.id,
        tierId: this.data.selectedTierId,
        amount,
        note: this.data.note,
        specialReason: this.data.specialReason,
        applyMemberDayBonus: this.data.applyMemberDayBonus,
      })
      wx.showToast({ title: '录入成功', icon: 'success' })
      // 成功后回到扫码/搜索初始界面，避免连点重复录入
      this.resetForm()
      this.setData({
        member: null,
        usage: null,
        codeToken: '',
        showSpecialReason: false,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '录入失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  resetForm() {
    const firstTier = this.data.tiers[0]
    this.setData({
      selectedTier: firstTier || null,
      selectedTierId: firstTier ? firstTier.id : '',
      amount: firstTier ? String(firstTier.defaultAmount) : '',
      note: '',
      specialReason: '',
      showSpecialReason: false,
      applyMemberDayBonus: this.data.memberDayDefault,
    })
  },

  onMemberDayChange(e: any) {
    const values: string[] = (e.detail && e.detail.value) || []
    this.setData({ applyMemberDayBonus: values.indexOf('1') >= 0 })
  },

  formatTime(t: any) {
    return formatDateTime(t)
  },
})
