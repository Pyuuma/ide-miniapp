# 桌游店会员小程序 v1 设计（待确认草稿）

配套文档：[CONTEXT.md](../CONTEXT.md)（术语）、[ADR-0001](adr/0001-wechat-cloud-development.md)（技术选型）。

## 技术选型

基于现有 TS + Sass 小程序模板，使用微信云开发（云函数 + 云数据库 + 云存储），环境 ID `cloudbase-d0g3x3jvnb9c1a61e`。云函数通过 `cloud.getWXContext().OPENID` 识别用户，无需自建登录态。

## 数据集合（云数据库）

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `members` | 会员档案 | openid（唯一固定 ID）、accountName（唯一）、accountNameChanged、nickname、avatar、signature、points（可兑换）、growth（成长值）、leaderboardAnon、level、roles、createdAt、updatedAt |
| `configs` | 规则与店铺信息 | storeInfo、pointTiers、consumptionLimit、reviewBonuses、levelThresholds、admins |
| `consumption_records` | 消费记录 | memberId、tierId、points、amount、note、operatorId、isSpecial、specialReason、scannedCodeAt、createdAt |
| `review_submissions` | 评论加分申请 | memberId、platform、screenshotFileIds、text、link、status、reviewedBy、reviewTime、isSpecial、specialReason、createdAt |
| `point_entries` | 积分明细（会员可见） | memberId、pointsDelta/pointsAfter、growthDelta/growthAfter、sourceType、sourceId、subtype、note、detail、createdAt |
| `audit_logs` | 审计记录（管理员可筛选） | actorId、actionType、targetType、targetId、changeType、delta、reason、specialFlag、metadata、createdAt |
| `member_codes` | 动态会员码 | token、memberId、expiresAt（60 秒 TTL，服务端签发与校验） |

每条积分变动双写 `point_entries` 和 `audit_logs`；`members.points` 作为冗余累计值，写入用云数据库事务保证一致。

## 云函数

所有动作收敛在 `cloudfunctions/api` 单个云函数中，通过 `action` 字段分发：

- `login`：首次进入创建会员并生成随机账号名；返回会员信息与管理员标记
- `renameAccountName`：允许且仅允许一次修改
- `updateProfile`：昵称、头像、签名
- `getConfig`：下发配置；店铺展示信息由后端完成占位替换，前端不做替换
- `issueMemberCode` / `verifyMemberCode`：签发/校验动态会员码（60 秒 TTL）
- `memberUsage` / `findMembers`：管理端查询会员与本周次数
- `createConsumption`：管理端扫码或搜索录入，含规则校验与特别录入
- `submitReview` / `listMyReviews` / `listReviewSubmissions` / `reviewAction`：评论加分申请与审核
- `listPointEntries`：积分明细（分页、筛选）
- `listAuditLogs`：审计列表（按会员、时间、操作人、变动类型筛选）+ 本周特别录入占比
- `manualAdjust` / `redeemPoints`：管理端新增成长值/积分、兑换扣减
- `leaderboard` / `updateLeaderboardAnon`：成长值排行榜与匿名设置

## 页面结构

用户端：

- 首页/会员卡：头像、昵称、@账号名、等级、积分、会员码二维码与倒计时
- 首次设置：展示系统随机账号名，可修改一次（也可暂不改）
- 个人资料：昵称（默认展示、可重复）、头像、签名
- 积分明细：按来源/时间筛选、分页
- 评论加分：选择平台，截图必填，文字/链接选填；我的申请列表
- 隐私政策

管理端（白名单角色可见，同时保留全部用户端功能）：

- 管理首页：扫码录入、待审核数量、审计入口
- 扫码录入：扫码 → 会员信息 + 本周次数（如 2/4）→ 档位/金额/备注 → 提交；超限警告 + 原因必填
- 审核列表：显示该会员同平台最近通过记录与时间差；通过/拒绝（原因必填）
- 审计列表：筛选 + 特别录入占比统计

## 规则配置（示例值，全部可在云控制台修改）

```json
{
  "storeInfo": {
    "name": "ide·我有更好的想法",
    "privacyContact": "ide·我有更好的想法"
  },
  "pointTiers": [
    { "id": "tier_4h", "name": "4小时", "points": 3, "defaultAmount": 58 },
    { "id": "tier_day", "name": "全天", "points": 4, "defaultAmount": 88 }
  ],
  "consumptionLimit": {
    "period": "week",
    "resetDay": 1,
    "resetHour": 4,
    "maxCount": 4
  },
  "reviewBonuses": [
    { "platform": "xiaohongshu", "points": 3, "period": "month", "maxCount": 1 },
    { "platform": "dianping", "points": 3, "period": "month", "maxCount": 1 }
  ],
  "levelThresholds": [
    { "id": "bronze", "name": "青铜", "minPoints": 0 },
    { "id": "silver", "name": "白银", "minPoints": 100 },
    { "id": "gold", "name": "黄金", "minPoints": 300 },
    { "id": "black", "name": "黑金", "minPoints": 800 }
  ],
  "admins": []
}
```

周期限制支持按周/按月，周重置时间为周一 04:00（可配）。

## 关键流程

1. **首次登录**：openid 作为唯一固定标识；系统生成随机账号名（如 `u` + 8 位随机字符），会员可修改一次，修改后不可变。
2. **扫码录入**：用户端展示动态会员码（60 秒 TTL，内容为 memberId + 时间戳 + 签名）→ 管理端扫码 → 云函数校验签名与 TTL → 返回会员信息与本周次数 → 选档位（金额预填默认值、可单次覆盖）、备注 → 未超限直接录入；超限则警告弹窗 + 原因必填，按特别录入处理并计入本周次数。
3. **评论加分**：提交截图（必填）+ 文字/链接（选填）→ 同平台待审核期间禁止重复提交 → 审核页自动展示该会员同平台最近通过记录与时间差 → 通过 +3（超限则特别录入 + 原因必填）/ 拒绝（原因必填）→ 被拒后可修改重提。
4. **审计**：所有积分增减双写积分明细与审计记录；管理端可按会员、时间、操作人、变动类型筛选，并查看特别录入占比。

## 安全与隐私

- 会员码签名密钥仅存于云环境，客户端不可见；服务端校验 TTL 与签名，操作人以 openid 为准。
- 管理端写操作在云函数内校验管理员白名单。
- 隐私政策页 + 首次授权弹窗；头像使用官方 `chooseAvatar`，昵称/签名做长度限制。
- 店铺展示信息由后端按配置替换占位后下发，前端不做替换。

## 实施状态

已按本设计完成 v1 代码：云函数（`cloudfunctions/api`）、用户端页面、管理端页面均已实现并通过 TypeScript 类型检查。部署步骤见 [../README.md](../README.md)。

## 实施顺序

1. 云开发初始化、`configs` 种子数据、登录与首次账号名
2. 用户端：个人资料、会员卡、会员码
3. 管理端：扫码录入、规则校验、特别录入
4. 评论加分：提交、审核（含历史比对）
5. 积分明细、审计列表、隐私合规
6. 真机联调与验收
