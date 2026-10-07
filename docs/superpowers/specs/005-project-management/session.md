# 会话交接 · 项目管理（工作空间轴）｜005-project-management

**状态**：✅ **已收尾**（2026-10-07）。**25 条 task：24 条落地，1 条整条移交**（T022，前置 `D-13` 只能在
目标环境办，本机 `docker: command not found`、无 MinIO）。

**审查两轮、新账 25 条**：

| 轮次 | 席数 | 新账 | 处置 |
|---|---|---|---|
| **Step 5**（runbook 六类） | 5 席并行 | 16 | 已修 **4**（X3-1 / X3-3 / X2-6 / X5-2）· 待裁定 **4**（X4-1 / X4-2·3 / X4-4 / X5-1 —— **用户全取推荐项、均已落地**）· 挂账 **8** |
| **第二轮**（`#003-02`：靶子＝「修复本身」） | 3 席并行 | 9 | 已修 **4**（R2-01 / R2-02 / R2-03 / R2-04）· 文档更正 **1**（R2-08）· 挂账 **4**（R2-05 / R2-06 / R2-07 / R2-09） |

**全部 Minors 一律挂账**（用户裁定），逐条落在 `state.md` 的两张表里，**没有一条写成「已覆盖」**。

> 合并到开发主线**由用户执行**（本 feature 不自行 merge；见下「用户侧」）。
> spec 目录 `005-project-management/` **永不删除**（下一个 feature 的上下文）。

---

## 上次做到哪

**全部 task 已处置完毕**——不是「跑完了」，是每一条要么落地、要么**明确移交**：

| 处置 | task | 说明 |
|---|---|---|
| 落地 | T001–T021、T023–T025（**24 条**） | 定位 → 数据模型（`project_ext` / `project_member` / `project_archive`）→ 判定纯函数 → 前后端出口 → 六个前端组件 → 归档 / 找回 / 冻结 → 文件四项 → 成员四项 → 超期提醒 |
| **移交** | **T022** | 整条移交 **`docs/workspace/deploy-todo.md` 的 D-13**（起 MinIO 的那一轮顺手裁定凭据契约）。**本 feature 唯一没勾的 `[ ]`** |

按标签：**FE 9 / BE 15 / INT 1 ＝ 25**（取数：`grep -c '^- \[x\] T0' tasks.md` ⇒ 24，`grep -n '^- \[ \] T0'` ⇒ 1）。
> ⚠️ runbook 收尾那节写的「共 16 个 task（7 FE / 8 BE / 1 INT）」是**任务书自己没跟上的旧数**，
> 以 `tasks.md` 实测为准（`LEARNINGS #001-01`：报数前先真跑一次）。

---

## 交付物一览

**core（判定与数据形状）**
- `packages/core/src/project/membership.ts` —— 微信群模型判定纯函数：`MEMBER_ROLES` / `PROJECT_ACTIONS` /
  `decide` / `frozen`。**只有一处定义**，归档 / 找回 / 冻结 / 成员四个出口全走它（宪法 IV）。
- `packages/core/src/project/ext.ts` —— `project_ext` 的四字段 ＋ `STALE_AFTER_MS`（90 天）＋ `isStale`
  （**纯函数、不取时钟**——边界断言才测得出来）＋ `touchProjectExt`。
- `packages/core/src/minio.ts` —— MinIO **窄接口**（`put` / `get` / `list` / `delete`，前缀由 `scope` 定死、
  调用者给不出）。⚠️ **只收凭据、不签发凭据**：STS / 桶策略属 `D-13`（本机一行都验不到，故意不进产品码）。
- `packages/core/src/database/router.ts` —— 每用户库路由（003 的机制，005 接上 `project_ext` 建表钩子）。
- `packages/core/src/test-support/fake-s3.ts` —— **真 HTTP 端点**观测面（从 `test/fixture/` 迁入 `src/`，
  因为 `packages/opencode` 要 import 它，而 core 的 `exports` 是 `"./*": "./src/*.ts"`）。

**auth（授权存储）**
- `packages/auth/src/migrations/0005_project_member.sql` ＋ `.down.sql` —— `project_member` ＋ `project_archive`
  两表（含 `project_archive_coherence_check`：`archived` 与 `archived_at` 成对）。
- `packages/auth/src/project-member.ts` / `user.ts` / `workspace.ts` —— drizzle 模型（**刻意无查询辅助函数**，
  有消费者才写取数，`#004-07`）＋ 警号 ⇄ UUID 翻译层 ＋ `sharedRoot`（`/shared`）。

