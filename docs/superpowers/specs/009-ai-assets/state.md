# 实施进度 · AI 资产（Skill / MCP / 知识库）

## 当前任务
T017 已交付。**tasks.md T001–T017 全部完成**（17/17），等待用户审阅。
剩余工作都在「阻塞项」里：资产 HTTP 接口 / 真栈接线 / `opencode.json` 写入器 / RLS（仓外）。

## 已完成
- **T017** SC-003 验收：授权与收藏分离 + 无权资产不可见 / 不可用
  - 新增 `acceptance-sc003.test.ts`（6 条用例 / 231 断言），与 T004 / T011 的抽样用例分层，
    验收层做全格扫描与出口一致性
  - 可见性全矩阵：7 状态 × 3 空间 × 6 类身份 = 126 格，逐格与独立口径对账；
    「不可见是默认」另扫 21 格（非作者 + 无授权 + 非共享状态）
  - 收藏全扫描（真库）：21 份资产逐个收藏，可见性一格不变、`role_resource` 仍 0 行
  - 收藏清单契约：`favoriteAssetIds()` 是原始清单，过滤后只剩可读的（`fav_dept` /
    `fav_personal` 被滤掉，`fav_global` / `fav_granted` 留下）
  - 下发不超出可见：无授权只剩内建治理 server；read 授权只下发可用状态；review 授权可读
    但不下发（下发出口按设计更严）
  - 排序不是过滤：`orderForDrawer()` 是排列，读不到的资产仍在输出里
  - 四组变异（M1–M4）：M1 / M2 红 3（共用判据），M3 / M4 红 1
  - 门禁：asset-service **197 pass / 0 fail**（+6）；`tsgo --noEmit` 0 errors；
    oxlint 0 warnings / 0 errors；`bun.lock` 无 diff
  - 缺口：四个判据今天都**没有生产调用点**（资产 API / 抽屉 / `opencode.json` 未落）——
    验的是判据与契约，不是真栈行为
  - 详见 `acceptance-sc003.md`

- **T016** SC-002 验收：生命周期状态流转 + 审核两道关分离
  - 新增 `acceptance-sc002.test.ts`（4 条用例 / 573 断言），与 T008 / T009 的用例**分层**：
    T008 分段测、T009 抽样测，验收层补「连起来还对不对」与「有没有漏格」
  - ① 连续旅程（真 PGlite + 真目录）：草稿 → 驳回 → 重提 → 发布 → 迭代 → 迭代发布 → 下线
    → 上线 → 归档 → 终态再拒；步步对账状态 / 版本 / 发布时间 / 文件位置
  - ② 身份 → 权限口径：6 类身份的权限集与 `effectivePermissions()` 实际输出逐条一致
  - ③ 全矩阵：7 状态 × 9 动作 × 6 类身份 = 378 格；权限不够 ⇒ `actor_not_allowed`（且先于
    状态判断），权限够但源状态不对 ⇒ `invalid_source`；review / admin 逐格互不蕴含
  - ④ 拒绝无副作用：越权 / 非法源状态 / 缺源目录都不改库、不动文件、不发通知
  - 五组变异（M1–M5）红点据实记录：M1 / M2 为「一类改动红一片」，M3–M5 只红对应判据
  - 门禁：asset-service **191 pass / 0 fail**（+4）；`tsgo --noEmit` 0 errors；
    oxlint 0 warnings / 0 errors；`bun.lock` 无 diff
  - 详见 `acceptance-sc002.md`

- **T015** 详情页「▶ 让 AI 助手执行此 skill」填入指令（FR-010 / 设计 §1.4）
  - `ai-assets/execute-skill.ts`：`执行skill指令()` 纯函数，出「请使用「名」这个 skill：描述」；
    描述 `trim()`，空描述不留冒号尾巴；句子不以 `!` / `/` / 空白 `@` 开头（避开输入框三种形状特判）
  - `ai-assets/asset-detail.tsx`：头部主按钮**只对 `type === "skill"` 渲染**（MCP / 知识库上没有
    「执行」这回事）；处理器只透传，判据与失败文案都住在接线盒（`#002-06`）
  - `ai-session/send-to-session.ts`：`写入方式 = "追加" | "替换"`；收件口签名加方式；
    `发送到会话(文本, 方式 = "追加")`。**跨栏接缝仍只有一条**，没有加 Provider（`#005-27`）
  - `ai-session/session-panel.tsx`：`替换` 走上游门面 `setText`（与指令卡 `onPick` 同义），
    否则 `addText`；两条路都 `restoreFocus()`
  - 五处用例：`execute-skill` 4 + 详情 3 + `send-to-session` 3 + 面板 1；六组变异（M1–M6）红点
    据实记录（M6 为部分覆盖，不夸大）
  - 门禁：单测 20 pass / 0 fail；详情 + 面板 104 pass / 0 fail；全量组件 1360 pass / 0 fail；
    全量单测 1193 pass / 27 fail（基线 1177 / 27，红的集合相同，**既有**）；`tsgo -b` 0 errors；
    oxlint 8 文件 0 errors / 2 warnings（既有）；`bun.lock` 无 diff
  - 详见 `execute-skill.md`

