import { AdminCandidate, api, SuperAdminEntry } from '../../../utils/api'
import { getSession } from '../../../utils/session'

interface AdminRow {
  openid: string
  label: string
}

Page({
  data: {
    loading: true,
    loaded: false,
    savingAdmins: false,
    dirty: false,
    admins: [] as AdminRow[],
    adminQuery: '',
    candidates: [] as AdminCandidate[],
    showCandidates: false,
    searchingAdmin: false,
    superAdmins: [] as AdminRow[],
  },

  originalAdmins: [] as string[],

  onLoad() {
    const session = getSession()
    if (!session || !session.isSuperAdmin) {
      wx.showToast({ title: '需要超级管理员权限', icon: 'none' })
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true, loaded: false })
    try {
      const res = await api.getSuperConsole()
      this.originalAdmins = res.admins.map(a => a.openid).sort()
      this.setData({
        admins: res.admins.map(toAdminRow),
        superAdmins: res.superAdmins.map(toAdminRow),
        loaded: true,
      })
      this.syncDirty()
    } catch (e: any) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onShow() {
    this.syncDirty()
  },

  onUnload() {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
  },

  openConfig() {
    if (this.data.savingAdmins) return
    const route = 'pages/admin/super-config/super-config'
    const pages = getCurrentPages()
    const index = pages.findIndex(page => page.route === route)
    if (index >= 0) {
      wx.navigateBack({ delta: pages.length - 1 - index })
    } else {
      wx.navigateTo({ url: `/${route}` })
    }
  },

  syncDirty() {
    const dirty = JSON.stringify(this.originalAdmins) !==
      JSON.stringify(this.data.admins.map(a => a.openid).sort())
    if (dirty !== this.data.dirty) this.setData({ dirty })
    if (dirty && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: '管理员名单尚未保存，确定返回吗？' })
    } else if (!dirty && wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload()
    }
  },

  // ---------- 管理员名单 ----------
  onAdminQueryInput(e: any) {
    const adminQuery = e.detail.value
    this.setData({
      adminQuery,
      candidates: adminQuery.trim() ? this.data.candidates : [],
      showCandidates: adminQuery.trim() ? this.data.showCandidates : false,
    })
  },

  async searchAdmins() {
    if (this.data.searchingAdmin || this.data.savingAdmins || !this.data.loaded) return
    const q = this.data.adminQuery.trim()
    if (!q) {
      wx.showToast({ title: '请输入账号 ID / 账号名 / openid', icon: 'none' })
      return
    }
    this.setData({ searchingAdmin: true })
    try {
      const res = await api.searchAdminCandidates(q)
      this.setData({ candidates: res.items, showCandidates: true })
      if (!res.items.length) wx.showToast({ title: '没有匹配的会员', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ searchingAdmin: false })
    }
  },

  pickCandidate(e: any) {
    if (this.data.savingAdmins || !this.data.loaded) return
    const index = Number(e.currentTarget.dataset.index)
    const candidate = this.data.candidates[index]
    if (!candidate) return
    if (candidate.isSuperAdmin) {
      wx.showToast({ title: '该会员已是超级管理员', icon: 'none' })
      return
    }
    if (this.data.admins.some(a => a.openid === candidate.openid)) {
      wx.showToast({ title: '该会员已在管理员名单中', icon: 'none' })
      return
    }
    const admins = this.data.admins.concat({
      openid: candidate.openid,
      label: `${candidate.nickname || '未命名'} @${candidate.accountName || '-'}`,
    })
    this.setData({ admins, candidates: [], showCandidates: false, adminQuery: '' })
    this.syncDirty()
  },

  closeCandidates() {
    this.setData({ showCandidates: false, candidates: [] })
  },

  removeAdmin(e: any) {
    if (this.data.savingAdmins || !this.data.loaded) return
    const index = e.currentTarget.dataset.index as number
    const admins = this.data.admins.slice()
    admins.splice(index, 1)
    this.setData({ admins })
    this.syncDirty()
  },

  async onSaveAdmins() {
    if (this.data.savingAdmins || !this.data.loaded || !this.data.dirty) return
    this.setData({ savingAdmins: true })
    try {
      const res = await api.saveAdmins(this.data.admins.map(a => a.openid))
      this.originalAdmins = res.admins.slice().sort()
      this.syncDirty()
      wx.showToast({ title: '管理员名单已保存', icon: 'success' })
    } catch (e: any) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ savingAdmins: false })
    }
  },

  copyOpenid(e: any) {
    wx.setClipboardData({ data: e.currentTarget.dataset.openid })
  },
})

function toAdminRow(entry: SuperAdminEntry): AdminRow {
  const member = entry.member
  const label = member ? `${member.nickname} @${member.accountName}` : '未注册/未登录过'
  return { openid: entry.openid, label }
}
