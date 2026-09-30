# 实施进度 · 多用户隔离

## 当前任务
✅ **T012 + T013 已完成**（2026-09-30）——**验收隔离测试**（FR-010 / SC-001 / SC-003）。
**零产品代码改动**（`git diff --stat packages/core/src packages/opencode/src` 无输出），
新增 2 个测试文件，合跑 **9 pass / 0 fail / 33 expect**。
两条出参都达成，但**范围要说准**：
- **T012**「A 读不到 B 的会话/项目」——走**真应用**（`HttpApiApp.routes` + 真实 `signToken` 签的
  带签名 Cookie），**无 mock**；4 条断言**双向**；oracle 用 `bun:sqlite` **直接读库文件**，不经过被测对象。
- **T013**「A 读写不到 `/workspaces/B/`」——挡在中间的是**应用层锚定**（T006），
  **不是 OS 权限**（`plan.md` R3 ② 要求如实这么写）。5 条断言**双向**。
- ⚠️ 两个文件**首次跑都是全绿、没有 RED**（它们是**验证既有行为**）；按 T008/T009 的做法改用
  **变异测试**证敏感性（T012 两次可追溯的见「T012 结论」、T013 四次见「T013 结论」），**全部还原**。
  其中 T013 有一次变异**因错误原因通过**，逼出了「穿越到底被**哪两道**守卫挡住」的真实答案——
  记下来免得下次重犯（`LEARNINGS #002-03` 的同类）。
- ⚠️ **本轮没覆盖**那三条登记缺口（T009 的两条读路径 / T010 的端到端 429 / 长连接）——
  **仍挂账，且目前没有接收方**，见下缺口表与「T012 结论」末节。
四条必读的落点结论见下「T012 结论」「T013 结论」。

**下一个：T014（网关）**——它是 T015/T016/T017/T018 的硬前置。
⚠️ **T015 开工前必须先回来问 D3**（**推迟是裁定本身**）。
不依赖 T014 的可并行候选：**T019–T024**（002 评审移交，6 条）。
📌 **一条待你裁决**：上面那三条缺口**现在没有接收方**——T016 的语义是「跨身份越权 BOLA/BFLA」，
与「同一用户内项目不串」「限流 429」「长连接下的取连接」都不贴切，**硬挂过去就是`LEARNINGS #002-04`
说的把责任推进黑洞**。要不要为它们开新任务（或并入 T019–T024 的某一条），请你定。

## 已完成
- **T012 + T013**（2026-09-30）· **验收隔离测试**（FR-010 / SC-001 / SC-003）。**零产品代码改动**，
  新增 2 个测试文件（`test/server/tenant-db-isolation.test.ts` 4 pass / 20 expect、
  `tenant-directory-isolation.test.ts` 5 pass / 13 expect）。要点见下「T012 结论」「T013 结论」，
  **含四条必须记住的事**（① `OPENHIVE_DATA_ROOT` **只能走 `process.env`**、走 `ConfigProvider` 会被
  无声忽略；② T013 的隔离**由应用层锚定保证、不是 OS**——`plan.md` R3 ② 要求如实写；
  ③ 穿越被挡住的**不是一道守卫**，`read` 是双重、`list` 只有 core 一道；④ 首次全绿不是「已验证」，
  是「还没有 RED」——靠**变异测试**才证得了敏感性）、**一条变异归因错误的自曝**，以及
  **三条如实登记的未覆盖**（T009 两条读路径 / T010 端到端 429 / 长连接）。
- **T011**（2026-09-30）· 沙箱磁盘配额（FR-009）。新增 3 文件 / 改动 1 文件。
  要点见下「T011 结论」，**含四条必须记住的事**（拦点为何选写漏斗 / `replacing` 抵扣是主路径必需 /
  「恰好写满放行」与 T010 方向不同非笔误 / core 抄常量 + 防漂移断言）、
  **一条模块依赖方向的硬约束**（core 与 auth 互相够不着）、**三条明写的缺口**
  （OS 级强制挂 `deploy-todo.md` D-01 / `shell` 绕过 / 符号链接那支无测试）。
- **T010**（2026-09-30）· 每用户并发会话限流（FR-008）。新增 4 文件 / 改动 2 文件。
  要点见下「T010 结论」，**含三件必须记住的事**（模块放 core 的理由 / 两条链分层作用域的实测 /
  `HttpApiMiddleware.Service` **不能写 `requires`**）、**一条顺带实测出的存量 flaky（等你裁决）**、
  以及**一条明写的缺口**（端到端 429 未验证）。
- **T009**（2026-09-30）· `session.project_id` 逻辑隔离 + 零表结构改动。**零生产代码改动**，
  3 条测试（`packages/core/test/session-project-isolation.test.ts`）。要点见下「T009 结论」，
  **含一条必须记住的边界**（`project_id` 是查询侧逻辑隔离，**不是授权门**）、
  **两条顺带发现并登记给 T012/T013 的读路径**，以及**出参① 的敏感性边界**（表那半要让迁移才红）。
- **T008**（2026-09-30）· 项目 = 唯一隔离边界。**零生产代码改动**，4 条特征化测试
  （`packages/core/test/project-sandbox-isolation.test.ts`）。要点见下「T008 结论」，
  **含两处按裁定登记的「条件成立」**（首次提交前同属 `global` / 未 git 化目录的 worktree 在沙箱外）、
  **一处诚实的交代**（本机那个 RED 是 fixture bug 不是产品缺陷），以及**两条变异敏感性实测**。
- **T007**（2026-09-30）· 文件权限 `0700`。**两条 `0700` 断言在本机不可验**（win32 忽略 mode），
  出参 ①「容器非 root」**挂缺口**（无可改产物、本机无 docker）。要点见下「T007 结论」，
  **含一处诚实的空白：本机没有观察到 RED**，以及**一条需你裁定的附带发现**（`turbo.json` 缺 auth 的 test 条目）。
- **T006**（2026-09-30）· 工作目录强制锚定（新增中间件，**上游文件零改动**）。
  要点见下「T006 结论」，**含两条刻意的设计选择**——其中「删 `?workspace=`」那条已于 2026-09-30
  **结案（维持删除）**，并**补了一条变异验证过的测试**守住它（此前无人守）。
- **T005**（2026-09-30）· db 查询按身份路由到各自连接。**本 feature 首次修改上游自有文件**
  （`packages/core/src/database/sqlite.bun.ts`，用户已批准方案 A）。要点见下「T005 结论」，
  **含两条拿「变异验证」证明过「测试真的守得住」的行为**（重入保护、事务路径）。
- **T004**（2026-09-30）· 每用户一个库的**注册表**落地（`packages/core/src/database/router.ts`，新增）。
  **零改动上游文件**。要点见下「T004 结论」，**含一个测试抓到的串库坑**（`Layer.fresh` 去掉即串库）。
- **T001**（2026-09-30）· 定位 `database.ts` 单例现状 + 可仿模式清单 → 产出 `refactor-targets.md`。
  要点见下「T001 结论」，**含一条影响 T004 落点的结构性发现**。
- **T002**（2026-09-30）· 目录挂载 + 受限用户权限方案 → 产出 `isolation-scheme.md`。
  要点见下「T002 结论」，**含一条阻断 T007 的未裁定问题**（已由 §5 裁定乙解锁）。
- **T003**（2026-09-30）· 验签门落地（取代 002 的「读头即放行」）。要点见下「T003 结论」，
  **含一处对 plan「模式 A」的有意偏离**（`LayerNode.unbound` → `Context.Service`，已 grep 全部引用点同步）。

## 阻塞项
（**无技术阻塞**——T009 / T010 / T011 / **T012 / T013** 均已 2026-09-30 完成，
**003 原计划的 13 条任务（T001–T013）到此全部做完**。还堵着的是**决策闸**而非技术障碍：
**只剩 D3 必须在 T015 开工前问**（推迟是裁定本身，见下「已裁定的事项」）——
**D4 已于 2026-09-30 到点裁定**，T010/T011 的形状不再是未知数。
T007 曾有的 §5 未裁定问题已由 §5 裁定**乙**解锁。

📌 **两条待你裁决**（都不阻塞收工，但都悬着）：

1. **存量 flaky（与 003 无因果）**：T010 顺带实测出的
   `user-identity.test.ts` 的「令牌被篡改 → 拒绝」以 **≈1/16** 概率假红
   （机制与修法见下「T010 结论」末节）。**未修**（属 T003 的产物）。**要不要本轮一并修**。
2. **三条缺口现在没有接收方**（T012/T013 收尾时确认，详见下缺口表与「T012 结论」末节）：
   T009 的两条「项目边界之外」读路径、T010 的端到端 429、长连接（SSE/WebSocket）下的取连接行为。
   **没有硬挂给 T016**——T016 的语义是「跨身份越权 BOLA/BFLA」，与这三条都不贴切，
   硬挂过去正是 `LEARNINGS #002-04` 说的「把责任推进黑洞」。
   **你定**：开新任务，还是并入 T019–T024 的某一条。）

### ⛔ 本 feature 未覆盖（登记为缺口，**不是覆盖**——`LEARNINGS #002-02`）

| 缺口 | 原因 | 处置 |
|---|---|---|
| 🟡 **T010 端到端「超限的新会话被拒」未验证**（FR-008 的最后一段） | 要让 `active ≥ limit` **得先有真会话在跑**（真 agent 执行，重且不确定）。已做的只是：**判据层**由 core 单测钉死、**接线层**由两条守夜测试证「依赖解析得开、**不是 500**」。守夜测试**证不了 429 真的会发生** | **登记为缺口，不假称已覆盖**（`LEARNINGS #002-02`）。**T012/T013 已于 2026-09-30 收尾但仍未覆盖它**（它们的出参是「A 读不到 B」，不含限流）⇒ **目前没有接收方**，**待你裁决**（见「阻塞项」第 2 条）。在此之前**不得声称 FR-008 已端到端验证**。见下「T010 结论」末节 |
| 🟡 **存量 flaky：`user-identity.test.ts` 的「令牌被篡改 → 拒绝」≈1/16 概率假红**（T010 顺带实测，**与 003 改动无因果关系**） | 测试把 JWT 末字符 `A`→`B`，而 HS256 签名 32 字节 → base64url **43 字符**、末字符**低 2 位是填充** ⇒ 解出的签名字节**逐字节相同**、验签照样通过。**不是安全洞、不是身份门漏了**，是**测试构造缺陷** | **本轮未修**（属 T003 的产物、不在 T010 范围内）。修法：改**中间**字符、或改 payload 后重签。机制与实测数据（300 条探针）见下「T010 结论」。**待你裁决是否本轮一并修** |
| 🟡 **T011 的 OS 级磁盘强制未做**（**D4 裁定丙**的「挂账」那一半）—— **应用层那半已落地**（2026-09-30） | plan 原写「Linux quota / docker volume」，而本机是 **win32、`docker: command not found`、无文件系统 quota** ⇒ 写得出配置、**测不了效果**。T011 已交付**应用层**统计 + 拒绝写入（`quota/disk-quota.ts` 挂在 `FSUtil.writeWithDirs` 上）；**OS 级强制**（容器卷配额 / quota）**没有产物可改**（同 T007 ① 的处境：仓库无部署清单） | **登记为缺口，不假称已覆盖**（`LEARNINGS #002-02`）。⚠️ 后果要说清：**应用层配额绕得过**——`shell` 工具、沙箱内进程自己落盘的写入都不受它管（D4-3 已认）。FR-009 的「底线」这半要靠部署侧关上。✅ **已有落点**：`docs/workspace/deploy-todo.md` **D-01**（本 task 新建的部署侧待办总目），「怎么验」那格写明「**绕开 opencode 工具**灌大文件应被 OS 拒绝；**只验应用层拒绝写入不算过**」 |
| 🟡 **T011：`shell` 工具绕过磁盘配额** | 配额挂在 `FSUtil.writeWithDirs` 上，而 `shell` 里的 `cat > bigfile`、沙箱内进程自己落盘**不走这条漏斗** | **D4-3 已认**（这是「应用层只是第一半」的直接后果），与上一行同源、同由 **D-01** 在部署侧闭合。**未修**——本轮修不了（要 OS 级强制） |
| 🟡 **T011：`usedBytes` 里「符号链接 / 设备 / 管道不计数」那一支无测试守着** | win32 建符号链接要管理员权限 ⇒ 本机构造不出来。该支只有一行 `if (!entry.isFile()) continue`，行为是**跳过** | **登记为缺口**，未假称覆盖。风险低（跳过=少算，方向是宽松而非误拒），留给有 Linux 的环境补 |
| 🟡 **两条「项目边界之外」的读路径**（T009 顺带发现） | ① core 的 `SessionV2.list` 走 `ListAllInput` 变体（**不带任何 scope**）时返回**本库内全部**会话；② legacy 的 `Session.listGlobal` **完全不带 project 条件**，且经 `handlers/experimental.ts` 的 `experimentalHandlers` 挂载（`server.ts` 里**无开关**，直接进路由组） | **T012/T013 已于 2026-09-30 收尾但仍未覆盖**——它们测的是**跨用户**（A 读不到 B 的），而这两条**不跨用户**（T005 的每用户库兜住跨用户），是「**同一用户内项目之间不串**」那半边，**不在 T012/T013 的出参内**。⇒ **目前没有接收方**，**待你裁决**（见「阻塞项」第 2 条）。`project_id` 是**查询侧逻辑隔离**，不是授权门——见下「T009 结论」 |
| 🟡 **T008：「项目各自独立」在首次提交之前不成立** | `initGit`（`packages/opencode/src/project/project.ts`）**只 `git init`、不提交**；而 id = `remote() ?? .git/opencode 缓存 ?? 根提交哈希 ?? global`，三者此时**全空** ⇒ 同沙箱内两个新建项目**同属 `global`**，**不是**互相独立的边界 | **裁定【甲】：登记为「条件成立」，不兜底。** 是否在建项目时自动补一次提交属**产品决定**，不由验证类任务顺手改（宪法 §I 也要求别动上游行为）。测试：`packages/core/test/project-sandbox-isolation.test.ts` 第 3 条——它**断言两者相等**（特征化：上游改了就红，那正是要回来重读的时候）。**影响面 = 同一用户自己的沙箱内**，不跨用户 |
| 🟡 **T008：未 git 化目录的项目 `worktree` 指向文件系统根** | `packages/opencode/src/project/project.ts` 的取法是「global 且无 vcs ⇒ `"/"`」⇒ 沙箱内一个还没 git 化的目录，其项目 `directory` 是**盘根**，**在沙箱之外** | **裁定【乙】：已测出并上报**，未修。⚠️ **别与 T006 混为一谈**——请求目录仍被锚在沙箱内，指到沙箱外的是**项目元数据**这一份。测试：同文件第 4 条 |
| 🟡 **T007 ①「容器以非 root 运行」未做** | **没有可改的产物**：官方 `packages/opencode/Dockerfile` 无 `USER` 指令且只装 CLI 二进制；全仓无服务镜像 / compose / k8s 清单。本机也**无 docker**（`docker: command not found`）。规范出处是 `spec.md` **FR-006** | **登记为缺口，不假称已移交**——**承接它的部署任务根本不存在**（003 无部署任务、仓库无部署产物）。⚠️ **更正**：先写的「挂 `isolation-scheme.md` §11.6 部署任务」是**错引**，§11.6 是 **design-v2 的「AI 资产治理」**章节、`isolation-scheme.md` 无 §11（它只在 §5.1 引 design-v2 §11.6 说明「部署形态 = 一个 opencode 容器」）。见 `LEARNINGS #002-04` |
| 🟡 **T007 ②`0700` 的「已建出」本机不可验，且 auth 侧无人跑** | ① win32 **完全忽略** mode（实测三种写法都得 `666`）⇒ 断言只能 `skip`，**本机没观察到 RED**；② `turbo.json` **没有 `@opencode-ai/auth#test`**，CI（`bun turbo test`）到不了 auth 包 ⇒ 在 Linux 上**也没有人跑它**。**旁证**：002 的整个 auth 包测试（本机 149 pass）从未在 CI 跑过 | 代码已按要求写。**若要真闭合，需裁定是否给 `turbo.json` 加 `"@opencode-ai/auth#test": {}`**——那是**上游文件**（`宪法 §I` 冲突面），**未自行改动**。`/data/{userId}/` 那条**不受此限**（core 的 test 条目已声明，Linux CI 真跑） |
| **`mkdir` 不会收紧已存在目录的权限** | `mode` 只在**创建**时生效；目录若已存在（部署时预建 / 权限被人改过），`0700` 不生效也**不报错** | 未修。与「历史账号惰性创建」同源；若部署约定预先建目录，需由部署侧保证初始权限 |
| 🟡 **`node` 构建条件下「路由真的生效」未被验证** | `sqlite.node.ts` 在本机**加载即报错**（bun 不提供 `node:sqlite`：`error: No such built-in module`），那一支一行都跑不到。已做的只是：路由逻辑抽成**两支共用的一份** `DatabaseConnectionRouting.routed`（于是 bun 支的测试覆盖的正是 node 支调用的那段代码）+ 一条**形状守卫**（读源码断言两支都接了 `routed(...)`）——**形状守卫不是行为验证**，它只防「漏接线」，不证明 node 条件下跑得对 | 需 CI 提供 **node 运行时**才算补齐。在此之前**不得声称「两种构建条件下都已隔离」** |
| **`packages/opencode` 全包 `bun test` 在本机不是可用的门禁** | 实测：全包 3660 tests / **2183s**；且 `test/server` **单独跑**也有**存量 flaky 5s 超时带**（基线 9 fail / 带本次改动 10 fail，失败集合**双向**变动：4 条「基线红、改动绿」，1 条反向，该条单独跑为绿）⇒ 「全包绿」在本机不可达，**不是**本 feature 能修的 | 判据改为「**改动影响面所在的测试文件**全绿」+ 与基线做**名称级差集**（不看总数）。基线与命令见下「T005 门禁」 |
| 🟡 **上一条里 `file HttpApi` 那批 5s 超时的根因已查明（T012/T013 收尾时顺带量出来的）**——**是环境、不是 003** | **实测**（`bun test` 下、只 spawn `rg.exe`、不 import 本项目任何代码的探针，跑两次都是同一形状）：**本机第一次 spawn `rg.exe` 要 ≈4800ms**（两次实测 4874ms / 4800ms），**之后每次只要 ≈30–45ms**。而 `httpapi-file.test.ts` 的 `serves search endpoints` 把**第一次** rg 调用放在一个 **5 秒预算**里 ⇒ 在本机**稳定超时**（单跑该文件 **3/3 次都红**，报 `timed out after 5000ms` / `file search index was not ready`）。探针同时实测出「索引就绪后 `find` 只要 ~46ms/次」⇒ **应用侧一点不慢，慢的是进程冷启动** | **不是 003 引入的**，三条实测依据：① 那两个新测试文件在**进程里根本没被加载**时，单跑 `httpapi-file.test.ts` 照样红；② `git diff --stat multi-tenant...HEAD -- packages/core/src/ripgrep* packages/core/src/filesystem*` **无输出**（003 一行没碰）;③ 这是本机 Windows 上 `rg.exe` 首次启动的代价。**未修**（要改的是上游测试的 5s 预算，属上游文件 = 合并冲突面，且不在本 feature 边界内）。**判据**：见下「T013 结论」末节的复现命令 |
| ~~**两个用户共用同一个 `Location.Ref` 时的隔离**~~ ✅ **已关闭（T006，2026-09-30）** | T004 的落点是「取连接点路由」，按当前 fiber 的 `User` 选库；而 Location 树按**目录**缓存、不按用户分键 ⇒ 后台 fiber 会「陈旧身份捕获」 | **T006 已交付**：`anchor-workspace.ts` 把请求目录强制锚到 `{沙箱根}/{userId}`，两用户碰不到同一目录。验收测试 `test/server/anchor-workspace.test.ts` 真的构造 `Location.Ref.make(...)` 再 `Equal.equals` 比对（不是拿字符串不等充数），同时钉「同一用户拿不到第二个工作区」。**丙（给 Location 键加 userId 维度）按裁定未做，且仍不需要做。** |
| 🟡 **锚定上线前就已存在的会话，其 `directory` 仍优先于锚定** | `planRequest` 是 `session?.directory \|\| defaultDirectory(...)`——**会话行里的 directory 优先于请求**，而锚定改的是请求 | **影响面 = 该用户自己的目录，不是越权**（T005 的每用户库让 `Session.Service.get` 只读自己的库）。**未测未修**，登记为缺口。若要闭合，须在会话创建侧锚定（T006 未做，见其 tasks 段的残留说明） |
| **`node` 构建条件下的锚定未验证** | 同上第 1 行：`sqlite.node.ts` 本机加载即报错。锚定本身与构建条件无关（纯 HTTP 层），但**未在 node 条件下跑过** | 与第 1 行同批交 CI |
| **长连接（SSE `/event`、WebSocket `/pty`、`/tui`）与 `SessionPrompt`（发消息跑 agent）下的取连接行为** | 第三轮探针刻意避开（要 provider/LLM），只测了普通 HTTP 请求 | **T012/T013 已于 2026-09-30 收尾但仍未覆盖**（两者都是「普通 HTTP 请求」形态，**没有一条长连接用例**）⇒ **目前没有接收方**，**待你裁决**（见「阻塞项」第 2 条）。在此之前**不得声称长连接下的隔离已验证** |
| **单进程多库方案本身**（一 client 服务多库、`Semaphore.make(1)` 的全局串行化、事务语义） | 探针只验了前提「acquirer 拿得到 `User`」 | T004 自己的测试覆盖 |

