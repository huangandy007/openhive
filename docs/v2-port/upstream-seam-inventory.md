# 上游接缝清单（v2 移植说明书）

> 生成日期：2026-11-26 · 基线：`a1f604bbe0`（v1.19.3）· 对比分支：`multi-tenant`
> 数据来源：本仓库 git 历史（`git diff` / `git log`），**未实跑 opencode v2**。
> 「v2 去向」列来自 `git ls-tree -r --name-only v2.4.2` 的路径核对——**是文件存在性，不是行为等价性**。

## 1. 这份文档是什么 / 怎么用

openhive 是 opencode 的定制 fork。将来若要迁到 opencode 2.x，真正的工作量不在「我们新增的 1600 多个文件」（它们是整块搬），而在**我们改过的上游文件**——先要改对、将来要改回来。这份表把每一个这样的文件记成一行：

| 列 | 含义 |
|---|---|
| 文件 | 相对仓库根的路径 |
| 规模 | 相对基线的 `+/−` 行数与触碰它的提交数 |
| 改了什么 | 这段 diff 做了什么 |
| 为什么 | 业务目标（来自提交信息与设计文档，不是推测） |
| 提交 | 可 `git show` 复核的代表提交 |
| v2 去向 | 该文件在 v2.4.2 里的位置；「v2 无同名」= 需在新结构里找落点或自建 |
| 难度 | 见 §4 |

**用法**：移植时按 §5 的难度排序逐条过；每条先看「改了什么」确认行为，再看「v2 去向」决定是「改 v2 同名文件」还是「在新结构里重建」。

## 2. 口径与复算

```bash
BASE=a1f604bbe0                      # v1.19.3，fork 点
git diff --name-status $BASE..multi-tenant | awk '{print $1}' | sort | uniq -c
#  1614 A / 81 M / 1 D

git ls-tree -r --name-only $BASE > base.txt
git diff --name-status $BASE..multi-tenant | awk '$1=="M"{print $2}' > mod.txt
comm -12 <(sort mod.txt) <(sort base.txt)     # 81 个「基线存在且被修改」= 接缝全集

git diff --numstat $BASE..multi-tenant -- <file>
git log --no-merges --format='%h %s' $BASE..multi-tenant -- <file>
```

**注意**：`M` 里有少量由「上游同名但内容已被整体替换」造成的误报；逐个核对后 81 个都确属定制（无纯格式变更）。

## 3. 总览

| 项 | 数 |
|---|---|
| 修改的上游文件 | **81**（代码接缝 73 + 根配置/杂项 8） |
| 删除的上游文件 | 1（`screenshot-uk.png`，无人引用） |
| 新增文件 | 1614 |
| 接缝总增删 | **+2970 / −556** |

按包分布：`opencode` 34、`app` 26、`ui` 6、`core` 5、`session-ui` 2、根/杂项 8。

## 4. 难度分级标准

| 难度 | 判据 |
|---|---|
| **易** | 只加配置项/参数/一行调用；省略时行为与上游逐字相同 |
| **中** | 在既有流程里插入判断或分支；需读懂上下游契约，但入口/出口形状不变 |
| **难** | 改主流程、改公共签名、或依赖上游内部结构（会随上游重写而失效） |

## 5. 接缝总表