- **T014** MCP 授权三层（授权 / 下发 / 身份）+ 数据隔离四环（FR-009）
  - 验收口径按 D0-12 与用户裁定：**前三环在本仓实测**；第四环（服务端 RLS）以接口契约 +
    外部验收清单交付，**明确记「RLS 未在本仓验证」**
  - 第②环 `asset-service/src/downlink.ts`：`buildUserMcpConfig()` 纯函数，出「这个用户的
    `mcp` 段」。条件是 `type=mcp` ∧ `isAssetUsable` ∧ `role_resource` 里真有
    `(mcp, 资产 id, read)`（空间可见不够：连接详情含静态凭据）；键 = 资产 id（与
    `resource_id` 同一把钥匙）；确定性键序；六种失败码在产出前抛出。**不写 `opencode.json`**
    ——本仓没有写入器，业务连接清单（`connections`）留成显式入参
  - 第③环：remote 注入 `X-User-ID`、local 注入 `USER_ID`，连接清单里的同名值（含大小写变体）
    一律覆盖；不改入参、不共享数组引用。fixture 真子进程证明连接身份与 `_meta` 都到达
  - 治理 server 注册为**内建**：共享常量 `packages/auth/src/builtin-mcp.ts`
    （`GOVERNANCE_MCP_SERVER` / `BUILTIN_MCP_SERVERS`）→ `mcpServerNaming()` 精确名字打标 →
    `sessionRuleset` 第①层整体放行、动作级仍在第③层（提交 `write` / 发布 `admin`）；
    `-copy` 这类蹭名字的 server 走授权行（对照用例）
  - 用例：`downlink.test.ts` 17 条、`openhive-access-builtin-wiring.test.ts` 3 条、
    `openhive-access-mcp.test.ts` 新增 2 条；五组变异（A–E）红点据实记录
  - 门禁：asset-service **187 pass / 0 fail**；auth **286 pass / 3 skip / 0 fail**；
    core access **25 pass / 0 fail**；opencode 三个文件 **16 pass / 2 fail**（两条均为既有
    `openai@6.39.1` 缺 `version.mjs` 的环境错误，与改动无关）；四包 typecheck 0 errors；
    oxlint 9 文件 0/0；`bun.lock` 无 diff
  - 详见 `mcp-downlink.md`

- **T013** Skill 制作入口（右栏 AI 对话生成 skill 落沙箱）（FR-008 / design §5.1）
- **T013** Skill 制作入口（右栏 AI 对话生成 skill 落沙箱）（FR-008 / design §5.1）
  - `governance.ts` 新增第三个工具 `create_skill_draft`：把已落到作者沙箱的 skill 登记为
    草稿资产。skill 文件由模型用普通写工具生成——FR-008 明确「入口 = 右栏 AI 对话，无需
    专门入口」，本次**不加任何前端控件**
  - 判据都在副作用之前：身份（`_meta` → `auth.user` 档案，作者 / 部门不听参数）→ 源目录
    必须是相对路径且解析后仍在 cwd 内 → 目录里有 `SKILL.md` 且 frontmatter 有非空 `name`
    → 写库；任何一步失败都不产生资产行
  - `service.ts` 新增 `createDraftAsset()`：正式元数据校验（含业务分类 seed）+ `insertAsset`，
    **不复制文件**。草稿的存储约定是停在作者沙箱（`assetLocation("draft")` = undefined），
    硬套 `storeAsset` 会先造一份没人读取的共享副本
  - 返回 `assetId` / `skillName` / `next`；用例钉住「制作 → 提交」用同一个 assetId 串链
  - 文档：`governance.md` 增加第三工具语义、残差、9 条变异、同类落点
  - 门禁实测：`asset-service` **170 pass / 0 fail**（+7）；`tsgo --noEmit` 0 errors；
    oxlint（改动文件）0 warnings / 0 errors；`bun.lock` 无 diff（零新依赖）
  - 变异验证（拆完即还原）：`skillNameOf` 不读文件 ⇒ 红 2（成功用例的 skillName +
    文件判据）；制作入口忽略 `_meta` ⇒ 红 1；收模型自报 department ⇒ 红 1；草稿写成
    published ⇒ 红 2；去掉分类 seed 校验 ⇒ 红 1；共用边界检查（制作 + 提交）⇒ 红 2
  - 已知残差：工具要等 T014 注册 / 下发后才出现在模型清单；同一源目录重复调用会产生两份
    草稿；建草稿没有全局「作者角色」门槛（`write` 按资产授予，资产尚不存在时无处可判）；
    frontmatter 只做最小解析，权威解析仍在内核 `ConfigMarkdown.parse`；`mcp-main.ts` 仍需
    真进程 + 真 PG 冒烟

