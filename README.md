# 桌游店会员小程序

基于微信云开发的会员管理系统：微信登录、不可变账号名（可改一次）、成长值/荣誉值/可兑换积分、等级与排行榜、动态会员码扫码录入、小红书/大众点评评论加分审核、赛事报名与荣誉发放、积分商城、积分明细与审计记录。

当前版本：**v1.1.0**（更新日志见 [CHANGELOG.md](CHANGELOG.md)）。

## 项目结构

```text
cloudfunctions/api/       云函数（按 action 分发全部业务逻辑）
miniprogram/
  pages/index/            会员卡（动态会员码）
  pages/points/           积分与荣誉值明细
  pages/profile/          个人资料 / 账号名设置
  pages/setup-account/    首次账号名引导
  pages/review-submit/    评论加分提交
  pages/review-list/      我的加分申请
  pages/leaderboard/      排行榜（成长值/荣誉值，TOP N + 我附近 ±5）
  pages/events/           活动 tab（全部赛事 / 我的报名）
  pages/event-detail/     赛事详情与报名
  pages/mall|item-detail/ 积分商城与商品详情
  pages/privacy/          隐私政策
  pages/admin/home|scan|review|audit|adjust|event-*|item-*/   管理端
  custom-tab-bar/         自定义底部导航（会员卡 / 积分 / 活动 / 我的，纯色 CSS 图标）
  utils/                  API 封装、会话、上传、二维码、格式化
  vendor/qrcode.js        二维码生成库（MIT）
docs/                     术语表、设计、ADR
```

## 部署步骤

1. 用微信开发者工具导入本项目（`project.config.json` 中已配置 appid 与云函数目录）。
2. 开通云开发环境，并把环境 ID 填到 `miniprogram/config.ts` 的 `CLOUD_ENV_ID`（云函数用 `DYNAMIC_CURRENT_ENV`，会自动跟随部署环境，不需要改）。
3. 在开发者工具中右键 `cloudfunctions/api` → “上传并部署：云端安装依赖”。
4. 首次调用会自动创建全部集合（`members`、`configs`、`consumption_records`、`review_submissions`、`point_entries`、`audit_logs`、`member_codes`、`events`、`event_registrations`、`redemption_items`、`honor_entries`），并写入 `configs/default` 默认配置（档位、次数上限、等级门槛、隐私文案、管理员白名单）。
5. 设置管理员：先任意微信登录一次，在控制台 `members` 集合里复制该用户的 `openid`，写入 `configs/default` 的 `admins` 数组（`["openid1", "openid2"]`）。管理员在小程序“我的 → 管理端”进入管理功能。
6. 修改店铺名、档位、上限等：直接编辑 `configs/default` 文档，规则下次生效。

## 环境与运行时

- **环境 ID 只在一处配置**：`miniprogram/config.ts` 的 `CLOUD_ENV_ID`。云函数侧使用 `cloud.DYNAMIC_CURRENT_ENV`，换环境时不需要改云函数代码。
- **更换环境后数据是空的**：首次调用会自动创建全部集合并写入 `configs/default`；记得在新环境的 `configs/default` 里重新填写 `admins` 管理员白名单。
- **云函数运行时**：目标 Node.js 24（`cloudfunctions/api/package.json` 的 `engines` 与 `wx-server-sdk` 4.x）。在微信开发者工具「云开发 → 云函数 → api → 配置 → 运行环境」选择 `Nodejs24.x`，再重新“上传并部署：云端安装依赖”；若控制台没有 24.x，选当前最高版本并告知开发。

## 超级管理员

超级管理员除了管理端全部功能，还能进入「超级管理台」维护**普通管理员名单**与**全部规则配置**（档位、次数限制、会员日、评论加分、等级、排行榜、店铺信息、隐私文案）。

超级管理员的 openid 名单**只能直接在数据库里配置**，页面不提供任何编辑入口：