### 5.1 内核 `packages/opencode`（34）

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `src/server/routes/instance/httpapi/server.ts` | +341/−1 · 40 | `createRoutes` 里挂身份/工作目录锚定/项目定位三件中间件，并挂载 30+ 个 `/openhive/*` 路由模块（项目、文件、成员、资产、治理、case、备份、hgraph、模型配置、MCP 监督器） | 全部业务出口的挂载点 + 多租户身份注入 | `11f429d7` | `protocol/src/groups/*` + `server/src/handlers/*`；**v2 无注入额外 group 的接缝** | 难 |
| `src/session/prompt.ts` | +112/−15 · 4 | resource 支路补 `read` 权限门；skill 命令出口补 `skill` 门（agent 解析上移）；客户端 rules 改为 merge 而非覆盖；skills 目录传 permission；MCP `_meta` | FR-004/FR-005 越权封堵（三条不经过工具层的出口） | `0a63df3f` | `core/src/session/prompt.ts`（会话执行重写，门要按新执行模型重做） | 难 |
| `src/config/config.ts` | +117/−3 · 9 | 加 `task_model` / `case_table_mask_samples`；MCP 只认受信来源并恢复权威快照；新增 `replaceGlobalMcp` 整段替换 | 后台模型统一配置；项目级可写配置不能改 MCP 指向（信任边界） | `131caf6e` | `cli/src/config/config.ts` + `core/src/config.ts`（拆两处） | 难 |
| `src/skill/index.ts` | +93/−17 · 2 | 同名 skill 按档位（项目 > opencode > 配置 > 外部 > 内置）+ 路径字典序去重；新增 `reload()`；项目 `.opencode` 按扫描时刻补根 | 并发解析导致赢家不定、真栈误报「快捷方式丢了」；新技能目录要重启才可见 | `cca2686c` | `core/src/skill.ts` + `skill/{discovery,instructions}.ts` | 难 |
| `src/session/system.ts` | +25/−4 · 2 | `skills` 目录吃 `session.permission`，逐条 `evaluate` 过滤 | 工具被 capability 拿掉但提示词照列，提示词与工具清单打架 | `3946f3c9` | `core/src/session/system-prompt.ts` | 中 |
| `src/permission/index.ts` | +18 · 1 | deny 时同步写治理审计 | FR-009「全部拒绝留痕」 | `43fbb089` | `core/src/permission.ts` + `permission/policy.ts` | 中 |
| `src/mcp/index.ts` | +28/−4 · 3 | `getPrompt` / `readResource` 加可选 `meta`；子进程环境剥离平台 PG/MinIO 凭据 | MCP 出口带身份；业务 MCP 子进程不能拿到平台凭据 | `3754c030` | `core/src/mcp/index.ts` | 中 |
| `src/agent/subagent-permissions.ts` | +30/−1 · 1 | 父会话 blanket-deny 配对的 allow 也传给子会话 | RBAC 是 deny+allow 成对；只传 deny 会让子会话静默全拒 | `704f3131` | v2 无同名（子代理在 `core/src/session/subagent-*`） | 中 |
| `src/command/index.ts` | +18/−10 · 1 | MCP prompt 出口带 `_meta` | 三条 MCP 出口同一份身份 | `35ece21b` | `cli/src/commands/*`（MCP prompt 落点需核） | 中 |
| `.../httpapi/handlers/session.ts` | +26/−2 · 1 | 建会话时服务端算 capability 并与客户端规则合并；update 合并顺序改为客户端在前 | 客户端可填 `permission`，不能压过服务端 capability | `e2e353b0` | `server/src/handlers/session.ts` | 中 |
| `.../httpapi/groups/session.ts` | +45/−6 · 2 | prompt/command/shell/init/summarize/message 六端点挂并发限流中间件 | 能被另一个端点绕过的配额不是配额 | `512ee3c6` | `protocol/src/groups/session.ts` | 中 |
| `.../httpapi/groups/mcp.ts` | +5/−3 · 2 | 关闭运行期动态注册 MCP（POST /mcp 恒 403） | 项目级可写配置不能增删 MCP server | `9f75ce9c` | `protocol/src/groups/mcp.ts` | 中 |
| `.../httpapi/handlers/mcp.ts` | +8/−9 · 1 | 同上，实现侧 | 同上 | `9f75ce9c` | `server/src/handlers/mcp.ts` | 中 |
| `src/mcp/catalog.ts` | +13/−1 · 1 | `convertTool` 加第 4 参 `meta`，写进出站 `tools/call` 的 `_meta` | MCP server 要知道「是谁在调」 | `31f2ed4e` | `core/src/tool/mcp.ts` | 易 |
| `src/session/tools.ts` | +7/−2 · 1 | 取一次 `mcpMeta`，server 工具与资源工具共用 | 两处各取一次是假镜像 | `31f2ed4e` | v2 无同名（工具解析并入 `core/src/tool`） | 易 |
| `src/session/session.ts` | +5 · 1 | fork 继承原会话 `permission` | 上游 fork 不带 permission，落回可自批的 `ask` | `e2e353b0` | `core/src/session/session.ts` | 易 |
| `.../httpapi/handlers/project-copy.ts` | +8/−5 · 2 | 命名走统一模型解析入口 | 模型统一配置 | `95b9af9e` | v2 无同名（需核） | 易 |
| `.../httpapi/handlers/global.ts` | +3/−1 · 1 | 读库并入串行队列 | 并发合并要全序（`#010-05`） | `1f6dce8b` | v2 无同名（需核） | 易 |
| `.../httpapi/middleware/error.ts` | +4/−1 · 1 | HTTP 400 配置解析错误只回路径 | 不泄漏配置内容 | `42c1090e` | v2 无同名 | 易 |
| `src/tool/apply_patch.ts` | +3 · 1 | 写前 `assertNotSharedAsset` | AI 不能顺链接改共享发布库 | `24aaa2a9` | v2 无 apply_patch（patch 工具取代） | 易 |
| `src/tool/edit.ts` | +2 · 1 | 同上 | 同上 | `24aaa2a9` | `core/src/tool/plugin/edit.ts` | 易 |
| `src/tool/write.ts` | +2 · 1 | 同上 | 同上 | `24aaa2a9` | `core/src/tool/plugin/write.ts` | 易 |
| `package.json` | +3 · 3 | 声明 `@opencode-ai/auth` 依赖等 | 包结构 | `74f2643c` | `cli/package.json` | 易 |
| `test/session/prompt.test.ts` | +324/−10 · 4 | MCP `_meta`、skill 门、merge 语义的契约用例 | 钉住 004 定制 | `e5296692` | 随实现重写（`cli/test/acp/prompt.test.ts` 近似） | 中 |
| `test/config/config.test.ts` | +102/−95 · 2 | MCP 受信来源与 `task_model` 用例 | 同 config.ts | `1eea6023` | `core/test/config/config.test.ts` | 中 |
| `test/skill/skill.test.ts` | +54 · 1 | 同名去重用例 | 同 skill/index.ts | `df1bbdb6` | `core/test/skill.test.ts` | 中 |
| `test/server/httpapi-mcp.test.ts` | +51/−78 · 3 | MCP 受信 / 403 用例 | 同 groups/mcp.ts | `6798a371` | 需重写 | 中 |
| `test/config/v2-compat.test.ts` | +35/−10 · 1 | v1 配置兼容 + MCP 受信 | 同 config.ts | `ed15f02e` | v2 自带 `core/test/fixture/v1-config`，需重写 | 中 |
| `test/preload.ts` | +12 · 3 | worker 开关、后台模型解析缓存 | 模型统一配置 | `11f429d7` | `core/test/preload.ts` | 易 |
| `test/fixture/fixture.ts` | +5/−6 · 1 | `task_model` 夹具 | 同上 | `1eea6023` | `core/test/fixture/` | 易 |
| `test/fixture/config.ts` | +1 · 1 | `replaceGlobalMcp` 夹具 | 同上 | `f5befbf4` | 同上 | 易 |
| `test/lib/effect.ts` | +1/−2 · 1 | `task_model` | 同上 | `1eea6023` | `core/test/lib/effect.ts` | 易 |
| `test/server/httpapi-exercise/index.ts` | +1/−9 · 1 | POST /mcp 恒 403 | 同上 | `9f75ce9c` | 需重写 | 易 |
| `test/session/system.test.ts` | +2 · 1 | 技能重扫 | 同 skill/index.ts | `cca2686c` | 需重写 | 易 |

