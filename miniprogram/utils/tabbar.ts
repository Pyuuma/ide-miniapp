const TAB_INDEX: Record<string, number> = {
  'pages/index/index': 0,
  'pages/points/points': 1,
  'pages/events/events': 2,
  'pages/profile/profile': 3,
}

/**
 * 自定义 tabBar 的官方做法：tab 页在 onShow 时把自己的下标同步给 tabBar。
 * 只依赖组件自身的 pageLifetimes 在个别机型/基础库上可能拿不到正确路由，这里显式同步一次更稳。
 */
export function syncTabBar(page: any): void {
  const selected = TAB_INDEX[page && page.route]
  if (selected === undefined) return
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && typeof tabBar.setData === 'function') {
    tabBar.setData({ selected })
  }
}
