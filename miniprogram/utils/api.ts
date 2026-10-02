export interface MemberInfo {
  id: string
  accountName: string
  accountNameChanged: boolean
  nickname: string
  avatar: string
  signature: string
  points: number
  growth: number
  honor: number
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
  memberDayBonus: {
    enabled: boolean
    label: string
    weekdays: number[]
    points: number
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
  honorDelta?: number
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
  honor: number
  value: number
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
  type: 'growth' | 'honor'
}

export interface EventInfo {
  _id: string
  title: string
  images: string[]
  contentMarkdown: string
  status: 'draft' | 'published' | 'ended'
  registerStart?: Date | null
  registerDeadline?: Date | null
  capacity?: number | null
  registrationCount: number
  myRegistered?: boolean
  registerState?: 'not_started' | 'open' | 'closed'
  createdAt?: Date
}

export interface EventRegistrationInfo {
  registrationId: string
  eventId: string
  title: string
  cover: string
  status: EventInfo['status']
  registerDeadline?: Date | null
  capacity?: number | null
  registrationCount: number
  createdAt?: Date
}

export interface RedemptionOption {
  id: string
  name: string
  points: number
}

export interface RedemptionItem {
  _id: string
  title: string
  images: string[]
  contentMarkdown: string
  status: 'on' | 'off'
  sort: number
  options: RedemptionOption[]
  createdAt?: Date
}

export interface HonorEntry {
  _id: string
  memberId: string
  honorDelta: number
  honorAfter: number
  sourceType: string
  sourceId: string
  subtype: string
  note: string
  detail?: string
  createdAt: Date
}

export interface RosterMember {
  id: string
  nickname: string
  accountName: string
  honor: number
}

export interface EventRosterItem {
  registrationId: string
  member: RosterMember
  source?: string
  createdAt?: Date
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
    .catch((err: any) => {
      if (err instanceof ApiError) throw err
      const msg = `${(err && err.errMsg) || ''} ${(err && err.errMessage) || ''}`
      if (/INVALID_ENV|-501000|Environment not found/i.test(msg)) {
        throw new ApiError(
          '云开发环境不存在：请检查 miniprogram/config.ts 的环境 ID，并确认已在该环境部署 api 云函数',
          'INVALID_ENV'
        )
      }
      throw new ApiError((err && err.errMsg) || (err && err.message) || '云函数调用失败')
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
    applyMemberDayBonus?: boolean
  }) =>
    callApi<{
      consumptionId: string
      pointsAfter: number
      growthAfter: number
      used: number
      overLimit: boolean
      bonusPoints: number
      totalPoints: number
    }>('createConsumption', data),
  submitReview: (data: { platform: string; screenshots: string[]; text?: string; link?: string }) =>
    callApi<{ id: string }>('submitReview', data),
  listMyReviews: () =>
    callApi<{ items: any[] }>('listMyReviews'),
  listReviewSubmissions: (status: string) =>
    callApi<{ items: any[] }>('listReviewSubmissions', { status }),
  reviewAction: (data: { id: string; subAction: 'approve' | 'reject'; reason?: string; specialReason?: string }) =>
    callApi<{ id: string }>('reviewAction', data),
  listPointEntries: (data: { page?: number; pageSize?: number; sourceType?: string }) =>
    callApi<{
      entries: PointEntry[]
      total: number
      page: number
      pageSize: number
      points: number
      growth: number
      honor: number
      levelName: string
    }>(
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
  manualAdjust: (data: {
    memberId: string
    growthDelta?: number
    pointsDelta?: number
    honorDelta?: number
    reason: string
  }) =>
    callApi<{ pointsAfter: number; growthAfter: number; honorAfter: number }>('manualAdjust', data),
  redeemPoints: (data: {
    memberId: string
    points: number
    item?: string
    note?: string
    itemId?: string
    optionId?: string
  }) => callApi<{ pointsAfter: number; growthAfter: number; itemName: string }>('redeemPoints', data),
  leaderboard: (type: 'growth' | 'honor' = 'growth') =>
    callApi<LeaderboardData>('leaderboard', { type }),
  updateLeaderboardAnon: (anon: boolean) =>
    callApi<{ member: MemberInfo; leaderboardAnon: boolean }>('updateLeaderboardAnon', { anon }),
  listHonorEntries: (data: { page?: number; pageSize?: number }) =>
    callApi<{
      entries: HonorEntry[]
      total: number
      page: number
      pageSize: number
      points: number
      growth: number
      honor: number
      levelName: string
    }>('listHonorEntries', data),
  listEvents: () => callApi<{ items: EventInfo[] }>('listEvents'),
  getEvent: (id: string) =>
    callApi<{ event: EventInfo; myRegistration: { _id: string } | null }>('getEvent', { id }),
  registerEvent: (id: string) =>
    callApi<{ id: string; registrationCount: number }>('registerEvent', { id }),
  cancelEventRegistration: (id: string) =>
    callApi<{ id: string }>('cancelEventRegistration', { id }),
  listMyEventRegistrations: () =>
    callApi<{ items: EventRegistrationInfo[] }>('listMyEventRegistrations'),
  listAdminEvents: () => callApi<{ items: EventInfo[] }>('listAdminEvents'),
  saveEvent: (data: {
    id?: string
    title: string
    images: string[]
    contentMarkdown: string
    status: EventInfo['status']
    registerStart?: string
    registerDeadline?: string
    capacity?: string
  }) => callApi<{ id: string }>('saveEvent', data),
  deleteEvent: (id: string) => callApi<{ id: string }>('deleteEvent', { id }),
  listEventRoster: (id: string) =>
    callApi<{ event: EventInfo; items: EventRosterItem[]; total: number }>('listEventRoster', { id }),
  addEventRegistration: (eventId: string, memberId: string) =>
    callApi<{ id: string }>('addEventRegistration', { eventId, memberId }),
  removeEventRegistration: (id: string) =>
    callApi<{ id: string }>('removeEventRegistration', { id }),
  awardEventHonor: (data: {
    eventId: string
    items: Array<{ memberId: string; honor: number }>
    note?: string
  }) => callApi<{ count: number; awarded: Array<{ memberId: string; honorAfter: number }>; eventId: string }>(
    'awardEventHonor',
    data
  ),
  listRedemptionItems: () =>
    callApi<{ items: RedemptionItem[]; contact: string }>('listRedemptionItems'),
  getRedemptionItem: (id: string) =>
    callApi<{ item: RedemptionItem; contact: string }>('getRedemptionItem', { id }),
  listAdminRedemptionItems: () =>
    callApi<{ items: RedemptionItem[] }>('listAdminRedemptionItems'),
  saveRedemptionItem: (data: {
    id?: string
    title: string
    images: string[]
    contentMarkdown: string
    status: 'on' | 'off'
    sort: string
    options: RedemptionOption[]
  }) => callApi<{ id: string }>('saveRedemptionItem', data),
}