### 5.2 前端 `packages/app`（26）

> v2 的 `packages/app` 仍在（1103 个文件），但**目录结构已重构**：我们依赖的 `src/{context,pages,components,utils}` 在 v2 里一个都没有（变成 `src/{shell,session,settings,servers,workspaces,home,composer,providers}`）。下表 26 个里只有 7 个路径在 v2 仍存在。

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `src/pages/layout-new.tsx` | +228/−3 · 24 | 三栏工作台全部接线：左栏会话/文件/实体 tab、中栏内容区路由、右栏会话、资产详情、治理后台、MCP 面板、`case://` 伪路径、产物引用登记 | OpenHive 主界面 | `010697a9` | v2 无 `src/pages/`（新结构 `shell`/`workspaces`/`session`） | 难 |
| `src/index.css` | +218 · 4 | Markdown 排版、正文 16px 五档可调、表格网格阅读器、`.md` 预览元素级版面 | 用户实报「格式展现不出来」 | `c5dd0269` | `app/src/index.css` 仍在，需重新定制 | 中 |
| `src/components/titlebar-tab-strip.tsx` | +65/−3 · 2 | 归档项目标签撞 403 后冻结不再盲探；404 幽灵标签自收 | 归档项目越多，每次刷新 403 越多 | `179d2e0f` | v2 无同名（titlebar 在 `shell/` 下，需核） | 中 |
| `src/context/tabs.tsx` | +41/−1 · 1 | 冻结标记持久化 + `isFrozen`/`markFrozen`/`clearFrozen` | 同上（403 只在请求后才知道） | `179d2e0f` | v2 无 `src/context/` | 中 |
| `src/app.tsx` | +33/−26 · 1 | `AuthGate` 包在 Provider 最外层：未登录不建 Global/Settings Provider | 登录门，登录页只跟网关打交道 | `408da4ef` | `app/src/app.tsx` 仍在（结构不同） | 中 |
| `src/context/notification.tsx` | +20/−2 · 1 | `runWithOwner` 包住 `session.idle` 流回调的 `ensureDirSyncContext` | owner 为 null ⇒ 引用计数只增不减、MCP 不释放（真栈 F12 告警） | `e7173f5b` | v2 无 `src/context/` | 中 |
| `src/context/server-session.ts` | +27/−4 · 1 | 同一条消息显示两遍：两个写入出口的去重判据对齐 | 右栏重复消息 | `c425daea` | 同上 | 中 |
| `src/pages/home/home-controller.ts` | +34/−9 · 1 | 主页项目列以服务端真清单为准 | 本地缓存列不出他人项目 | `44e8082f` | v2 无 `src/pages/` | 中 |
| `src/pages/home/home-projects-controller.tsx` | +34/−18 · 1 | 删冗余入口 | 主页简化 | `1cd1340d` | 同上 | 易 |
| `src/pages/home/home-projects-view.tsx` | +26/−76 · 1 | 删冗余入口 | 同上 | `1cd1340d` | 同上 | 易 |
| `src/vite.config.ts` | +28/−12 · 2 | dev 下 `/openhive` 代理到内核 | 登录/改密同源 Cookie | `e405d93b` | `app/vite.config.ts` 仍在 | 易 |
| `src/utils/server-errors.ts` | +22 · 1 | 归档 403 不剪标签 | 与 tabs 冻结配套 | `54f1db05` | v2 无 `src/utils/` | 易 |
| `src/utils/toast.tsx` | +14/−3 · 1 | 备份恢复当场给进度与结果 | 用户要可见反馈 | `b5881a8f` | 同上 | 易 |
| `src/env.d.ts` | +12 · 2 | 顶栏/登录环境声明 | 类型 | `e441ecec` | `app/src/env.d.ts` 仍在 | 易 |
| `src/context/global-sync/types.ts` | +9 · 1 | 会话 tab 三态类型 | 加载中/暂无/列表 | `a488e72d` | v2 无 `src/context/` | 易 |
| `src/context/global-sync/child-store.ts` | +3 · 1 | 会话 tab 三态 | 同上 | `a488e72d` | 同上 | 易 |
| `src/context/server-sync.tsx` | +4 · 1 | 会话 tab 三态 | 同上 | `a488e72d` | 同上 | 易 |
| `src/context/global-sync/bootstrap.test.ts` | +2 · 1 | 三态用例 | 同上 | `a488e72d` | 同上 | 易 |
| `src/pages/home.tsx` | +4/−7 · 1 | 删冗余入口 | 主页简化 | `1cd1340d` | 同上 | 易 |
| `src/pages/home/home-projects.tsx` | +0/−3 · 1 | 删冗余入口 | 同上 | `1cd1340d` | 同上 | 易 |
| `src/pages/home/home-sessions-view.tsx` | +8/−39 · 1 | 删冗余入口 | 同上 | `1cd1340d` | 同上 | 易 |
| `src/components/settings-models.tsx` | +4 · 1 | 模型页只读展示聊天/后台两槽位 | 模型统一配置 | `37022b9d` | v2 无同名（`settings/` 下需核） | 易 |
| `index.html` | +7/−4 · 1 | 标题与图标改为 OpenHive | 品牌化 | `1a2ec9e1` | `app/index.html` 仍在 | 易 |
| `package.json` | +13/−4 · 6 | 业务依赖（pdf/xlsx 等） | 业务界面 | `e520e1ff` | `app/package.json` 仍在 | 易 |
| `playwright.config.ts` | +11/−1 · 1 | 默认 e2e 排除 `real-stack/**` | 真栈用例不进 mock 门禁 | `5eb2e25f` | `app/playwright.config.ts` 仍在 | 易 |
| `e2e/tsconfig.json` | +2/−1 · 1 | 真栈用例类型配置 | 真栈接缝对账 | `ae7638d9` | `app/e2e/` 仍在 | 易 |

