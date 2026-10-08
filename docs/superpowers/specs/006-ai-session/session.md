# 会话交接 · AI 会话（右栏指令卡）｜006-ai-session

**状态**：✅ **已收尾**（2026-10-08）。**16 条 task（T001–T016）：16 条全部落地，0 条移交。**

**审查两轮**：

| 轮次 | 席数 | 新账 | 处置 |
|---|---|---|---|
| **Step 5**（runbook 六类） | 5 席并行 | **7 条 Important** ＋ D1（右栏列表没筛） | 用户裁定**全修** ⇒ 拆三批提交：`5a228efd90` / `3ebe26da43` / `eef5201760`；另 **D2** ⇒ 补开 **T016** |
| **第二轮**（`#003-02`：靶子＝「修复本身」） | 5 席并行 | **1 条 Important**（三席独立命中同一处：cookie 通道刷新后与信号分叉）＋ **4 处不实记述** | 用户裁定 **B：启动清掉 cookie** ⇒ 已修（`eef5201760`） |

**全部 Minor 一律挂账**，逐条落在 `state.md` 的缺口表，**没有一条写成「已覆盖」**。

> 合并到开发主线**由用户执行**（本 feature 不自行 merge；见下「用户侧」）。
> spec 目录 `006-ai-session/` **永不删除**（下一个 feature 的上下文）。

---

## 上次做到哪

**16 条 task 全部落地，无待办**：

| 处置 | task | 说明 |
|---|---|---|
| 落地 | T001–T016（**16 条**） | 定位右栏槽位 → 能力清单接口 → 四层投影（纯函数）→ 卡 / 上下文卡 / 抽屉 / `/` 命令面板 → 最小右栏会话 ＋ 提交 ＋ 点卡填句 → 环境准则（不滥用确定性）＋ 高风险闸门 → 两组验收测试 → 会话管理三件事 → 导出会话 |

按标签：**FE 11（定位 1 / 新增 9 / 验收 1）· INT 4 · P 1 ＝ 16**
（取数：`grep -c '^- \[x\] T0' tasks.md` ⇒ **16**；`grep -n '^- \[ \] T0'` ⇒ **0**。）
> ⚠️ runbook（`dev_tdd.006.md`）Step 6 报告节写的「共 14 个 task」是**任务书自己没跟上的旧数**
> ——T015 / T016 两条都是 Step 5 期间裁定补开的，写手册时还不存在。以 `tasks.md` 实测为准
> （`LEARNINGS #001-01`：报数前先真跑一次）。

---

## 交付物一览

**app（主战场，`packages/app/src/ai-session/` 25 个文件 ＝ 产品 13 ＋ 测试 12）**

- 纯函数 / 机制：`capabilities.ts`（清单声明）· `projection.ts`（四层投影）· `route-session.ts`（路径 ↔ id）·
  `session-actions.ts`（会话动作**有判断的那一半**）· `submit-prompt.ts` · `right-pane-source.ts`（路由 → id → 目录 → 数据）
- 组件：`instruction-cards.tsx`（**四层共用的视觉语法**）· `common-cards.tsx` · `context-cards.tsx` ·
  `skill-drawer.tsx` · `command-palette.ts` · `session-panel.tsx`
- 接线：`ai-session-slot.tsx`（生产组装，**按设计不带测试**）

**app（本目录之外）**
- `src/workspace/workspace-entry.tsx`（`right` 槽 ＋ 启动清 cookie）、`src/project/current-project.ts`（cookie 通道）
- `src/pages/layout-new.tsx`（**上游文件**，1 import ＋ 1 prop）、`packages/app/solid-jsx.ts`

**opencode（少量，本 feature 只碰 1 个源文件）**
- `.opencode/instructions/openhive-tool-path.md`（T011 环境准则正文）＋ `.opencode/opencode.jsonc`
  （T012：`permission.bash` **8 条通用删除类 pattern → `"ask"`**）
- `src/server/routes/instance/httpapi/middleware/project-location.ts`（**fork 自建**：项目头 / cookie 两条通道 ＋ 归档冻结门）
- 见证测试 **5 个文件**：`test/permission/openhive-highrisk-{ask,gate}.test.ts` ·
  `test/server/openhive-{project-directory,prompt-minimal}.test.ts` · `test/session/openhive-tool-path-instruction.test.ts`

**文档**：`openhive-DESIGN.md §4.7`（U6 定稿）＋ 本 feature 的 spec/plan/tasks/state ＋
007 / 008 / 009 的 `tasks.md` 📥 块（移交项）

**上游文件里的「要保留的定制」**（`git ls-tree upstream/dev` 实测）
- 真正碰上游的**只有 2 个文件**：`package.json`（`lint:openhive` 的目录清单加了 `packages/app/src/ai-session`）、
  `packages/app/src/pages/layout-new.tsx`（`right={() => <AiSessionSlot />}`）。
- ⚠️ **只有后者带了标记**（`⚠️ openhive 定制（006 T008）：这是要保留的定制`）。
  `package.json` 那处**没带**——不是漏：它改的是 **fork 自有那一行**（`lint:openhive` 这个 script 本身就是
  fork 加的，上游没有），属「在 fork 行上追加」，不是「改上游行」。**据实记，不改历史**。