- **T012** 资产治理 MCP server（submit_skill_for_review / publish_skill）（FR-004 / design §2.5 §3.6）
- **T012** 资产治理 MCP server（submit_skill_for_review / publish_skill）（FR-004 / design §2.5 §3.6）
  - `governance.ts`：低层 MCP `Server` + 两个工具；工具名 → 动作**写死**
    （submit_review / publish_tech），不开放 `action` 参数
  - 身份：`_meta["openhive/user"]`；缺失 ⇒ `identity_required`，查 `auth.user`
    不存在 ⇒ `user_not_found`、`status != 1` ⇒ `user_disabled`；部门从库里取，不听参数
  - capability：直接调 `transitionAsset` → `authorizeTransition()`（提交需 write、
    发布需 admin）；拒绝发生在任何文件操作之前；`review` 不蕴含 `admin`、作者不派生管理权
  - 源目录边界：只收相对路径，相对 MCP 进程 cwd 解析后必须仍在 cwd 内（绝对路径 /
    `..` ⇒ `source_outside_workspace`），挡住「把任意系统目录复制成已提交 skill」
  - `mcp-main.ts`：stdio 入口（`connect(process.env)` + `assetsRoot` + `process.cwd()`）
  - 依赖：`packages/asset-service` 新增 `@modelcontextprotocol/sdk@1.29.0`；
    `bun.lock` 仅 +1 行 workspace 依赖（`bun install --frozen-lockfile` 通过，无镜像污染）
  - 文档：新增 `governance.md`（工具语义 / 身份分层 / 残差 / 变异 / 同类落点）
  - 门禁实测：`asset-service` **163 pass / 0 fail**（+11：协议 2 + 提交 6 + 发布 3，
    全部走真 MCP 客户端 / 服务器 in-memory 握手）；`tsgo --noEmit` 0 errors；
    oxlint（改动文件）0 warnings / 0 errors
  - 变异验证（拆完即还原）：忽略 `_meta` 恒用 u1 ⇒ 红 3（#003-03 第②类，据实记）；
    注入假 admin 授权 ⇒ 红 2；去掉源目录边界 ⇒ 红 1；发布映射成 approve_business ⇒ 红 2
  - 已知残差：**尚未注册 / 下发**（T014）；`mcp-main.ts` 需真进程 + 真 PG，本机未测；
    工具只流转已存在资产（登记归 T013）；无审计；`USER_META_KEY` 跨包靠注释保持一致

- **T011** 授权 vs 收藏分离（收藏只影响抽屉排序）（FR-007 / design §1.3 §1.5）
  - 迁移 `0012_asset_preferences.sql`（＋ `.down.sql`）：`auth.asset_favorite`
    （个人偏好，主键 `(user_id, asset_id)`）、`auth.asset_usage`（每用户每资产一行
    `last_used_at`）；两表外键均级联删除；每表每列中文注释；`asset_id` 单列索引供
    「谁收藏 / 谁用过」解析
  - `preferences.ts`：`addFavorite` / `removeFavorite`（一条数据修改 CTE，插入成功才
    改 `favorite_count`；幂等、计数不为负）、`isFavorite` / `favoriteAssetIds`、
    `recordUsage`（upsert 最近使用 + `usage_count + 1`）/ `lastUsedAtOf` / `favoriteUsers`
  - `orderForDrawer()`：抽屉组内排序，固定比较链「最近使用倒序 → 使用次数倒序 →
    收藏优先 → id 升序」；排序不过滤、不改入参；设计里「收藏加持 / 收藏低频排后」的
    口径张力在 `preferences.md` §3 写明并标为待确认
  - **授权判定未动**：收藏不是 `effectivePermissions()` / `canReadAsset()` 的输入；
    用例钉住「收藏了个人资产仍读不到」「收藏了别的部门的资产仍读不到」「收藏人仍过不了审核关」
  - `notify.ts`：下线 = 作者 + 收藏者；重新上线 = 收藏者（作者没收藏就不通知）；
    新增「skill 已重新上线」文案；T010 残差里的「使用者」第一半已补齐
  - 文档：新增 `preferences.md`（分离口径 / 排序规则 / API / 残差 / 变异）；`notification.md`
    的矩阵与残差同步
  - 门禁实测：`asset-service` **152 pass / 0 fail**（+19：偏好 16 + 通知 3）；
    `auth` **286 pass / 3 skip / 0 fail**（含 0012 迁移、中文注释全覆盖）；
    `tsgo --noEmit` 两个 package 均 0 errors；oxlint（改动文件）0 warnings / 0 errors；
    `bun.lock` 无 diff
  - 变异验证（拆完即还原）：重复收藏 `do nothing` 改 `do update` ⇒ 红 1；
    收藏提到使用次数之前 ⇒ 红 1；去掉最近使用比较 ⇒ 红 1；
    `bring_online` 改回 `[]` ⇒ 红 2；`canReadAsset` 无条件放行 ⇒ 红 2
  - 已知残差：收藏按钮与抽屉排序接线等资产 HTTP 接口（T017）；`favoriteAssetIds()` 是原始
    清单、列出前须过滤 `canReadAsset()`；用户注销后 `favorite_count` 缓存漂移待对账；
    「最近用过」的通知时间窗设计未定义；本机未跑 `test:real-pg`（默认 skip）