### 5.3 共享 `packages/core`（5）

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `src/database/sqlite.bun.ts` | +16/−2 · 2 | 每条查询与事务的 acquirer 按身份路由到各自连接 | 多租户隔离：一条查询落哪个库在这决定 | `cbe36a9f` | 同名仍在 `core/src/database/` | 中 |
| `src/database/sqlite.node.ts` | +12/−2 · 1 | 同上（同一份路由实现） | 两支都要接，漏一支静默失效 | `cbe36a9f` | 同上 | 中 |
| `src/fs-util.ts` | +17/−1 · 1 | `writeWithDirs` 落盘前判沙箱磁盘配额 | 一处覆盖 write/edit/apply_patch 三个工具 | `ba801253` | `util/src/fs-util.ts` | 中 |
| `src/project/directories.ts` | +44 · 1 | 新增 `removeAll`（删项目全部目录行） | 项目删除要可重入 | `b11030cb` | v2 无同名（`core/src/project/{schema,sql}`） | 中 |
| `test/project-directories.test.ts` | +49 · 1 | `removeAll` 用例 | 同上 | `b11030cb` | 需重写 | 易 |

### 5.4 组件库 `packages/ui`（6）

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `src/v2/components/icon.tsx` | +71 · 3 | hgraph 工具栏四组图标、模式按下态、收藏星形图标 | 关系图工具与资产收藏 | `c6cd6244` | `ui/src/icons/icon/icon.tsx` | 中 |
| `src/v2/styles/theme.css` | +44/−17 · 2 | 品牌金换皮 | 品牌化（宪法 II·§八） | `408da4ef` | `ui/src/styles/theme.css` | 中 |
| `src/i18n/en.ts` | +35 · 4 | 收尾行/错误码/工具卡文案 | 015 收尾行、事实卡片 | `1485e587` | `ui/src/i18n/en.ts` 仍在 | 易 |
| `src/i18n/zh.ts` | +35 · 4 | 同上 | 同上 | `1485e587` | `ui/src/i18n/zh.ts` 仍在 | 易 |
| `src/theme/themes/oc-2.json` | +35/−8 · 2 | 品牌金主题值 | 同上 | `408da4ef` | `ui/src/theme/themes/oc-2.json` 仍在 | 易 |
| `src/v2/components/badge-v2.css` | +7/−1 · 1 | accent 标签字色改 `text-base` | 白字压品牌金底 3.18:1 不过 axe | `2d1cbce5` | v2 无 `v2/` 目录（组件已重排） | 易 |

