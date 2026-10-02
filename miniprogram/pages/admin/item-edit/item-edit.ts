import { api, RedemptionOption } from '../../../utils/api'
import { uploadImages } from '../../../utils/upload'
import { renderMarkdown } from '../../../utils/markdown'

Page({
  data: {
    id: '',
    title: '',
    images: [] as string[],
    contentMarkdown: '',
    mode: 'edit' as 'edit' | 'preview',
    previewHtml: '',
    status: 'on' as 'on' | 'off',
    sort: '0',
    options: [] as Array<RedemptionOption & { key: number }>,
    nextKey: 1,
    saving: false,
  },

  onLoad(options: any) {
    const id = options.id || ''
    this.setData({ id })
    if (id) this.loadItem(id)
  },

  async loadItem(id: string) {
    wx.showLoading({ title: '加载中' })
    try {
      const res = await api.listAdminRedemptionItems()
      const item = res.items.find((it: any) => it._id === id)
      if (!item) throw new Error('商品不存在')
      const options = (item.options || []).map((o: RedemptionOption, i: number) => ({
        ...o,
        key: i + 1,
      }))
      this.setData({
        title: item.title,
        images: item.images || [],
        contentMarkdown: item.contentMarkdown || '',
        status: item.status,
        sort: String(item.sort || 0),
        options,
        nextKey: options.length + 1,
      })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onTitleInput(e: any) {
    this.setData({ title: e.detail.value })
  },

  chooseImages() {
    const remain = 9 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张图片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const paths = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths) })
      },
    })
  },

  removeImage(e: any) {
    const index = e.currentTarget.dataset.index as number
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onMarkdownInput(e: any) {
    this.setData({ contentMarkdown: e.detail.value })
  },

  switchMode(e: any) {
    const mode = e.currentTarget.dataset.mode as 'edit' | 'preview'
    if (mode === 'preview') {
      this.setData({ mode, previewHtml: renderMarkdown(this.data.contentMarkdown) })
    } else {
      this.setData({ mode })
    }
  },

  onStatusChange(e: any) {
    this.setData({ status: e.detail.value ? 'on' : 'off' })
  },

  onSortInput(e: any) {
    this.setData({ sort: e.detail.value })
  },

  onOptionNameInput(e: any) {
    const index = e.currentTarget.dataset.index as number
    const options = this.data.options.slice()
    options[index] = { ...options[index], name: e.detail.value }
    this.setData({ options })
  },

  onOptionPointsInput(e: any) {
    const index = e.currentTarget.dataset.index as number
    const options = this.data.options.slice()
    options[index] = { ...options[index], points: Number(e.detail.value) }
    this.setData({ options })
  },

  addOption() {
    const options = this.data.options.slice()
    options.push({ id: '', name: '', points: 0, key: this.data.nextKey })
    this.setData({ options, nextKey: this.data.nextKey + 1 })
  },

  removeOption(e: any) {
    const index = e.currentTarget.dataset.index as number
    const options = this.data.options.slice()
    options.splice(index, 1)
    this.setData({ options })
  },

  async onSave() {
    if (this.data.saving) return
    if (!this.data.title.trim()) {
      wx.showToast({ title: '请填写商品标题', icon: 'none' })
      return
    }
    if (!this.data.images.length) {
      wx.showToast({ title: '请至少上传一张图片', icon: 'none' })
      return
    }
    if (!this.data.contentMarkdown.trim()) {
      wx.showToast({ title: '请填写商品说明', icon: 'none' })
      return
    }
    const options = this.data.options
      .filter(o => o.name.trim() || o.points > 0)
      .map(o => ({ ...o, name: o.name.trim(), points: Number(o.points) }))
    if (!options.length) {
      wx.showToast({ title: '请至少添加一个兑换选项', icon: 'none' })
      return
    }
    if (options.some(o => !o.name || !o.points || o.points <= 0)) {
      wx.showToast({ title: '兑换选项需填写名称和正整数积分', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中' })
    try {
      const tempPaths = this.data.images.filter(p => !p.startsWith('cloud://'))
      const uploaded = tempPaths.length ? await uploadImages('items', tempPaths) : []
      const images = this.data.images.map(p => (p.startsWith('cloud://') ? p : uploaded.shift() || p))
      await api.saveRedemptionItem({
        id: this.data.id || undefined,
        title: this.data.title,
        images,
        contentMarkdown: this.data.contentMarkdown,
        status: this.data.status,
        sort: this.data.sort,
        options: options.map(o => ({ id: o.id, name: o.name, points: o.points })),
      })
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (e: any) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