- **T010** 站内信通知（状态变化推送到人，🧩 资产标签）（FR-004 / design §2.6）
  - 迁移 `0011_asset_notification.sql`（＋ `.down.sql`）：`auth.asset_notification`
    一行一人；收件人与资产名写入时快照；`action` CHECK 与 `SKILL_ACTIONS` 双向比对；
    资产 / 用户外键均级联删除（避免死链与阻塞账号清理）；每列中文注释
  - `notify.ts`：`TRANSITION_RECIPIENTS` 收件人矩阵（design §2.6）；收件人从**库里的授权行**
    解析（`role_resource` → `user_role`），去重并排除发起人；批量插入；无收件人返回 0 不抛错
  - `service.ts`：流转提交后写通知；通知失败抛 `AssetNotificationError`
    （`code = "notification_failed"`，消息写明流转已生效），**不回滚状态**
  - 刻意口径：发布不广播；`start_iteration` 不通知（作者自己发起）；`bring_online` 零收件人
    （「使用者」需收藏 / 使用明细，T011 后补）；下线当前只通知作者
  - 文档：新增 `notification.md`（矩阵 / 失败语义 / 残差 / 变异记录）
  - 门禁实测：`asset-service` 133 pass / 0 fail（+16：通知 14 + 服务集成 2）；
    `auth` 286 pass / 3 skip / 0 fail（含 0011 迁移、中文注释全覆盖、真 PG 表清单已更新）；
    `tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings（均为既有告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`submit_review` 收件人改成 author ⇒ 红 3；
    去掉发起人排除 ⇒ 红 1；去掉 `AssetNotificationError` 包装 ⇒ 红 1

- **T009** 审核两道关（业务审核 / 技术发布分离）（FR-005 / design §3.3）
  - `review.ts`：`TRANSITION_REQUIRED_PERMS`（author→write / business_reviewer→review /
    system_admin→admin）＋ `authorizeTransition(viewer, asset, grants, action)`：
    角色由 `effectivePermissions()` 派生，未知动作抛 `unknown_action`，无权限抛
    `actor_not_allowed` 且消息写明缺的权限
  - `service.ts`：`TransitionAssetInput` 删除 `actor`，改收 `viewer` + 可选 `grants`
    （省略时 `grantsFor(db, viewer.userId)`）；授权判定在**任何文件操作与写库之前**
  - 两道关互不蕴含：`admin` 不蕴含 `review`，`review` 不蕴含 `write`（本轮用 13 条新用例钉住）
  - 文档：新增 `review.md`（映射 / 为何不自报角色 / 残差 / 变异记录）；
    `authorization.md` 与 `lifecycle.md` 的入口口径同步
  - 门禁实测：`asset-service` 117 pass / 0 fail（+13：纯逻辑 10 + 流转集成 3）；
    `tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings（均为既有告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`authorizeTransition` 改成直接取 `actors[0]` ⇒ 红 8；
    `grants` 兜底改成 `[]`（不查库）⇒ 红 1
  - 已知残差：同一人显式同时持有 `review` + `admin` 仍可连过两关（FR-005 的口径是「权限互不
    蕴含」，更强的人员分离需 010 审计日志记录每步审核人）