1. 先用你的微信登录一次小程序（这样 `members` 里会有记录）。
2. 云开发控制台 → 数据库 → `configs` 集合 → `default` 文档 → 添加数组字段 `superAdmins`，值为你的 openid（例如 `["oXXXX..."]`）。
3. 重新进入小程序「我的 → 管理端」，即可看到「超级管理台」入口。

超级管理台里添加管理员的方式是：输入**账号 ID / 账号名 / openid** 模糊搜索 → 在下方结果中选择会员 → 保存名单（未登录过、没有会员记录的 openid 不会出现在搜索结果里）。规则配置的保存按钮固定在页面底部，保存前会弹出本次改动的 diff（例如「会员日：额外 +1，默认 周二/周四 → 额外 +2，默认 周三」）供确认，确认后才写入并记审计。

注意：`configs/default` 文档在首次调用云函数后才会自动生成；`admins`（普通管理员名单）之后可以直接在超级管理台里增删，不必再手改数据库。超级管理员同时具备普通管理员权限。

## 默认规则（可在 configs/default 修改）

- 消费档位：4 小时 +2 分（默认 ¥58）、全天不限时 +3 分（默认 ¥88）；金额可选、可单次覆盖
- 会员日：默认周二、周四，录入消费时提供「按会员日额外 +1 分」勾选项——会员日默认勾选、其他时间默认不勾，操作者可手动勾选或取消；额外分同时计入积分与成长值，可在 `configs/default.memberDayBonus` 调整星期/分值或设 `enabled: false` 关闭
- 消费录入：每会员每周最多 4 次，周一 04:00 重置；超限须填特别录入原因
- 评论加分：默认小红书、大众点评各每月 1 次、每次 +3 分；加分项可在超级管理台自由增删（名称 / 每次积分 / 按周或按月 / 次数上限），会员端选项与审核规则同步生效
- 等级：青铜 0 / 白银 100 / 黄金 300 / 黑金 800（占位）
- 排行榜：成长值/荣誉值双榜，TOP 20 名，自己前后各 5 名（`configs/default` 的 `leaderboard` 可调）；荣誉值通过赛事名单发放或手动调整
- 赛事：管理员发布赛事（多图 + Markdown 说明，可设报名开始/截止时间），发布后即展示，会员仅可在报名窗口内自助报名/取消，管理员可随时补录/移除名单
- 积分商城：商品含多图、Markdown 说明与多个兑换选项（每个选项积分可不同）；会员端仅展示并联系工作人员兑换，扣减由管理端执行

## 成长值、荣誉值与积分

- 消费、评论加分、手动新增会**同时**增加成长值和积分；
- 成长值只增不减，决定会员等级与排行榜；
- 荣誉值只增不减，通过赛事名单发放或手动调整获得，不参与等级与积分兑换，仅展示并计入荣誉值排行榜；
- 积分可被兑换扣减（管理端“积分管理 → 兑换扣减”），扣分不影响成长值与等级；
- 管理端“积分管理 → 新增”可只加成长值、积分、荣誉值或任意组合，原因必填并写入审计；
- 排行榜所有会员自动参与，可在“我的”页切换匿名（对他人隐藏昵称/账号名，本人仍可见自己）。

历史会员首次登录时会自动用原积分初始化成长值，无需人工迁移。

## 说明

- 所有积分变动同时写入 `point_entries`（会员可见）与 `audit_logs`（管理员可筛选），荣誉值变动写入 `honor_entries`，均通过云数据库事务保证一致。
- 动态会员码 60 秒过期，内容为服务端签发的随机 token；离线时提示使用账号名兜底。
- 隐私政策页文案来自后端配置并按 `{{storeName}}`、`{{contact}}` 占位替换后下发，前端不做替换。
- 常用操作：`npm install` 安装开发依赖，`npm run typecheck`（等价 `npx tsc --noEmit -p tsconfig.json`）做类型检查。
