const TABS = [
  { pagePath: '/pages/index/index', text: '会员卡', key: 'member' },
  { pagePath: '/pages/points/points', text: '积分', key: 'points' },
  { pagePath: '/pages/events/events', text: '活动', key: 'events' },
  { pagePath: '/pages/profile/profile', text: '我的', key: 'profile' },
]

Component({
  data: {
    selected: 0,
    list: TABS,
  },

  lifetimes: {
    attached() {
      this.syncSelected()
    },
  },

  pageLifetimes: {
    show() {
      this.syncSelected()
    },
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      if (!pages.length) return
      const current = `/${(pages[pages.length - 1] as any).route}`
      const index = TABS.findIndex(tab => tab.pagePath === current)
      if (index >= 0 && index !== this.data.selected) {
        this.setData({ selected: index })
      }
    },

    switchTab(e: any) {
      const index = Number(e.currentTarget.dataset.index)
      const tab = TABS[index]
      if (!tab || index === this.data.selected) return
      wx.switchTab({ url: tab.pagePath })
    },
  },
})