- **T008** 生命周期状态机流转（提交 / 审核 / 发布 / 迭代 / 下线 / 归档）（FR-004 / D0-7）
  - `lifecycle.ts`：转移表新增 `storage` 物理动作（`none` / `copy_to_pending` /
    `move_pending_to_publish` / `move_publish_to_archive`）；错误码扩到资产不存在、
    非 Skill、缺源目录、并发流转
  - `service.ts`：`transitionAsset` 编排——状态机校验 → 文件迁移 → 元数据条件更新；
    写库失败按物理动作回滚（复制类删副本；移动类搬回；迭代发布用备份恢复旧版）；
    回滚失败抛 `AggregateError`
  - `asset.ts`：`updateAssetLifecycle` 条件更新（`where id = ? and status = 期望值`），
    落空返回 `undefined` ⇒ 抛 `concurrent_transition`，不覆盖别人的状态
  - `storage.ts`：`replaceDirectory` —— 源替换目标、旧版保留到 `commit()`，
    `rollback()` 新版退回源 + 旧版放回目标
  - 刻意口径：驳回不动 `pending/`（下次提交覆盖）；下线不搬目录（沿用 T003 裁定，
    见 `lifecycle.md` §4）；`start_iteration` 版本号 +1；发布时间在发布/重新上线时刷新
  - 文档：新增 `lifecycle.md`（流转表 / 次序与补偿 / 并发 / 已知残差）；`storage.md` helper 表补
    `replaceDirectory`
  - 门禁实测：`asset-service` 104 pass / 0 fail（+37：转移表 1 + 目录替换 3 + 条件更新 2 +
    流转编排 10，其余为原有用例）；`tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings
    （均为既有的测试文件告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`publish_tech` 的物理动作改 `none` ⇒ 红 6；去掉条件更新的
    `status` 守卫 ⇒ 红 3；去掉写库失败回滚 ⇒ 红 2；去掉版本 +1 ⇒ 红 1；
    目录替换回滚不恢复备份 ⇒ 红 2

- **T007** 详情 tab（介绍 / 注意事项 / 评价 / 版本）（FR-003 / DESIGN §4.10）
  - `ai-assets/asset-detail.tsx`：头部固定（名称 / 空间·状态徽章 / 作者 / 评分 / 收藏 / 使用次数，
    tab 切换不重建）＋ 四 tab（默认介绍）；`role="tablist"` / `tab` / `tabpanel`，
    左右箭头循环、Home / End，焦点跟随；进入详情焦点落在「返回」（11 用例）
  - 「注意事项」显式不确定性标注（`role="note"`：AI 结论可能偏差、必须人工复核）＋
    资产专属注意事项的空态；介绍（描述 + 标签）、评价（评分汇总 + 反馈数）、版本（版本号 +
    更新/发布日期）无数据源的正文一律写显式空态，**不编造内容**
  - `ai-assets/asset-card.tsx`：外层 `role="listitem"`，内层真 `<button>` 打开详情
    （`aria-label="查看资产：{名称}"`）；列表语义与点击语义分开
  - `ai-assets/asset-visual.ts`：六边形裁切 + 按类型图标抽成共用常量（卡片 / 详情两处共用，
    `#002-06`）
  - `ai-assets/asset-center.tsx`：详情**盖在浏览区上**（页面内状态，不加 `ContentTab`）；
    浏览区 `hidden` 保活（滚动位置与搜索词保留）；返回后焦点归还刚才打开的那张卡
  - **未接线不渲染**：收藏（T011）、「▶ 执行此 skill」（T015）——不画按下去没反应的按钮
  - DESIGN.md 新增 §4.10「AI 资产 · 详情面板」，§4.9 卡片交互口径更新为现状
  - 门禁实测：`test:components` 1356 pass / 0 fail（T006 后 +15：详情组件 11 + 卡片 1 +
    集成 4，其中卡片 1 为原用例改写）；`test:unit` 1186 pass / 27 fail / 19 errors，
    **与 T006 基线逐条相同**（`jsxDEV` 与 T020 上传下载旧红）；`tsgo -b` 0 errors；
    `oxlint`（改动文件）0 errors / 1 warning（为 `workspace-entry.test.tsx` 既有告警）；
    `bun.lock` 无 diff
  - 变异验证：拆掉返回后的 `.focus()` ⇒ 仅「焦点归还原卡片」1 条红（216 pass / 1 fail），
    还原后 237 pass / 0 fail

- **T006** 中栏卡片网格（虚拟滚动）+ 全局搜索（FR-003 / DESIGN §4.9）
  - `ai-assets/grid-model.ts`：`AssetQuery` 三组筛选 ∧ 搜索的**纯函数**交集；搜索口径
    名称 / 描述 / 标签，子串 + 忽略大小写 + 去首尾空格；`网格列数`（240px 最小卡宽 + 12px
    列距，至少 1 列）；常量 `卡片高 132` / `卡片行距 12`（8 用例）
  - `ai-assets/asset-search.tsx`：36px 高、`aria-label="搜索资产"`、清除按钮
    `aria-label="清除搜索"`（点后焦点留在输入框）；受控，值由中栏持有（3 用例）
  - `ai-assets/asset-card.tsx`：**精简四件**——六边形图标（`clip-path`，图标集无 hexagon，
    按类型取 `brain` / `mcp` / `folder`）、单行名称、两行描述、空间/状态徽章（文案取字典）；
    静态条目（`role="listitem"`，无按钮语义 / 无 tabindex，点击留 T007）
  - `ai-assets/asset-grid.tsx`：**按行虚拟滚动**（`@tanstack/solid-virtual`，行高 144、
    overscan 2，单一滚动容器 `#006-30`）；列数按容器宽实时算（`ResizeObserver`）；
    行容器 `role="presentation"`，`listitem` 直挂 `role="list"`；空态「没有符合条件的资产」
  - `ai-assets/asset-center.tsx`：搜索词落在这层（不属于左栏筛选、也不进接入缝），
    `filter` 与左栏共享同一份
  - `workspace-entry.tsx`：中栏占位换成 `AssetCenter`；新增注入缝
    `assets?: () => readonly AssetMetadata[]`（省略 = 空态，**不造假数据**）
  - DESIGN.md 新增 §4.9「AI 资产 · 中栏卡片网格与全局搜索」
  - 门禁实测：`test:components` 1341 pass / 0 fail（T005 后 +17：组件 12 + 集成 5）；
    `test:unit` 1186 pass / 27 fail / 19 errors（+8 = 新增 `grid-model` 用例，红集与 T005
    记录的旧红相同：`jsxDEV` 与 T020 上传下载）；`tsgo -b --force` 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）；`bun.lock` 无 diff
  - 变异验证：拆搜索谓词 ⇒ 红 4（纯逻辑 1 + 组件 2 + 集成 1）；拆类型筛选 ⇒ 红 5（3 + 1 + 1）；
    拆虚拟化（`overscan: 9999`）⇒ 红 2；拆 `assets` 注入接线 ⇒ 集成红 4；均拆完即还原

