# 桌游店会员小程序 v1 设计（待确认草稿）

配套文档：[CONTEXT.md](../CONTEXT.md)（术语）、[ADR-0001](adr/0001-wechat-cloud-development.md)（技术选型）。

## 技术选型

基于现有 TS + Sass 小程序模板，使用微信云开发（云函数 + 云数据库 + 云存储）。环境 ID 配置在 `miniprogram/config.ts` 的 `CLOUD_ENV_ID`；云函数通过 `cloud.DYNAMIC_CURRENT_ENV` 跟随部署环境，并用 `cloud.getWXContext().OPENID` 识别用户，无需自建登录态。云函数运行时目标 Node.js 24，依赖 `wx-server-sdk` 4.x。

## 数据集合（云数据库）

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `members` | 会员档案 | openid（唯一固定 ID）、accountName（唯一）、accountNameChanged、nickname、avatar、signature、points（可兑换）、growth（成长值）、leaderboardAnon、level、roles、createdAt、updatedAt |
| `configs` | 规则与店铺信息 | storeInfo、pointTiers、consumptionLimit、reviewBonuses、levelThresholds、admins |
| `consumption_records` | 消费记录 | memberId、tierId、points（档位分）、memberDayBonus、totalPoints、amount、note、operatorId、isSpecial、specialReason、scannedCodeAt、createdAt |
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