### ⚠️ 顺带上报：宪法 §III 的措辞可能仍需一次修订（**未动宪法**）
宪法 §III 原文：「用户间数据隔离 MUST 靠 **OS 文件权限 + 每用户独立 db** 实现；
MUST NOT 仅靠应用层 `if` 判断过滤。」
- **我的读法（已写进 `plan.md` 的 Constitution Check）**：裁定乙下 §III **仍成立**——
  独立 db 那半边是真正的物理隔离（连接级分离），所以不构成「**仅**靠应用层」。
- **但**：措辞把「OS 文件权限」与「每用户独立 db」**并列**为 MUST 手段，
  一个较真的审计方可能读成「OS 文件权限必须承担用户间隔离」——那样乙就不合规。
- ⇒ **未擅自改宪法**：§六 治理明写「修改本宪法 MUST 经 PR + 书面理由 + 维护者审批」。
  **这是给你的一条待决项**，不是本 feature 擅自处理的事。宪法文件在外层工作区
  （`D:\project\study\openhive\.specify\memory\constitution.md`），不在本仓库。

## 已裁定的事项（feature 内）

- ✅ **D4 配额（2026-09-30 · T010/T011 开工前到点裁定）——三个问题都取了推荐项**：
  1. **维度 + 拦点 = 甲**：数「**活跃执行数**」= `SessionExecution.active` ∩ 本用户的库
     （`packages/core/src/session/execution.ts` 的 `active` 是「本进程正在执行的 session 集合」），
     拦在**启动执行时**（`prompt` → `wake`/`resume`），**不是**建会话时。
     依据：session 只是一行记录，吃资源的是跑起来的 turn。
     ⚠️ **spec.md 验收场景 1 措辞有歧义，没拿它当依据**（「再发起新会话」可读成不让建、也可读成
     不让跑；甲取后者，依据是它自己用的词是**「并发」**）——**与验收方对齐时要主动说出来**。
     否掉了**乙**（按存量 session 拦在 `create`：拦的不是资源消耗，空会话反挡正常使用）
     与**丙**（两道都上：多执行点 + 多阈值，提示难解释）。

     > ⚠️ **同日二次裁定（覆盖面）——上面那条机制的前提被实测推翻一半，改【丙】两条链都拦。**
     > 生产侧有**两条** prompt 链，挂在**同一棵路由树**上（`server.ts` 的 `createRoutes` 同时挂
     > `instanceRoutes` 与 `serverRoutes`）：**A**（`POST /session/{id}/prompt_async` →
     > `SessionPrompt.prompt` → `SessionRunState.ensureRunning`，活跃集合 = `SessionStatus`
     > 的 busy，`InstanceState` 作用域，**完全不碰 core 的 `SessionExecution`**）；
     > **B**（`POST /api/session/{id}/prompt` → core `SessionV2.prompt` → `execution.wake`，
     > 活跃集合 = `SessionExecution.active`，进程级）。
     > ⇒ 上面写的「数 `SessionExecution.active` ∩ 本用户的库」**只覆盖 B 链**，
     > 而**产品 UI 走 A 链**（`packages/app/src/utils/server-compat.test.ts` 断言发的是
     > `/session/ses_1/prompt_async`）。**照字面落 = web UI 主路径零配额**，而 `/api/*`
     > 与 T009 登记的 `listGlobal` 同型——**同一棵树上、没有开关** ⇒
     > **能被另一个端点绕过的配额不是配额。**
     > **二次裁定【丙】**：两条链都拦，**判定 + 阈值 + 计数逻辑全在同一个
     > `quota/session-quota.ts`**，只有「活跃集合从哪取」按链注入。代价：**两个调用点**。
     > 📌 **不连带返工**：T005 的库路由不受影响——A 链用的也是 core 的 `Database.Service`，
     > 路由发生在 `$client.reserve`、按发起查询的 **fiber** 的 `User` 分，消费侧一字不改。
  2. **默认阈值 = `5`**（plan：1600 用户 / 并发活跃 320~480 ⇒ 人均不到 1，5 是 5 倍以上余量）。
     ⚠️ **未经压测，非结论**。
  3. **磁盘配额（T011）= 丙**：**应用层先做**（T011 出参由这半达成），
     **OS 级强制**（Linux quota / docker volume）**登记为部署缺口**。
     否掉了甲（只做应用层不提 OS 层：会留下「已隔离」的不实印象，且应用层**绕得过**）与
     乙（严格照 plan 走 OS：本机 win32 / 无 Docker / 无 quota ⇒ 只能整条挂账）。
  ⚠️ **D4 未涉及、但 T010 开工必查的一条**：这个拦点与 **F4 的工具执行守卫**是否打架。
  **已同步的落点（按文件列，不数条数）**：`dev_tdd.003.md`（Step 0.5 的 D4 段 + 顶部状态行 +
  节奏铁律段）、本文件（本条 + 当前任务 + 阻塞项 + 缺口表 + 最后更新）、
  `tasks.md`（T010 段 + T011 段）、`plan.md`（R4 + 项目文件结构两行 + 依赖清单一行）。

- ✅ **§5 隔离模型（2026-09-30 定稿）：走【乙】· 降级为容器级**。
  单进程模型下「OS 层兜底」不成立（一容器 = 一进程 = 一 OS 主体）⇒ 用户间隔离由
  **每用户独立 db（真文件级物理隔离）+ 应用层锚定**承担；`0700` 降级为**容器外防护**。
  理由见 `isolation-scheme.md` §5.4；**丙（每用户一进程/容器）记为真正的答案 + 触发条件**
  （§5.5，**主要是合规评审触发，不是技术触发**）。
  **已同步 6 处**：`spec.md`（US2 引言 + 验收场景 2 + FR-006 + SC-003）、`plan.md`
  （数据流向图 + 工作空间轴 + R3）、`isolation-scheme.md` §5、`tasks.md` T002 段、
  `2026-09-06-openhive-design-v2.md`（§3 原则 3 + §5.2 + §14.4）、本文件。

- ✅ **2026-09-30 补两刀（同一类缺陷，grep 后一次清完）**：收尾核对时按 `LEARNINGS #002-06`
  「改完一处立刻 grep 谁引用了它」扫了 design-v2，发现两类**说过了头**的记述，已一并修正并加勘误块：
  1. **「应用层 bug 也拦得住」（§3 原则 3 / §5.2）**——**我自己上一轮的表述**。它把 `Map[userId]`
     说成「不存在忘了过滤这条路径」，实际上是**防住「过滤遗漏」、防不住「取错 key」**：
     取错时进程照样打得开别人的库，单进程下 OS 不拦。真正强的是身份**来自验签**。
  2. **「`X-User-ID` 是信任通道 / 只认它」（§3 原则 1 + 数据流 + 必改点 ① + §4.1 + §5.2）**——
     **2026-09-29 的【甲】裁定漏 sync 了 design-v2**（当次只同步了 5 处，见上）。
     `X-User-ID` 是明文头，作不了信任通道；甲下它**降级为路由提示**，验签发生在**内核**这一侧。
  > 教训写在这次的修正动作里：上一轮我把「五处必须同改」当成范围，**范围划小了就等于没扫**。

## T004 前置实测（2026-09-30 · 实测已做；落点**已裁定【甲】**，见下）

T001 留了一句「T004 必须实测」。**测了**（探针用完即删，未入库；完整数据见 `refactor-targets.md` §3）：

| 测法 | 结果 |
|---|---|
| 静态：`hoist` 后的 `hoisted` 集合 | 18 个 global 被切出，**`@opencode/v2/storage/Database` 在列**；主树里 global 残留 = 0 |
| 静态：数 `Database` 引用点 | **7 处** |
| 运行时：替换层计数 + materialize 两个 location key | **每 key 建 8 次**；同 key 再取不重建（缓存有效） |

⇒ **`Database` 不是进程级单例**：随 location key 各建一份，且每个引用点各建一份。
> 🔴 **2026-09-30 更正：本行结论在生产形状下不成立**——它是**用替换层**测出来的。
> 去掉替换层后实测：**整个进程只有一份 `Database.Service` 对象**。详见下「消费侧实测结果」（§C）。
⇒ ⚠️ **由此浮出一条会串库的坑**：路径**不能**由「当前请求的 `User`」决定——location 层按 key 缓存
（TTL 60 分钟），请求身份每次变，缓存里留下的是**第一个**用户解析出来的库。
路径必须由 **key（`Location.Ref`）** 派生，或把 userId **并进 key**。

**三条路（未定，需要你拍板）**：
| 方向 | 思路 | 代价 / 风险 |
|---|---|---|
| 甲 · 换掉 `Database.node` 指向 | 新增一个「按 location 上下文派生 db 路径」的层，作为 replacement 传入 | 零改上游文件；但路径只能由 **key** 派生（不能看请求身份），且需 T006 锚定「一个 location ↔ 一个用户」 |
| 乙 · `Database` 自持 `Map<userId, 连接>`（节点仍 global） | plan.md 原案 | 实测显示 `{db}` 句柄在 7 个引用点各有一份 ⇒ 要么改所有消费者取用方式（侵入大），要么做 drizzle 代理（脆弱） |
| 丙 · userId 并进 location map 的键 | 复用现成 LayerMap + TTL | 要动 `Location.Ref` 的语义（上游类型）⇒ 侵入面偏大 |

### ✅ 落点裁定（2026-09-30 · 用户裁定【甲】）

**甲 = 在 server 根处把 `LocationServiceMap.node` 换成我们自己的 map，并在其中把 `Database.node`
替换成「指向该 location 对应文件」的层。**

> 🔴 **2026-09-30 稍后：本裁定的前提被消费侧实测推翻**（见下「消费侧实测结果」§D）。
> 本节保留作为**决策记录**，但**不要照此开工**。

**⚠️ 我给用户的成本估计被实测推翻，更正两处**（按 `LEARNINGS #002-06`：不实数字代价最大）：

1. 我说过「**甲零改上游文件**」——**不对**。`AppNodeBuilder.build` 的自动分支**不是**两个 server 根
   实际走的路径（R1 的 `hasUnbound(app, LocationServiceMap.node) === false`）；甲的接线点是 **4 处**，
   见下「接线点清点」。
2. 我说过「**甲结构上不可能串库**」——**对 per-location 树成立，对主树不成立**。见下「第一轮实测」。

**为什么不选乙 / 丙**（复述给未来的自己，免得重新发现一轮）：

- **乙**（`Database` 自持 `Map<userId, 连接>`）：它有甲没有的好处——**不用逐根接线**（一处改动，
  所有根自动生效）。但代价是要改 ~10 个上游消费者，或做 drizzle 代理（脆弱）。
  ⚠️ 这条在下面「第一轮实测」之后**分量上升了**：主树那条路径恰恰是甲碰不到的。
- **丙**（userId 并进 location key）：**它并不能单独解决路由**——db 文件指针仍来自
  `Database.node.implementation`，所以丙 = 甲的工作 **加上** 改上游 `Location.Ref` 的类型语义。
  ⇒ 严格劣于甲。

### 接线点清点（2026-09-30 · 实测）

**两个 server 根都活着**，各自服务真实流量（`cli serve` 走 R2；opencode 自带 server 走 R1）：

| # | 接线点 | 现状 | 要改成 |
|---|---|---|---|
| 1 | `packages/server/src/routes.ts`（`makeRoutes`） | 靠 `AppNodeBuilder` 的**自动分支**建 map | 显式传入我们的 map |
| 2 | `packages/opencode/.../httpapi/server.ts` 的 `createRoutes` | 显式调 `buildLocationServiceMap()` | 换我们的 builder |
| 3 | `.../httpapi/handlers/pty.ts` | handler 自己 `Layer.provide(locationServiceMapLayer)` | 换我们的 layer |
| 4 | `.../httpapi/handlers/file.ts` | 同上 | 同上 |

⚠️ **接线式的缝有个固有缺点**：**漏改一处 = 那条路径静默用回公共库**（不报错、不变红）。
⇒ 必须配一条**兜底测试**（把每个根 build 出来，断言解析到的 `Database` 落在租户路径下）。
这条测试**不是锦上添花，它是这个方案的安全网**。

### ⚠️ 第一轮实测（静态依赖图）：主树确实有「不经过 location map」的 Database 路径

**两个根都是「是」**（探针用完即删，未入库）：

- **R1**（`app` 组，56 个直接成员）：**31 个**依赖 Database；根 → Database 共 **600 条路径**，
  其中**含 location map 一跳的 = 0 条**。
- **R2**（`applicationServices`，10 个直接成员）：主树消费者 = `Event` / `Session` /
  `PermissionSaved` / `Credential` + Database 自身。

**原因是结构性的，不是巧合**：`LocationServiceMap.node` 是 **unbound 叶子**
（实测 `kind: unbound`、`dependencies.length === 0`），而 per-location 树来自**另一个模块级 group**
（`locationServices`），由 `LayerMap` **运行时**按 ref 建出——**不是从根可达的子树**。
⇒ **它不在任何一条通往 `Database` 的路径上**，所以在根上替换它**结构上碰不到主树**。

主树的消费者里含**真实租户数据**的持有者：`Session`、`session-projector`、`PermissionSaved`、
`Credential`、`Event`、`ProjectDirectories`。

⇒ **甲按现在划定的范围，不足以保证「用户 A 读不到 B 的会话」——只要有一个租户请求由主树服务。**

### 🔴 消费侧实测结果（2026-09-30 · **HTTP 真请求**，非静态推断）

方法：重建 `packages/server/src/routes.ts` 的 `makeRoutes`（逐字照抄，只把 `Database.node` 换成
带账本的探针层，用 `:memory:`），`HttpRouter.toWebHandler` 起 handler，`fetch` 真实路由。
探针用完即删。**结论：主树那份 `Database` 被真实请求消费了。**

#### A. 因果对照（把「谁在执行 SQL」钉死）

| 场景 | 探针行为 | 结果 |
|---|---|---|
| A1 | 主树那份**一调用就 die** | `GET /api/session?limit=5` → **500**；`POST /api/session` → **500** |
| A2 | 主树那份**只对 `insert` die**，`select` 正常 | 同一个 `GET /api/session` → **200**；`POST /api/session` → **500**（die 在 `insert`） |
| B | **per-location** 那份一调用就 die，主树正常 | 5 个请求**全部 200**，**无一失败** |

A2 是决定性的一条：同一个 GET，`select` 不 die 就 200、`insert` die 就 500
⇒ 这条链路上执行 SQL 的**确实是主树那份**。

#### B. per-location 那份在生产形状下几乎不被调用

场景 B 的 5 个请求里，per-location 那份 `Database` **总共只被调用一次**
（`ProjectCopy.refresh` 的 `db.transaction`），且它的失败被
`packages/core/src/project/copy.ts` 的 `Effect.catchCause(..., "project copy refresh failed")`
**吞成一条 WARN**，不进 HTTP 响应。⇒ **失败都不会暴露**，这正是「看起来像隔离」的典型形状。

#### C. 生产形状下**整个进程只有一份 `Database.Service` 对象**

去掉替换层、按生产写法实测：

```
distinct real Database.Service objects: 1   （19 次构建事件，全部指向同一个对象）
```

配套控制实验（同一 layer 对象被引用两次会构建几次）：

```
E1 merge             builds=1 value=1
E2 provideMerge      builds=1 value=1
E3 两份 Layer.fresh   builds=2 value=2
E4 一份 fresh 一份不 fresh  builds=2 value=2
```

⇒ **Effect 对同一个 layer 对象只构建一次**；`Database.node` 是模块级单例对象，被主树与
per-location 树共同引用 ⇒ **两者共用一份**。这也解释了为什么上面的替换层实验会得出
「每 key 建 8 次」——**替换层是每次新建的 layer 对象**，把 `Layer.fresh` 的效果放大了。

#### D. 对方案的直接影响

**⇒ 甲按现在划定的范围不成立**：真实请求读写的是**主树**那份 Database，
而在 location map 里替换 `Database.node` **碰不到主树**（见上「第一轮实测」）。
⇒ **T004 回到未决状态**，需重新裁定（用户 2026-09-30 已裁定甲，**此实测推翻了它的前提**）。

#### E. 未测出的部分（**不当结论用**）

1. **R1（`packages/opencode/.../httpapi/server.ts` 的 `app` 组）没有运行时实测**——
   全部运行时证据来自 `packages/server` 这条路。R1 只有静态事实。
2. 场景 A 里 500 的**确切 defect 文本没拿到**（body 为空）；归因来自事件顺序 + A2 的方法级对照，
   不是直接读到错误消息。
3. **未覆盖全部路由**（`file` / `pty` / `question` / `permission` 等 group 没跑），
   per-location 那份在别的路由上是否被更多调用，未知。
4. 生产形状探针必然注入了 replacement 节点；「未改动的 `Database.node` 在生产图里也只构建一次」
   这一层是**由控制实验 E1/E2 推出**的，不是直接观测。

**旁证**：`handlers/pty.ts` / `handlers/file.ts` 的 handler 走 v1 `Session`
（`packages/opencode/src/session/session.ts`）；`packages/server` 的 handler 走 v2 `SessionV2`。
两条路都存在（见 `state.md` 上方 R1/R2 的静态结论）。

### ✅ 第三轮实测：acquirer 能不能看到请求的 `User`（2026-09-30 · **生死点，已验**）

甲被推翻后，候选落点收敛到「**在取连接的那一刻路由**」——`packages/core/src/database/sqlite.bun.ts`
里的 `acquirer`。它成立与否，只取决于一个问题：**acquirer 跑起来时，当前 fiber 的 context 里有没有
请求的 `User.Service`**。

> **类型上的死路与绕法（先记下，省得下一个人再撞）**：`Connection.Acquirer` 的类型是
> `Effect<Connection, SqlError, Scope>` —— **`R` 通道写死**，所以「在 acquirer 上声明依赖 `User`」
> 编译不过。绕法是 `Effect.withFiber((fiber) => ...)`（`R = never`，直接摸 `fiber.context`）——
> 同文件的 `run()` 早就这么取 `Client.SafeIntegers` 了。**缝一直在，只是不在类型上。**

**实验一（核心层最小复现，层只 build 一次模拟启动，随后在 provide 了 `User` 的 fiber 里跑真查询）**：