### 5.5 会话组件 `packages/session-ui`（2）

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `src/components/markdown-worker.ts` | +26/−2 · 1 | worker 不可用时降级主线程投影，提醒只打一次 | worker 脚本加载失败会让整块 markdown 变报错 | `9dcd2db5` | 同名仍在 | 易 |
| `src/components/message-part.tsx` | +33/−3 · 4 | 收尾行挂载、事实卡片信封工具卡渲染与兜底 | 015 收尾行、事实卡片 | `1485e587` | 同名仍在 | 中 |

### 5.6 根配置与杂项（8）

| 文件 | 规模 | 改了什么 | 为什么 | 提交 | v2 去向 | 难度 |
|---|---|---|---|---|---|---|
| `package.json` | +2/−1 · 7 | bun 版本 pin、治理后台入口 | 工具链/业务 | `9ec84180` | 根 `package.json` 仍在 | 易 |
| `turbo.json` | +3 · 1 | 加 `@opencode-ai/auth` 的 test 任务 | 新包进 CI | `c013619d` | 仍在 | 易 |
| `.gitignore` | +20 · 5 | worktree 副本、`.astro/`、浏览器工具产物 | 防误提交 GB 级副本 | `9549dea0` | 仍在 | 易 |
| `bun.lock` | +117/−5 · 15 | 清理镜像 URL 污染 + 新依赖 | 锁文件不进镜像源 | `74f2643c` | 仍在 | 易 |
| `.opencode/opencode.jsonc` | +24/−1 · 3 | 关闭自动更新、高风险动作强制确认、环境准则 | 民警环境 | `bc238a8d` | 仍在 | 易 |
| `packages/containers/bun-node/Dockerfile` | +1/−1 · 1 | bun 1.4.2 | 工具链对齐 | `16c1ecb9` | v2 已删该包（`cli/Dockerfile`） | 易 |
| `packages/stats/server/Dockerfile` | +1/−1 · 1 | bun 1.4.2 | 同上 | `16c1ecb9` | v2 已删 `stats` | 易 |
| `packages/enterprise/src/routes/share/[shareID].tsx` | +5 · 1 | 分享页思考全文跟主会话开关 | 006 思考显示 | `9c610c1e` | v2 已删 `enterprise` | 易 |

