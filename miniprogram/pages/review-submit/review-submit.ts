import { api, StoreConfig } from '../../utils/api'
import { uploadImages } from '../../utils/upload'

Page({
  data: {
    platforms: [] as Array<{
      id: string
      name: string
      points: number
      period: string
      maxCount: number
    }>,
    platform: '',
    ruleText: '',
    images: [] as string[],
    text: '',
    link: '',
    submitting: false,
  },

  async onLoad() {
    try {
      const config: StoreConfig = await api.getConfig()
      const platforms = (config.reviewBonuses || []).map(r => ({
        id: r.platform,
        name: r.name || r.platform,
        points: r.points,
        period: r.period,
        maxCount: r.maxCount,
      }))
      this.setData({ platforms })
      if (!platforms.length) wx.showToast({ title: '暂无可用的评论加分项', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '配置加载失败', icon: 'none' })
    }
  },

  selectPlatform(e: any) {
    const id = e.currentTarget.dataset.id as string
    const rule = this.data.platforms.find(p => p.id === id)
    this.setData({
      platform: id,
      ruleText: rule
        ? `每${rule.period === 'week' ? '周' : '月'}最多 ${rule.maxCount} 次，审核通过 +${rule.points} 分`
        : '',
    })
  },

  chooseImages() {
    const remain = 6 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 6 张截图', icon: 'none' })
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

  onTextInput(e: any) {
    this.setData({ text: e.detail.value })
  },

  onLinkInput(e: any) {
    this.setData({ link: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.data.platform) {
      wx.showToast({ title: '请选择平台', icon: 'none' })
      return
    }
    if (!this.data.images.length) {
      wx.showToast({ title: '请至少上传一张评论截图', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '上传中' })
    try {
      const fileIDs = await uploadImages('reviews', this.data.images)
      await api.submitReview({
        platform: this.data.platform,
        screenshots: fileIDs,
        text: this.data.text,
        link: this.data.link,
      })
      wx.hideLoading()
      wx.showModal({
        title: '提交成功',
        content: '管理员审核通过后将自动加分',
        showCancel: false,
        success: () => wx.navigateTo({ url: '/pages/review-list/review-list' }),
      })
    } catch (e: any) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