| 问题 | 结果 |
|---|---|
| provide `User` 时账本记什么 | **`acq:alice`** |
| 不 provide 时记什么（对照，证明账本有效） | `acq:NONE` |
| 事务路径（`transactionAcquirer`） | `tx:alice`，同样看得见 |
| `Layer.build` 在谁的 context 里执行 | **调用方的**——build 期查询 provide 了 User 就记 `alice`，没 provide 就记 `NONE` |

**实验二（HTTP 真请求，生产路由树 `HttpApiApp.routes` + `HttpRouter.toWebHandler`，身份门真开着）**：

门确实开着（无凭证 / 坏凭证都 401，**没有绕过门当成功**）：

```
NO-TOKEN  /session -> 401
BAD-TOKEN /session -> 401
```

| 问题 | 结果 |
|---|---|
| **普通请求期间 `NONE` 出现几次** | **0 次**。`GET/POST/PATCH/DELETE /session`、`/session/:id/message` 全部 `acq:alice`（事务路径 `tx:alice`） |
| 有没有请求**同时**出现 userId 与 `NONE` | 没有 |
| 空闲 2000ms 账本新增 | **0 条**（本窗口内无周期性后台查询） |
| 启动期（`DatabaseMigration.apply`） | **`NONE`**——`Database` 层构造不在请求 fiber 里，走建层 fiber |

⇒ **落点成立**：取连接那一刻，身份是拿得到的，且**每次查询看的是发起查询那个 fiber 的身份**
（不是「首个请求」的）。

### 🔴 但它带回来一个方案没预料到的反向风险：**陈旧身份捕获**（不是「无身份」）

`ProjectCopy.refresh` 在账本里记的是 **`acq:alice` / `tx:alice`**，**不是 `NONE`**。
它跑在一个由 `Effect.forkScoped` 派生、经 `InstanceStore.load` 的 `Effect.forkIn` 从**请求 fiber**
分叉出去的**后台 fiber** 里——**该 fiber 继承了发起首个请求的那个用户的身份**。

而 Location 服务树是按 **`Location.Ref`（目录）** 缓存的（`LayerMap`，TTL 60 分钟），
**不按用户分键**。两件事合起来：

> 留驻在按目录缓存的 Location 层里的**后台工作**，会写进**第一个碰该目录的用户**的 db。

危害的**机制**是证据链支撑的（实验一的 `Layer.build 继承调用方 context` + 实验二账本里
`COPY_REFRESH` 段记到 `alice`）；但**危害本身没有直接实测到**——跨用户那组只跑了 3 个请求、
1 个目录对，且 **bob 的两个请求压根没产生 DB 查询（账本 0 条）**，所以严格说：
**没有观察到泄漏，但也没有压到会泄漏的那条路径。**

⇒ **落点成立 ≠ 落点充分**：这一条是「取连接点路由」单独用不够的证据，
它指向 **Location 层的缓存键必须按用户分**（或由 T006 沙箱锚定天然达成——见下）。

### 本轮未覆盖（按 `LEARNINGS #002-02`：缺口写成缺口，不写成覆盖）

1. 只跑了一个进程、一个 `:memory:` 库——**没验证真实文件路径下**的行为（多文件、WAL、目录权限）。
2. **没测长连接**：SSE `/event`、WebSocket `/pty`、`/tui`——它们跨多个用户生命周期，是明显的下一个疑点。
3. **没测 `SessionPrompt`（发消息跑 agent）**——最长的一条链路（工具调用、后台 job、LLM 流），
   `BackgroundJob` / `SessionProcessor` 里的 fork 极可能重现上面的「陈旧身份」同类问题。
4. **没有并发请求**（任务要求串行），「两个用户同时打同一目录、Location 层正在构造」的竞争没测。
5. 跨用户那组样本极小且**没压到目标路径**（见上）。
6. 未验证方案本身（一 client 服务多库、`Semaphore.make(1)` 的全局串行化、事务语义）——只验了前提。

### ✅ 落点最终裁定（2026-09-30 · 用户裁定「**乙＋丙，丙挂 T006**」）

**裁定内容**：T004 的落点 = **取连接点路由**（`sqlite.bun.ts` 的 `acquirer` 按当前 fiber 的 `User`
选库）＋ **Location 缓存键必须按用户分**；后者**不现在做**，而是**挂到 T006 的验收项**上。

**为什么不是「现在就显式给 Location 键加 userId」**（代价已实测，非估计）：

| | 丙现在就做 | 丙挂 T006 |
|---|---|---|
| 改动面 | `Location.Ref` 是 **`packages/schema/src/location.ts` 的 `Schema.Struct`**，加字段 = **改上游 schema 包**（被 **18 个文件** import）；`Ref.make` 字面构造点 **生产 17 处 + 测试 11 处**，`Location.Ref` 相关命中全仓 **198 处** | 只碰 `sqlite.bun.ts` 的 acquirer（一处内部小改）＋ 新增 `router.ts` |
| 与上游冲突面 | 每次上游动 `location.ts` / `schema/location.ts` 都撞上我们 ⇒ 撞宪法 §I | 窄一个数量级 |
| 是否冗余 | 若 T006 沙箱锚定做实，两个用户拿不到同一目录 ⇒ 这一维**纯冗余**，代价是每目录每用户多一棵 60 分钟 TTL 的服务树 | 无冗余 |

**但这个选择把一条安全不变量推迟到了另一个 task**，故附**三个条件**（缺一不可，是把「延迟的风险」
变成「登记在案、有验收项的风险」的全部差别）：

1. **丙 是 T006 的书面验收项**——判据是一条**测试**：「两个用户拿不到同一个 `Location.Ref`」。
   已写进 `tasks.md` 的 T006 段。理由：`LEARNINGS #002-04`（责任推出去时既没指定接收方、
   也没核对接收方是否知道）——002 的欠账就是这么在两份文档之间蒸发的。
2. **T006 落地前，本缺口在本文档登记为「未覆盖」，不写成「已覆盖」**（`LEARNINGS #002-02`）。
   判据：今天没有任何一条测试压过「两用户抢同一目录」，所以它**不是覆盖**。
3. **非 HTTP 入口的回退判据按「谁在跑」而非「有没有 `User`」**——与落点无关，无论选哪个都得做对。
   见下方「非 HTTP 入口」清单：回退判据若是「context 里没有 User 就回退」，
   等于给 HTTP 请求留了一条**静默串库的暗道**。

**改判回「丙现在就做」的触发条件**（现在就写进 T006，到时不必重新论证）：
若 T006 最终**做不到「一人一工作区」**（例如产品上允许民警打开任意路径），
则 `Location.Ref` 不再天然按用户分，丙从「冗余」变成「必需」，**必须回到本 task 补**。

**刻意不做的一件事**：不为丙写一条**长期红灯**的测试。红灯挂久了会被当噪音忽略，比没有更糟——
丙的红灯测试属于 **T006 的交付物**，不属于 T004。

#### 非 HTTP 入口清单（条件 3 的对象）

以下入口**都没有 `User`**，但**共享同一个 `Database.node` 单例**，故都需要回退到「本机用户自己的库」。

> ✅ **T005 收尾后：这个回退是自动的，不必逐个入口去改。** 钩子由**身份中间件**注入，
> 这些入口的 fiber 里**根本没有钩子** ⇒ `routed(fallback)` 直接走 `fallback`（逐字等于上游行为）。
> 所以下表**不是一份待办清单**，它是「回退目标为什么必须存在、以及谁在依赖它」的证据表。
> 换句话说：**T005 之后不需要碰这六个文件**；它们之所以正确，是因为**没被碰**。

| 入口 | 落点 |
|---|---|
| TUI | `packages/opencode/src/cli/tui/layer.ts` → `AppNodeBuilder.build(Global.node)` |
| CLI 主层 | `packages/opencode/src/effect/app-runtime.ts` → `AppLayer` |
| 启动层 | `packages/opencode/src/effect/bootstrap-runtime.ts` → `BootstrapLayer` |
| ACP（编辑器集成） | `packages/opencode/src/acp/service.ts` → `AppNodeBuilder.build(ACPSession.node)` |
| SDK-next | `packages/sdk-next/src/opencode.ts` |
| HTTP server（第二支） | `packages/server/src/routes.ts`（**没看到**身份中间件，待确认） |

回退**目标**是现状的 `path()` 结果（本机用户自己的库）——对本地 CLI/TUI 是**对的**。

## T013 结论（2026-09-30 · 已完成；出参「A 读写不到 `/workspaces/B/`」在**应用层**达成）

**新增 1 文件（`packages/opencode/test/server/tenant-directory-isolation.test.ts`，5 pass / 13 expect），
零产品代码改动。**

### ① 这份断言证明的是什么——按 `plan.md` R3 ② 的原话如实写

挡在中间的是**应用层锚定**（T006）：客户端传什么 `directory` 都被改写成
`{沙箱根}/{自己的 userId}`。**不是** OS 权限——003 已裁定：单进程 = 一个 OS 主体，`0700` 对
「A vs B」零作用，它的效力降级为**容器外防护**（`isolation-scheme.md` §5）。
⇒ 本文件的每条断言只说明「**请求进不来**」；**不得**据此宣称「OS 已隔离」。
（这条不是修辞要求：T007 已登记「两条 `0700` 断言在本机不可验」，若这里写成「OS 拦的」，
两处会互相矛盾。）

### ② 为什么走真实 HTTP 而不是直接调锚定函数

锚定是**全局中间件**，只有接进真实 `createRoutes` 才测得到「装法对不对」——自己搭个最小路由
套中间件，**漏装也照样绿**（同 `anchor-workspace.test.ts` 的理由）。两者不重复：那边证「锚到哪」，
这边证「**锚定之后，A 到底够不够得着 B 的东西**」，走的是文件读接口这条**真实数据通路**。

### ③ 五条断言，全部双向

| # | 断言 | 为什么这么写 |
|---|---|---|
| 1 | A 伪造 `directory` 指向 **B 的沙箱** ⇒ 被忽略，仍落自己的沙箱（**两边都验**） | 比「随便一个不存在的绝对路径」更贴近真实攻击：攻击者会报一个**真实存在**的别人家目录 |
| 2 | A 用 `..` 穿越读 B 沙箱里的文件 ⇒ 非 200 **且响应体不含 B 的明文内容** | 只断言非 200 的话，一个 200 + 错误体、或 500 + 把内容带进错误详情的实现都能混过去。真正的安全属性是「**内容没漏**」 |
| 3 | A 列 B 的沙箱目录 ⇒ 看不到 B 的文件名 | 与 2 是**不同通路**（`list` vs `read`），守卫也不同（见 ④） |
| 4 | **反向**：A 读得到自己沙箱里的文件 | 任务书 Step 4「过紧也是缺陷」——少了它，把所有人锚进一个空目录也能让 1–3 全绿 |
| 5 | **反向**：A 列得到自己沙箱、看得见自己的文件、看不见 B 的 | 同上 |

### ④ ⚠️ 挡住穿越的**不是一道守卫**——变异实测出来的，含一次**归因错误的自曝**

有两道 `FSUtil.contains`，**都在上游自有代码里，本 feature 一行都没加**：
① `packages/core/src/filesystem.ts` 的 `resolve()`（`read` / `list` **共用**）；
② `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts` 的 `content`（只护 `content`）。

| 变异 | 结果 | 含义 |
|---|---|---|
| **M1** 让锚定中间件整体不生效（关掉改写） | **3 条红** | 断言确实挂在**锚定**这件事上（不是碰巧绿） |
| **M2a** 只拿掉 ② | **两条穿越用例都还绿** | ① 兜住了 ⇒ 我当时断言「② 是它的守卫」是**错的** |
| **M2b** 只拿掉 ① | **「列目录」那条红** | `list` **只有** ① 一道 |
| **M2c** 两道都拿掉 | 2、3 才都红 | ② 是冗余的第二道（对 `read` 而言） |

⇒ **「读文件」是双重防护（任一道在就够），「列目录」只有 ① 一道。**
⚠️ 记这个是因为 **M2a（只动 ②）第一次跑出 5 pass**——我原本的注释把功劳记在 ② 上，
是变异测试把错误归因顶出来的。**别把「列目录」的安全性记在 handler 那道守卫上。**

### ⑤ 一个 Windows 专属的测试坑（已修）

本机 `tmpdir()` 给的是 **8.3 短名**（`ADMINI~1`），而应用把目录解析成**长名**
（`Administrator`）——同一个目录，直接比字符串会**假红**。故断言前先 `realpathSync.native` 再归一。
`anchor-workspace.test.ts` 没撞上，是因为它的沙箱目录**从未被创建**，应用不会去 realpath；
本文件要先建出目录放文件，于是必然撞上。（第一次跑就是这么红的一条，**是测试产物、不是产品缺陷**。）

### ⑥ ⚠️ 未覆盖（缺口，不是覆盖）

与 T012 同三条（T009 的两条读路径 / T010 的端到端 429 / 长连接），**且都没有接收方**，
见「阻塞项」第 2 条。**另加一条本文件自己的**：只覆盖**读**路径（`read` / `list`），
「**A 写进 B 的沙箱**」这条**没测**——写漏斗上的那道门是 T011 的配额，断言的是配额、不是归属。

### ⑦ 附：顺带查明「`file HttpApi` 5s 超时」的根因（**是环境，不是 003**）

收尾时按 `#001-01` 去做名称级差集，撞上 `test/server/httpapi-file.test.ts` 的
`serves search endpoints` **单跑 3/3 次都红**，得先判它是不是本轮引入的。查法与本机实测：

```bash
# 本机第一次 spawn rg.exe 的代价（连着 spawn 三次，看第一次与后两次的差）
bun -e 'const RG="C:/Users/Administrator/.cache/opencode/bin/rg.exe";
for (let i=0;i<3;i++){const t=performance.now();
const p=Bun.spawn([RG,"--version"],{stdout:"pipe",stderr:"pipe",stdin:"ignore"});
await p.exited; console.log(JSON.stringify({i, ms: Math.round(performance.now()-t)}))}'
```
- **实测**：`{"i":0,"ms":3921}` / `{"i":1,"ms":37}` / `{"i":2,"ms":36}`
  （另在 `bun test` 下用只 spawn 不 import 本项目的探针复跑两次：**4874ms / 4800ms**，
  后三次 ~30–45ms）⇒ **第一次 ≈4 秒，之后 ~40ms**。
- 那个用例把**第一次** rg 调用放在 **5 秒预算**（`test/lib/effect.ts` 的 `pollWithTimeout`）里
  ⇒ 在本机**稳定超时**。应用侧一点不慢：索引就绪后 `find` 只要 **~46ms/次**（同批探针实测）。
- **与 003 无关的三条依据**：① 那两个新测试文件在进程里**根本没被加载**时，单跑该文件照样红；
  ② `git diff --stat multi-tenant...HEAD -- packages/core/src/ripgrep* packages/core/src/filesystem*`
  **无输出**（003 一行没碰）；③ 代价出现在**进程冷启动**上，与本次改动不在同一层。
- **未修**：要改的是上游测试的 5 秒预算，属上游文件（合并冲突面），且不在本 feature 边界内。

## T012 结论（2026-09-30 · 已完成；出参「A 读不到 B 的会话/项目」在 HTTP 层达成）

**新增 1 文件（`packages/opencode/test/server/tenant-db-isolation.test.ts`，4 pass / 20 expect），
零产品代码改动**（`git diff --stat packages/core/src packages/opencode/src` 无输出）。

### ① 为什么是「验收」而不是「再写一条 core 单测」

T005 的 `packages/core/test/database-routing.test.ts` 证的是**机制**（同一段查询代码按身份落到不同库）；
本任务证的是**接线**——把整棵真应用的链路跑起来，从 HTTP 这一层问「A 能不能看见 B 的东西」。
**机制绿不保证接线装对了**（`multi-tenant-routing.test.ts` 那组守卫的存在就是这个道理），
两者不可互相替代。出处是任务书的 [INT]：「必须在对应 `[FE]` 与 `[BE]` 都通过后启动，
**跑真实端到端，不 mock**。」

### ② 怎么求真的

- 走**真应用**：`HttpApiApp.routes` + `HttpRouter.toWebHandler(...)`，env 经 `ConfigProvider` 注入。
- 走**真签发器**：`@opencode-ai/auth/token` 的 `signToken` 签出**真令牌**（不手搓 JWT——
  测试自己写错格式还会自认为对），装进 `UserIdentity.COOKIE_NAME` 那个 Cookie 发出去。
- **没有任何 mock**。
- **oracle 不经过被测对象**：③④ 里「会话落在谁的库里」一律用 `bun:sqlite` **直接读库文件**断言，
  不调我们自己的接口（`LEARNINGS #002-02`：拿被测对象证明被测对象，等于没证）。
  另：每个测试文件一套**临时根**（`mkdtempSync`）而不是固定路径——固定路径会把上一轮的库文件
  留下来，于是「B 的库里没有 A 的会话」可能只是因为那文件本来就在，**假绿**。

### ③ ⚠️ 一条接线知识（实测，别记错）：`OPENHIVE_DATA_ROOT` **只能走 `process.env`**

`DatabaseRouter.layer()` 读的是 `dataRoot(process.env)`——**不是** Effect 的 `Config` 服务。
所以 `anchor-workspace.test.ts` 那种「env 全塞 `ConfigProvider`」的写法在这里**只对身份门与锚定有效，
对数据根会被无声忽略**（库会落到默认的 `/data/...` 去，而测试看着还是绿的）。
值的生命周期只到**层构建**为止（`Layer.unwrap` 里求值一次），故建完 handler 即可还原 `process.env`。
⚠️ 这条与 T006 的 `AnchorWorkspace.Config`（**是**走 `Config` 的）**不相同**——同一次收尾里
两条 env 读法不一样，正是 `LEARNINGS #002-01`「同一维度上形状可能不同」的那类事。

### ④ 四条断言，全部双向

| # | 断言 |
|---|---|
| 1 | A 建的会话落在 A 自己的库文件里；**B 的库文件这一步还不该存在**（不是「存在但为空」，是根本没被碰过） |
| 2 | B 按 id 直取 A 的会话 ⇒ **404**（不是「返回了但我没权限看」） |
| 3 | B 列会话看不到 A 的，**且 B 看得到自己的、A 看得到自己的** |
| 4 | 各自的会话落在各自的库文件里（直接读文件） |

### ⑤ ⚠️ 首次跑就是 4 pass / 0 fail——**没有 RED**，靠变异测试证敏感性

这是**验证既有行为**的任务（T004/T005 早已落地），不是新写实现 ⇒ 写不出「先红后绿」。
按 T008/T009 的同样做法改用**变异测试**，两次都还原（`git diff --stat` 复核为空）：

| 变异 | 结果 | 证了什么 |
|---|---|---|
| 在 `router.ts` 的取连接钩子里**提前 `return Option.none()`**（等于取消按用户路由） | **4 条全红** | 断言确实挂在「按用户路由」这件事上 |
| **只对 BOB 的 id** 返回 `Option.none()` | **仅第 4 条红**，其余 3 条绿 | 「过紧也是缺陷」那半（「A 看得到自己的」）在为**正确的理由**起作用，不是搭便车 |

⚠️ **「首次全绿」不等于「已验证」**——没有红过的断言，谁也不知道它到底守没守住
（`#002-02` 的同一条道理）。本 feature 里 T008 / T009 / T012 / T013 四条都属这一类。

### ⑥ ⚠️ 未覆盖（缺口，不是覆盖）

三条，且**目前都没有接收方**（见「阻塞项」第 2 条）：
① T009 登记的两条「项目边界之外」读路径——注意它们**不跨用户**（T005 的每用户库兜住跨用户），
是「同一用户内项目之间不串」那半边，**不在本 task 的出参内**；
② T010 的端到端 429（要让 `active ≥ limit` 得先有真会话在跑）；
③ **长连接**（SSE `/event`、WebSocket `/pty`、`/tui`）与 `SessionPrompt` 下的取连接行为——
本文件与 T013 全是**普通 HTTP 请求**形态，**一条长连接用例都没有**。
⇒ 在此之前**不得声称**「长连接下的隔离已验证」「FR-008 已端到端验证」。

