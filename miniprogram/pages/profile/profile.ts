import { api } from '../../utils/api'
import { getSession, setSession, updateMember } from '../../utils/session'
import { uploadImage } from '../../utils/upload'
import { syncTabBar } from '../../utils/tabbar'

const ACCOUNT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{4,19}$/

Page({
  data: {
    member: null as any,
    isAdmin: false,
    points: 0,
    growth: 0,
    honor: 0,
    leaderboardAnon: false,
    nickname: '',
    signature: '',
    renamePanel: false,
    newAccountName: '',
    saving: false,
  },

  onShow() {
    syncTabBar(this)
    const session = getSession()
    if (!session) {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    this.setData({
      member: session.member,
      isAdmin: session.isAdmin,
      points: session.member.points || 0,
      growth: session.member.growth || 0,
      honor: session.member.honor || 0,
      leaderboardAnon: !!session.member.leaderboardAnon,
      nickname: session.member.nickname,
      signature: session.member.signature,
    })
  },

  async onChooseAvatar(e: any) {
    const tempPath = e.detail.avatarUrl
    if (!tempPath) return
    wx.showLoading({ title: '上传中' })
    try {
      const fileID = await uploadImage('avatars', tempPath)
      const res = await api.updateProfile({ avatar: fileID })
      updateMember(res.member)
      this.setData({ 'member.avatar': res.member.avatar })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err: any) {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onNicknameInput(e: any) {
    this.setData({ nickname: e.detail.value })
  },

  onSignatureInput(e: any) {
    this.setData({ signature: e.detail.value })
  },

  async onSaveProfile() {
    const nickname = this.data.nickname.trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const res = await api.updateProfile({
        nickname,
        signature: this.data.signature,
      })
      updateMember(res.member)
      this.setData({ member: res.member })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  openRename() {
    this.setData({ renamePanel: true, newAccountName: '' })
  },

  closeRename() {
    this.setData({ renamePanel: false })
  },

  onRenameInput(e: any) {
    this.setData({ newAccountName: e.detail.value })
  },

  async confirmRename() {
    const name = this.data.newAccountName.trim()
    if (!ACCOUNT_NAME_RE.test(name)) {
      wx.showToast({ title: '需以字母开头，5–20 位字母/数字/_/-', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const res = await api.renameAccountName(name)
      const session = getSession()
      if (session) {
        session.member = res.member
        session.needSetup = false
        setSession(session)
      }
      this.setData({
        member: res.member,
        renamePanel: false,
      })
      wx.showToast({ title: '账号名已设定', icon: 'success' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '设置失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onTapAdmin() {
    wx.navigateTo({ url: '/pages/admin/home/home' })
  },

  onTapPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  onTapReview() {
    wx.navigateTo({ url: '/pages/review-submit/review-submit' })
  },

  onTapMyReviews() {
    wx.navigateTo({ url: '/pages/review-list/review-list' })
  },

  onTapLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' })
  },

  onTapMyEvents() {
    wx.setStorageSync('events_open_tab', 'mine')
    wx.switchTab({ url: '/pages/events/events' })
  },

  async onAnonChange(e: any) {
    const anon = !!e.detail.value
    try {
      const res = await api.updateLeaderboardAnon(anon)
      const session = getSession()
      if (session) {
        session.member = res.member
        setSession(session)
      }
      this.setData({ leaderboardAnon: anon })
      wx.showToast({ title: anon ? '已开启匿名' : '已实名展示', icon: 'none' })
    } catch (err: any) {
      wx.showToast({ title: err.message || '设置失败', icon: 'none' })
    }
  },

  noop() {},
})
