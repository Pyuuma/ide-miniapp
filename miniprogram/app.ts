App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发，请升级至 2.2.3 及以上版本')
      return
    }
    wx.cloud.init({
      env: 'cloudbase-d0g3x3jvnb9c1a61e',
      traceUser: true,
    })
  },
})