## T011 结论（2026-09-30 · 已完成；**应用层达成，OS 级那半挂账**）

**新增 3 文件、改动 1 文件（`fs-util.ts`：+1 处调用 + 错误联合 +1 项）**，**零 schema 改动**。

| 角色 | 文件 | 测试 |
|---|---|---|
| 判定/阈值/扫描（唯一一份） | `packages/core/src/quota/disk-quota.ts` | `packages/core/test/disk-quota.test.ts` **19 pass / 53 expect** |
| 接线（**唯一**一处） | `packages/core/src/fs-util.ts` → `writeWithDirs` 落盘前 | 同上最后一组（3 条，真调 `FSUtil.writeWithDirs`） |
| 防漂移（core 与 auth 的沙箱根常量） | — | `packages/opencode/test/disk-quota-drift.test.ts` **1 pass** |

### 四件必须记住的事

1. **拦点选「写漏斗」而不是逐个工具**：`write` / `edit` / `apply_patch` 三个工具**共用
   `FSUtil.writeWithDirs`**（`tool/write.ts`、`tool/edit.ts`、`patch/index.ts` 都经它落盘）
   ⇒ **一处接线覆盖三个工具**。代价是改了**上游热文件** `fs-util.ts`（改动最小化到 1 行调用 +
   1 行联合类型，均带【保留的定制 · 同步上游时不要丢】注释）。
   ⚠️ **`shell` 工具绕得过**——D4-3 已认，见缺口表。
2. **`replacing` 抵扣是主路径必需，不是优化**：三个写入工具**全是整文件重写**（改一个字符也重发全文）。
   判据是净增 `used - replacing + incoming > limit`；若去掉 `replacing`，沙箱一旦接近上限
   **连把文件改小都会被拒**——「磁盘满了所以你不能删内容」，民警会卡在「改不动也删不掉」上。
   **已做变异验证**：去掉 `replacing` ⇒ 2 条测试红。
3. **边界是「恰好写满放行」，与 T010 方向不同且不是笔误**：T010 的 `exceeds` 是 `active >= limit`
   （那边数**名额**——再要一个就超出）；本处是 `used - replacing + incoming > limit`
   （这边量**字节总量**——写满为止）。两处刻意不一致，**别在同步/重构时「统一」掉**。
4. **core 抄了一份沙箱根常量 + 一条防漂移断言**：`packages/core` **不能** import
   `@opencode-ai/auth`（反向也不依赖），两边都够不着对方的 `WORKSPACE_ROOT_ENV` / 默认根
   ⇒ 在 core 里另立字面量，靠 `packages/opencode`（同时依赖两者）里的断言钉住相等。
   **漂了会怎样**：`sandboxOf` 认不出任何路径 ⇒ 配额**永远显示 0 字节已用、永远不拒任何写入**，
   而且**不报错、不变红**——所以这条断言不是形式主义。**已做变异验证**：改 core 默认根 ⇒ 断言红。

### 另外三条判据的工程理由（都不是随手定的）

- **沙箱外路径直接放行**：`/data/{userId}/` 的库、临时目录、ripgrep 解压出的二进制、
  `~/.config` 全不在沙箱根下。判错一点就会把整个进程写死。**变异验证**：不排根外路径 ⇒ 5 条红。
- **「量不出来 ⇒ 拒」而不是学 `du` 的跳过**：这道门本来就绕得过（第 1 条），若再对
  「量不出来」静默放行，等于把配额做成一句声明（`LEARNINGS #002-02` 说的「门看着还在、
  其实没有」）。扫描失败在沙箱内是异常态（文件本就由本进程以 `0700` 写入），宁可报明确的错。
- **中文按 UTF-8 字节算**：不能拿 `content.length`（UTF-16 码元数）——中文一个字 1 码元、
  落盘 3 字节，用 `length` 会让中文内容的配额**少算三分之二**，而民警的产物（研判报告、
  话单分析）恰恰全是中文，等于**专门对主用途失灵**。

### 一处**踩到并已修掉**的地雷（值得记）

`sandboxOf` 起初写成「沙箱根下的任何路径都算沙箱内」，于是**根下的散文件**（如
`{root}/stray.txt`）被认成 userId = `stray.txt` 的沙箱 ⇒ 扫它得 `ENOTDIR` ⇒ **那个文件每次写入
都被判成「量不出来」而拒掉**。修法：要求路径**至少两段**（`{root}/{userId}/…`）才算沙箱内，
并同步改测试断言（根自身、根下散文件都算 `undefined`）。**是「沙箱外的路径不受配额管辖」
那条测试抓出来的**——不写它这颗雷会埋到线上。

### 质量门禁（2026-09-30 实跑）

| 门 | 命令 | 结果 |
|---|---|---|
| typecheck | `bun run typecheck` | **31/31、exit 0**（`FSUtil.Error` 扩联合 **零连带**） |
| core 全量 | `bun test`（包内） | **1135 pass / 8 skip / 5 fail**；5 条全是存量 `NpmConfig`（本机 `~/.npmrc` 镜像，T004/T009 已登记） |
| 三个写入工具 | `bun test test/tool/` | **72 pass**（`write` / `edit` / `apply_patch` 未受影响） |
| 防漂移 | `bun test test/disk-quota-drift.test.ts` | **1 pass** |
| lint | `bunx oxlint -c script/oxlintrc.openhive.json <三个新文件>` | **0 error / 0 warning** |
| lint（改动文件） | 同上 + `fs-util.ts` | `fs-util.ts` 有 4 条 warning，**用 `git show HEAD:` 实测 HEAD 上同样有** ⇒ 非本次引入，**不动**（`LEARNINGS #001-01`：看规则名+文件行，不看总数） |
| 锁文件 | `git diff --stat bun.lock` | **空** |

**基线核对**：T009 记录的 core 基线 **1109** + T010 的 **7** + 本 task 的 **19** = **1135**，
与实跑**精确吻合**，失败集合也一致（5 条 `NpmConfig`）。
⚠️ **跑次噪声已登记**：core 全量首跑出现 **8 fail / 1 error**（含 `snapshot.test.ts` 5s 超时），
第二遍回到 5 fail。判为**跑次噪声**（T004 也记过 snapshot 抖动），**未**回退基线跑——
依据是上面的基线算式精确吻合 + 失败集合一致。

### 未覆盖（明写为缺口，**不是覆盖**）

1. **OS 级磁盘强制**（FR-009 的底线）—— 挂 `docs/workspace/deploy-todo.md` **D-01**。
2. **`shell` 工具绕过** —— D4-3 已认，同由 D-01 闭合。
3. **`usedBytes` 里「符号链接 / 设备 / 管道不计数」那一支无测试守着** —— win32 建链接要管理员
   权限，本机构造不出来。仅 1 行、行为是**跳过**（方向是少算 = 宽松，不会误拒）。

## T010 结论（2026-09-30 · 已完成；出参在判据层与接线层达成，**端到端那一枪是缺口**）

**新增 4 文件、改动 2 文件（各 2 行挂载 + 1 行 import）**；**零错误契约改动、零 schema 改动**。
| 角色 | 文件 | 测试 |
|---|---|---|
| 判定/阈值/计数（唯一一份） | `packages/core/src/quota/session-quota.ts` | `packages/core/test/session-quota.test.ts` **7 pass** |
| 两种形态的适配器 | `packages/opencode/src/server/routes/instance/httpapi/middleware/session-quota.ts` | `packages/opencode/test/server/session-quota-middleware.test.ts` **7 pass**（5 判据 + 2 守夜） |
| 接线（A 链端点级 / B 链路由级） | `.../httpapi/groups/session.ts`（`.middleware(...)`）/ `.../httpapi/server.ts`（两处 provide） | — |

### 三件必须记住的事

1. **模块放 core（有意偏离 `plan.md`）**：plan 写 `packages/opencode/src/quota/`。真正的理由是
   **B 链的拦截点在 core**（`SessionV2.prompt`），而 core **不能** import `@opencode-ai/opencode`
   （`packages/core/package.json` 无该依赖）⇒ 两条链要共用一份判定，只能放两者共同依赖的 core。
   （模块头注释里我写了「已记进 `state.md`」——**那条承诺在本段写下的此刻才兑现**。）

2. **⚠️ D4 裁定「一处挂载覆盖两条链」的前提被实测推翻**：两条链**活在两个不同的层作用域**。
   - `SessionV2.Service`（B 链活跃集合）、`Database.Service` —— 路由层够得着；
   - `SessionStatus.Service`（A 链活跃集合）—— 层构造期**取得到**，**请求期调用失败**。
     根因：实例上下文（`InstanceRef`）由**端点级** `HttpApiMiddleware`（`InstanceContextMiddleware`）
     注入，**任何路由级中间件都在它外面**。⇒ A 链**只能**走端点级 `.middleware(...)`，B 链走路由级。
   - **两次挂载、一份判定**：`judge` 是唯一分支处，两种形态只是它的适配器。
   - 探针实测过坏法长什么样：挂错位置**不是静默放行**，是 `Service not found` → **500**。
   - 定位过程（留痕）：① 路由级 → 层构造成功、请求期 500；② 二分（让 source 不调 `list()`）→ 7/7 绿，
     排除「位置/依赖解析」；③ 读 `instance-context.ts` → 根因；④ 改端点级 → 7/7 绿 + 变异验证通过。

3. **⚠️ `HttpApiMiddleware.Service` 声明里不能写 `requires`**（typecheck 实测、二分定位到本处）：
   写进去的需求会**焊进 API 的类型**（`InstanceHttpApi` 的 requirement），那个位置
   **任何 `Layer.provide` 都消不掉**——层在下面供了、运行期也对，typecheck 仍坚持说 `QuotaConfig` 欠着。
   照官方 `Authorization` 先例（**只有 `error`、没有 `requires`**），需求留在**层**上、由挂载处的
   `.pipe(Layer.provide(...))` 消掉即可。**注意 `HttpRouter.middleware` 没有这个约束**——
   `userIdentityLayer` / `anchorWorkspaceLayer` 的 `requires` 都是层级的，`.pipe()` 消得掉。

### 判据与形状（为什么这么写）

- **响应形状**：**裸 429 + JSON body**（`SessionQuotaExceeded`），**不声明进 HttpApi 错误契约**。
  这是「不碰 4~6 个上游契约文件（`protocol/groups/session.ts`、两边 `errors.ts`、handler 映射）」
  换来的代价，客户端按状态码识别。
- **判据两段，`alreadyRunning` 那段不是优化**：`run-coordinator.ts` 的 `wake` 对已在跑的 key 只置
  `pendingWake`、**不新建条目** ⇒ 满配额时给正在跑的会话**追加一句 steer** 不增加并发；
  若只写 `active >= limit`，会把它误当成「又开了一个会话」而拒绝。
- **阈值** `OPENHIVE_MAX_SESSIONS_PER_USER`，默认 **5**；四种回落（没设 / 空串 / 非数字 / 非正数）
  一律回默认。**非数字那条是必须的**：`Number("abc")` 是 `NaN`，而与 `NaN` 的比较**恒假** ⇒
  放它过去则 `active >= NaN` 恒 false、**限流静默失效**（门看着还在、实际没有，且无任何症状）。
- **B 链计数** `countActiveForUser`：进程级活跃集合 **∩ 本用户的库**。数行数、**不用 drizzle 的
  `count()`**（`LEARNINGS #002-01`：行形状随驱动而变）；**空集合在进 SQL 之前拦掉**
  （`inArray(col, [])` 跨版本行为不一致，而空载正是最常见的调用态）。

### 质量门禁（2026-09-30 实跑，非外推）

- `bun run typecheck` **31/31、exit 0**。
- core **7 pass / 0 fail**；opencode **影响面四文件**（本 task + `user-identity` +
  `multi-tenant-routing` + `anchor-workspace`）**31 pass / 0 fail**。
- 改动/新增 6 文件 `bunx oxlint` **0 errors**；2 条 warning 是 `groups/session.ts` 的
  `Permission` / `MessageV2` 未使用 import，`git show HEAD:` **实测同样存在** ⇒ 非本次引入、不动。
- `git diff --stat bun.lock` **无输出**。

### `test/server` 全目录：仍不做「全绿」门禁（沿用 T005 登记），本轮做了真基线对照

| 跑法（`cd packages/opencode && bun test test/server/`） | 结果 |
|---|---|
| **基线**（把 2 个接线文件 patch 出来、`git checkout --` 回退后跑） | **298 pass / 23 skip / 9 fail**（9 条**全是 5s 超时**） |
| 带本次改动 | **298 pass / 23 skip / 9 fail / 1 error** |
| 失败集合**名称级差集** | 两边都红 **7**；只在基线红 **2**；只在带改动红 **2** |

**判读**：失败集合**双向变动**、且除 1 条外**全是同一批 5s 超时**（`file HttpApi` /
`Server.listen` / `SDK` / `session HttpApi` / `project-copy` / `session-messages`）——
与 T005 登记的「跑次噪声」**同一签名** ⇒ **T010 未引入新失败**。
（本条是**结论**，不是辩解：那 2 条「只在带改动红」= 1 条超时 + 下面那条 flaky，均已单独复核。）

### ⚠️ 顺带实测出的一条**存量 flaky**（登记，**本轮未修**，请裁决）

`packages/opencode/test/server/user-identity.test.ts` 的
**「开关开：令牌被篡改 → 拒绝」以 ≈1/16 概率假红**（本轮全目录跑时撞上一次）。

- **机制**（300 条探针**实测**，不是推理）：HS256 签名 32 字节 → base64url **43 字符**，
  末字符只有 **4 个真比特、低 2 位是填充**；该测试把末字符 `A`→`B`（`A`=000000 → `B`=000001）
  **只动了填充位** ⇒ 解出的签名字节**逐字节相同** ⇒ 验签**照样通过**。
  实测：300 条里末字符为 `A` 的 **20 条全部**「篡改后仍验过」；改**中间**字符 **0/300** 幸存。
  末字符取值必为 `{A,E,I,M,Q,U,Y,c,g,k,o,s,w,0,4,8}`（低 2 位必为 0）⇒ 只有 `A` 这一种会翻车，
  故概率 ≈ **1/16**。
- **它不是安全洞、也不是身份门漏了**：`A`→`B` 得到的**不是另一个令牌**，是同一个令牌的
  等价编码。**是测试构造缺陷。**
- **与本 task 无关**（已证）：带本次改动**单独跑该文件 17 pass / 0 fail**；且该文件不在改动影响面内。
- **修法（未做，留给裁决）**：别改末字符——改**中间**字符，或改 payload 后重签。
  本轮不修的理由：它属 T003 的产物、不在 T010 范围内，且 **T010 的改动与它无因果关系**
  （「外科手术式改动」+ 节奏铁律）。

### 核过 D4 未涉及、但 T010 必查的一条

**「本拦点与 F4 的工具执行守卫是否打架」→ 不打架。** F4（`004-access-control`）**尚未落地**
（仓库无 `packages/opencode/src/authz/`），其两个钩点在**工具清单组装**（`tool-filter.ts`）与
**执行器入口**（`tool-guard.ts`），都在「**一轮已经跑起来之后**」；本 task 在**prompt 入口准入**。
不同层、不重叠：被本 task 拒的 prompt **走不到**工具执行；被 F4 拒的工具调用发生在**已准入**的轮内。

### ⚠️ 未覆盖（缺口，**不是覆盖** —— `LEARNINGS #002-02`）

- 🟡 **端到端「第 6 个真会话被拒」未验证**：要让 `active ≥ limit` 得**先有真会话在跑**
  （真 agent 执行，重且不确定）。两条守夜测试只能证「依赖解析得开、**不是 500**」，
  **证不了 429 真的会发生**。⇒ 留给 **T012/T013 或压测**补，**不得声称已端到端验证**。
  📌 **2026-09-30 补记**：T012/T013 已收尾，但它们的出参是「A 读不到 B」、**不含限流** ⇒ **仍未覆盖**，
  且**现无接收方**。最新状态以「阻塞项」第 2 条与缺口表为准，本段是 T010 当时的历史记录。

## T009 结论（2026-09-30 · 已完成；**两条出参都达成**）

**零生产代码改动**——验证类任务，新增 `packages/core/test/session-project-isolation.test.ts`（3 条）。

### 出参① 「session 表无 `user_id` 列」（FR-004 · 零表结构改动）

对**真实建出来的表**断言（`pragma_table_info('session')`），**不只读 TS 模型**：
模型与迁移是**两份真相**，`packages/auth/src/user.test.ts` 的「防漂移」就是这个思路。
core 里可行——`packages/core/test/preload.ts` 把 `OPENCODE_DB` 设成 `:memory:`，
而 `Database.node` 开库时会 `DatabaseMigration.apply`。

**两边都查**：模型（有人改 drizzle 定义）+ 真实表（有人加迁移）。**并同时钉 `project_id` 必须在**——
只断言「没有 `user_id`」的话，查错表 / 表名写错 / 拿到空数组都会绿；钉一个**必须存在**的列，
才说明这份清单真读到东西了。

### 出参② 「逻辑隔离生效」—— 执行点在**两条栈**上都有

| 栈 | 执行点 |
|---|---|
| core | `SessionV2.list`：`if ("project" in input)` 时按 `project_id` 过滤 |
| **生产 HTTP** | `packages/opencode/src/session/session.ts` 的 `Session.list` → `listByProject`：**无条件**先按 `projectID: ctx.project.id`（来自 `InstanceState.context`）过滤，再按 `directory` 收窄 |

⇒ 「会话通过 `project_id` 逻辑归属到项目」**有真实执行点**，不是只写在文档里。

### ⚠️ 但必须说清它**不是**什么

`SessionStore.get` **只按 `session_id` 查、不看 project** ⇒ 这是**查询侧的逻辑隔离**，
**不是**一道能挡越权的门：拿得到 `session_id` 就取得到那行。
**跨用户那一半不靠它**——靠 T005 的每用户独立库（`Session.Service.get` 只读自己的库）。
**别把 `project_id` 当授权判据**，否则会以为它挡住了它并不挡的东西。

### ⚠️ 顺带发现：两条「项目边界之外」的读路径（已登记给 T012/T013）

1. core 的 `SessionV2.list` 走 `ListAllInput` 变体（**不带任何 scope**）→ 返回**本库内全部**会话；
2. legacy 的 `Session.listGlobal` → **完全不带 project 条件**，且经
   `handlers/experimental.ts` 的 `experimentalHandlers` 挂载（`server.ts` 里**无开关**，直接进路由组）。

两条都**仍是「本库 = 本用户」内**（T005 的每用户库兜住跨用户），**不跨用户**；
但「同一用户内项目之间不串」在它们上面**不成立**。本轮**未修未测**，登记为缺口。

### 与 T008 的接口：第 3 条测的是**那个窗口里的后备判据**

`create` 里 `project_id` 是 `projects.resolve(input.location.directory)` **从会话目录推出来的**
⇒ 两个目录算不算两个项目由 T008 决定；T008 已实测**首次提交之前二者都解析成 `global`**。
于是第 3 条钉：项目 id 塌成一个时 `list({project})` 会把两边一起返回（**不是 bug**，
是 T008 登记过的条件成立），但 `list({directory})` 仍把两边分开。

📌 **这条不是「理论上还有一道」——它正是生产默认行为**：`Session.list` 在 `scope !== "project"` 时
**总会**再加一个 `directory` 条件（`listByProject`），前端 `directory-sync` 也正是传 `{ directory, ... }`。
⇒ **项目边界有前提，目录边界没有；而生产默认走的就是目录边界。**

### 不是 TDD + 变异敏感性实测

零生产代码改动 ⇒ 断言既有行为，**本机没有观察到 RED**（同 T007 ③ / T008 的口径）。
两条变异：

