import { CLOUD_ENV_ID } from './config'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发，请升级至 2.2.3 及以上版本')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    })
  },
})