- **T005** 左栏纯导航（空间筛选 + 三 Tab + 业务分类折叠）+ 模块级页面接线（FR-002 / D0-3 / D0-6）
  - `ai-assets/filter.ts`：空间多选（默认全选）、类型 Tab（默认 Skill）、分类单开手风琴；
    分类行来自 `asset-service/categories` 的 seed，按 `order` 排序，前端不硬编码（5 用例）
  - `ai-assets/asset-nav.tsx`：`role="group"` 空间筛选、`role="tablist"` 类型 Tab、分类按钮
    `aria-expanded` + chevron-right/down；**永不渲染资产行**（7 用例）
  - `workspace/workspace-view.ts`：「模块 → 视图」纯函数，`ai-assets` 走模块级页面（3 用例）
  - `workspace-entry.tsx`：左栏内容按视图分派（项目侧栏 / `AssetNav`），中栏在 AI 资产下换成
    占位 `[data-slot="asset-center"]`（文件 tab 状态保留、仅不渲染）；「项目管理」图标在 AI 资产下
    不亮（`projectOpen` 仍代表项目左栏）
  - `ai-session/projection-module.tsx` + `ai-session-slot.tsx`：右栏投影改读 **最近一个业务模块**
    （进入 AI 资产不换投影，离开后继续跟随）；无 Provider 时退回当前模块，与改动前逐字相同
    （4 用例）
  - DESIGN.md 新增 §4.8「AI 资产 · 左栏纯导航」；D0-14 三处目录清单同步加 `ai-assets`
  - 门禁实测：`test:components` 1324 pass / 0 fail；`test:unit` 1178 pass / 27 fail / 19 errors，
    **与 HEAD 基线逐条相同**（1170 pass / 27 fail / 19 errors，均 `jsxDEV` 与 T020 上传下载旧红）；
    `typecheck` 136 errors，**与 HEAD 基线错误集合逐一相同**（`diff` 为空），T005 文件 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）
  - 变异验证：拆掉 AI 资产左栏分支 ⇒ 集成用例红 2 条（左栏换导航、三组齐备）；
    去掉投影「`ai-assets` 不覆盖记忆」守卫 ⇒ 红 2 条（`projection-module` 停在业务模块、
    集成投影探针），拆完即还原

- **T004** RBAC 授权 + 三级空间 + 授权组（FR-006 / FR-007）
  - 迁移 `0010_role_type.sql`（＋配对的 `.down.sql`）：`auth.role.role_type`
    （闭集 `normal` / `group`，默认 `normal`，CHECK 名 `role_type_check`），带中文 `COMMENT`
  - 模型 `auth/rbac.ts`：`role.roleType` + `ROLE_TYPES`；`grantsFor()` **未改**（它不读这一列）
  - 判定 `asset-service/authorization.ts`：`effectivePermissions()` / `canReadAsset()`；
    三级空间只授读、四类权限各自只蕴含读（`admin` 不蕴含 `review`，两道关靠它）；
    非共享状态对非作者 / 非被授权者不可见
  - 授权组写入路径：`createAuthorizationGroup` / `addGroupMember` / `grantAssetToGroup`
    （组必须是 `group`；`resource_type` 由资产类型决定；资产必须存在；未知 perm 碰库前拒绝）
  - 26 个新用例（asset-service）＋ 4 个 role_type 用例（auth）＋ 真 PG 8 条断言；
    四轮变异验证均恰红；详见 `authorization.md` §4
  - 已知残差：`listAssets` 尚未接收 viewer（可见性过滤在 T005 投影 / T017 接）；
    撤销授权 / 移出组 / 删组的 API 未做（T010 治理后台再补）；部门仍自由文本

