import { getSession } from '../../../utils/session'

Page({
  onLoad() {
    const session = getSession()
    if (!session || !session.isSuperAdmin) {
      wx.showToast({ title: '需要超级管理员权限', icon: 'none' })
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
    }
  },

  openAdmins() {
    wx.navigateTo({ url: '/pages/admin/super-admins/super-admins' })
  },

  openConfig() {
    wx.navigateTo({ url: '/pages/admin/super-config/super-config' })
  },
})
