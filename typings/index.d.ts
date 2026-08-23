/// <reference path="./types/index.d.ts" />

interface IAppOption extends WechatMiniprogram.IAnyObject {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
}
