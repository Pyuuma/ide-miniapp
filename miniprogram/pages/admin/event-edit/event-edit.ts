import { api } from '../../../utils/api'
import { uploadImages } from '../../../utils/upload'
import { renderMarkdown } from '../../../utils/markdown'

const STATUS_OPTIONS = [
  { id: 'draft', name: '草稿' },
  { id: 'published', name: '已发布' },
  { id: 'ended', name: '已结束' },
]

function toDatePart(input: Date | string | null | undefined): string {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toTimePart(input: Date | string | null | undefined): string {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

Page({
  data: {
    id: '',
    title: '',
    images: [] as string[],
    statusOptions: STATUS_OPTIONS,
    status: 'draft',
    contentMarkdown: '',
    mode: 'edit' as 'edit' | 'preview',
    previewHtml: '',
    registerStartDate: '',
    registerStartTime: '',
    deadlineDate: '',
    deadlineTime: '',
    capacity: '',
    saving: false,
  },

  onLoad(options: any) {
    const id = options.id || ''
    this.setData({ id })
    if (id) this.loadEvent(id)
  },

  async loadEvent(id: string) {
    wx.showLoading({ title: '加载中' })
    try {
      const res = await api.listAdminEvents()
      const ev = res.items.find((e: any) => e._id === id)
      if (!ev) throw new Error('赛事不存在')
      this.setData({
        title: ev.title,
        images: ev.images || [],
        status: ev.status,
        contentMarkdown: ev.contentMarkdown || '',
        registerStartDate: toDatePart(ev.registerStart),
        registerStartTime: toTimePart(ev.registerStart),
        deadlineDate: toDatePart(ev.registerDeadline),
        deadlineTime: toTimePart(ev.registerDeadline),
        capacity: ev.capacity ? String(ev.capacity) : '',
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

  onStatus(e: any) {
    this.setData({ status: e.currentTarget.dataset.id })
  },

  onRegisterStartDateChange(e: any) {
    this.setData({ registerStartDate: e.detail.value })
  },

  onRegisterStartTimeChange(e: any) {
    this.setData({ registerStartTime: e.detail.value })
  },

  clearRegisterStart() {
    this.setData({ registerStartDate: '', registerStartTime: '' })
  },

  onDateChange(e: any) {
    this.setData({ deadlineDate: e.detail.value })
  },

  onTimeChange(e: any) {
    this.setData({ deadlineTime: e.detail.value })
  },

  clearDeadline() {
    this.setData({ deadlineDate: '', deadlineTime: '' })
  },

  onCapacityInput(e: any) {
    this.setData({ capacity: e.detail.value })
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

  async onSave() {
    if (this.data.saving) return
    if (!this.data.title.trim()) {
      wx.showToast({ title: '请填写赛事标题', icon: 'none' })
      return
    }
    if (!this.data.images.length) {
      wx.showToast({ title: '请至少上传一张图片', icon: 'none' })
      return
    }
    if (!this.data.contentMarkdown.trim()) {
      wx.showToast({ title: '请填写赛事说明', icon: 'none' })
      return
    }
    const startDate = this.data.registerStartDate
    const startTime = this.data.registerStartTime
    const endDate = this.data.deadlineDate
    const endTime = this.data.deadlineTime
    if (!!startDate !== !!startTime) {
      wx.showToast({ title: startDate ? '请补充报名开始时间' : '请补充报名开始日期', icon: 'none' })
      return
    }
    if (!!endDate !== !!endTime) {
      wx.showToast({ title: endDate ? '请补充报名截止时间' : '请补充报名截止日期', icon: 'none' })
      return
    }
    const registerStart = startDate ? `${startDate}T${startTime}:00+08:00` : ''
    const deadline = endDate ? `${endDate}T${endTime}:00+08:00` : ''
    if ((registerStart && !Number.isFinite(Date.parse(registerStart))) || (deadline && !Number.isFinite(Date.parse(deadline)))) {
      wx.showToast({ title: '报名日期或时间无效', icon: 'none' })
      return
    }
    if (registerStart && deadline && Date.parse(registerStart) >= Date.parse(deadline)) {
      wx.showToast({ title: '报名开始时间须早于截止时间', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中' })
    try {
      const tempPaths = this.data.images.filter(p => !p.startsWith('cloud://'))
      const uploaded = tempPaths.length ? await uploadImages('events', tempPaths) : []
      const images = this.data.images.map(p => (p.startsWith('cloud://') ? p : uploaded.shift() || p))
      await api.saveEvent({
        id: this.data.id || undefined,
        title: this.data.title,
        images,
        contentMarkdown: this.data.contentMarkdown,
        status: this.data.status as 'draft' | 'published' | 'ended',
        registerStart,
        registerDeadline: deadline,
        capacity: this.data.capacity,
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

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除赛事？',
      content: '仅草稿状态可删除，删除后不可恢复。',
      success: res => {
        if (res.confirm) this.doDelete()
      },
    })
  },

  async doDelete() {
    this.setData({ saving: true })
    try {
      await api.deleteEvent(this.data.id)
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (e: any) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
