import type { MemberInfo, Session } from './api'

const SESSION_KEY = 'member_session_v1'
const SETUP_SKIPPED_KEY = 'setup_skipped_v1'

export function getSession(): Session | null {
  try {
    return (wx.getStorageSync(SESSION_KEY) as Session) || null
  } catch (e) {
    return null
  }
}

export function setSession(session: Session): void {
  wx.setStorageSync(SESSION_KEY, session)
}

export function updateMember(member: MemberInfo): Session | null {
  const session = getSession()
  if (!session) return null
  session.member = member
  setSession(session)
  return session
}

// 只合并余额和等级，保留用户正在编辑或已更新的个人资料。
export function updateMemberBalances(
  balances: Pick<MemberInfo, 'points' | 'growth' | 'honor' | 'level' | 'levelName'>
): Session | null {
  const session = getSession()
  if (!session) return null
  session.member = {
    ...session.member,
    points: balances.points,
    growth: balances.growth,
    honor: balances.honor,
    level: balances.level,
    levelName: balances.levelName,
  }
  setSession(session)
  return session
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY)
}

export function isSetupSkipped(): boolean {
  return !!wx.getStorageSync(SETUP_SKIPPED_KEY)
}

export function markSetupSkipped(): void {
  wx.setStorageSync(SETUP_SKIPPED_KEY, true)
}

export function clearSetupSkipped(): void {
  wx.removeStorageSync(SETUP_SKIPPED_KEY)
}