| 变异 | 结果 |
|---|---|
| 往 `SessionTable` 加一列 `user_id` | 出参①红（`Expected to not contain: "user_id"`）；**另两条也红**——模型多一列会让生成的 SQL 对不上真实表，正好佐证「模型与表必须一致」 |
| 把 `list` 的 project 条件停用 | **只有**出参②那条红（2 pass / 1 fail） |

两个上游文件（`src/session/sql.ts`、`src/session.ts`）改后均**逐字还原**，`git diff --stat` 已核为空。

⚠️ **诚实交代出参①的敏感性边界**：上面那条变异**只动模型**，真实表未变，所以红的只有模型那半。
要让**表**那半红，得加一个迁移（成本高，本轮**未做**）。表那半「不是空断言」由同一测试里的
`expect(table).toContain("project_id")` + `expect(table.length).toBeGreaterThan(0)` 保证——它证明 `pragma_table_info('session')`
真的读到了 `session` 表。

### 质量门禁（2026-09-30 实跑，非外推）

- `packages/core` `bun test`：**1109 pass / 8 skip / 5 fail** = T008 的 1106 **+3**；
  5 条失败仍是既有 `NpmConfig`（本机 `~/.npmrc` 镜像），与本轮无关。
- `bun run typecheck`：**31/31 成功，exit 0**。
- 该文件 `bunx oxlint -c script/oxlintrc.openhive.json`：**0 warnings / 0 errors**（161 条规则）。
- `git diff --stat bun.lock`：**无输出**。

## T008 结论（2026-09-30 · 已完成；出参成立，**但带一条前提**）

**零生产代码改动**——本 task 是**验证**类，复用 opencode 原生 project 解析，只在
`packages/core/test/project-sandbox-isolation.test.ts` 新增 4 条**特征化**测试。
沙箱形状（前提）：`createWorkspace`（`packages/auth/src/workspace.ts`）**只有 `mkdir`、没有
`git init`** ⇒ **沙箱根不是 git 仓库**，项目要在它底下自己成库。

### 出参的准确口径（「沙箱内项目各自独立 git」）

| 情形 | 实测结果 |
|---|---|
| 两个项目**各自成库、且已有首次提交** | ✅ **独立**：id 互不相同（各 = 自己的根提交哈希），worktree 各是自己的库根（不是沙箱根） |
| 两个项目**已 `git init`、但还没提交** | ⚠️ **同属 `global`**——前提，见下 |
| 尚未 git 化的目录 | ⚠️ id = `global`，且项目 **worktree = 文件系统根**（沙箱之外） |

**成因**：`Project.resolve` 的 id = `remote() ?? .git/opencode 缓存 ?? 根提交哈希 ?? global`，
而 `initGit`（`packages/opencode/src/project/project.ts`）**只 `git init`、不提交**
⇒ 三个来源此时全空 ⇒ 一律回落 `global`。**「项目 = 隔离边界」是首次提交之后才成立的。**

### 两处「条件成立」按裁定登记，**均未修**

- **【甲】首次提交前同属 `global`**：只登记，**不兜底**。「建项目时是否自动补一次提交」
  属**产品决定**，不由验证类任务顺手改（宪法 §I 也要求别动上游行为）。
- **【乙】未 git 化目录的 worktree 在沙箱外**：已**测出并上报**。
  ⚠️ **边界必须说清**：这**不是** T006 的目录锚定失效——请求目录仍被锚在沙箱内，
  指到沙箱外的是**项目元数据**那一份。两者是两份不同的东西，混为一谈会误判 T006 的成果。

### ⚠️ 一处诚实的交代：**本机那个 RED 是 fixture 的 bug，不是产品缺陷**

第 1 条测试首次跑**红了**，看着像「同沙箱内两个项目 id 相同」这种大事。查下去是**我自己的 setup 错**：
两个 `git commit --allow-empty`（空树、无父、同身份、同 message）**落在同一秒**时，
内容寻址下**根提交哈希完全相同**，于是 `a.id !== b.id` **假红**。两条佐证：
① 单独跑该条时，前两条「id = 自己的根提交」断言**反而是绿的**（说明解析没问题，是输入相同）；
② 探针里两次提交跨了秒，哈希就不同了——**靠时间跨秒才绿本身就是 flaky**。
修法：给每个库写一个**不同的种子文件**，让树确定性不同。

顺带记一条**真性质**（不是 bug）：opencode 的 id 本就按**仓库身份**算，
同一个仓库克隆两份 = 同一个项目（`remote()` 归一化的用意正在此）；上面那个撞哈希是它的退化情形。

### 不是 TDD（同 T007 ③ 的口径）+ 变异敏感性实测

零生产代码改动 ⇒ 断言的是既有行为，属**特征化测试**，**没有 RED→GREEN**。
为了让「全绿」有意义，做了两条变异（都**只红目标那一条**，3 pass / 1 fail）：

| 变异 | 结果 | 说明 |
|---|---|---|
| 去掉 beta 的首次提交 | 「两项目独立」红 | 该条对本性质**敏感**（同时揭示：不提交 ⇒ 边界消失） |
| 给「条件成立」那条的一方补上提交 | 该条红 | 它是**真特征化**而非空断言——上游改了回落规则它就会红 |

### 与既有测试的分工（「不重复覆盖」是刻意的）

`packages/core/test/project.test.ts` 已把 id 优先级链的**原语**逐条钉过，含
「非 git 目录 → global + 文件系统根」「空仓库 → global」两条。本文件**不重钉原语**，
只钉**沙箱形状的复合**：多个项目**共用一个祖先目录**时边界还在不在（上游的用例里
从来没有两个仓库共享父目录）。这个取舍要写下来，免得后来者以为是漏测。

### 质量门禁（2026-09-30 实跑，非外推）

- `packages/core` `bun test`：**1106 pass / 8 skip / 5 fail** = 基线 **1102 + 新增 4**；
  5 条失败**全是既有的 `NpmConfig`**（本机 `~/.npmrc` 镜像），与本次无关。
- `bun run typecheck`：**31/31 成功，exit 0**。
- `bunx oxlint -c script/oxlintrc.openhive.json <该文件>`：**0 warnings / 0 errors**（161 条规则，
  合 `LEARNINGS #001-05` 的恒等式）。
- `git diff --stat bun.lock`：**无输出**（未污染）。

## T007 结论（2026-09-30 · 已完成，但**两条 `0700` 断言在本机不可验**）

**一句话**：`0700` 加上了，**但本机证明不了它加上了**——win32 忽略 mode。出参 ① 无产物可改，挂缺口。

### 三条出参逐条交代

| 出参 | 落点 | 本机可验？ | 结论 |
|---|---|---|---|
| ① 容器**非 root** | **不存在**——官方 `packages/opencode/Dockerfile` 无 `USER` 指令，且它只装 CLI 二进制；全仓**无服务镜像 / 无 compose / 无 k8s 清单** | ❌ 无 docker | **缺口**（登记进缺口表；规范出处 `spec.md` FR-006）。**不假称已移交**——承接它的部署任务**不存在**。**未新建任何部署产物** |
| ② `/workspaces/{userId}/` 以 `0700` 建出 | `packages/auth/src/workspace.ts` 的 `createWorkspace` | ⚠️ win32 skip | 代码已加；**验证是缺口** |
| ③ `/data/{userId}/` **目录可写** | `packages/core/src/database/router.ts`（原本就 `mkdir`） | ✅ | 真写 canary 再读回；**但改动前就是绿的**（见下「护栏不是测试」） |

顺带按 §4 同一张表把 `/data/{userId}/` 也加上了 `0700`。

### 🔴 重点：两条 `0700` 断言的**可验性不同**，别混为一谈

| 目录 | 测试文件 | 谁真的会跑它 |
|---|---|---|
| `/data/{userId}/` | `packages/core/test/database-router.test.ts` | ✅ **Linux CI 真跑**（`turbo.json` 有 `@opencode-ai/core#test`；CI 跑 `bun turbo test`，矩阵含 ubuntu） |
| `/workspaces/{userId}/` | `packages/auth/src/workspace.test.ts` | ❌ **无人跑**：本机 win32 → skip；**CI 也到不了**——`turbo.json` **没有 `@opencode-ai/auth#test`** |

**两边都受同一个前提约束**：该分支得进 CI 触发范围（push 到 `dev`，或开 PR）才会跑。

⚠️ **附带发现（需裁定，未自行处理）**：`turbo.json` 只为 `opencode` / `@opencode-ai/core` /
`function` / `app` / `ui` / `session-ui` 声明了 `test`，**`@opencode-ai/auth` 缺席**
⇒ **002 的整个 auth 包测试（本机实测 149 pass）从未在 CI 里跑过**。修法是在 `turbo.json` 加一行
`"@opencode-ai/auth#test": {}`，但那是**上游文件**（`宪法 §I`：加一行就是一处冲突面）。
**未自行改动**，留给你裁定。改动之后，本出参的 ② 侧才进入「被验」状态。

### ③ 的诚实交代：**护栏不是测试**

「目录可写」这条**在改动之前就是绿的**（默认权限本就可写）——它**不是** RED→GREEN，
是**回归护栏**（防将来有人把 `mode: 0o500` 之类写进来导致 SQLite 打不开库）。
写清楚这一点，免得后人把「这条绿了」误读成「本 task 的改动被验证了」。
另外它**刻意不断言权限位**：位断言在 win32 恒真（= 没测），落盘读写才是 WAL 真正要的能力。

### ⚠️ 一个诚实的空白：本机**没有观察到 RED**

TDD 要求「先看它失败」。这两条 `0700` 断言在本机**是 `skip` 不是 `fail`**——
不是我把 RED 跳过了，而是**这台机器上没有能观察 RED 的手段**（win32 丢弃 mode，
连 `chmod` 后再 `stat` 都还是 `666`，实测三种写法一致）。
按 `LEARNINGS #002-02`：**测不了必须写成「缺口」，不能写成「覆盖」**。故本 task **不得**被读成
「`0700` 已被验证生效」，只能说「代码已按要求写，Linux 上有一条会真跑的断言守着」——
且那条只覆盖 `/data/`，`/workspaces/` 侧目前**连跑的人都没有**。

### `mode` 的三个边界（写进 `router.ts` 注释里了，这里留档）

1. **umask 只会清位、不会加位** ⇒ `0o700` 在**任何** umask 下都成立（不必担心 CI 的 umask 比本机严）。
2. **目录已存在时 `mkdir` 不看 mode** ⇒ **历史账号的老目录不会被这条收紧**（与本 feature 「惰性创建」
   同一类问题：`isolation-scheme.md` §1 说历史账号的 `/data/{userId}/` 本来就不存在，所以是**新建**，
   但若部署时预先建过、或权限被人改过，本 task **不会**纠正它）。→ 缺口表。
3. **win32 完全忽略 mode**（实测 `mkdir({mode:0o700})` / 不传 / 建后 `chmod(0o700)` 三者都得到 `666`）。

### 质量门禁（2026-09-30 实跑，非外推）

- `packages/core`：**1102 pass / 5 fail / 8 skip**（1115 tests / 147 files）。
  5 条 fail 全是 `NpmConfig.*`，**与 T004 基线同一批**、根因是本机 `~/.npmrc` 指向
  `registry.npmmirror.com` 漏进临时目录（实测输出 `Received: "https://registry.npmmirror.com/"`），
  **不是本 task 引入**。skip 从 7 → 8，多出来的正是本次新增的 win32 跳过项。
- `packages/auth`：**149 pass / 1 skip / 0 fail**（150 tests / 13 files）。
- `bun run typecheck`：**EXIT=0**（31 tasks successful / 31）。
- oxlint：本次改动的 4 个文件 **0 warning / 0 error**。
- `git diff --stat bun.lock`：**空**（未跑 `bun install`）。

### 本次改动文件（4 个）

`packages/auth/src/workspace.ts`、`packages/auth/src/workspace.test.ts`、
`packages/core/src/database/router.ts`、`packages/core/test/database-router.test.ts`。
**未触碰** `database.ts`、`sql.ts`、任何 schema。**零表结构改动**。

## T006 结论（2026-09-30 · 已完成）

**一句话**：客户端传什么目录都不作数了——请求在进路由树**之前**被改写，目录一律锚到
`{沙箱根}/{userId}`。上游文件**一行没动**。