**opencode（接线 + 见证）**
- `src/server/openhive/project.ts`（CRUD ＋ 清单 ＋ **`POST …/touch`**）、`archive.ts`（归档 / 找回）、
  `file.ts`（复制 / 移动 / 上传 / 下载）、`member.ts`（名单 / 邀请 / 移除 / 退群）。
- `src/server/routes/instance/httpapi/middleware/project-location.ts` —— 「归档＝冻结」**两道门**
  （项目头 · 会话行目录），fork 自建文件。
- 见证测试：`test/server/openhive-project*.test.ts` 等 **10 个文件**（含防漂移：
  `openhive-project-member-closed-set.test.ts` 钉 `CHECK` ⇔ core 的 `MEMBER_ROLES`）。

**app（前端换皮 ＋ 新增）**
- 换皮：`file-tree.tsx`（＋`draggable`）、`target-picker.tsx`、`minio-bar.tsx`。
- 新增：`project-anchor.tsx`（锚点行）、`project-panel.tsx`（＋新建 / 三 tab）、`member-panel.tsx`（👥 侧滑）、
  `dual-file-tree.tsx`（上下双树 ＋ 拖拽）、`sidebar-tabs.tsx`（② `[会话][文件]`）。
- 接入缝：`openhive-fetch.ts` / `openhive-project.ts` / `openhive-files.ts` / `openhive-file-ops.ts` /
  `openhive-members.ts` / `project-data.ts`（窄接口 `ProjectData` ＋ 生产绑定 `PROJECT_DATA`）。

**上游文件里的「要保留的定制」**（各自单独提交，带 `【这是要保留的定制 · 同步上游时不要丢】`）
- 真正碰上游的**只有 3 个文件**（席 3 独立 `git ls-tree upstream/dev` 核过；我原先把 `router.ts` /
  `workspace-entry.tsx` / `app/src/project/**` / `auth/**` 也当成上游文件，**是错的**）：
  `packages/opencode/src/server/routes/instance/httpapi/server.ts`（`Layer.mergeAll` 逐次「加」）、
  `packages/app/src/pages/layout-new.tsx`（1 import ＋ 1 prop）、`package.json`。
- ⚠️ **`server.ts` 有一处不是纯加**：T015 的提交把 T017 加的那行就地重写（fork 自建行改 fork 自建行，
  可接受，已记账 X2-4）。⚠️ **7 个碰 `server.ts` 的提交里 6 个**带了标记，**T015 那个没带**（X2-7，不改历史）。

---

## Step 5 与第二轮修了什么

**Step 5（五席并行 · 六类）去重后 16 条。** 最重的两条都是**本 feature 自己引入的**：

| 编号 | 一句话 | 落点 |
|---|---|---|
| **X3-1** | `backupAll` 只 `put`、**从不 `delete`** ⇒「归档→找回→**删沙箱里的 B**→再归档→再找回」B **静默复活**。加**收敛**（先传后删——任一时刻 MinIO 里是超集，中途失败仍够找回）；`files.length === 0 ⇒ continue` 是这步的**前提**不是优化 | `03f4fbe436` |
| **X3-3** | `x-openhive-project` 头非法时 `throw` 在 `Effect.gen` 体内是 **defect** ⇒ 折成 **500**，与同文件对 `sessionID` 刻意回 400 的口径不一致。旧断言把 defect 也当「被拒」收下，所以一直绿 | `dc0facdfbf` |
| **X4-1（Critical）** | `S3Client` **无任何超时** ⇒ MinIO 僵死时归档 / 找回**无限期挂起**（不是 500、不是可重试）。用户裁定「现在就配」⇒ `Config.timeoutMs`（默认 30 s），四处外呼走**同一处** `withTimeout` | `3fb2041241` |
| **X5-1** | 选中态用中性 `layer-03` 且与 hover 同色（鼠标移开分不清选中），而 `plan.md` / `DESIGN.md` 指定浅金 `--v2-background-bg-accent-soft`。改规范浅金，**顺带统一 X5-2**（`project/**` 的 12 处 hover 对齐 house 标准） | `3fb2041241` |
| **X4-4** | `releaseAll` 先于 `markArchived` ⇒ PG 抖动时「**归档没落 ＋ 沙箱已空 ＋ MinIO 有备份**」的半成功窗口。用户裁定「接受 ＋ 如实文档化」⇒ `archive.ts` 文件头新增「窄窗口」一节 | `3fb2041241` |

**第二轮（`#003-02`）三席对抗证伪。** 抓到的两条重的**又都长在刚落的修复里**：

