import { api } from '../../utils/api'
import { uploadImages } from '../../utils/upload'

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书' },
  { id: 'dianping', name: '大众点评' },
]

Page({
  data: {
    platforms: PLATFORMS,
    platform: '',
    images: [] as string[],
    text: '',
    link: '',
    submitting: false,
  },

  selectPlatform(e: any) {
    this.setData({ platform: e.currentTarget.dataset.id })
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
