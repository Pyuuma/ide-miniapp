import { api, MemberInfo } from '../../utils/api'
import { isSetupSkipped, setSession } from '../../utils/session'
import { drawQrCode } from '../../utils/qr'
import { syncTabBar } from '../../utils/tabbar'

Page({
  data: {
    loading: true,
    member: null as MemberInfo | null,
    isAdmin: false,
    storeName: '',
    levelName: '',
    token: '',
    countdown: 0,
    showPrivacy: false,
  },

  timer: 0,
  canvas: null as any,
  refreshing: false,

  onShow() {
    syncTabBar(this)
    this.bootstrap()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  async bootstrap() {
    this.setData({ loading: true })
    try {
      if (!wx.getStorageSync('privacy_consent_v1')) {
        this.setData({ loading: false, showPrivacy: true })
        return
      }
      const session = await api.login()
      setSession(session)
      if (!session.member.accountNameChanged && !isSetupSkipped()) {
        wx.redirectTo({ url: '/pages/setup-account/setup-account' })
        return
      }
      this.setData({
        member: session.member,
        isAdmin: session.isAdmin,
        levelName: session.member.levelName,
      })
      const config = await api.getConfig()
      this.setData({ storeName: config.storeInfo.name })
      await this.ensureCanvas()
      await this.refreshCode()
      this.startTimer()
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  ensureCanvas(): Promise<any> {
    if (this.canvas) return Promise.resolve(this.canvas)
    return new Promise(resolve => {
      wx.createSelectorQuery()
        .select('#memberCode')
        .fields({ node: true, size: true })
        .exec(res => {
          const info = res && res[0]
          if (info && info.node) {
            const canvas = info.node
            canvas.width = 300
            canvas.height = 300
            this.canvas = canvas
          }
          resolve(this.canvas)
        })
    })
  },

  async refreshCode() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const code = await api.issueMemberCode()
      this.setData({
        token: code.token,
        countdown: Math.max(0, Math.floor((code.expiresAt - Date.now()) / 1000)),
      })
      if (this.canvas) {
        drawQrCode(this.canvas, code.token)
      } else {
        setTimeout(() => {
          this.ensureCanvas().then(canvas => {
            if (canvas && this.data.token === code.token) drawQrCode(canvas, code.token)
          })
        }, 100)
      }
    } catch (e: any) {
      wx.showToast({ title: e.message || '二维码生成失败', icon: 'none' })
    } finally {
      this.refreshing = false
    }
  },

  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => {
      const left = this.data.countdown - 1
      if (left <= 0) {
        this.setData({ countdown: 0 })
        this.refreshCode()
      } else {
        this.setData({ countdown: left })
      }
    }, 1000)
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = 0
    }
  },

  onTapAdmin() {
    wx.navigateTo({ url: '/pages/admin/home/home' })
  },

  onTapReview() {
    wx.navigateTo({ url: '/pages/review-submit/review-submit' })
  },

  onTapMyReviews() {
    wx.navigateTo({ url: '/pages/review-list/review-list' })
  },

  onTapMall() {
    wx.navigateTo({ url: '/pages/mall/mall' })
  },

  onAgreePrivacy() {
    wx.setStorageSync('privacy_consent_v1', true)
    this.setData({ showPrivacy: false })
    this.bootstrap()
  },

  onViewPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },
})
