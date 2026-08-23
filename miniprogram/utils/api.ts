export interface MemberInfo {
  id: string
  accountName: string
  accountNameChanged: boolean
  nickname: string
  avatar: string
  signature: string
  points: number
  growth: number
  leaderboardAnon: boolean
  level: string
  levelName: string
  createdAt?: Date
}

export interface Session {
  member: MemberInfo
  isAdmin: boolean
  needSetup: boolean
}

export interface PointTier {
  id: string
  name: string
  points: number
  defaultAmount: number
}

export interface ConsumptionUsage {
  used: number
  max: number
  period: string
}

export interface StoreConfig {
  storeInfo: {
    name: string
    contact: string
  }
  pointTiers: PointTier[]
  consumptionLimit: {
    period: string
    resetDay: number
    resetHour: number
    maxCount: number
  }
  reviewBonuses: Array<{
    platform: string
    points: number
    period: string
    maxCount: number
  }>
  levelThresholds: Array<{
    id: string
    name: string
    minPoints: number
  }>
  privacyText: string
}

export interface PointEntry {
  _id: string
  memberId: string
  delta: number
  balanceAfter: number
  growthDelta?: number
  growthAfter?: number
  pointsDelta?: number
  pointsAfter?: number
  sourceType: string
  sourceId: string
  subtype: string
  note: string
  detail?: string
  createdAt: Date
}

export interface AuditLogItem {
  _id: string
  actorId: string
  actorNickname: string
  actionType: string
  targetType: string
  targetId: string
  targetMemberId: string
  targetMemberNickname: string
  changeType: string
  delta: number
  growthDelta?: number
  reason: string
  specialFlag: boolean
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface LeaderboardEntry {
  id: string
  rank: number
  nickname: string
  accountName: string
  growth: number
  anonymous: boolean
  isMe: boolean
  ellipsis?: boolean
}

export interface LeaderboardData {
  top: LeaderboardEntry[]
  around: LeaderboardEntry[]
  me: LeaderboardEntry
  topCount: number
  aroundCount: number
  total: number
  leaderboardAnon: boolean
}

export class ApiError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export function callApi<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!wx.cloud) {
    return Promise.reject(new ApiError('当前微信基础库不支持云开发，请升级微信后重试'))
  }
  return wx.cloud
    .callFunction({ name: 'api', data: { ...data, action } })
    .then((res: any) => {
      const r = res && res.result
      if (!r) throw new ApiError('云函数无响应，请重试')
      if (!r.ok) throw new ApiError(r.error || '请求失败', r.code)
      return r.data as T
    })
}

export const api = {
  login: () => callApi<Session>('login'),
  renameAccountName: (accountName: string) =>
    callApi<{ member: MemberInfo }>('renameAccountName', { accountName }),
  updateProfile: (data: { nickname?: string; signature?: string; avatar?: string }) =>
    callApi<{ member: MemberInfo }>('updateProfile', data),
  getConfig: () => callApi<StoreConfig>('getConfig'),
  issueMemberCode: () => callApi<{ token: string; expiresAt: number }>('issueMemberCode'),
  verifyMemberCode: (token: string) =>
    callApi<{ member: MemberInfo; usage: ConsumptionUsage }>('verifyMemberCode', { token }),
  memberUsage: (memberId: string) =>
    callApi<{ member: MemberInfo; usage: ConsumptionUsage }>('memberUsage', { memberId }),
  findMembers: (q: string) => callApi<{ members: MemberInfo[] }>('findMembers', { q }),
  createConsumption: (data: {
    codeToken?: string
    memberId?: string
    tierId: string
    amount?: number
    note?: string
    specialReason?: string
  }) => callApi<{ consumptionId: string; balanceAfter: number; used: number; overLimit: boolean }>('createConsumption', data),
  submitReview: (data: { platform: string; screenshots: string[]; text?: string; link?: string }) =>
    callApi<{ id: string }>('submitReview', data),
  listMyReviews: () =>
    callApi<{ items: any[] }>('listMyReviews'),
  listReviewSubmissions: (status: string) =>
    callApi<{ items: any[] }>('listReviewSubmissions', { status }),
  reviewAction: (data: { id: string; subAction: 'approve' | 'reject'; reason?: string; specialReason?: string }) =>
    callApi<{ id: string }>('reviewAction', data),
  listPointEntries: (data: { page?: number; pageSize?: number; sourceType?: string }) =>
    callApi<{ entries: PointEntry[]; total: number; page: number; pageSize: number; points: number; growth: number; levelName: string }>(
      'listPointEntries',
      data
    ),
  listAuditLogs: (data: {
    targetMemberId?: string
    actorId?: string
    changeType?: string
    timeRange?: string
    page?: number
    pageSize?: number
  }) =>
    callApi<{
      items: AuditLogItem[]
      total: number
      page: number
      pageSize: number
      weekStats: { total: number; special: number; ratio: number }
    }>('listAuditLogs', data),
  manualAdjust: (data: { memberId: string; growthDelta?: number; pointsDelta?: number; reason: string }) =>
    callApi<{ pointsAfter: number; growthAfter: number }>('manualAdjust', data),
  redeemPoints: (data: { memberId: string; points: number; item: string; note?: string }) =>
    callApi<{ pointsAfter: number; growthAfter: number }>('redeemPoints', data),
  leaderboard: () => callApi<LeaderboardData>('leaderboard'),
  updateLeaderboardAnon: (anon: boolean) =>
    callApi<{ member: MemberInfo; leaderboardAnon: boolean }>('updateLeaderboardAnon', { anon }),
}