- **T003** 资产服务（metadata + storage：复制 / 删除 / rename）（FR-001）
  - 迁移 `0009_asset.sql`（＋配对的 `.down.sql`）：`auth.asset` 22 列，每表每列中文 `COMMENT`；
    闭集 CHECK 与 `metadata.ts` 常量由用例双向比对；`owner_id` 外键不级联
  - 仓储 `asset.ts`：`insertAsset` / `assetById` / `listAssets`（类型 / 状态 / 分类 / 可见范围 /
    搜索，`updated_at desc, id asc`）/ `deleteAsset`（`returning` 判命中）
  - 存储原语 `storage.ts`：`assertWithinRoot`、暂存 → 提交（旧版备份 / 回滚）、
    `copyDirectory`、`moveDirectory`（同卷 rename，`EXDEV` 退化复制）、`removeDirectory`（根内 + 幂等）
  - 服务编排 `service.ts`：`assetLocation`（7 状态 → 目录）、`storeAsset`（校验 → 复制 → 写库 →
    失败补偿）、`discardAsset`（先删元数据 → 再删文件；个人资产不碰共享根）
  - 62 个用例（asset-service）＋ 真 PG 迁移 2 条；三轮变异验证均恰红；详见 `storage.md` §7
  - 已知残差：跨存储无事务（复制成功、写库前崩溃 ⇒ 孤儿目录，T005 后接对账）；
    删元数据成功但删文件失败会抛错，重试返回 `false`（孤儿目录需人工/对账清理）
  - 遗留子任务：`tasks.md` T003 描述里的「rename」已由 `moveDirectory` 覆盖；
    `storeAsset` 的 `targetDirectory` 由调用方按 `assetLocation` 算，T008 接线时复核

- **T002** `/assets` 物理存放约定 + 部署方案（D0-2）
  - 新变量 `OPENHIVE_ASSETS_ROOT`，生产默认 `/assets`；开发机显式 `D:/openhive-stack-state/assets`
  - helper：`assetsRoot` / `assetDirectory` / `pendingDirectory` / `publishDirectory` / `archiveDirectory` / `ensureDir` / `assertSafeSegment`
  - 布局覆盖 pending / global / dept / archive，三类资产目录 `skills` / `mcp` / `knowledge-base`；个人资产不进共享卷
  - 约定同卷临时目录 → rename → 删旧；跨卷 `EXDEV` 退化复制；迭代先备份旧版再替换（T003 实现）
  - 文档：`docs/superpowers/specs/009-ai-assets/storage.md`；`.env.example`、`CONFIG.md`、`plan.md` 已同步
  - 28 个用例通过；两轮变异验证（错误默认根、整体拆掉路径校验）均恰红

- **T001** 统一元数据 + 7 状态机定义（`packages/asset-service`）
  - 元数据 15 项 + `category`；7 状态 = draft / in_review / pending_tech / published / iterating / offline / archived
  - 转移表覆盖提交、业务审核、技术发布、迭代、下线、重新上线、归档；驳回是 `in_review → draft` 且必须带理由
  - 业务分类 seed 9 条（D0-15，待业务管理员审阅）
  - 23 个用例通过（含「7 个状态都从草稿正向可达」）；两轮变异验证均按预期变红

## 治理 MCP 单进程形态（2026-10-26）

形态：内核 spawn **一份** `asset-service/src/mcp-http.ts`（绑 127.0.0.1、系统分配端口）＋
`Config.updateGlobal` 把 `mcp.openhive-governance` 写进全局配置（保留键）。身份与沙箱目录由内核
每次调用注入 `_meta{openhive/user, openhive/directory}`，服务端独立校验。
详见 `../2026-10-26-governance-mcp-single-process-design.md`。

| 判据 | 实测（2026-10-26） |
|---|---|
| 全局配置落位（栈隔离的 `$XDG_CONFIG_HOME`） | `<state>/config/opencode/opencode.jsonc`：`{"mcp":{"openhive-governance":{"type":"remote","url":"http://127.0.0.1:63924/mcp"}}}`。**文件名是 `opencode.jsonc`**（`globalConfigFile()` 在无既有文件时取 `candidates[0]`），不是计划里写的 `.json`。开发机真实 `~/.config/opencode/opencode.json` 未被改动（mtime Oct 20 19:03，`grep -c openhive-governance` = 0） |
| `/mcp` 状态（内核 4711；前门 3010 对 `/mcp` 返回 SPA HTML，探针要打内核） | 020602 王五：`{"openhive-governance":{"status":"connected"}}` HTTP 200；换 020600 李四再查：同一结果 |
| 治理 MCP 进程数 | 换第二个账号后仍 **1 个**：`wmic process ... \| grep -i mcp-http` → 1 行（PID 15356，LISTENING 63924，启动时间 22:34:48，与本次栈一致） |
| 一次真实登记 draft → in_review | **待用户本人实操**（页面里说「把这个 skill 登记成资产草稿并提交审核」），做完后回填本行 |

### 现场发现（实测，非推断）