---

## Step 5 与第二轮修了什么

**Step 5（五席并行 · 六类）去重后 7 条 Important ＋ D1。** 最重的两条都是**本 feature 自己引入的**：

- **②-1（Critical）**：右栏**整条会话链落沙箱根** —— 服务端的锚定把 `POST /api/session` 体里的
  `location.directory` **无条件**改写成沙箱根，而 SDK v2 那条链**不发** `x-openhive-project` 头 ⇒
  民警在项目里新建的会话全部落在沙箱根。用户裁定 **B：补一条 cookie 环境通道**
  （`packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts` 读
  `openhive_project` cookie）。⚠️ 配套的四笔裁定写在那个中间件文件头的「第四笔裁定」——
  **头是意向（无效就拒），cookie 是环境（无效就当没有）**，改那条链之前**先读那一段**。
- **D1**：右栏会话列表**没有筛**（把子会话与归档会话也列出来、也能切过去）⇒ 与「删完去哪」的候选集
  分家。修法：两处**共用同一份判据** `可列出的会话`（`LEARNINGS #004-02` 的前端形态）。

**第二轮（`#003-02`）五席对抗证伪。** 抓到的 **1 条 Important 又长在刚落的修复里**：

- **cookie 通道刷新后与信号分叉**（界面说「没选项目」、请求仍落旧项目目录）—— **三席独立**命中同一处。
  ✅ 它是 ②-1 **自己引入的**（②-1 之前没有任何东西读那个 cookie），属 `#003-02` 的形状。
  用户裁定 **B：启动清掉 cookie** ⇒ 产品码 **1 处**（`workspace-entry.tsx` 的 `onMount`）。
- **另 4 处是「把说过头的话收回来」**（`session-actions.ts` 的「三根线」实为**两根**、
  `PROJECT_COOKIE` 的「三处」实为**四处**、`%2E%2E%2Fbob` 那条把风险说大了、用例⑤挂错了门）。
  ⚠️ 本轮最重的产物其实是**这四处不实记述**，不是那一行代码。

**第二轮没抓到的**（据实记，`#003-03`）：产品码功能性缺陷**零新增**。

---

## 下次会话要做的事

**本 feature 已收尾，无待办 task。** 后续只有两类动作：

### 1. 用户侧（在主检出执行）

- 合并：**`git merge --ff-only worktree-feat-006-ai-session`**
  （本隔离会话做不了——一个分支不能 checkout 两次）。分叉点是 `39be0146df`（005 的收尾提交），
  本 feature **26 个提交**。
- 合入之后打 tag：**`git tag v0.1.0-006-ai-session`**（沿用 002/003/004/005 带编号的形式）。
  ⚠️ **tag 必须指向最终状态**——001 的教训就是 tag 打在收尾提交上、漏掉了后来的补测提交。
- `bun.lock` 本次**一行未动**（`git diff --numstat bun.lock` 实测为空；本 feature 没跑过 `bun install`）。

### 2. 下游 / 部署侧移交（**三笔，均已落进接收方的表**）

| 这笔 | 交不出的一半 | **谁接 · 接在哪张表** |
|---|---|---|
| **FR-004 的「收藏 / 最近使用」** | 排序因子与存储 | **`009-ai-assets/tasks.md` 的 📥 块**（已落） |
| **「判定涉案」的判定逻辑** | AI 只提取 / 查证 / 预填，**不替人下结论** | **`007-fund-analysis/tasks.md` ＋ `008-call-analysis/tasks.md` 的 📥 块**（各一份，T014） |
| **FR-008「确定性的事」的硬那一半** | 一句提示词管不住「确定性」——要靠**真存在可调用的业务查询工具** | **007 / 008 的 📥 块**（T006 / T014） |

⚠️ **另有两笔给下一轮**（`state.md` 缺口表，**不写成已覆盖**）：① **多标签页**（cookie 全浏览器共享，
三种修法都修不到）；② **「挂载即清」仰赖一条上游事实**（`NewAppLayout` 在路由根里 ⇒ SPA 不重挂），
**今天没有断言钉着**。⇒ **别把第二轮读成「分叉已根除」。**

---

## 已知缺口（**不是**「已覆盖」，别读错）

完整表在 `state.md`（**59 行**）。这里只列**收尾时最容易读错**的几条：