**删除**：`screenshot-uk.png`（基线中的图片，当前树已移除，无代码引用）。

## 6. 我们新增的模块地图（1614 个文件）

这些**不是接缝**——它们在 v2 里没有对应物，移植时是「整块搬到 v2 新壳上」。按目录：

| 目录 | 新增文件数 | 是什么 |
|---|---|---|
| `packages/opencode/src/server/openhive/` | 127 | 业务服务层：项目/文件/成员/备份/资产/治理/case/ingest worker/MCP 监督器 |
| `packages/auth/` | 170 | 多租户：登录、账号、JWT/Cookie、RBAC、PG 连接 |
| `packages/asset-service/` | 57 | AI 资产仓储与治理 MCP server |
| `packages/opencode/src/`（其余） | 138 | 内核侧定制模块（配额、身份、审计、表头识别等） |
| `packages/app/src/` | 540 | 业务界面：三栏工作台、案件/实体、AI 资产、治理后台、登录 |
| `packages/app/e2e/` | 51 | 真栈用例 |
| `packages/core/src/` | 14 | 配额/访问通行证/连接路由等共享模块 |
| `packages/session-ui/src/` | 9 | 收尾行、事实卡片 |
| `packages/*/test/` | 约 340 | 上述模块的用例 |
| `docs/` | 约 250 | specs/plans（迁移时不必搬） |
| `adapter_skills/` | 约 40 | 银行卡/财付通流水转换技能资产 |

## 7. 移植顺序建议（建议，不是结论）

按「能不能挂上去」的风险排序，前一步不通就停：

1. **多租户 auth**：v2 的 `server/src/api.ts` 能否挂身份中间件？我们的 170 文件 auth 是纯加法，这一步决定整条路线成立与否。
2. **自定义路由**：39 个 protocol group 在 v2 是硬编码的，验证要改哪几个文件才能挂上 `/openhive/*`（fork 面最大不确定项）。
3. **工具/skill 接缝**：v2 的 `Tool.make` + 工具内 `permission.assert` 比 v1 更干净，`skill` 的档位去重可直接搬到 `core/src/skill/discovery.ts`。
4. **前端壳**：v2 的 app 目录已重构，`layout-new` 的等价物要重建；放最后。

## 8. 缺口与不确定（据实记）

- **未实跑 v2**：本表「v2 去向」是文件存在性核对，**不是行为等价性验证**。标「需核」的 8 处需要在 v2 源码里逐一确认。
- **v2 无多租户**：`server/src/auth.ts` 只有单密码 + HMAC cookie，没有 users/roles——我们的 auth 是整块新建，不是改。
- **v2 无自定义 HTTP 路由插件接缝**：`protocol/src/api.ts` 的 group 列表是 `makeDefaultApi` 硬编码，只能 fork 内改。
- **`app` 26 个接缝里 19 个在 v2 无同名路径**：目录重构（`context/pages/components/utils` → `shell/session/settings/servers/workspaces`），每条都要在新结构里找落点。
- 本表只覆盖 `packages/` 与根配置；`services/`、`sdks/` 的改动未纳入（本分支无）。