- **孤儿进程**：起本栈前系统里已有两个更早的 `bun run src/mcp-http.ts`（PID 19352 @21:07 端口 65357、PID 23892 @21:23 端口 55215），是 Task 2 实现期手工探针留下的，父进程已不在。已按 PID 杀掉。这正是 `#010-03` 的形状：清理只打直接子进程就会留孤儿。
- **`STACK_FILE` 是固定路径**（`%TEMP%/openhive-real-stack.json`），同机并行起两份真栈会互相覆盖；本次是与另一会话协调后**独占** 4711/3010 起的。

### 缺口（本机无法覆盖，不算已覆盖）

- **Docker 镜像内实测**：本机没有构建带 `bun` + `packages/asset-service` 的镜像。**没跑**（`#003-04`）。验收命令（部署机执行）：
  `docker compose exec openhive sh -lc 'ps -ef | grep -c "[m]cp-http.ts"'` ⇒ 期望 `1`；
  `docker compose exec openhive sh -lc 'cat "$XDG_CONFIG_HOME"/opencode/opencode.json*'` ⇒ 期望含 `openhive-governance`。
- **Linux 进程组收尾未真机验证**：`kill(-pid)` 分支本机（win32）走的是 `taskkill /T /F`；POSIX 分支只有注入式单测。
- **子进程重启后老会话的 MCP 客户端不会重建**：`MCP.state` 按目录缓存且只读一次 config，新会话正常，老会话要等实例重建。已知边界，未修。
- **测试侧提醒**：若把 `OPENHIVE_ASSET_SERVICE_DIR` 写进 `packages/opencode/.env*`，所有用 `HttpApiApp.routes` 的单测都会真起子进程；测试环境应显式 `OPENHIVE_GOVERNANCE_MCP=off`。

## 阻塞项
- **D0-15（内容）**：分类 seed 是可审阅初稿，正式词条仍需业务管理员确认。
- **D0-6（已裁定，投影部分已落地）**：006 `capabilities.ts` 字段扩充与「资产服务 → 右栏清单」
  供数方式仍未定——T005 只按裁定做了**投影模块记忆**的最小修复；`listAssets` 作投影数据源、
  `GET /assets/capabilities`、`SkillCapability` 扩充留待 T007 / T017。
- **资产列表数据源（T006 已留缝、未接真源）**：中栏网格吃
  `WorkspaceEntry.assets?: () => readonly AssetMetadata[]`，省略即空态。`/assets` 的列表 HTTP
  接口尚未落，`pages/layout-new.tsx` 也还没注入 ⇒ **真栈上资产页今天只有空态**；
  接线在 T017 与后端列表接口一并做（T008 / T009 只落了服务层，未加 HTTP 出口）。
  `AssetGrid` 的列数 / 行高按真容器量，接口接上后无需改。
- **部门 id 化**：发布目录当前用部门名；部门表与稳定 id 待 010，届时迁移 `/assets/dept/*`。
- **没有 `opencode.json` 写入器（T014 留下的主缺口）**：`buildUserMcpConfig()` 只产出「这个
  用户应该拿到哪段 `mcp` 配置」，本仓**没有任何代码把它写进用户的 `opencode.json`**——写到哪、
  谁触发、并发怎么处理都没定。治理 server 与已授权 MCP 资产因此在**部署侧接线之前**仍不会
  出现在模型的工具清单里。
- **🔴 RLS 未在本仓验证（D0-12 / 用户裁定）**：数据隔离第四环（服务端行级过滤）本仓既无业务
  MCP server、也无业务表与策略；`mcp-downlink.md` §6 交付的是接口契约（C1–C8）＋外部验收清单
  （8 条），归 F6/F7 与后续业务 server 执行。**不得在任何报告里写成「RLS 已覆盖」。**
- **业务 MCP 连接清单无常存储**：`connections` 是 `buildUserMcpConfig` 的显式入参，没有配置表 /
  管理端写入路径。
- **端到端接线用例被环境挡住**：`openhive-access-mcp-wiring.test.ts`（真应用里配置 → capability）
  因 `openai@6.39.1` 缺 `version.mjs` 跑不起来；T014 以纯函数用例
  （`openhive-access-builtin-wiring.test.ts`）替代，缺口如实记录（`#002-02`）。
- **T015 残差：指令用显示名，不是 SKILL.md frontmatter 名**：元数据没有这一列；两者不同名时
  内核 skill 工具要靠搜索工作区才能找到。根治需给资产加列（元数据变更），不在 T015。
- **T015 残差：描述里「空白领起的 `@`」会弹提及面板**：`capabilities.ts` 的形状特判；本任务
  **不静默改写用户内容**，留待输入框侧统一处理或资产描述校验时拦。
- **T015 残差：`usageCount` 不因点执行而 +1**（今天也没有资产 HTTP 接口可写）；真栈未验证
  ——中栏资产列表还没接真源，详情页今天在真栈上只到空态（同下条）。

## 最后更新
2026-10-26（治理 MCP 改为单进程形态，真栈三条判据实测通过；Step 5 真实登记待用户实操）