- **R2-01（Important）**：X4-1 的超时**修了 `put`、漏了 `get`** —— `GetObjectCommand` 的 `Body` 是**流**，
  定时器在 `send` resolve 时就放掉了 ⇒ 找回路径**仍会无限期挂起**，同一个症状换了个入口。
  修的过程探针实测出两条形状（Bun 1.3.14）：**`abortSignal` 对已经发出的响应流没有约束力**、
  **裸 `body.destroy()` 只 emit `aborted`＋`close`、读取照样挂着，必须 `destroy(new Error(...))`**。
- **R2-03（Important）**：X5-1 改了 **4 处**选中态、**只钉了 1 处** ⇒ 另 3 处改回 `layer-03` 全套仍绿
  （`#004-02`：投影各长各的，没有相等断言钉在一起）。各补一条「选中＝浅金、未选中的**不带**」。
- 另两条 Minor 顺手修（R2-02 `withTimeout` 同步抛时定时器泄漏 / R2-04 最后一处非 house hover）。
- **R2-08**：三处**不实记述**就地回填（X4-2·3 的「无 per-call 超时」已由 X4-1 解决、X4-6 的
  「无重试、无超时……被 X4-1 一并解决」**只对一半**、X5-2 标「挂账」而实际已修）。

**第二轮没抓到的**（据实记，`#003-03`）：核心 / 前端的**功能性缺陷零新增**——`put` / `list` / `delete`
三条外呼确实都闭合在超时内（`list` / `delete` 的响应体由 SDK 在 `send` **内部**收完再解析，天然被罩住，
**只有 `get` 是流的例外**）；前端 `layer-03` 的 13 处残留逐一核过，全是输入框底 / 徽章 / 弹层底 / 内联确认条。

---

## 下次会话要做的事

**本 feature 已收尾，无待办 task。** 后续动作只有两类：

### 1. 用户侧

- 把 `worktree-feat-005-project-management` 合并到开发主线：**`git merge --ff-only worktree-feat-005-project-management`**
  （在**主检出**执行；本隔离会话做不了——一个分支不能 checkout 两次）。
- 合入之后打 tag：**`git tag v0.1.0-005-project-management`**（沿用 002/003/004 带编号的形式）。
  ⚠️ **tag 必须指向最终状态**——001 的教训就是 tag 打在收尾提交上、漏掉了后来的补测提交。
- `bun.lock` 本次**一行未动**（`git diff --numstat bun.lock` 实测为空；本 feature 没跑过 `bun install`）。

### 2. 下游 / 部署侧移交（**两笔，均已落进接收方的表**）

- **→ `docs/workspace/deploy-todo.md` 的 D-13（＝ T022 的前置，本表已写明这一步）**
  起内网 MinIO、建桶 `openhive`、实测 `${aws:username}` 策略变量是否生效，**并顺手裁定第四项**：
  「服务端代写各成员前缀走哪条凭据路径」（`(c)` 裁定把「写权限绑调用者」与「服务端替每个成员写各自前缀」
  顶成了反向 —— 它决定 `minio.md` §2 的策略要不要重写）。
  **T022 出了本机之前没有能落地的凭据契约**，别在 MinIO 起好之后就把 T022 当成「只差写代码」。
- **→ `docs/workspace/deploy-todo.md` 的 D-14**：`/shared` 共享卷（`FR-012` 的 bare 仓库载体）。
  ⚠️ 归档**不回收** `/shared` 的空间（T014 裁定），这一格的代价归谁兜底要回答。

---

## 已知缺口（**不是**「已覆盖」，别读错）

完整表在 `state.md` 的两张审查表 ＋ 各 task 的「缺口」节（**22 处**）。这里只列**收尾时最容易读错**的几条：

