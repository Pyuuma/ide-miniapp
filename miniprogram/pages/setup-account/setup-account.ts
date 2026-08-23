import { api } from '../../utils/api'
import { getSession, markSetupSkipped, setSession } from '../../utils/session'

const ACCOUNT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{4,19}$/

Page({
  data: {
    accountName: '',
    input: '',
    saving: false,
  },

  onLoad() {
    this.bootstrap()
  },

  async bootstrap() {
    try {
      let session = getSession()
      if (!session) session = await api.login()
      setSession(session)
      if (session.member.accountNameChanged) {
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      this.setData({ accountName: session.member.accountName })
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value })
  },

  async onConfirm() {
    if (this.data.saving) return
    const custom = this.data.input.trim()
    if (custom) {
      if (!ACCOUNT_NAME_RE.test(custom)) {
        wx.showToast({ title: '需以字母开头，5–20 位字母/数字/_/-', icon: 'none' })
        return
      }
      this.setData({ saving: true })
      try {
        const res = await api.renameAccountName(custom)
        const session = getSession()
        if (session) {
          session.member = res.member
          session.needSetup = !res.member.accountNameChanged
          setSession(session)
        }
        wx.reLaunch({ url: '/pages/index/index' })
        return
      } catch (e: any) {
        wx.showToast({ title: e.message || '设置失败', icon: 'none' })
        return
      } finally {
        this.setData({ saving: false })
      }
    }
    markSetupSkipped()
    wx.reLaunch({ url: '/pages/index/index' })
  },
})