- 首页/会员卡：头像、昵称、@账号名、等级、积分、荣誉值、会员码二维码与倒计时；快捷操作（评论加分、我的加分申请、管理端）与**积分商城入口卡片**
- 底部导航：4 个自定义 tab —— 会员卡 / 积分 / 活动 / 我的，用 CSS 绘制纯色图标（卡片/铜钱/日历/人像，未选中 `#8a8f99`、选中 `#1a1a1a`），选中项文字加粗；tab 页预留底部安全间距
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
    { "id": "tier_4h", "name": "4小时", "points": 2, "defaultAmount": 58 },
    { "id": "tier_day", "name": "全天不限时", "points": 3, "defaultAmount": 88 }
  ],
  "consumptionLimit": {
    "period": "week",
    "resetDay": 1,
    "resetHour": 4,
    "maxCount": 4
  },
  "memberDayBonus": {
    "enabled": true,
    "label": "会员日",
    "weekdays": [2, 4],
    "points": 1
  },
  "reviewBonuses": [
    { "platform": "xiaohongshu", "name": "小红书", "points": 3, "period": "month", "maxCount": 1 },
    { "platform": "dianping", "name": "大众点评", "points": 3, "period": "month", "maxCount": 1 }
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

周期限制支持按周/按月，周重置时间为周一 04:00（可配）。`memberDayBonus.weekdays` 用 JS 星期编号（0 = 周日、1 = 周一 … 6 = 周六），默认 `[2, 4]` 即周二、周四；按中国时区判断默认勾选状态，设为 `enabled: false` 可关闭整个功能。是否加分**由操作者在录入页勾选决定**：会员日默认勾选、非会员日默认不勾，操作者可手动勾选或取消，额外分同时计入积分与成长值。

`reviewBonuses` 是**可增删的评论加分项列表**（最多 10 项），每项含展示名称、每次积分、周期（按周/按月）与周期内次数上限；默认小红书、大众点评。会员端提交页的平台选项直接来自该配置，管理端审核与加分规则同源；新增项由服务端自动分配 `platform` id（`custom_N`）。

## 关键流程

1. **首次登录**：openid 作为唯一固定标识；系统生成随机账号名（如 `u` + 8 位随机字符），会员可修改一次，修改后不可变。
2. **扫码录入**：用户端展示动态会员码（60 秒 TTL，内容为 memberId + 时间戳 + 签名）→ 管理端扫码 → 云函数校验签名与 TTL → 返回会员信息与本周次数 → 选档位（金额预填默认值、可单次覆盖）、备注 → 未超限直接录入；超限则警告弹窗 + 原因必填，按特别录入处理并计入本周次数。录入页提供「按会员日额外 +N 分」勾选项：会员日（默认周二、周四）默认勾选、其余时间默认不勾，操作者可随时勾选或取消；勾选后档位分外再加分，明细标注「会员日 +N」。
3. **评论加分**：提交截图（必填）+ 文字/链接（选填）→ 同平台待审核期间禁止重复提交 → 审核页自动展示该会员同平台最近通过记录与时间差 → 通过 +3（超限则特别录入 + 原因必填）/ 拒绝（原因必填）→ 被拒后可修改重提。
4. **审计**：所有积分增减双写积分明细与审计记录；管理端可按会员、时间、操作人、变动类型筛选，并查看特别录入占比。

## v1.1 新增：荣誉值、赛事、积分商城

在 v1 基础上增加三种能力：荣誉值排行榜、赛事报名、积分商城。术语见 [CONTEXT.md](../CONTEXT.md)，第三余额决策见 [ADR-0003](adr/0003-honor-value-as-third-balance.md)。

### 新增数据集合

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `events` | 赛事 | title、images（≤9）、contentMarkdown、status（draft/published/ended）、registerStart（可选）、registerDeadline（可选）、capacity（可选）、createdAt、updatedAt |
| `event_registrations` | 赛事报名 | eventId、memberId、status（registered/cancelled/removed）、registeredBy、createdAt、cancelledAt、removedAt |
| `redemption_items` | 积分商品 | title、images（≤9）、contentMarkdown、status（on/off）、sort、options[{id,name,points}]、createdAt、updatedAt |
| `honor_entries` | 荣誉值明细 | memberId、honorDelta/honorAfter、sourceType、sourceId、note、createdAt |

`members` 增加 `honor` 字段，存量会员登录时默认 0。

### 云函数新增/变更

- `leaderboard` 增加 `type`（growth | honor），成长值为主、默认进入；匿名开关两个榜单共用
- `listEvents` / `getEvent` / `registerEvent` / `cancelEventRegistration` / `listMyEventRegistrations`：会员端赛事报名
- `listAdminEvents` / `saveEvent` / `deleteEvent` / `listEventRoster` / `addEventRegistration` / `removeEventRegistration` / `awardEventHonor`：管理端赛事与名单、荣誉发放
- `listRedemptionItems` / `listAdminRedemptionItems` / `saveRedemptionItem`：积分商品目录
- `listHonorEntries`：荣誉值明细
- `manualAdjust` 增加 `honorDelta`
- `redeemPoints` 支持 `itemId + optionId` 模板带出积分与备注（商品名），管理员可修改后扣减；保留自定义兑换

### 页面结构

用户端：**活动** tab 内切换「全部赛事 / 我的报名」，赛事详情负责报名与取消；积分商城与商品详情从会员卡、积分页进入；积分明细页并入荣誉值明细切换；排行榜页增加成长值/荣誉值切换（成长值默认）。

管理端：赛事管理（列表/编辑/单场名单）、商品管理（列表/编辑）；积分管理页扩展为兑换操作（选商品+选项自动带出，可改）。

### 关键流程

1. **荣誉值**：管理员在赛事名单勾选会员并填写荣誉值（统一或逐人）后发放，或通过手动调整发放；均写入荣誉值明细与审计记录。
2. **赛事报名**：发布后赛事即展示；会员仅可在报名开始时间至报名截止时间之间自助报名（未设开始时间则发布后即可报，未设截止时间则至赛事结束），同一赛事一人一条；截止后不可取消；管理员补录/移除不受时间与名额限制，操作写审计。
3. **积分兑换**：管理员搜索会员 → 选商品+选项 → 自动带出所需积分与备注（商品名）→ 可修改积分和备注 → 确认扣分；会员端仅展示目录和“联系工作人员兑换”，不直接兑换。

### 超级管理台

在管理端之上增加 **超级管理员** 角色：openid 白名单存放在 `configs/default.superAdmins`，**只能通过云开发控制台修改数据库，页面不提供配置入口**；超级管理员同时拥有普通管理员的全部权限。

入口：管理端首页 →「超级管理台」（仅超级管理员可见，云函数侧同样校验）。

可维护内容：

- **管理员名单**：输入账号 ID / 账号名 / openid 模糊搜索 → 从下拉结果中选择会员加入 → 保存（写入 `configs/default.admins`）；已在名单或已是超级管理员的会员会标注且不可重复添加，超级管理员名单只读展示
- **规则与展示配置**：`storeInfo`、`pointTiers`、`consumptionLimit`、`memberDayBonus`、`reviewBonuses`、`levelThresholds`、`leaderboard`、`privacyText`

规则配置的保存按钮固定在页面底部；保存前对比页面原始配置生成 diff 并弹窗确认，确认后才提交。云函数新增 `getSuperConsole`（读取配置与名单）、`searchAdminCandidates`（按账号名/昵称/openid 模糊搜索会员）、`saveAdmins`（保存管理员名单）、`saveSuperConfig`（保存规则配置，服务端白名单校验，`superAdmins` 不可通过接口修改）。两处保存都会写入审计记录（`config_update` / `admin_list_update`）。

安全调整：`getConfig` 只下发展示与规则字段，不再把 `admins` / `superAdmins` 名单返回给客户端。

初始化：首次部署后先登录一次（生成 `members` 记录），在控制台把该会员的 openid 写入 `configs/default.superAdmins`，之后即可在页面上维护其余配置。

### 技术默认项

- Markdown 由客户端轻量解析后经 `<rich-text>` 渲染；编辑页为 textarea + 编辑/预览切换，预览与详情共用同一解析工具。
- 图片单条最多 9 张，沿用现有云存储上传工具。
- 荣誉值排行榜并列按“荣誉值 → 积分 → 创建时间”排序，与成长榜规则一致。
- 隐私政策文案补充荣誉值与赛事报名信息的收集说明。

## 安全与隐私

- 会员码签名密钥仅存于云环境，客户端不可见；服务端校验 TTL 与签名，操作人以 openid 为准。
- 管理端写操作在云函数内校验管理员白名单。
- 隐私政策页 + 首次授权弹窗；头像使用官方 `chooseAvatar`，昵称/签名做长度限制。
- 店铺展示信息由后端按配置替换占位后下发，前端不做替换。

## 实施状态

已按本设计完成 v1 代码：云函数（`cloudfunctions/api`）、用户端页面、管理端页面均已实现并通过 TypeScript 类型检查。v1.1 新增功能（荣誉值、赛事、积分商城）随本次迭代实现，当前版本 **v1.1.0**（变更见 [../CHANGELOG.md](../CHANGELOG.md)）。部署步骤见 [../README.md](../README.md)。

## 实施顺序

1. 云开发初始化、`configs` 种子数据、登录与首次账号名
2. 用户端：个人资料、会员卡、会员码
3. 管理端：扫码录入、规则校验、特别录入
4. 评论加分：提交、审核（含历史比对）
5. 积分明细、审计列表、隐私合规
6. 真机联调与验收