| 缺口 | 位置 | 说明 |
|---|---|---|
| **`MANIFESTS` 的 `cards` 全为空** | `capabilities.ts` | 006 只造机制，卡文案随模块（F6/F7/F9）填。⚠️ **连带后果**：生产里**没卡可点** ⇒ T009 的「点卡填句」与 §4.7.1 的选中态**在生产里无从发生**（不是没接线，是没东西可点） |
| **`contexts` 生产里必为空** | T005 → T008 | 中栏**没有任何右栏读得到的「选中」状态** ⇒ 上下文指令这一层**生产里必然不渲染**（用户裁定「本轮不接」）。别把 T013 的组件验收读成「民警能看到上下文指令」 |
| **`ai-session-slot.tsx` 无测试** | T008 | 纯接线、挂不起来测（要活着的服务器连接）。它里面**真的会出错**的五件事都单独抽出来测了；**没钉的那几条**（`navigate` 那几句 / 在途守卫的接线 / 导出的落盘那一句 ＋ `.catch(报错)`）**只有人读代码看得见**（`#002-02` 的口径：这就是缺口） |
| **005 的「归档＝冻结」门在新出口上没有断言** | T015 | `session.remove` 与四个文件出口（`file/`）都**结构上**被路径中间件罩着，但**没有一条断言**在那两条出口上验过。⚠️ 正是 `LEARNINGS #005-11` 的形状 |
| **中文标题 ⇒ 导出文件名回落成 `ses_xxxx.json`** | T016 | 上游 `sessionExportFilename` 只保留 `[a-z0-9_-]`（**上游既有行为，不改**）。已用一条**哨兵**记录 |
| **深色方案无 `--v2-background-bg-accent-soft`** | `packages/ui` 的 dark 块 | 沿用 005 裁定（§6.2 明写**不启用暗色**）⇒ **非本次引入**，继续挂账 |
| **民警真的会被弹窗拦住 —— 本机测不到** | T012 → 缺口 | 端到端链上**只剩「前端把 `Event.Asked` 渲染成弹窗」这一段**没测（本机没有真模型、没有前端）。**不得声称 FR-009 已在 006 端到端验证** |
| **`edit` / `write` 本轮不动** | T012 裁定 ② | 本次闸门**只覆盖 `bash` 的删除类命令** ⇒「修改 / 覆盖数据文件」**今天仍静默执行** |

---

## 门禁（**在本 feature 最终状态上复跑**，2026-10-08 · 串行，`#003-01`）

> 一律先 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`（不设它时 bun 的运行时转译缓存在复用时会报
> `Expected JSX element name but found "?"`，整个测试文件**中止**——看着像「还没跑完」）。

| 门 | 结果 |
|---|---|
| `packages/app` typecheck（`tsgo -b`） | **干净**（`EXIT=0`） |
| `packages/opencode` typecheck（`tsgo -b`） | **干净**（`EXIT=0`） |
| `bun run lint:openhive`（135 文件） | **23 warnings / 0 errors** ＝ T008 记录的基线，**未变**（本 feature 改动文件 **0 命中**） |
| opencode 侧 6 个改动文件（单文件 oxlint，仓库根跑，`#004-10`） | **0 warnings / 0 errors**（161 规则） |
| `packages/app` unit（`./src/project` ＋ `./src/ai-session`） | **182 pass / 0 fail / 252 expect / 11 文件** |
| `packages/app` unit（全量 `./src`） | **1006 pass / 0 fail / 3426 expect / 128 文件** |
| `packages/app` components（全量 `./src`） | **601 pass / 0 fail / 1292 expect / 35 文件** |
| opencode：4 个文件成组（`permission/*` ＋ `prompt-minimal` ＋ `tool-path`） | **13 pass / 0 fail / 54 expect** |
| opencode：`openhive-project-directory.test.ts` **单独跑** | **16 pass / 0 fail / 62 expect** |
| `git diff --numstat -- bun.lock` | **空** |

### ⚠️ 收尾时发现的一条实测（**下次别重踩**）

**`packages/opencode/test/server/openhive-project-directory.test.ts` 必须单独跑**：它与**任何**另一个
测试文件同进程同跑都会挂 —— 症状**稳定复现**（三次不同组合）：

```
(fail) (unnamed) [5.0~5.3s]  ^ a beforeEach/afterEach hook timed out for this test.
# Unhandled error between tests
PostgresError: Connection closed   code: "ERR_POSTGRES_CONNECTION_CLOSED"
  at wrapPostgresError (internal:sql/postgres:171:10)
```

- **是不是 006 引入的：不是**（**已实测**）。把 **006 起点那版**（`39be0146df:…` 的 603 行版本，
  005 时代的 8 条）拉到当前环境与同一个文件同跑 ⇒ **现象逐字相同**（`6 pass / 1 fail / 1 error`）。
- **`--max-concurrency=1` 也不解**（仍红）⇒ 不是「文件级并发争抢」，是**同进程里两套 PGlite 夹具
  互相关连接**（与 `LEARNINGS #005-02` 的 42P05 属**同一族**：都是「PGlite 夹具在同一进程内并存」）。
- **成因未定论**（`#003-04`：写不成就写成相关）：能确定的是「同进程 + 另一个文件 ⇒ 挂」，
  **没有**继续拆到「是哪两样资源打架」。
- **门禁口径**：本题按 **`#003-01` 的既有裁定**取「受影响文件**逐个 / 分组单跑**」，
  那条全包类命令在本机**本来就不是可用门禁**。

---

## 上游侵入面

**2 个文件**（`git ls-tree upstream/dev` 实测，本 feature 全部 53 个改动文件里）：`package.json`、
`packages/app/src/pages/layout-new.tsx`。两处都是**纯加**，无一行重写；标记情况见上「交付物一览」。