### 落点

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/middleware/anchor-workspace.ts` | **新增**（中间件 + `Config`） |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | **一行接线** + 一行 import |

**为什么是「改写请求」而不是「改两条解析链」**：内核里「当前目录」有两个独立读者——
v2 的 `workspace-routing.ts`（`defaultDirectory` 读 `?directory=` 与 `x-opencode-directory`）与
旧版 `@opencode-ai/server/location` 的 `ref()`（另读 `location[directory]`）。它们都是上游高频文件，
改它们 = 每次同步都冲突（宪法 §I）。**但它们都从同一个 `HttpServerRequest` 读** ⇒
用 `HttpServerRequest.modify` 在请求进路由树之前换掉它，两条链同时被锚定（§V「侵入是加不是改」）。
三处入参都改（`?directory=` / `location[directory]` / `x-opencode-directory`）——**它们不是同一条读法**，
只改一处就是留一条明路。

### 三条验收项 → 三条测试

`packages/opencode/test/server/anchor-workspace.test.ts`（4 用例，真应用 `HttpApiApp.routes` + 真签发 Cookie）：

| 验收项 | 测试 | 关键点 |
|---|---|---|
| 出参「伪造 directory 被忽略，落沙箱根」 | 客户端伪造的 directory 被忽略 | 断言「不等于伪造值 + 在配置的根下 + 以 userId 结尾」，**三条同时成立**，直通蒙混不过去 |
| T004 移交：「两个用户拿不到同一个 `Location.Ref`」 | 同名用例 | **真的构造 `Location.Ref.make({directory: AbsolutePath.make(...)})` 再 `Equal.equals` 比对**——LayerMap 的键用的正是这套结构相等。不拿「目录字符串不相等」充数 |
| 追加：「一人一工作区」 | 同一用户拿不到第二个工作区 | 同一用户换三种 directory（含他自己的沙箱根）仍只有一个锚点 |
| （零回归守卫） | 身份门关着：不改写请求 | 见下「为什么门关着要直通」 |

**测试是真应用装的**（`HttpApiApp.routes`），不是「搭个最小路由自己套中间件」——后者漏装也照样绿。

### 两条刻意的设计选择

1. **没有 `User` 就直通**（判据是「**谁在跑**」，与 T004 条件③一致）。身份门默认关着，此时上下文里
   **没有** `User`（不是空身份，是没有）。锚定若无条件生效，等于把一个没有身份的系统整体搬到
   `{根}/{undefined}` 下——比它要堵的洞更像事故。第 4 条测试钉的就是这条。
2. **一并删掉 `?workspace=`**——✅ **2026-09-30 结案：维持删除**（此前标着「超出字面出参、已上报等复核」）。
   它同样由客户端给，而 `planRequest` 会用该工作区的 `target.directory` **完全绕过**
   `defaultDirectory`——留着它，上面三处改写等于白改。删而不是替换：一人一工作区（T004 裁定）下
   没有第二个工作区 id 可填。

   **结案的依据（这次是查出来的，不是推断的）**：
   - **全仓没有任何生产者**：`grep 'searchParams.set("workspace"' / '"workspace="' / 'workspace=${'`
     遍 `packages/**`（排除 node_modules 与测试）**零命中**。前端 `packages/app` 里的
     `data-workspace=` 是 CSS 属性、`src/workspace/` 是 openhive 自己的模块目录，**都不是这个查询参数**。
     ⇒ 删掉它**不可能弄坏任何现有调用方**。
   - 该特性在 opencode 里是**实验性的**（`@opencode/ExperimentalHttpApiWorkspaceRouting`）。
   - 它比「目录提示」更重：`resolveTarget` 可给出 **Remote** target，请求会被 **proxy 到另一台服务器**
     （`proxyRemote`）——所以这是**请求转发开关**，不只是换目录。
   - openhive 模型是「一人一沙箱一工作区」，项目隔离在沙箱**内部**（T008），没有「跨工作区」这回事。
     （T008 已于 2026-09-30 完成：项目确实落在沙箱内，**本条的论据不受它的前提影响**——
     那里说的前提是「首次提交前两个项目同属 `global`」，与「有没有第二个工作区」无关。）

   ⚠️ **并补了一条测试守住这行删除**（此前没有）：删 `?workspace=` 是**承重的**（不删=锚定被绕过），
   但原先 4 条用例**没有一条**能发现它被去掉。新增用例
   `客户端传 ?workspace= 指别人的工作区：参数被剥掉，仍落自己的沙箱`，并**做过变异验证**——
   把那行 `delete` 去掉后，**只有这一条红**（500 而非 200，4 pass / 1 fail）。
   **理由**：「全仓没人发它」这个论据**会随时间失效**（哪天有人加了就悄悄破了）；论据会过期，测试不会。

### 次序是承重的

`anchorWorkspaceLayer` **必须排在 `userIdentityLayer` 之后**——它靠身份门放进上下文的 `User`
决定锚到谁。排前面 ⇒ 抓不到 `User` ⇒ **整道锚定静默直通**（不报错、不变红）。
这个次序**由测试守着**：反了的话第 1~3 条用例直接红。`server.ts` 那行接线旁写了注释。

### 开工前挂着的那个未决问题：**结案，不可利用**

`packages/protocol` 的 `v2.session.create` 声明了请求体 `location: Location.Ref`，一度怀疑
「会话带着自己的 location 创建」是绕过锚定的口子。**实测两条一起否掉**：
① `SessionLocationMiddleware` **不读请求体**——它读 `route.params.sessionID` 再查 `SessionTable.directory`；
② `ServerApi`（`/api/*` 那一家族）在本仓库**只有 schema、没有任何 `HttpApiBuilder.layer(ServerApi)`**，
即**根本没有 handler** 去消费那个字段。
⇒ **若将来 v2 handler 层落地，这条必须重新裁定**（届时请求体 `location` 会是一个活的绕过向量）。

### 门禁（全部实测）

- 测试：`anchor-workspace` + `user-identity` + `multi-tenant-routing` 三文件 **23 pass / 0 fail**；
  core 的 `connection-routing` **5 pass / 0 fail**。
- `bun run typecheck`（`packages/opencode`）**EXIT=0**。
- oxlint 改动文件：**1 warning / 0 errors**（复核时刻实测）。⚠️ 如实登记：清过一轮
  （去掉未用 import + 改用仓库既有的 `json<A>(response)` 读法），**剩下的这条**是
  `no-unsafe-type-assertion`，与上游文件 `test/server/httpapi-mcp.test.ts` 里的
  **同款写法、同一条警告**（上游自己也带）——沿用仓库惯例而非另造一种。
  > 记账时的自我更正：首次提交信息里写的「3 warning」是**清理之前**的数，
  > 清理后没重新取值就写下来了。实测（命令见下）**1 warning / 0 errors**。
  > 取数：`bunx oxlint <改动的三个文件>` ——**别抄这里的数**，改了文件数就会变。
- `bun.lock`：`git diff --stat bun.lock` 为空（未跑 `bun install`）。

### 未覆盖（缺口，**不是覆盖**）

- 🟡 **锚定上线前已存在的会话，其 `directory` 仍优先于锚定**——`planRequest` 是
  `session?.directory || defaultDirectory(...)`，而锚定改的是**请求**。**影响面 = 该用户自己的目录，
  不是越权**（T005 的每用户库让 `Session.Service.get` 只读自己的库）。**未测未修**。
- 🟡 **`node` 构建条件下的锚定未验证**——锚定本身与构建条件无关（纯 HTTP 层），但本机跑不到 node 支。

## T005 结论（2026-09-30 · 已完成）

**出参**：同一个 `Database.Service`、同一段查询代码，**按当前 fiber 的身份落到不同库文件**。
测试 `packages/core/test/database-routing.test.ts`（3 用例）——断言一律用 `bun:sqlite`
**直接读库文件**，不经过我们自己的代码（`LEARNINGS #002-02`）。

**落点**（行数一律取 `git diff --stat`，别引用写死的数）：

| 文件 | 性质 | 内容 |
|---|---|---|
| `packages/core/src/database/connection-routing.ts` | 改（T004 就有） | tag `Hook` / `Disabled`，**外加两支共用的 `routed(...)`**（下节①为何抽在这里） |
| `packages/core/src/database/router.ts` | 改（T004 已有） | 实现路由：读身份 → `forUser(id).db.$client.reserve`；**`Interface` 上暴露 `hook`** 供中间件每请求注入 |
| `packages/core/src/database/sqlite.bun.ts` | ⚠️ **上游自有文件，改** | 侵入点：`acquirer`/`transactionAcquirer` 各包一层 `routed(...)`（内联实现已抽走） |
| `packages/core/src/database/sqlite.node.ts` | ⚠️ **上游自有文件，改** | **同一处侵入、同一份实现**（下节②为何必须两支都接） |
| `packages/opencode/.../httpapi/middleware/user-identity.ts` | 改（003 T003 新增的文件） | 层构造期取一次 `DatabaseRouter.Service`，**请求期把 `Hook` 塞进上下文**（与 `User` 同源注入） |
| `packages/opencode/.../httpapi/server.ts` | 改（上游自有文件） | 一行接线：`userIdentityLayer` 的依赖里加 `Layer.provide(DatabaseRouter.layer())` |

`database.ts` 与 `package.json` **一行没动**（§V 要求「连接路由落在新增的 `router.ts`」——满足；
注意 §V 说「新增的 `router.ts`」，而 `router.ts` 是 T004 建的、本次只是扩，**未新增其他路由落点**）。

**侵入形状**：`routed(fallback)` 先问 fiber context 里有没有 `Hook`；**没有就逐字返回 `fallback`**。
无钩子 = 上游原样 ⇒ CLI / TUI / ACP 等无身份入口、以及**全部既有测试**，行为一字不变
（测试 2「没有身份时回退到本层自己的库」钉的就是这条）。

**为什么 tag 单独一个文件（而不是并进 `router.ts`）**：`sqlite.bun.ts` 要 import 它，
而 `router.ts` 已经 import `database.ts`、后者 import `#sqlite` ⇒ 并进 `router.ts` 会成环
（`sqlite.bun.ts → router.ts → database.ts → #sqlite → sqlite.bun.ts`）；而 `database.ts` 在
**模块求值期**就调 `layerFromPath(path())`，谁先被求值都可能踩到未初始化的绑定（TDZ）。
`connection-routing.ts` **刻意不 import 任何本仓库模块**，故无此风险。

### 两条「必做」都做了，且都拿**变异验证**证明测试守得住

不是「写了就算」——每条都做过一次「故意破坏 → 看测试是否红 → 还原」：

| 行为 | 破坏方式 | 结果 |
|---|---|---|
| **重入保护 `Disabled`** | 把钩子的 `Disabled` 判断注释掉 | 本组测试**挂住**：超过 **75s 无任何输出**，连 bun 的 10s 超时都没报出来 |
| **事务路径 `transactionAcquirer` 也路由** | 改成 `= localTransactionAcquirer` | 「事务路径」用例**红**：alice 库为 `[]`（确实写回了主树） |

🔴 **第一条的后果要说清**：破坏它的表现是 **CI 挂住、不是变红**。谁将来改这块、把 `Disabled`
当成冗余删掉，看到的是「测试卡死」而不是一句失败信息——**别去调超时，那是死锁**。

⚠️ **诚实登记**：「事务路径」那条测试是**补写的**——实现 GREEN 时顺手做了「事务也要路由」，
超出了当时 RED 的覆盖。为补偿，补写后立刻做变异验证（上表第二行）。
不把它写成「已覆盖」蒙混过去。

### 收尾补的三件事（2026-09-30，都是「本轮未覆盖」倒逼出来的）

**① `routed` 抽成两支共用的一份**（`connection-routing.ts`）。原先内联在 `sqlite.bun.ts` 里，
收尾时发现 `sqlite.node.ts`（`#sqlite` 的另一支）也得接，而它**在本机一行都跑不到**
（bun 不提供 `node:sqlite`）⇒ 两份各写一遍 = 其中一份永远没人跑，正是 `#002-01` 的形状。
抽成一份后，bun 支的测试覆盖的**就是** node 支调用的那段代码。**残差已登记**（见上「未覆盖」表）。

**② `sqlite.node.ts` 一起接**。`#sqlite` 是**按运行时条件解析**的（`bun` → `sqlite.bun.ts`、
`node` → `sqlite.node.ts`），只改一支 = 隔离在一个构建条件下静默失效，**且不会有任何东西变红**。
为此加了两条**形状守卫**（`connection-routing.test.ts`：读源码断言两支都接了
`routed(localAcquirer)` 与 `routed(localTransactionAcquirer)`）。
⚠️ **形状守卫不是行为验证**——它只防「漏接线」，不证明 node 条件下跑得对，别把它当覆盖。

**③ 接进真实请求路径**（这条推翻了原计划的落点）。原计划把 `DatabaseRouter.layer` 加进
`app-runtime.ts` 的 `AppLayer`。**实测证伪**：**请求 fiber 的 context 里没有 app 层服务**——
测试路由体直接 `yield* Database.Service` 得到 `Service not found: @opencode/v2/storage/Database`；
上游自己也只能在**层构造期**取服务、请求期用闭包（`handlers/sync.ts`、`middleware/fence.ts` 同形状）。
⇒ 改为：**钩子与身份同源注入**——身份中间件在**构造期**取一次 `DatabaseRouter.Service`，
**请求期**用 `Effect.provideService` 把 `Hook` 塞进上下文。谁拿到 `User` 必然同时拿到钩子；
没有身份就不给钩子（否则钩子会去猜一个主体）。
**变异验证**：去掉 `server.ts` 那行 `Layer.provide(DatabaseRouter.layer())` ⇒「真应用的接线」用例
**红**，报 `Service not found: @opencode/openhive/DatabaseRouter`——**炸在层构造期，不是静默回退**，
这条失败模式是对的。

### 质量门禁（2026-09-30 实跑，收尾后重跑）

| 门 | 结果 |
|---|---|
| T005 新增测试（core） | `connection-routing.test.ts` + `database-routing.test.ts` = **8 pass / 0 fail** |
| T005 新增测试（opencode） | `multi-tenant-routing.test.ts` + `user-identity.test.ts` = **19 pass / 0 fail** |
| core 全包 | **1101 pass / 7 skip / 5 fail**（T004 基线 1093/7/5 ⇒ Δ = +8 pass / 0 新失败） |
| typecheck | `packages/core` **EXIT=0** + `packages/opencode` **EXIT=0** |
| oxlint（9 个改动文件） | **15 warnings / 0 errors**。逐条分类：1 条是 `connection-routing.ts` 里从 `sqlite.bun.ts` **搬过来的**（净 0）、13 条上游存量、**新增 1 条**（见下） |

- core 那 5 条失败全是 `NpmConfig.*`，**与 T004 基线同一批**，根因是本机 `~/.npmrc` 指向
  `registry.npmmirror.com`（报错正文 `Expected "https://registry.example.test/" /
  Received "https://registry.npmmirror.com/"`），存量环境失败，与 T005 无关。
- **新增的那 1 条 warning**：`multi-tenant-routing.test.ts` 里 `db.all(...) as Array<{v:string}>`
  （`no-unsafe-type-assertion`）——与 `packages/core` 既有测试**同款写法**，随大流，不单独破例。
  另一条 `no-unsafe-type-assertion`（`Hook.resolve` 那个 `as`）**不是我新增的**，
  它是 `routed` 从 `sqlite.bun.ts` 搬到 `connection-routing.ts` 时**跟着搬的**，净 0。
  为什么留：`Hook.resolve` 的静态类型是 `Effect<Connection, SqlError, Scope>`，而
  `client.export` / `loadExtension` 要求无 `Scope` 的 R（那是上游的两行，不去动它）。
  评估过的替代都不成立——改 `SqliteClient` 接口 = 动更多上游行；让钩子返回无 Scope 的类型
  = 把断言挪个位置，warning 照报。**如实登记，不隐藏、也不为它扩大上游改动面。**

### `packages/opencode` 全包回归：**无可用基线，已改用「名称级差集」判据**

全包实测 **3548 pass / 58 skip / 1 todo / 53 fail / 4 errors**（3660 tests / 256 files / **2183s**）。
但**这个数不能直接当门禁用**——`test/server` **单独跑**也有存量 flaky 5s 超时带：

| 跑法 | 结果 |
|---|---|
| 基线（`HEAD`，改动全部回退）跑 `bun test test/server` | 284 pass / 23 skip / **9 fail / 1 error** |
| 带本次改动跑同一命令 | 285 pass / 23 skip / **10 fail / 0 error** |
| 失败集合**名称级差集** | 两边都红 **5** 条（存量）；只在基线红 **4** 条；只在带改动红 **1** 条 |

**判读（这是结论，不是辩解）**：失败集合**双向**变动（4 条「基线红、改动绿」+ 1 条反向），
只有跑次噪声能解释；那条唯一「只在带改动红」的
（`session HttpApi > durably records one v2 prompt for exact message-ID retries`）
**单独跑该文件为绿**（19 pass / 2 fail，余下 2 条正是「两边都红」的存量）。
⇒ **T005 未引入新失败**，且**全包绿在本机不可达**，与本 feature 无关（已登记进上表）。

**复现命令**（别引用上面写死的数——它们会随跑次漂）：
基线用 `git stash` 之外的干净做法——把改动导出成 patch、`git checkout --` 回退、跑完 `git apply` 还原；
对比只看**测试名集合**，不看总数（oxlint 与 bun 的计数都有抖动，`LEARNINGS #001-01`）。

### 本轮未覆盖（缺口，**不是覆盖**）

- 🟡 **`node` 构建条件下「路由真的生效」未验证**——原因与残差见上「未覆盖」表第 1 行。
  要看的是：形状守卫**不是**行为验证，别把它当覆盖。
- 长连接（SSE `/event`、WebSocket `/pty`、`/tui`）与 `SessionPrompt`（发消息跑 agent）下的取连接行为
  ——**本次仍未测**（要 provider/LLM），仍在「本 feature 未覆盖」表里挂着，交给 T012/T013。
  📌 **2026-09-30 补记**：T012/T013 已收尾，两者**都是普通 HTTP 请求形态、一条长连接用例都没有**
  ⇒ **仍未覆盖、现无接收方**，待裁。最新状态见「阻塞项」第 2 条。
- 两个用户共用同一个 `Location.Ref` 的隔离——**没被 T005 关掉**（路由按 fiber 的 `User` 分库，
  Location 树按**目录**缓存、不按用户分键）。仍挂 T006，**T006 落地前不得声称已隔离**。

✅ **原先那条「路由还没接进真实请求路径」已关闭**——即上面③，已接进并有变异验证。

## T005 探针结论（2026-09-30 · 三问全部实跑；**推翻了我自己的一条读码推断**）

T005 开工第一步跑探针（不预设形状）。探针文件已删、临时改的上游文件已还原
（`git status` 只有本文档与 `tasks.md` 两处 M，无未跟踪文件；`git diff` 对
`packages/opencode/.../user-identity.ts` 与 `packages/core/src/database/` 均为空）。

### ❌ 先更正一条错话：我说「裁定落点站不住」，**是错的**

我据「`sqlite.bun.ts` 的 `run()` 里是 `native.query(query)`」推断「acquirer 只是 facade、
换不了库」。**实测推翻**：`Client.make` 的 `getConnection` **每条查询都回调 acquirer**，
`Statement.make(getConnection, …)` 每查询取一次；**acquirer 返回哪个 connection 就决定落到哪个文件**。

实测（把两个 `layerFromPath` 各自的 connection 交给第三个自建 client 的 acquirer 按身份二选一）：

| 实验 | 结果 |
|---|---|
| 身份 = B 时写 `probe` | 只落在 **B** 的文件（`a_has_probe:false, b_has_probe:true`） |
| 身份 = A 时写 `probe_a` | 只落在 **A** 的文件 |
| 对照：acquirer 写死 connA/connB | 身份不再影响落点（`a:["fixed_a"], b:["fixed_b"]`） |

⇒ **裁定「乙 · 取连接点路由」成立，T004 的落点不变。** 教训：`LEARNINGS #001-01` / `#002-03`
——**读代码的推断不等于实测**，我这次就是以「看起来对」的代码形状下了结论，被 10 分钟的实验推翻。

### ❌ 候选路 ①：请求级替换 `Database.Service` —— **无效**

做法：真 HTTP 请求路径上，在身份中间件里 `Effect.provideService(effect, Database.Service, 每用户实例)`，
身份门真开、真签发的 JWT。结果：

```
[Q2] POST /session (alice) -> 200      ← 建会话成功
[Q2] alice 库: []                       ← 但 alice 库里 0 行
[Q2] bob  库: []
[Q2] GET /session (bob)   -> 200  [{… "title":"alice-probe" …}]   ← bob 读到了 alice 的会话
```

**机制定位（决定性）**：`[Q2-机制] {"lazy":"OUTER(中间件注入的)","captured":"INNER(路由层提供的)"}`
—— 同一棵树、同一处注入，**每次 `yield*` 的惰性读者看得到注入，而建层时捕获的读者看不到**。
⇒ 失败原因**不是遮蔽，是消费者在建层时就把 `Database.Service` 捕获了**。
捕获点成串（`opencode/session/session.ts` 的 `layer`、`core/session.ts`、`core/event.ts`、
`core/credential.ts`、`core/project/copy.ts` … 十余处），都是
`Layer.effect(…, Effect.gen(function*(){ const { db } = yield* Database.Service …}))`。

⇒ **「`packages/core` 零改动、只在服务端加一个注入点」这条路不存在**（探索过，排除）。

### ❌ 候选路 ②：把 `#sqlite` 映射换成包装层 —— **死锁**

```
[Q3-①] 建层期看到的身份: ["k:caller-identity"]      ← per-user 层在调用方 fiber 里构建
[Q3-②] {"ok":false,"why":"TimeoutError"}           ← 构建中再取同一 key：5s 挂住，不是报错
```

合成真链路：`router.ts` 的 per-user 层 → `Database.layerFromPath` → `#sqlite` → `make()`，
而该层的构建体（`database.ts` 的 `layer`）**自己就跑 6 条 PRAGMA + `DatabaseMigration.apply`**
⇒ 包装层若按 fiber 身份回调 router，这些建层期查询会以**同一 key** 再进一次 ⇒ 同型死锁。
**要走这条必须先显式打断递归**（例：per-user 层 `Layer.provide(Layer.succeed(AlreadyRouting, true))`，
包装层见标记即退回 `config.filename`）。

### ✅ 推荐落点（方案 A）：`sqlite.bun.ts` 里加一个**可选钩子**，路由逻辑全在 `router.ts`

- `make()` 的 `acquirer`（**及 `transactionAcquirer`**）改成：先问 fiber context 里一个**可选**钩子；
  **没有钩子就逐字用本层 `connection`**（默认路径与现状逐字相同）。
- 钩子与全部路由逻辑放 `packages/core/src/database/router.ts`（**新增**，零冲突面）。
- 上游触碰：**1 文件**（`sqlite.bun.ts`）；`database.ts` 与 `package.json` **都不用动**。
  （当时估「约 5 行」；实测行数比估计多得多，多出来的**全是解释性注释**，刻意如此。
  收尾后这里只剩两行 `routed(...)` 调用——实现抽到了 `connection-routing.ts`。
  **别引用写死的行数**，取数用 `git diff --stat`。）
- ⚠️ 仍须解 Q3 的重入（见上），且事务路径也要路由。

### 本轮未覆盖（按 `LEARNINGS #002-02`：缺口写成缺口）

① **没有端到端跑过**「改了 `sqlite.bun.ts` 的 acquirer 之后落点确实改变」——Q1 是用**同型**自建
client 证明机制，上游文件当时一行未动；这一步是「Q1 实测 + 静态读码」的**合成**。
② 未测事务路由后的行为；③ 未测长连接（SSE/WebSocket）与 `SessionPrompt`（agent 链路）；
④ 未测并发（两用户同打一目录）。③④ 与第三轮的未覆盖项重合，仍未覆盖。
⑤ 捕获点清单来自 grep + 读码，**没有逐个消费者跑**。
⑥ Q3 的「真链路会死锁」由 ①+②+静态事实推出，**没在真实 router + `#sqlite` 包装下跑出死锁**。

## T004 结论（2026-09-30 · 每用户一个库的注册表已落地）

**落点**：`packages/core/src/database/router.ts`（新增）+ `packages/core/test/database-router.test.ts`（新增）。
**零改动上游文件**——`database.ts` / `sqlite.bun.ts` 一行没动（那时）；
本 task 只交**注册表本身**：给一个 userId，给出那个用户独有的 `Database.Interface`；**不读任何上下文**。
（后续更正：当时说「接进 `Database.node` 是 T005 的事」——**T005 最终走的是「取连接点路由」，
没有接 `Database.node`**，而是给 `sqlite.bun.ts` 加钩子。`node` 至今仍在原地。）

**公开面**：`DATA_ROOT_ENV` / `dataRoot(env)` / `userDatabasePath(root, userId)` /
`Service`（`Interface = { forUser }`）/ `layer({ root })`。

**三条出参怎么落的**：

| 出参（`tasks.md` T004） | 落法 |
|---|---|
| `/data/{userId}/opencode.db`，`OPENHIVE_DATA_ROOT` 常量落本 task | `join(dataRoot(env), userId, "opencode.db")`；`dataRoot` 照 002 的 `workspaceRoot(env)` 先例读 **env 记录**（可注入），空串按没设处理 |
| 目录**惰性** `mkdir -p` | 在**层构造里**（`Layer.unwrap`）、开库之前——`new Database(...)` 不会建父目录（`isolation-scheme.md` §1）。**不能放 `forUser` 里**：T005 后那是按查询调用，等于每查询一次 `mkdir` 系统调用 |
| 各自 PRAGMA + 迁移 | **复用 `Database.layerFromPath`**，不自己开库。那 5 条 PRAGMA、`wal_checkpoint`、`DatabaseMigration.apply` 全在里面；自己写一份等于把「新库要跑迁移」分裂成两处 |
| 多 userId 各自连接独立 | `LayerMap`（TTL 60 分钟）按 userId 缓存 + **`Layer.fresh`**（见下） |

**校验口径**：与 002 `createWorkspace` **等价**、本地实现。为什么本地写：`packages/core/package.json`
**没有 `@opencode-ai/auth` 依赖**，core 是最底层，反向 import 会让依赖倒过来。

**为什么用 `LayerMap` 而不是裸 `Map`**：它自带空闲回收（TTL）与并发去重——`plan.md` R2（连接泄漏）
要的正是这个，不必重造；`location-services.ts` 是同一个用法。

### 🔴 踩到并已修的坑：`Layer.fresh` 去掉就**串库**

`Database.layerFromPath(filename)` 内部是 `layer.pipe(Layer.provide(sqliteLayer({ filename })))`，
其中 `layer` 是 **`database.ts` 的模块级常量**。而 `Layer.buildWithMemoMap` **按层对象身份缓存** ⇒
不加 `Layer.fresh` 时，**第二个用户会直接复用第一个用户已建好的连接**，两个 userId 指向**同一个库文件**。

**这不是理论风险——本 task 的测试第一版就撞上了**：关键断言「bob 看不到 alice 建的表」直接变红
（bob 的库里查到了 `probe` 表）。修法就是 `.pipe(Layer.fresh)`，与 `location-services.ts` 同款。

> 这是本 feature 第二次撞「**同一 layer 对象被共享 memo 缓存**」这一类问题（第一次是 `Database`
> 的进程级单例），而两次都是**测试**而不是推理抓到的。`LEARNINGS #001-04`（三段真相链）同源：
> 层树里「看起来一样」的东西，缓存键未必含你以为的那一维。

### 质量门禁（2026-09-30 实跑，非外推）

| 门 | 命令 | 结果 |
|---|---|---|
| 单测 | `cd packages/core && bun test test/database-router.test.ts` | **6 pass / 0 fail**，21 expect |
| 类型 | `cd packages/core && bun run typecheck` | 通过（`tsgo --noEmit` 无输出） |
| lint | `bunx oxlint -c script/oxlintrc.openhive.json <两个新文件>` | **0 warning / 0 error**，161 rules（＝ `LEARNINGS #001-05` 的 161 = 131 + 30 恒等式，配置未被换过） |
| 回归 | `cd packages/core && bun test`（全包） | **基准对照，Δ 见下** |

**全包回归的基准对照**（`LEARNINGS #001-02`：门禁数字先测真实基线再引用）。两次真跑，唯一变量
是这两个新文件在不在树里（把它们临时挪出仓库再挪回，不是靠「它没被 import」推断）：

| | pass | skip | fail | 失败名单 |
|---|---|---|---|---|
| **无 T004（基线）** | 1087 | 7 | 5 | 5 条 `NpmConfig` |
| **有 T004** | 1093 | 7 | 5 | **同一条不差**的 5 条 `NpmConfig` |

⇒ **Δ = +6 pass（本 task 的 6 个用例）/ 0 新失败**。

那 5 条 `NpmConfig` 是**存量环境失败，不是本 task 的**，根因与 CLAUDE.md 记的 `bun.lock` 污染**同源**：
本机 `~/.npmrc` 指向 `registry.npmmirror.com`，漏进了「读项目 `.npmrc`」的用例
（实测报错正文：`Expected "https://registry.example.test/" / Received "https://registry.npmmirror.com/"`）。
**未动 `~/.npmrc`**——那是本机全局配置，改它超出本 feature 边界。

⚠️ **一次抖动，已如实记下**：其中一次全包跑里 `test/snapshot.test.ts` 的
`isolates snapshot indexes by canonical Git worktree` **超时**（`timed out after 5000ms`），
另两次跑**都不出现**。判定为 5s 超时的存量 flake（与机器负载相关），**不是**稳定失败；
本 task 没有结论依赖它，但**「跑几次绿一次」不等于稳**，若它在 T005 之后复现要当回事查。

**未覆盖**（缺口，不是覆盖）：① ~~没跑 HTTP，本 task 的注册表**还没接进任何真实请求路径**（T005 的事）~~
——**已由 T005 收尾关闭**（接进真实请求路径并有变异验证，见上「T005 结论」③）；
② 没验真实 `OPENHIVE_DATA_ROOT` 下的权限/属主（T007 的事）；③ `Layer.fresh` 后每用户一棵树，
    多用户下的**连接基数与内存占用**没量（R2 的量化留给收尾评审）。

## T003 结论（2026-09-30 · 验签门已落地）

### 落点（两处新增 / 重写，**未改上游既有文件**）
- `packages/core/src/user.ts`（新）—— `User.Service` = `Context.Service`，`Info` = `{ id, policeNo, name, isAdmin }`。
  **放 core 不放在 `opencode/src/user/`**：T005 要 core 的 `Database` 读得到它（与 `Location` 同侧）。
- `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts`（重写）——
  取代 002 的「读头即放行」：用 002 的 `verifyToken` 验 `AUTH_JWT_SECRET` 签的会话 Cookie，
  取 subject 为 `User`，`Effect.provideService` 填进请求上下文。
- `packages/opencode/src/server/user-identity.ts`（重写）—— `Config` 改为 `{ required, secret }`；
  `HEADER` 保留但**降级为路由提示**；`COOKIE_NAME` 复用 `packages/auth/src/policy.ts` 的常量（不写死名字）。
- `packages/opencode/test/server/user-identity.test.ts`（重写）—— 002 的 4 条**换成**验签语义（不是加）。

### 放行规则（四条刻意的选择）
1. **验不了就拒**：无凭证 / 签名不符 / 过期 / 换密钥签 / 密钥缺失 / 密钥短于 002 的地板 ⇒ 一律 401。
2. **`X-User-ID` 只在「与验签结果矛盾」时拒**：**缺失不拒**（提示不是必要条件，拒了等于又把它当身份来源）；
   不一致拒（令牌说 A 头说 B，只有两种解释：链路被改写，或有人手工塞了头）。
3. **不制造「默认用户」或空身份**——拿不到身份就不放行，宁可 401 也不给下游一个假主体。
4. **公共 UI 资源豁免**（同 Basic Auth，上游 #25698 的 PWA manifest）；
   拒绝时**不发** `www-authenticate`（那是给浏览器弹 Basic 框用的，这里没有 Basic）。

### ⚠️ 与 plan 的有意偏离：**没用模式 A**（`LayerNode.unbound`）
`unbound`/`boundNode` 解决的是「**按 key 构造并缓存一棵服务树**」，且替换物**由 key 算出来**
（`Location` 有 `LayerMap` + `Layer.fresh` + TTL 才有意义）；而用户身份是**每请求验出的纯数据**——
没有要构造的东西、没有要缓存的树、没有「由 key 算替换物」。为它建层树 = 每请求重建一棵树。
「未填即失败」这层保证 `Context.Service` 照样给：编译期消费者把 `User.Service` 写进 `R`，
运行时兜底是 **401**（比抛异常更贴 T003 的验收口径）。
⇒ **模式 A 留给 T004/T005 的 `Database` 替换**，那才是真·按用户构造连接的地方。
**已同步**（**别记条数**——条数把「扫完了没有」偷换成「数够 N 条没有」，`LEARNINGS #002-06` 就是这么栽的）：
`tasks.md`（T003 段 + T014 段的落点文件名）、`refactor-targets.md`（§5 + §4 基线表）、
`plan.md`（Technical Context / 宪法对照 V / 文件结构 / 依赖表 / 集成点）、`state.md`（可仿模式表）、
`design-v2.md`（§5.2 步骤 1）。判据是 `grep`（`unbound` / `context.ts` / `src/user/`），不是这个列表。
> 手法照 `LEARNINGS #002-06`：**改完立刻 grep「谁引用了刚改掉的东西」**（`unbound` / `context.ts` / `src/user/`）。
> 这次 grep 出的第 5、6 处（`state.md` 的模式表、`tasks.md` T014 段的 `user/context.ts`）**是偏离发生后我才想到去扫的**
> ——先做代码、后扫文档，顺序颠倒；正确顺序是**决定偏离的那一刻就扫**。

### 质量门禁（2026-09-30 实跑，非外推）
| 门 | 命令 | 结果 |
|---|---|---|
| 单测 | `bun test test/server/user-identity.test.ts`（`packages/opencode`） | **17 pass / 0 fail**（18 expect） |
| typecheck | `bun run typecheck`（`opencode` / `core` / `auth` 三个包各跑一次） | 三个包**均无输出=干净** |
| lint | `bunx oxlint <本次改动的 4 个 .ts 文件>`（仓库根配置） | **0 warnings / 0 errors**（130 rules） |

**变异验证**（证伪「测试在守空气」）：三条关键行为各只有一条测试守着——
删「`X-User-ID` 不一致即拒」只红那一条；把密钥强度校验短路成 `return raw` 只红「短于 32 字符」；
去掉 `Effect.provideService(..., User.Service, user)` 只红「读到验签出来的 userId」。**每次改完即还原**。

### 踩到的 API 坑（值得记）
`UserIdentity.Config` 在**类型位置**指的是「键」（`ServiceClass`：`key` / `[ServiceTypeId]` / `Service`），
**没有** `required` / `secret`——那是 `yield* Config` 之后才拿到的值。取形状要走 Effect 官方的
`Context.Service.Shape<typeof Tag>`。走错时报的是 `Property 'secret' does not exist on type 'Config'`，
外加一条**连带的** `Type '{} | null' is not assignable to type 'string | undefined'`（不是独立缺陷）。

### 未覆盖 / 挂账（按 `LEARNINGS #002-02`：缺口要写成缺口，不写成覆盖）
- **真网关链路的端到端未测**——T014 之后才有，作为 T016 的前置。本 task 用 002 的 `signToken`
  **自造令牌**独立测（这是 task 设计如此，不是缺口）。
- **中间件类型参数暂未声明 `provides: User.Service`**——T003 没有消费者要求它；
  等 T004/T005 定了消费者形状再加，现在加是猜。
- **`OPENHIVE_REQUIRE_USER_ID` 仍默认关**（002 定的，T003 沿用）：网关还不存在，默认开 = 把
  app / desktop / CLI / 内置 web UI 全锁死在自己机器上。由 T014 上线时置 `1`。

## T002 结论（2026-09-30 · 基点 `21d0b61b52`）

### 能确定的部分
- **`/workspaces` 侧 002 已交**：`packages/auth/src/workspace.ts` 的
  `WORKSPACE_ROOT_ENV` / `workspaceRoot()` / `createWorkspace()`（含 `../` 穿越校验）——**不重造**。
- **`{userId}` = UUID**（`register.ts` 的 `crypto.randomUUID()`）⇒ 可直接作目录名。
- 目录布局：`/workspaces/{userId}/{project}/` + `/data/{userId}/opencode.db` + `/assets`（共享，独立于用户隔离）。
- 挂载：`/workspaces`、`/data` 持久卷，`/assets` 共享卷（资产服务 rw + opencode **ro**）。
- 本 task 新增 `OPENHIVE_DATA_ROOT`（照 `WORKSPACE_ROOT_ENV` 先例）——**落点在 T004，不在 `packages/auth`**。
- **`/data/{userId}/` 的创建时机 = T004 连接惰性打开处**（不是 002 的 `provisionUser`——
  历史账号没有该目录）。

### ⚠️ SQLite WAL 的坑（T004 / T007 的前置约束）
`database.ts` 层里设了 `PRAGMA journal_mode = WAL` → WAL 会在 db 文件**旁**生成 `-wal` / `-shm`。
⇒ **`/data/{userId}/` 目录本身必须对运行身份可写**。
「db 文件 0600 + 目录 0500」这种只读目录方案**会让 SQLite 直接打不开库**。

### ✅ 已裁定（乙）：单进程模型下「OS 层兜底」不成立
证据链：design-v2 §11.6 部署 = **一个 opencode 容器**（`/workspaces`、`/data` 是它的持久卷）；
§6 = **共享单进程**；**实测** `packages/core/src/cross-spawn-spawner.ts` 的 spawn 选项
= `cwd / env / stdio / detached / shell / windowsHide`，**无 `uid`/`gid`**；
上游 `packages/opencode/Dockerfile` **无 `USER` 指令**（以 root 跑，且只是 CLI 镜像）。

⇒ **一个进程 = 一个 OS 主体**：`/workspaces/{userId}/` 全属同一 uid，同一进程处理 A 与处理 B
看到的 uid 完全相同 ⇒ **`chmod 700` 对「用户 A vs 用户 B」零作用**。
⇒ `spec.md` 的 **FR-006 / US2 验收场景 2 / SC-003** 字面**无法成立**（不是配置问题，是模型问题）。

三个方向（见 `isolation-scheme.md` §5.3）：
| 方向 | 能真正 OS 隔离吗 | 代价 |
|---|---|---|
| 甲 · 逐用户 uid + 子进程 | **部分**（Bash 走子进程有效；Read/Write/Edit 进程内 fs 无效） | 1600 系统用户 + uid 映射；要动 `cross-spawn-spawner` = **深改 core**（撞 §I/§V） |
| 乙 · 降级为「容器级」 | 否 | 改 FR-006/US2-2/SC-003 措辞；§III 仍成立（独立 db 是真物理隔离） |
| 丙 · 每用户一进程/容器 | **是** | 把 §6.1 的「后手」提前到 P0，资源模型全变 |

**裁定结果：乙**（用户 2026-09-30）。理由见 `isolation-scheme.md` §5.4。
**丙记为真正的答案 + 触发条件**（`isolation-scheme.md` §5.5）——主要是**合规评审**触发，
不是技术触发。**T007 据此解锁**：`0700` 照做，但**不得宣称它承担用户间隔离**。

## T001 结论（2026-09-30 · 基点 `e788f9a9aa`）

### 单例现状
- 真身 = `packages/core/src/database/database.ts`（**不是** `packages/opencode/src/`）；
  同目录 `path.ts` 是 drizzle 列类型定义，**与 db 路由无关**（任务书提醒属实）。
- 「一个进程一个 db」的根源 = `path()` 在**模块导入时**求值一次；它依赖的 `Global.Path.data`
  同样在导入时算死。`node = makeGlobalNode({ service, layer: layerFromPath(path()), deps: [] })` 焊死结果。
- **实测**：`git log --author=huangandy -- packages/core/src/database/` **零条提交**；
  `database.ts` 最近改动全为上游 PR（最新 `472d0f376e`）。⇒ R1「我们从未碰过它」**成立**。
- **实测**：`grep -rn 'user_id' --include=sql.ts packages/core/src/` **零命中**；
  `session` 表只有 `project_id` + `session_project_idx`。⇒ **零表结构改动基线成立**。

### 可仿模式清单
| 模式 | 落点 | 本 feature 的用法 |
|---|---|---|
| A · `unbound` / `boundNode` | `packages/core/src/location.ts` + `effect/layer-node.ts` | T004 的 `Database` 按用户替换（**真·按 key 构造**）。⚠️ T003 原写的是用它，**落地时改判没用**——per-request 数据无树可缓存，见 `refactor-targets.md` §5 |
| B · `LayerMap` + `hoist` + `Layer.fresh` + `idleTimeToLive` | `packages/core/src/location-services.ts` | T004 的 per-user 连接树 + **R2 连接回收（现成的）** |
| C · `AppNodeBuilder.build(root, replacements)` | `packages/core/src/effect/app-node-builder.ts` | 挂在 `replacements` 上就无需改既有调用点 |
| D · env 常量先例 | `packages/auth/src/policy.ts` / `server/auth.ts` | 新增 env 常量的写法 |

- **`layerFromPath(filename)` 已是公开导出**——接受的任意文件名，内部含 5 个 PRAGMA + `wal_checkpoint` +
  `DatabaseMigration.apply`。⇒ per-user 连接**零改动复用**它，不必重写这段逻辑。

### ⚠️ 结构性发现（影响 T004 落点 —— **该落点已于 2026-09-30 三轮实测后裁定**，见「T004 结论」；本段保留为当时的发现记录）
`Database.node` 的 tag 是 **`global`**，消费者 9/10 是 global 节点
（`credential` / `event` / `permission/saved` / `project/copy` / `project/directories` /
`session/projector` / `session/runner/llm` / `session/store` / `session.ts`；只有 `session/todo` 是 location），
而 `locationServices` 组**不含**这些节点。
⇒ **把 `Database.node` 塞进 `locationServices` 的替换列表只能影响 1/10 的消费者**，
**不能照抄 Location 的替换点**。T004 落点三选一（见 `refactor-targets.md` §3），
**开工前未定则停下来问**（任务书 Step 0.5 规则）。

### 待实测（**不写进结论**）
`LayerNode.compile(location.hoisted)` 位于 `LayerMap.make` 的 per-key 回调内 →
按字面语义 global 节点会每 key 重建一次。若属实，`Database` 现状可能已「每 location 一个连接（同一文件）」，
**直接影响 R2 的评估**。⇒ T004 必须实测，本次**不据此下结论**。

## 开工前已裁定的事项
- ✅ **FR-002 的信任模型（2026-09-29 定稿）：走【甲】真做验签**。
  > 演变：002 收尾时曾裁【乙】「认链路不可达」，同日**推翻**改为【甲】。
  > 推翻理由：乙的成本论据（「要两段共享密钥的分发与轮转」）不成立——002 已把整套 JWT 基建
  > 交齐（`packages/auth/src/token.ts` 的 `signToken` / `verifyToken` / `jwtSecret` / `sessionCookie`，
  > 且 `verifyToken` 返回的 subject 就是 userId），**甲零新增密钥、零新增轮转**。
  > 后果不对称：乙失败 = 案件数据任意跨用户暴露；甲失败 = 攻击者仍拿不到密钥。

  **甲 = 三层保证，缺一不可**（乙那两条全部保留，验签是叠加不是替换）：
  ① 网关**剥离客户端传入的 `X-User-ID`** 后按会话凭证**强制覆盖**注入（是覆盖，不是拼接）；
  ② 内核端口**只对网关可达**（回环绑定 / 网络策略）；
  ③ 内核**验签后才认**——网关透传会话 JWT，内核用 `verifyToken` + `AUTH_JWT_SECRET` 验签，
     取 subject 为 userId，失败即拒（fail-closed）。

  ⚠️ **明文头 `X-User-ID` 保留但降级为路由提示**，MUST NOT 作为身份来源。

  同步改动：`spec.md`（FR-002 / 验收场景 3 / SC-003 / Assumptions）、`plan.md`
  （数据流向图 + 数据隔离说明 + 集成点）、`tasks.md`（T003 出参 + T014 裁定段）、
  `packages/opencode/src/server/user-identity.ts`（顶部注释）——**每处都必须同改，否则自相矛盾**。
  ⚠️ **勘误（2026-09-30）**：原文写的是「**五处**必须同改」。这个数字本身就是错的——当次同步
  **漏了 design-v2**（共 6 处），而「数几条」这种写法的毛病在于：它把「扫完了没有」偷换成
  「我数够 N 条了没有」，**范围划小了就等于没扫**。判据应当是**命令**（`grep` 出全部引用点），不是一个数。

  落地分工：**T014 管「注入 + 透传」，T003 管「验签后才认」**；T003 用自造令牌即可独立测，
  真链路端到端在 T014 之后。

## 最后更新
2026-09-30（**T012 + T013 已完成 —— 003 原计划的 13 条任务（T001–T013）到此全部做完**：
**验收隔离测试**（FR-010 / SC-001 / SC-003）。**零产品代码改动**，新增 2 个测试文件、
合跑 **9 pass / 0 fail / 33 expect**（T012 `tenant-db-isolation.test.ts` 4/20、
T013 `tenant-directory-isolation.test.ts` 5/13）。**两条出参都达成**，但范围要说准：
T012 走**真应用**（`HttpApiApp.routes`）+ **真签发器**（`signToken`）发带签名 Cookie 的请求，
**无 mock**，oracle 用 `bun:sqlite` **直接读库文件**、不经过被测对象（`#002-02`）；
T013 挡在中间的是**应用层锚定**（T006）——**不是 OS 权限**，这是 `plan.md` R3 ② 要求如实写的
（T007 已登记「两条 `0700` 断言在本机不可验」，写成「OS 拦的」就自相矛盾）。
⚠️ **两个文件首次跑都全绿、没有 RED**——它们是**验证既有行为**，按 T008/T009 的做法改用
**变异测试**证敏感性，全部还原：T012 拿掉按用户路由 ⇒ **4 条全红**、只对 BOB 拿掉 ⇒ **仅第 4 条红**
（证明「过紧也是缺陷」那半在为**正确的理由**起作用）；T013 里 **M2a（只动 handler 那道守卫）
跑出 5 pass** ——我原本把穿越的功劳记在它头上，是变异测试把**错误归因**顶出来的：
真实答案是 `read` **双重**守卫（`filesystem.ts` 的 `resolve()` + `handlers/file.ts` 的 `content`）、
`list` **只有** core 一道。另记一条 Windows 坑：本机 `tmpdir()` 给 **8.3 短名**（`ADMINI~1`）、
应用解析成**长名**（`Administrator`），不比 `realpath` 会**假红**（那是测试产物、不是产品缺陷）。
📌 **实测出的一条接线知识**：`OPENHIVE_DATA_ROOT` **只能走 `process.env`**，走 `ConfigProvider`
会被**无声忽略**（`DatabaseRouter.layer()` 读 `dataRoot(process.env)`，不是 Effect 的 `Config`）
——而 T006 的 `AnchorWorkspace.Config` **是**走 `Config` 的，两条 env 读法不一样（`#002-01` 那类）。
📌 **顺带查明**「`file HttpApi` 5s 超时」的根因：本机**第一次 spawn `rg.exe` ≈4 秒**
（实测 3921ms / bun test 下 4874ms、4800ms；之后 ~30–45ms），而该用例把第一次 rg 调用放在
**5 秒预算**里 ⇒ 本机稳定超时。**是环境、不是 003**（新测试文件不被加载时照样红；
003 对 ripgrep / filesystem 的 diff 为空）。复现命令与三条依据见「T013 结论」⑦。
🟡 **三条缺口如实登记为「未覆盖」且现在**没有接收方**：T009 的两条读路径（**不跨用户**，
是「同一用户内项目不串」那半边）、T010 的端到端 429、**长连接**（SSE / WebSocket 下一条用例都没有）
——**没有硬挂给 T016**（语义是 BOLA/BFLA，不贴切；硬挂正是 `#002-04` 说的推责任进黑洞），
**请你裁决**（见「阻塞项」第 2 条）。
门禁：两个新文件 `bun test` **9 pass / 0 fail**；`bun run typecheck` **31/31、exit 0**；
新文件 `bunx oxlint` **0 warnings / 0 errors**；`git diff --stat bun.lock` **无输出**。
**下一个：T014（网关）**，⚠️ T015 开工前必须先回来问 **D3**。）

2026-09-30（**T011 已完成**：沙箱磁盘配额（FR-009）。新增 3 文件、改动 1 文件（+1 行调用、
错误联合 +1 项），**零 schema 改动**。**出参在应用层达成**——拦点按裁定落在
**`FSUtil.writeWithDirs` 这道写漏斗**上，`write` / `edit` / `apply_patch` 三者共用它
⇒ 一处接线覆盖三个工具。判据是**净增**（`used - replacing + incoming > limit`）：
`replacing` 抵扣**不是优化**，三个工具都是整文件重写，不抵扣的话接近上限时**改小也会被拒**；
边界是「**恰好写满放行**」（⚠️ 与 T010 的 `>=` 方向不同、不是笔误：那边数名额、这边量字节）。
沙箱外路径**直接放行**（`/data/{userId}/`、临时目录、storage 都不在沙箱根下）；
要有**第二段**才算沙箱内——先写成「根下散文件也算」，扫它会 ENOTDIR ⇒ 那个文件每次写入都被判成
「量不出来」而拒，**是枚地雷**，已钉测试。**量不出来 ⇒ 拒**（不学 `du` 的跳过：这道门本就绕得过，
再静默放行就等于把配额做成一句声明）。中文按 **UTF-8 字节**算（用 `length` 会让配额少算三分之二，
而民警产物全是中文）。core 取不到 auth 的沙箱根常量 ⇒ 另立一份 + `packages/opencode` 里一条
**防漂移**断言（漂了的话配额**永远显示 0 已用、永远不拒**，且不报错、不变红）。
🟡 **OS 级强制那半挂账**：落点 = 新建的 `docs/workspace/deploy-todo.md` **D-01**（验收写明
「绕开 opencode 工具灌大文件、应当被 OS 拒绝；**只验应用层拒绝不算过**」）。
变异验证 4 条都实测（`>`→`>=` 4 红 / 去 `replacing` 2 红 / 不排根外 5 红 / 改常量 ⇒ 漂移测试红）。
门禁：typecheck **31/31 exit 0**（`FSUtil.Error` +1 项**零连带**）；core 全量
**1135 pass / 8 skip / 5 fail**，5 条全是存量 `NpmConfig`，且 **T009 基线 1109 + 26
（T010 的 7 + 本 task 的 19）= 1135 精确吻合**；opencode 三个写入工具 **72 pass**；
三个新文件 oxlint **0 error / 0 warning**，`fs-util.ts` 那 4 条 warning 用 `git show HEAD:` 实测
**HEAD 上同样有**（不动）；`bun.lock` 无 diff。⚠️ **未覆盖**：符号链接那支「不计数」无测试守着、
`shell` 工具绕过（D4-3 已认）、OS 级强制（D-01）。详见下「T011 结论」）
2026-09-30（**T010 已完成**：每用户并发 Session 限流（FR-008）。新增 4 文件、改动 2 文件
（各 2 行挂载 + 1 行 import），**零错误契约改动、零 schema 改动**。判定/阈值/计数唯一一份在
core（`quota/session-quota.ts`，7 测），opencode 侧只放两种形态的适配器（7 测 = 5 判据 + 2 守夜）。
⚠️ **D4 裁定「一处挂载覆盖两条链」的前提被实测推翻**：两条链**活在两个层作用域**——
A 链（**产品 UI 主路径**，`/session/{id}/prompt_async`）的活跃集合 `SessionStatus` **只能端点级**挂
（`InstanceRef` 由**端点级** `HttpApiMiddleware` 注入，任何路由级中间件都在它外面；挂错是 **500**，
不是静默放行），B 链（`/api/session/{id}/prompt`）走路由级。**两次挂载、一份判定**（`judge`）。
⚠️ 另实测出一条 **typecheck 级**的坑：`HttpApiMiddleware.Service` 声明里写 `requires`
会把需求**焊进 API 的类型**、**任何 `Layer.provide` 都消不掉**（层供了、运行期也对，
typecheck 仍报欠着）；照官方 `Authorization` 先例——它只写 `error`、不写 `requires`。
⚠️ **顺带实测出一条存量 flaky**：`user-identity.test.ts` 的「令牌被篡改 → 拒绝」以 **≈1/16**
概率假红（末字符 `A`→`B` 只动 base64 **填充位** ⇒ 解出的签名字节**逐字节相同** ⇒ 验签照样通过；
300 条探针实测：末字符为 `A` 的 **20/20 全部**「篡改后仍验过」，改中间字符 **0/300** 幸存）。
**不是安全洞、不是身份门漏了**，是测试构造缺陷；**本轮未修，待你裁决**。
⚠️ **未覆盖**：端到端「第 6 个真会话被拒」**未验证**（要先有真会话在跑），按 `#002-02` 登记为缺口。
📌 核过 D4 未涉及但开工必查的一条：与 **F4 工具执行守卫**是否打架 → **不打架**（F4 未落地，
钩点在工具清单组装/执行器入口，都在「一轮已跑起来之后」；本 task 在 prompt 入口准入，不同层）。
门禁：typecheck **31/31 exit 0**；core 7 pass、opencode 影响面四文件 **31 pass / 0 fail**；
改动/新增 6 文件 oxlint **0 error**（2 条 warning 实测在 HEAD 上就存在、不动）；`bun.lock` 无 diff。
`test/server` 全目录**没做全绿门禁**（沿用 T005 登记），改为**真基线对照**：
基线 298/23/**9 fail**（9 条**全是 5s 超时**）vs 带改动 298/23/**9 fail**，
失败集合**名称级差集双向变动**（7 两边都红 / 2 只基线红 / 2 只带改动红）⇒ **未引入新失败**。
详见下「T010 结论」）
2026-09-30（**D4 二次裁定 · 覆盖面改【丙】**：动手 T010 前实测发现生产侧有**两条** prompt 链、
挂在**同一棵路由树**上，而 D4-1 写的「数 `SessionExecution.active`」**只覆盖 `/api` 那条（B）**；
**产品 UI 走的是另一条（A，`/session/{id}/prompt_async` → `SessionRunState`）**，
其活跃集合是 `SessionStatus`、**完全不碰 core 的 `SessionExecution`**。
⇒ 照字面落 = web UI 主路径零配额，而 `/api/*` 与 T009 登记的 `listGlobal` 同型
（同一棵树上、**没有开关**）⇒ **能被另一个端点绕过的配额不是配额**。
**裁定【丙】：两条链都拦**，判定 + 阈值 + 计数全在同一个 `quota/session-quota.ts`，
只有「活跃集合从哪取」按链注入（代价：两个调用点）。
📌 顺带核过、**不连带返工**：T005 的库路由不受影响——A 链用的也是 core 的 `Database.Service`，
路由发生在 `$client.reserve`、按发起查询的 **fiber** 的 `User` 分。
已同步 `dev_tdd.003.md` / `tasks.md` / `plan.md` / 本文件）
2026-09-30（**D4 到点裁定**（T010/T011 开工前）：**甲**——数「本用户活跃执行数」
（`SessionExecution.active` ∩ 本用户的库），拦在**启动执行时**（`prompt` → `wake`/`resume`），
**不是**建会话时；默认阈值 **`5`**（plan 的 1600 用户 / 并发活跃 320~480 ⇒ 人均不到 1，5 倍以上余量），
⚠️ **未经压测，非结论**；T011 走**丙**——**应用层先做**（其出参由这半达成），
**OS 级强制**（Linux quota / docker volume）**登记为部署缺口**（本机 win32、无 Docker、无 quota）。
否掉的两条与理由见下「已裁定的事项」D4 条。已同步 `dev_tdd.003.md` / `tasks.md` / `plan.md` /
本文件（含缺口表一行）。
⚠️ **顺带记一条口径风险**：`spec.md` 验收场景 1 的「再发起新会话被拒」**措辞有歧义**
（可读成不让建会话、也可读成不让跑起来），甲取后者——**这不是依据，是要跟验收方对齐的点**。
⚠️ T010 开工必查一条（D4 未涉及）：这个拦点与 **F4 的工具执行守卫**是否打架。
下一步 = **T010**）
2026-09-30（**T009 已完成**：`session.project_id` 逻辑隔离 + 零表结构改动。**零生产代码改动**，
新增 `packages/core/test/session-project-isolation.test.ts`（3 条）。**两条出参都达成**：
① 对**真实建出来的表**（`pragma_table_info('session')`）+ TS 模型**两边都查**，确认无 `user_id` 列；
② 执行点在**两条栈**上都有——core 的 `SessionV2.list`，以及**生产 HTTP** 的 `Session.list →
listByProject`（**无条件**先按 `projectID: ctx.project.id` 过滤，再按 `directory` 收窄）。
⚠️ **必须记住的边界**：`project_id` 是**查询侧逻辑隔离，不是授权门**——`SessionStore.get`
只按 `session_id` 查，拿得到 id 就取得到那行；**跨用户不靠它**，靠 T005 的每用户库。
⚠️ **顺带发现两条「项目边界之外」的读路径**（core 的 `ListAllInput` 变体 / legacy 的 `Session.listGlobal`，
后者经 `experimentalHandlers` **无开关**挂载），**已登记给 T012/T013**；两条都仍**不跨用户**，
但「同一用户内项目不串」在它们上面不成立。
📌 **2026-09-30 补记**：T012/T013 已收尾，测的是**跨用户**、**不含这两条**（它们**不跨用户**，
不在其出参内）⇒ **仍未覆盖、现无接收方**，待裁。最新状态见「阻塞项」第 2 条与缺口表。
📌 与 T008 的接口：`project_id` 由会话目录推出，**首次提交前两个目录同属 `global`**；
但第 3 条实测——**生产默认就带 `directory` 条件**，所以后备判据不是理论上的。
⚠️ **本机没有观察到 RED**（零生产改动）；两条变异验证见下。出参① 的敏感性边界也如实记了
（只动模型那半会红，表那半要让迁移才红，本轮未做）。
门禁：core **1109 pass / 8 skip / 5 fail**（= T008 的 1106 **+3**；5 条仍是存量 `NpmConfig`）；
typecheck **31/31 exit 0**；该文件 oxlint 0/0（161 条规则）；`bun.lock` 无 diff。
详见下「T009 结论」）
2026-09-30（**T008 已完成**：项目 = 唯一隔离边界。**零生产代码改动**，新增
`packages/core/test/project-sandbox-isolation.test.ts`（4 条**特征化**测试，**不是 TDD**）。
出参「沙箱内项目各自独立 git」**成立，但带一条前提**：两个项目**首次提交之前同属 `global`**
（`initGit` 只 `git init`、不提交 ⇒ id 的三个来源全空）——按裁定【甲】**只登记不兜底**，
「是否自动补一次提交」属产品决定；另一处：未 git 化目录的项目 **worktree = 文件系统根**
（沙箱之外）——按裁定【乙】**已测出上报**。⚠️ 两条都**不是** T006 的锚定失效：
请求目录仍锚在沙箱内，指出去的是**项目元数据**那一份。
⚠️ **一处诚实交代**：第 1 条首次跑红是**我自己 fixture 的 bug**（两个同秒空提交哈希相同），
**不是产品缺陷**；已改成给每个库不同种子文件（靠时间跨秒才绿本身就是 flaky）。
**两条变异验证**：去掉一方的首次提交 ⇒ 只「两项目独立」红；给「条件成立」那条补提交 ⇒ 只该条红。
门禁：core **1106 pass / 8 skip / 5 fail**（= 基线 1102 **+4**；5 条全是存量 `NpmConfig`）；
typecheck **31/31 exit 0**；该文件 oxlint 0/0（161 条规则）；`bun.lock` 无 diff。
详见下「T008 结论」）
2026-09-30（**T007 已完成**：文件权限 `0700`。出参 ①「容器非 root」**挂缺口**（无产物可改、
本机无 docker；⚠️ 更正：先前写的「挂 §11.6 部署任务」是**错引**——§11.6 是 design-v2 的
「AI 资产治理」章节、`isolation-scheme.md` 无 §11，且**承接它的部署任务根本不存在**，
故只登记为缺口、不假称已移交，见 `LEARNINGS #002-04`；规范出处是 `spec.md` FR-006）；
②③ 落地：`createWorkspace` 与 `router.ts`
的建目录处加 `{ mode: 0o700 }`。⚠️ **本机没有观察到 RED**——win32 **完全忽略** mode
（实测 `mkdir({mode:0o700})` / 不传 / 建后 `chmod(0o700)` 三者都是 `666`），两条 `0700` 断言只能 `skip`，
按 `LEARNINGS #002-02` 记为**缺口而非覆盖**。
📌 **两条断言的可验性不同**：`/data/{userId}/` 那条 **Linux CI 真跑**（`turbo.json` 有
`@opencode-ai/core#test`）；`/workspaces/{userId}/` 那条 **无人跑**——`turbo.json` **缺
`@opencode-ai/auth#test`**，CI（`bun turbo test`）到不了 auth 包。
⚠️ **附带发现（需裁定，未自行处理）**：这意味着 **002 的整个 auth 包测试从未在 CI 跑过**；
补法是给 `turbo.json` 加一行，但那是**上游文件**（`宪法 §I` 冲突面）。
另：③「目录可写」**改动前就是绿的**，本 task 补的是**回归护栏**而非 RED→GREEN，已写进 `tasks.md`。
门禁：core 1102 pass / 5 fail（**全是存量 `NpmConfig`**，本机 `~/.npmrc` 镜像）/ 8 skip；
auth 149 pass / 1 skip / 0 fail；typecheck EXIT=0；改动 4 文件 oxlint 0/0；`bun.lock` 无 diff。
详见下「T007 结论」）
2026-09-30（**T006 已完成**：工作目录强制锚定，出参达成——客户端传什么 directory 都被改写成
`{沙箱根}/{userId}`。**上游文件零改动**（新增 `middleware/anchor-workspace.ts` + `server.ts` 一行接线）。
**T004 移交的「两个用户拿不到同一个 `Location.Ref`」缺口随本 task 关闭**，验收测试真的构造
`Location.Ref.make(...)` 用 `Equal.equals` 比对；「一人一工作区」同时钉成被验的事实。
⚠️ **两处要点**：① 接线**次序承重**——`anchorWorkspaceLayer` 必须排在 `userIdentityLayer` **之后**，
否则抓不到 `User`、整道锚定**静默直通**（测试守着这个次序）；② 一并删掉 `?workspace=`，因为
`planRequest` 会用该工作区的 `target.directory` **完全绕过** `defaultDirectory`，留着它三处改写等于白改。
**2026-09-30 补记：本条已结案（维持删除）**——依据是查出来的：全仓**零个生产者**构造 `?workspace=`
（前端那几处 `data-workspace=` 是 CSS 属性、`src/workspace/` 是自有模块目录），该特性在 opencode 里是
**Experimental**，且它能 proxy 到 Remote target（是**请求转发开关**，不只是换目录）。
⚠️ 并**补了一条此前缺失的测试**守住这行承重删除，且**做过变异验证**：去掉那行 ⇒ **只有它红**
（500 而非 200）。理由：「全仓没人发它」这个论据会随时间失效，测试不会。
另：开工前挂着的那个未决问题（请求体 `location`）**实测结案为不可利用**——`SessionLocationMiddleware`
不读请求体、且 `ServerApi` 在本仓库**只有 schema 没有 handler**；**若 v2 handler 层将来落地要重新裁定**。）
2026-09-30（**T005 已完成**：db 查询按身份路由到各自连接，出参达成。**本 feature 首次修改上游自有
文件**——`sqlite.bun.ts` **与 `sqlite.node.ts`** 两支（用户已批准方案 A）；`database.ts`/`package.json`
一行没动。三条必做各做过**变异验证**——⚠️ 破坏重入保护 `Disabled` 的表现是**测试挂住（>75s 无输出）
而非变红**；去掉 `server.ts` 的接线则**炸在层构造期**（非静默回退）。
✅ **原计划「接进 `AppLayer`」被实测证伪并改道**：请求 fiber 里**没有 app 层服务**，
改为**身份中间件每请求注入钩子**（与 `User` 同源），已接进真实请求路径。
门禁：T005 新增单测 core 8 pass + opencode 19 pass / 两个包 typecheck 均 EXIT=0 /
oxlint 15 warning 0 error（**新增 1 条已如实登记**）。
🟡 **两条未覆盖已登记**：① `node` 构建条件下路由生效**未验证**（本机跑不到，只有形状守卫）；
② **`packages/opencode` 全包在本机不是可用门禁**——`test/server` 有存量 flaky 5s 超时带，
判据改用**名称级差集**（T005 未引入新失败，证据见下）。
详见下「T005 结论」）
2026-09-30（**T005 探针已跑完** → 裁定「乙」成立、落点不变；**但我据读码写的「落点站不住」被实测推翻**，
已更正。另两条候选路被排除：请求级替换 `Database.Service` 无效（消费者建层时捕获）、`#sqlite` 包装层死锁。
推荐方案 A 要碰 `sqlite.bun.ts`（§I 红线；**该裁定当天已获批准并按方案 A 做完，见上「T005 结论」**）。
详见下「T005 探针结论」）
2026-09-30（**T004 已完成**：每用户一个库的注册表落地，零改动上游文件；**下一个候选 T005**。
补：全包回归已做**基线对照**（挪开/挪回两个新文件各真跑一次）——Δ = **+6 pass / 0 新失败**；
既有 5 条 `NpmConfig` 失败是本机 `~/.npmrc` 镜像导致的**存量**，与 T004 无关；另记一次 `snapshot` 5s 超时抖动。
补：REFACTOR 把 `mkdir` 从 `forUser` 挪进**层构造**（`Layer.unwrap`）——否则 T005 后是每查询一次系统调用；
已按 `LEARNINGS #002-06` grep 后同步 `state.md` / `tasks.md` 两处旧记述）
T004 落点三轮实测后裁定「乙＋丙，丙挂 T006」——取连接点路由 + Location 缓存键按用户分）
2026-09-30（**T003 验签门已落地**；T001/T002 完成；**§5 隔离模型已裁定为【乙】**。
FR-002 信任模型 2026-09-29 定稿为【甲】真做验签。
补①：design-v2 的两类过头记述已按 `LEARNINGS #002-06` grep 后清完——【甲】那次的同步范围划小了，漏了 design-v2。
补②：T003 落地时**改判不用模式 A**（`LayerNode.unbound` → `Context.Service`），已 grep 全部引用点并同步）