| 缺口 | 位置 | 说明 |
|---|---|---|
| **T022 整条** | `tasks.md` | MinIO 的 HTTP 出口（备份 / 拉回路由）**不存在** ⇒ 生产里双树那两行**不可拖**（「未接线即禁用」）。⚠️ 它**不是**「只差写路由」：`minio-backups.ts` 那条缝**今天零写入方**（恒 `undefined`） |
| **`backupAll` 无并发 / 无上限** | `archive.ts` | 双层串行 `for`＋`await`，外呼量＝Σ（各成员沙箱文件数）。**今天是性能问题不是正确性问题**；回归条件＝「真实项目文件数常态上千时回来做」 |
| **`backupAll` 的「上传后校验」** | `plan.md` R3 有意图、实现无对应物 | `put` 是裸 `PutObject`、不回读校验 ⇒ **上传静默截断**时备份缺内容而归档照落。已按 `#002-02` 补登（原先是**零登记**） |
| **`file.ts` 四个出口无 `decide`** | X1-1 | 授权隐含在中间件、等价「创建者」（**今天 fail-closed**）。与已登记的「成员在文件出口上没有独立授权点」**同一根因** ⇒ 补那条时**这四个出口必须同时补**（`#004-01`） |
| **成员进不去共享项目目录 / 成员检出无归属** | T016 缺口 | `project_ext` 是**个人态**、只给创建者写一行 ⇒ 成员带项目头**被静默忽略**。修它＝新能力，属 T018 / T021 地界 |
| **超期提醒只到创建者 / 不开界面就没有提醒** | T024 | 「成员在动、owner 3 个月没动」今天**没有可分辨的输入**；阈值今天等价「建项目后 90 天」 |
| **前端 `fetch` 无 `AbortController`**（X4-8）· **建项目八步无事务 / 补偿**（X4-9） | — | 前者：服务端挂住时界面一直转；后者：中途失败留下**孤儿目录 ＋ git 仓库**、重试生成新 UUID ⇒ 每次失败泄漏一个目录 |
| **未实测、按推断挂账的** | — | `question` 同形；`sync` / `warp` 的会话身份在**请求体**；`pty` 走 `ptyID`；D-13 的存储层拒绝本身。**一律写「未实测」，不许写成已覆盖**（`#002-02`） |
| **深色方案无 `--v2-background-bg-accent-soft`**（R2-09） | `packages/ui` 的 dark 块 | 回落浅色值 ⇒ 近白字压奶黄底。`DESIGN.md §6.2` 明写**不启用暗色** ⇒ **非本次引入** |
| **`timeoutMs` 生产不可配**（R2-06）· **`list` 的上界＝页数 × 30 s**（R2-07，已写进注释） | `minio.ts` | 后者**有界**（不是 X4-1 那种无限挂起），写下来只为让这个上界是**已知**的 |

---

## 门禁（**在本 feature 最终状态上串行复跑**，2026-10-07）

> 一律 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`（不设它时 bun 的运行时转译缓存会在复用时报
> `Expected JSX element name but found "?" at …sprite.svg:1:2`，整个测试文件**中止**——看着像「还没跑完」，
> 不是「失败了」）。**串行**跑（`#003-01`：并行会造假红）。复核请在自己的检出上重跑（`#004-05`）。

| 门 | 结果（实测） |
|---|---|
| `packages/core` `test/minio.test.ts` | **24 pass / 0 fail / 39 expect** |
| `packages/opencode` 项目族（**10 文件**） | **93 pass / 0 fail / 554 expect** |
| `packages/app` `test:unit` | **930 pass / 0 fail / 3305 expect / 122 文件** |
| `packages/app` `test:components` | **491 pass / 0 fail / 1075 expect / 28 文件** |
| `typecheck`（turbo，全仓） | **31 / 31 successful，exit 0**（28 cached；实跑 = core / app / opencode 三个改过的包） |
| `lint:openhive`（fork 自有配置） | **23 warnings / 0 errors / 101 files / 161 rules**（＝基线，**无回归**） |
| 文件级 oxlint（**仓库根**，`#004-10`）本 feature 改动面 83 文件 / 130 rules | 命中 **4 条，全在未改动的既有代码里**（`core/src/project/copy.ts:149,201` ＋ `copy-strategies.ts:18` 是**上游文件**；`app/src/pages/layout-new.tsx:25` 是上游 `version` 函数，005 只加了 import 与 prop）⇒ **本 feature 改动行 0 命中** |
| `git diff --numstat bun.lock` | **空**（本 feature 未跑 `bun install`） |

**变异验证**（散在各 task 节，据实记 `#003-03` 三类）：T012 **14** · T013 **5** · T014 **5** ·
T015 **7** · T016 **2** · T020 **21** · T021 **18** · T024 **7** · 第二轮 **2**（R2-01 / R2-03）。
⚠️ **其中 T020 的 5 行数字是从会话记录回收、未复跑**；其余为本轮或各 task 收尾时跑过并已还原的。

**一处工具怪癖（每次收尾都会撞）**：`openhive-project-frozen.test.ts` 在 `git status` 里显示 `M`，
而 `git diff --numstat` / `--raw` **全空**、工作区 blob 与 `HEAD:` **逐字节相同** ⇒ **陈旧 stat 伪影**
（只有 LF/CRLF 警告），**从未写进任何提交**。
