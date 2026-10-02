import { api, MemberInfo, RedemptionItem } from '../../../utils/api'

Page({
  data: {
    tab: 'add',
    member: null as MemberInfo | null,
    q: '',
    results: [] as MemberInfo[],
    searching: false,
    growthDelta: '',
    pointsDelta: '',
    honorDelta: '',
    reason: '',
    redeemPoints: '',
    item: '',
    note: '',
    products: [] as RedemptionItem[],
    selectedProduct: null as RedemptionItem | null,
    selectedOption: null as { id: string; name: string; points: number } | null,
    submitting: false,
  },

  onLoad() {
    this.loadProducts()
  },

  async loadProducts() {
    try {
      const res = await api.listAdminRedemptionItems()
      this.setData({ products: res.items })
    } catch (e: any) {
      wx.showToast({ title: e.message || '商品加载失败', icon: 'none' })
    }
  },

  switchTab(e: any) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onSearchInput(e: any) {
    this.setData({ q: e.detail.value })
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
      this.setData({ member: res.member, results: [] })
    } catch (e: any) {
      wx.showToast({ title: e.message || '会员码无效', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
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
    try {
      const res = await api.memberUsage(memberId)
      this.setData({ member: res.member, results: [] })
    } catch (err: any) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onGrowthInput(e: any) {
    this.setData({ growthDelta: e.detail.value })
  },

  onPointsDeltaInput(e: any) {
    this.setData({ pointsDelta: e.detail.value })
  },

  onHonorDeltaInput(e: any) {
    this.setData({ honorDelta: e.detail.value })
  },

  onReasonInput(e: any) {
    this.setData({ reason: e.detail.value })
  },

  onRedeemPointsInput(e: any) {
    this.setData({ redeemPoints: e.detail.value })
  },

  onItemInput(e: any) {
    this.setData({ item: e.detail.value })
  },

  onNoteInput(e: any) {
    this.setData({ note: e.detail.value })
  },

  async onSubmitAdd() {
    if (!this.data.member) {
      wx.showToast({ title: '请先选择会员', icon: 'none' })
      return
    }
    const growthDelta = Number(this.data.growthDelta)
    const pointsDelta = Number(this.data.pointsDelta)
    const honorDelta = Number(this.data.honorDelta)
    if (
      (!this.data.growthDelta || growthDelta <= 0) &&
      (!this.data.pointsDelta || pointsDelta <= 0) &&
      (!this.data.honorDelta || honorDelta <= 0)
    ) {
      wx.showToast({ title: '请至少填写一项成长值、积分或荣誉值', icon: 'none' })
      return
    }
    if (!this.data.reason.trim()) {
      wx.showToast({ title: '原因必填', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const res = await api.manualAdjust({
        memberId: this.data.member.id,
        growthDelta: this.data.growthDelta ? growthDelta : 0,
        pointsDelta: this.data.pointsDelta ? pointsDelta : 0,
        honorDelta: this.data.honorDelta ? honorDelta : 0,
        reason: this.data.reason,
      })
      wx.showToast({ title: '已新增', icon: 'success' })
      this.refreshMember(res.growthAfter, res.pointsAfter, res.honorAfter)
      this.setData({ growthDelta: '', pointsDelta: '', honorDelta: '', reason: '' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onProductChange(e: any) {
    const index = Number(e.detail.value)
    const product = this.data.products[index]
    if (!product) return
    this.setData({
      selectedProduct: product,
      selectedOption: null,
      redeemPoints: '',
      item: '',
    })
  },

  onOptionChange(e: any) {
    if (!this.data.selectedProduct) return
    const index = Number(e.detail.value)
    const option = this.data.selectedProduct.options[index]
    if (!option) return
    this.setData({
      selectedOption: option,
      redeemPoints: String(option.points),
      item: `${this.data.selectedProduct.title} · ${option.name}`,
    })
  },

  clearSelection() {
    this.setData({ selectedProduct: null, selectedOption: null })
  },

  async onSubmitRedeem() {
    if (!this.data.member) {
      wx.showToast({ title: '请先选择会员', icon: 'none' })
      return
    }
    const points = Number(this.data.redeemPoints)
    if (!this.data.redeemPoints || points <= 0) {
      wx.showToast({ title: '兑换积分必须大于 0', icon: 'none' })
      return
    }
    if (!this.data.item.trim()) {
      wx.showToast({ title: '请填写兑换内容', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const useCatalog = !!(this.data.selectedProduct && this.data.selectedOption)
      const res = await api.redeemPoints({
        memberId: this.data.member.id,
        points,
        item: this.data.item,
        note: this.data.note,
        itemId: useCatalog ? this.data.selectedProduct!._id : undefined,
        optionId: useCatalog ? this.data.selectedOption!.id : undefined,
      })
      wx.showToast({ title: '兑换成功', icon: 'success' })
      this.refreshMember(res.growthAfter, res.pointsAfter, this.data.member.honor || 0)
      this.setData({ redeemPoints: '', item: '', note: '' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  refreshMember(growthAfter: number, pointsAfter: number, honorAfter: number) {
    if (!this.data.member) return
    const member = { ...this.data.member, growth: growthAfter, points: pointsAfter, honor: honorAfter }
    this.setData({ member })
  },
})
