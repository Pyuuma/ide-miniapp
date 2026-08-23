# 桌游店会员小程序

基于微信云开发的会员管理系统：微信登录、不可变账号名（可改一次）、成长值与可兑换积分、等级与排行榜、动态会员码扫码录入、小红书/大众点评评论加分审核、积分兑换、积分明细与审计记录。

## 项目结构

```text
cloudfunctions/api/       云函数（按 action 分发全部业务逻辑）
miniprogram/
  pages/index/            会员卡（动态会员码）
  pages/points/           积分明细
  pages/profile/          个人资料 / 账号名设置
  pages/setup-account/    首次账号名引导
  pages/review-submit/    评论加分提交
  pages/review-list/      我的加分申请
  pages/leaderboard/      成长值排行榜（TOP N + 我附近 ±5）
  pages/privacy/          隐私政策
  pages/admin/home|scan|review|audit|adjust/   管理端
  utils/                  API 封装、会话、上传、二维码、格式化
  vendor/qrcode.js        二维码生成库（MIT）
docs/                     术语表、设计、ADR
```

## 部署步骤

1. 用微信开发者工具导入本项目（`project.config.json` 中已配置 appid 与云函数目录）。
2. 开通云开发环境（环境 ID 已填 `cloudbase-d0g3x3jvnb9c1a61e`，如不一致请在 `miniprogram/app.ts` 和 `docs/design.md` 中替换）。
3. 在开发者工具中右键 `cloudfunctions/api` → “上传并部署：云端安装依赖”。
4. 首次调用会自动创建全部集合（`members`、`configs`、`consumption_records`、`review_submissions`、`point_entries`、`audit_logs`、`member_codes`），并写入 `configs/default` 默认配置（档位、次数上限、等级门槛、隐私文案、管理员白名单）。
5. 设置管理员：先任意微信登录一次，在控制台 `members` 集合里复制该用户的 `openid`，写入 `configs/default` 的 `admins` 数组（`["openid1", "openid2"]`）。管理员在小程序“我的 → 管理端”进入管理功能。
6. 修改店铺名、档位、上限等：直接编辑 `configs/default` 文档，规则下次生效。

## 默认规则（可在 configs/default 修改）

- 消费档位：4 小时 +3 分（默认 ¥58）、全天 +4 分（默认 ¥88）；金额可选、可单次覆盖
- 消费录入：每会员每周最多 4 次，周一 04:00 重置；超限须填特别录入原因
- 评论加分：小红书、大众点评各每月 1 次，每次 +3；截图必填，审核通过才加分
- 等级：青铜 0 / 白银 100 / 黄金 300 / 黑金 800（占位）
- 排行榜：TOP 20 名，自己前后各 5 名（`configs/default` 的 `leaderboard` 可调）

## 成长值与积分

- 消费、评论加分、手动新增会**同时**增加成长值和积分；
- 成长值只增不减，决定会员等级与排行榜；
- 积分可被兑换扣减（管理端“积分管理 → 兑换扣减”），扣分不影响成长值与等级；
- 管理端“积分管理 → 新增”可只加成长值、只加积分或两者都加，原因必填并写入审计；
- 排行榜所有会员自动参与，可在“我的”页切换匿名（对他人隐藏昵称/账号名，本人仍可见自己）。

历史会员首次登录时会自动用原积分初始化成长值，无需人工迁移。

## 说明

- 所有积分变动同时写入 `point_entries`（会员可见）与 `audit_logs`（管理员可筛选），均通过云数据库事务保证一致。
- 动态会员码 60 秒过期，内容为服务端签发的随机 token；离线时提示使用账号名兜底。
- 隐私政策页文案来自后端配置并按 `{{storeName}}`、`{{contact}}` 占位替换后下发，前端不做替换。
- 常用操作：`npm install` 安装开发依赖，`npx tsc --noEmit` 做类型检查。
