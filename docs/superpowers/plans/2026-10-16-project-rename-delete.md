# 项目重命名与删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目补上「改名」与「删除」两个动作——改名把名字的**两处**（每用户 SQLite 的 `project.name` ＋ PG 的 `auth.project_meta.name`）一起写；删除按 spec §6 清七处牵连，但**绝不删每用户库的 `project` 行**（会话留底）。

**Architecture:** 判定收在 core 的纯函数 `ProjectMembership.decide`（加两个动作 `rename` / `delete`，并把已被复制三份的 `asRole` / `actorIn` 搬进同一文件）；存储收在 `packages/auth/src/project-member.ts`（加四个辅助）；两个 HTTP 出口分别落在内核 `server/openhive/project.ts`（改名，因为它已持有 `SharedRootConfig` 与 `project` / `projectV2` 服务）与 `server/openhive/archive.ts`（删除，因为它已持有 `MinIO` 与成员名单的读法）；前端薄客户端 `openhive-project.ts` 把 `projectAction` 泛化成「服务端自述一个布尔」的四动作共用件。

**Tech Stack:** Bun monorepo · TypeScript 5.8.2 · Effect 4.0.0-beta.83 · Hono 4.10.7 · Drizzle 1.0.0-rc.2 · SolidJS 1.9.10（无 React）· PGlite（测试夹具）· bun:test · Playwright（真栈）· oxlint 1.60.0

**Spec:** `docs/superpowers/specs/2026-10-16-project-rename-delete-design.md`（本计划是它的论证；两者冲突时以 spec 为准）

## Global Constraints

以下逐字取自 spec 头部、`CLAUDE.md`（仓库级）与 `docs/superpowers/specs/2026-10-16-project-rename-delete-design.md` §9/§10。**每个任务的隐含要求都包含本节。**

- **性质**：本仓定制（openhive），**每个提交的信息都必须以「这是要保留的定制。」结尾**。
- **上游约束**：改动只落在 fork 自己的文件里（`packages/opencode/src/server/openhive/**`、`packages/opencode/src/server/routes/instance/httpapi/server.ts`（**只加一行 `Layer.provide`**，Task 5）、`packages/app/src/project/**`、`packages/app/src/workspace/workspace-entry.tsx`、`packages/auth/src/project-member.ts`、`packages/core/src/project/**`）。**不碰** `packages/ui` 与 `packages/session-ui` 的上游源码。
- **入侵方式是「加」不是「改」**：新增出口与服务函数，**不修改上游 `Project.update` 的语义**，**不接** `PATCH /project/:projectID`。
- **`packages/app/src/components/inline-rename-input.tsx` 一个字都不改**（只复用；spec §9「明确不改」）。
- **不动项目面板现有的「新建」输入行**（spec §2 v1 不做）。
- **不做右键菜单**（本仓无先例，`project-panel.tsx:1098-1099` 有注释明写不做）。
- **⛔ 删除绝不能删每用户库里的 `project` 行**（`ProjectTable`）：`session.project_id` 是 `NOT NULL` ＋ `ON DELETE CASCADE`（`packages/core/src/session/sql.ts:26-29`）⇒ 删它 = 会话被数据库连带删掉，与「聊天记录留底」正面冲突（spec §5 路 C）。**这条禁令必须写死在删除处理器的代码注释里。**
- **所有注释、提交信息、变量名一律用中文**（仓库惯例）。
- **绝不并行跑多个测试 / 门禁套件**（`LEARNINGS #003-01`：并行会造假红；且本机内存吃紧）。严格串行，一次一个。
- **根目录 `bun test` 禁止**（`package.json` 的 `test` script 是 `exit 1`）。在受影响 package 内跑。
- **门禁里的 lint 用 `bunx oxlint <改动目录>`**——根 `bun run lint` 天生红（1 个上游 error，`LEARNINGS #001-02`）。
- **`bun install` 之后必须查 `git diff --stat bun.lock`**——被污染就 `git checkout -- bun.lock` 还原（`CLAUDE.md` 的「锁文件污染」）。本计划不需要新增任何依赖，正常路径下不该跑 `bun install`。
- **提交一律走 `git commit -F <文件>`**，绝不用 `git commit -m`：提交信息里的反引号会被 bash 当命令替换。写文件用 `cat > /tmp/x.txt <<'EOF'`（**单引号 heredoc**，防反引号展开）。
- **每个任务结束单独提交**（spec 头部 ＋ `CLAUDE.md` 定制化三原则第 2 条）。
- **真栈**：`E2E_BROWSER` 指向 chromium-1234；端口被残留栈占住就换 `REAL_STACK_KERNEL_PORT` / `REAL_STACK_FRONT_PORT`，**绝不杀进程**；真栈持久态在 `D:\openhive-stack-state`；真栈 spec 必须带 `--config e2e/real-stack/playwright.config.ts`。
- **变异验证回滚未提交的工作只用 `cp` 备份，绝不用 `git checkout --`**（`LEARNINGS #005-40`：会把未提交的实现一起擦掉）。
- **不谎称改了**：报告只写跑过的命令与它**实际的**输出。没跑的、跑不动的，明说没跑。
- **不做表面修改**：找不到根因就不动代码，先报「卡在哪、缺什么证据」。
- **不把测不了的写成已覆盖**：本机验不了的（真模型 / 真 PG 之外的、真栈量不出的）如实写进缺口表。

## 计划作者对 spec 的裁定（**先读这一节**）

以下是写计划时对 spec 做的裁定。**每条都登记理由**，执行者遇到 spec 与计划不一致时以本节为准。

| # | spec 怎么说 | 本计划的裁定 | 理由 |
|---|---|---|---|
| R1 | §9 把删除路由放 `project.ts` | **放 `archive.ts`**（`PATH.delete = \`${PREFIX}/delete\``） | `archive.ts` 已持有 `MinIO`（`Deps.minio`）与成员名单读法；放 `project.ts` 要新建 MinIO 配置层。代价：`server.ts` 的 `OpenhiveArchive.routes.pipe(...)` 块要多一行 `Layer.provide(OpenhiveProject.SharedRootConfig.layer)`（删除要 `shared` 根去删 `/shared/<id>.git`）。 |
| R2 | §6 次序：① 成员关系 ② 归档标记/共享名字 ③ `project_ext` ④ 盘上目录+bare ⑤ MinIO ⑥ 残留 ⑦ `project_directory` | **⑤ MinIO 提到最前**：读成员名单 → ⑤ MinIO → ④ 沙箱+bare → ⑥ 残留 → ③ `project_ext` ＋ ⑦ `project_directory` → ① `project_member` ＋ ② `project_archive`/`project_meta` | spec 原序让 ⑤ **不可重入**：① 先删掉 `project_member` ⇒ 第二次调用建不出「哪些成员的前缀要清」⇒ 备份成永久孤儿。**spec §6 自己要「可重入」**，原序自相矛盾。 |
| R3 | §9②「两处一起写」 | 次序 **PG 先、本地后** | 本地 `project.name` 是 owner 读的那一份、PG 是成员读的那一份。PG 写失败时本地还没动 ⇒ 用户重试即可收敛；反过来会出现「我改了、同事看的还是旧名」且**没人能发现**（`handleList` 里 owner 读本地、成员读 PG，`project.ts:354/391`）。 |
| R4 | §9「新增改写 `project_meta.name` 的函数」 | 用 **`update`**，不用 upsert；命中 0 行**静默成功**，进缺口表 | 同 `markRestored` 的理由（`project-member.ts:242-249`）：走得到这里 = 上一句刚读过那一行 ⇒ 那行必然在。**残差如实记**：命中 0 行时分辨不出，要防它得数返回行数，而那条形状在两个 PG 驱动下是否一致**没验过**（`LEARNINGS #002-01`）。 |
| R5 | spec 未提 core 的 `membership.ts` | `PROJECT_ACTIONS` 加 `"rename"` / `"delete"`；**三条既有核心用例改写**（不是删） | `packages/core/test/project-membership.test.ts` 的 `:133-138`（归档后 owner 也只留找回）、`:156-167`（`frozen` 等价断言）、`:190-193`（闭集逐值）加动作后**必红**。**改写**保留反面断言（`#005-36`）。`:126-131`（归档后 member 全失权）对 `delete` 仍应绿——member 在归档态下不可 delete，无需改。 |
| R6 | spec §9 未提 | `ProjectData` 的两个新方法命名 **`rename`** / **`deleteProject`** | `delete` 在 JS 里是合法属性名，但 `projectData.delete(...)` 读起来像 `delete` 运算符，且与 `removeEntry` / `remove` 并列时容易混。`deleteProject` 与同文件的 `createEntry` / `renameEntry` 命名风格一致（名字里带对象）。 |
| R7 | spec §9 未提客户端形状 | `projectAction` 的 `expected: boolean` **泛化成 `ActionShape`**（`path` ＋ `stateKey` ＋ `stateValue` ＋ `failed` ＋ 可选 `extra`），四个动作的响应体一律**自述一个布尔**（`archived` / `renamed` / `deleted`） | 四个动作的请求形状、失败分类、成功判据**逐字同形**（都是 `POST` ＋ `{projectId}` ＋ 一个状态布尔）。写成两个函数就是 `LEARNINGS #002-06` 那句话本身。 |
| R8 | spec 未提 | `asRole` / `actorIn` 从 `archive.ts:250` / `member.ts:185,190` **搬进 core `membership.ts`**（第 4 份出现的临界点） | 已存在**三份**（`archive.ts:250` 一份、`member.ts:185/190` 两份），本 feature 要第 4 处。闭集的解码器该住在闭集旁边。三处调用点全改；`member.ts:64-66` 的残差注释（「没有提到共享模块，是因为那要动 T013/T014 已审过的文件——本次不动它」）随之变成假话 ⇒ **必须订正**；`archive.ts` 的 `MEMBER_ROLES` / `MemberRole` 导入若成孤儿 ⇒ 一并删。 |
| R9 | spec §9 三处遗漏/口误 | ① `membership.ts` 及其核心测试 **确在** `packages/core/src/project/membership.ts` ＋ `packages/core/test/project-membership.test.ts`（spec §9 未列）② `project-action-dialog.tsx` 未列（本计划 Task 7 要改它）③ spec §9 写的「同族 `NewProjectInput:52`」**是口误**：`openhive-project.ts:53` 的类型叫 `CreateProjectInput`；`NewProjectInput` 在 `project-panel.tsx:149` | 三处均为逐字核实过的实情，登记以免执行者按 spec 的字面去找不存在的符号。 |
| R10 | spec §6 ⑧「待实施时核实」 | ✅ 已核实：`Minio.Interface` **已有** `delete({path})`（`packages/core/src/minio.ts`）⇒ 删除备份 = 遍历每个成员的 scope `list()` ＋ 逐键 `delete`。`project_directory` 的读取者见 Task 3 的 ⑥ 步清点 | spec 明写「本设计不假设」，实施前核实后落计划。 |

---

## 文件结构（先定边界，再拆任务）

| 文件 | 职责 | 本计划对它的动作 |
|---|---|---|
| `packages/core/src/project/membership.ts` | 项目成员判定（纯函数，无 DB、不抛错） | 加两动作 + 搬入 `asRole`/`actorIn` + 六处注释订正 |
| `packages/core/test/project-membership.test.ts` | 上面的判据 | 改写三条 + 新增两组 |
| `packages/core/src/project/directories.ts` | 每用户库的 `project_directory`（Effect 服务） | 加 `removeAll` |
| `packages/core/test/project-directories.test.ts` | 上面的判据 | 加一条 |
| `packages/core/src/project/ext.ts` | 每用户库的 `project_ext`（裸 db 纯函数） | 加 `deleteByProjectID` |
| `packages/core/test/project-ext.test.ts` | 上面的判据 | 加一条 |
| `packages/auth/src/project-member.ts` | PG 三表（`project_member` / `project_archive` / `project_meta`）的读写 | 加四个辅助 |
| `packages/auth/src/project-member.test.ts` | 上面的判据 | 加四条 |
| `packages/opencode/src/server/openhive/project.ts` | 内核项目出口（列 / 建 / 触摸） | 加 `PATH.rename` + `RenameBody` + `FORBIDDEN`/`forbidden` + `handleRename` + 一行路由 |
| `packages/opencode/src/server/openhive/archive.ts` | 内核归档 / 找回出口 | 加 `PATH.delete` + `handleDelete` + `Deps.shared`/`Deps.database` + 一行路由（＋ `asRole` 改用 core 版） |
| `packages/opencode/src/server/openhive/member.ts` | 内核成员出口 | `asRole`/`actorIn` 改用 core 版 + 订正残差注释 |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 路由接线 | 删除那块加**一行** `Layer.provide(OpenhiveProject.SharedRootConfig.layer)` |
| `packages/opencode/test/server/openhive-project-rename.test.ts` | 改名出口的路由测试 | 新建 |
| `packages/opencode/test/server/openhive-project-delete.test.ts` | 删除出口的路由测试 | 新建 |
| `packages/app/src/project/openhive-project.ts` | 前端薄客户端（裸 HTTP 形状） | `projectAction` 泛化 + `renameProject` / `deleteProject` |
| `packages/app/src/project/openhive-project.test.ts` | 上面的判据 | 加两组 |
| `packages/app/src/project/project-data.ts` | 数据源接线（窄接口 ＋ 生产实现） | 接口加两条 + `PROJECT_DATA` 加两条 |
| `packages/app/src/project/project-data.test.ts` | 上面的判据（接错线不报错） | 加两条 |
| `packages/app/src/project/project-action-dialog.tsx` | 项目级动作的二次确认弹窗 | `ProjectActionKind` 加 `"delete"` + `文案` 加一段 |
| `packages/app/src/project/project-panel.tsx` | 项目面板 | `canRename`/`canDelete` + 行内 ⋯ 菜单 + 就地改名 + 删除确认接线 |
| `packages/app/src/project/project-panel.test.tsx` | 上面的判据 | 加两组 |
| `packages/app/src/workspace/workspace-entry.tsx` | 工作台接线（唯一写入清单的地方） | 接 `onRename` / `onDelete` |
| `packages/app/e2e/real-stack/project-rename-delete-real.spec.ts` | 真栈端到端 | 新建 |
| `docs/superpowers/specs/2026-10-16-project-rename-delete-design.md` | 本 feature 的 spec | §11 加七条缺口 + §6 末两条改成「已核实」（Task 10） |
| `LEARNINGS-full.md` / `LEARNINGS.md` | 教训正文 / 索引 | 各追加同号条目（Task 10） |

**明确不改**：`packages/app/src/components/inline-rename-input.tsx`、`packages/app/src/pages/layout-new.tsx`（接口扩了它自动带上）、`packages/app/src/project/project-panel.tsx` 的新建输入行、上游 `Project.update` 与 `PATCH /project/:projectID`。

---

## Task 0: 量基线（不动任何代码）

**Files:**
- Create: `.superpowers/sdd/2026-10-16-project-rename-delete/baseline.md`（git-ignored 的临时记录，随本 feature 收尾丢弃）

**Interfaces:**
- Consumes: 无
- Produces: 三个包的**用例数基线**——Task 10 的完成判据要拿它对比（「用例数不低于开工前实测的基线」，spec §10）。

- [ ] **Step 1: 确认分支与工作区干净**

```bash
git -C /d/project/study/openhive/openhive status --porcelain
git -C /d/project/study/openhive/openhive rev-parse --abbrev-ref HEAD
```

预期：`status --porcelain` **空**（工作区干净）；分支输出 **`multi-tenant`**。
若工作区不干净，**停下来**，先问清那些改动的归属再动手。

- [ ] **Step 2: 跑 core 的测试，记下数字**

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test
```

预期：全绿。记下末行 ` N pass / M fail` 里的 **N**。

- [ ] **Step 3: 跑 auth 的测试，记下数字**

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun test --timeout 30000
```

预期：全绿（21 个测试文件）。记下 **N**。

- [ ] **Step 4: 跑 opencode 的测试，记下数字**

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test --timeout 30000
```

预期：全绿（295 条）。记下 **N**。

- [ ] **Step 5: 跑 app 的两套，记下数字**

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:unit
```

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:components
```

预期：`test:unit` 全绿；`test:components` 全绿（2026-10-16 实测基线：**1042 通过 / 0 失败 / 2248 期望 / 51 文件**）。各记下 **N**。

- [ ] **Step 6: 把五个数字写进记录文件**

```bash
mkdir -p /d/project/study/openhive/openhive/.superpowers/sdd/2026-10-16-project-rename-delete
cat > /d/project/study/openhive/openhive/.superpowers/sdd/2026-10-16-project-rename-delete/baseline.md <<'EOF'
# 开工基线（2026-10-16 项目重命名与删除）

分支：multi-tenant
core:            <把 Step 2 的 N 填进来>
auth:            <把 Step 3 的 N 填进来>
opencode:        <把 Step 4 的 N 填进来>
app:test:unit:   <把 Step 5 第一项的 N 填进来>
app:test:components: <把 Step 5 第二项的 N 填进来>
EOF
```

⚠️ **把尖括号里的字面占位替换成真实数字**——文件本身不是判据，用完即弃。

- [ ] **Step 7: 不提交**

本任务只产出读数，**不产生任何改动**，因此**没有提交**。若 `git status --porcelain` 现在非空，说明有别的进程在动这个仓——停下来查清。

---

## Task 1: core 判定——加两个动作、搬入 `asRole`/`actorIn`、改写三条既有用例

对应 spec §7「判定复用现成件」＋ R5、R8。**这是本 feature 的地基**：后面每个出口都调 `decide`。

**Files:**
- Modify: `packages/core/src/project/membership.ts`（`:77-79`、`:106-118`、`:127-131`、`:44-54`、`:115-117`、`:123-125`、`:141-143`、`:148-150`，末尾加两个导出）
- Modify: `packages/core/test/project-membership.test.ts`（`:133-138`、`:156-167`、`:190-193` 改写；文件末尾加两组）
- Modify: `packages/opencode/src/server/openhive/archive.ts`（`:250-254` 删本地 `asRole`、`:280` 与 `:349` 改调 core 版、删孤儿导入）
- Modify: `packages/opencode/src/server/openhive/member.ts`（`:185-192` 删本地两个、改调 core 版、`:64-66` 订正残差注释）

**Interfaces:**
- Consumes: 无（本任务是第一件动代码的事）
- Produces:
  - `ProjectMembership.PROJECT_ACTIONS: readonly ["invite", "remove", "leave", "archive", "restore", "rename", "delete"]`
  - `ProjectMembership.decide({ actor, action, target, archived }) => boolean`——语义新增：`rename` / `delete` 只认 `owner`；归档态下 `delete` 也放行（owner）
  - `ProjectMembership.asRole(value: string | undefined) => MemberRole | null`
  - `ProjectMembership.actorIn(members: readonly { userId: string; role: string }[], userId: string) => MemberRole | null`

### Step 1: 先写会红的用例

- [ ] 打开 `packages/core/test/project-membership.test.ts`，把 `:133-138` 那条整段替换成：

```ts
  test("归档后 owner 只留「找回」与「删除」（归档 = 冻结，见文件头）", () => {
    for (const action of ProjectMembership.PROJECT_ACTIONS) {
      // 归档态下**成立**的两个例外跳过（它们是同一条不变量的两个出口：找回把东西拉回来、
      // 删除把项目整个拿掉——都不产生活儿，见 `frozen` 那条注释）。
      if (action === "restore" || action === "delete") continue
      expect(ask("owner", action, { target: "member", archived: true })).toBe(false)
    }
    // 跳过的两个要有**正面**断言——跳过本身不证明它们成立（`LEARNINGS #005-36`：借前提的绿不是守护）。
    expect(ask("owner", "restore", { archived: true })).toBe(true)
    expect(ask("owner", "delete", { archived: true })).toBe(true)
  })
```

- [ ] 把 `:156-167` 那条整段替换成：

```ts
  test("冻结 ⟺ 归档态下除「找回」与「删除」之外没有动作成立", () => {
    // 归档态下的两个例外（见上面那条）：它们都**不是**「在项目里干活」——
    // 一个把文件拉回沙箱、一个把项目整份拿掉，两者都不依赖项目目录存在。
    const 归档态例外 = new Set<ProjectMembership.ProjectAction>(["restore", "delete"])
    for (const archived of [true, false]) {
      const 还有别的动作成立 = ProjectMembership.PROJECT_ACTIONS.filter((action) => !归档态例外.has(action)).some(
        (action) =>
          [null, ...ProjectMembership.MEMBER_ROLES].some((actor) => ask(actor, action, { target: "member", archived })),
      )
      expect({ archived, 冻结: ProjectMembership.frozen(archived) }).toEqual({
        archived,
        冻结: !还有别的动作成立,
      })
    }
  })
```

- [ ] 把 `:190-193` 那条替换成：

```ts
  test("MEMBER_ROLES / PROJECT_ACTIONS 逐值相等", () => {
    expect([...ProjectMembership.MEMBER_ROLES]).toEqual(["owner", "member"])
    expect([...ProjectMembership.PROJECT_ACTIONS]).toEqual([
      "invite",
      "remove",
      "leave",
      "archive",
      "restore",
      "rename",
      "delete",
    ])
  })
```

- [ ] 在文件**末尾**（`:195` 的 `})` 之后）追加两组新用例：

```ts
describe("项目级动作：改名 / 删除（2026-10-16 spec §7：两项都只有创建人能做）", () => {
  test("未归档时：owner 可改名、可删除；member / 非成员 都不可", () => {
    expect(ask("owner", "rename")).toBe(true)
    expect(ask("member", "rename")).toBe(false)
    expect(ask(null, "rename")).toBe(false)

    expect(ask("owner", "delete")).toBe(true)
    expect(ask("member", "delete")).toBe(false)
    expect(ask(null, "delete")).toBe(false)
  })

  /**
   * **已归档的项目也能删除**（spec §7）——但对 **member 仍然不行**。
   *
   * 只测 owner 那一侧会把「归档态下 delete 谁都放行」当成通过；只测 member 那一侧
   * 又会把「归档态下 delete 谁都不行」当成通过。两侧一起测才是 spec §7 的整句话。
   */
  test("已归档时：owner 仍可删除；member 仍不可（归档态只对 owner 的 delete 开口）", () => {
    expect(ask("owner", "delete", { archived: true })).toBe(true)
    expect(ask("member", "delete", { archived: true })).toBe(false)
    expect(ask(null, "delete", { archived: true })).toBe(false)
  })

  /**
   * **改名在归档态下被拒**（方向是**收紧**，同文件头那段「归档 = 冻结」的读法）。
   * spec §7 只给「已归档也能删」，没给「已归档也能改名」——归档项目的名字没有可作用的实体
   * （要改就先找回）。谁将来放宽它，这条会红，逼人回来补理由。
   */
  test("已归档时：owner 也不可改名（归档 = 冻结，理由见文件头）", () => {
    expect(ask("owner", "rename", { archived: true })).toBe(false)
  })
})

describe("角色的闭集解码（`asRole` / `actorIn`——2026-10-16 从三份副本收口到这里）", () => {
  /**
   * 这两条钉的是**「库里的字符串 ⇒ 闭集成员」这一步不许放宽**：`project_member.role`
   * 的 CHECK 与 `MEMBER_ROLES` 是同一份值的两处写法（文件头「镜像」），而这一层是
   * 从**库里取出来的字符串**走到判定之前的唯一一道门。认不出必须是 `null`（= 视作非成员），
   * **不是**「退化成 member / owner」——那是一次静默的越权（`LEARNINGS #003-05` 的取向）。
   */
  test("asRole：闭集内的取值认得，别的一律 null（含 undefined / 空串 / 大小写不同）", () => {
    expect(ProjectMembership.asRole("owner")).toBe("owner")
    expect(ProjectMembership.asRole("member")).toBe("member")
    expect(ProjectMembership.asRole("admin")).toBe(null)
    expect(ProjectMembership.asRole("Owner")).toBe(null)
    expect(ProjectMembership.asRole("")).toBe(null)
    expect(ProjectMembership.asRole(undefined)).toBe(null)
  })

  test("actorIn：在名单里 ⇒ 那个角色；不在名单里 / 认不出 ⇒ null", () => {
    const 名单 = [
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "member" },
      { userId: "u3", role: "退休" },
    ]
    expect(ProjectMembership.actorIn(名单, "u1")).toBe("owner")
    expect(ProjectMembership.actorIn(名单, "u2")).toBe("member")
    // 角色认不出 ⇒ 视作非成员，**不是**当成 member
    expect(ProjectMembership.actorIn(名单, "u3")).toBe(null)
    expect(ProjectMembership.actorIn(名单, "u9")).toBe(null)
    expect(ProjectMembership.actorIn([], "u1")).toBe(null)
  })
})
```

### Step 2: 跑它，确认红

- [ ] 跑：

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test test/project-membership.test.ts
```

预期：**红**。实得形状（据实记，不要预设条数）：
- 至少三条既有用例红在 `.toEqual` / `.toBe(false)` 上（闭集少两项、归档态 owner 的 delete 读成 `false`）；
- 新增两组里 `projectAction` 不认识的两个动作目前**能编过**（`PROJECT_ACTIONS` 是推导类型，此刻还没有 `"rename"`）——所以新增那组会红在**类型**上或**运行**上，具体形状以实跑为准。
- `asRole` / `actorIn` 此刻**不存在** ⇒ 相关的红是 `is not a function` / `not defined` 型（`LEARNINGS #004-11`：报红要说清哪几条是「符号压根不存在」型）。

若**一条都不红**，停下来——说明测试没跑到，别往下走。

### Step 3: 改到绿——`membership.ts` 三处

- [ ] 改 `:77-79`（动作闭集）：

```ts
/**
 * 需要判定的动作闭集。加一个动作 = 归档态的「冻结」也自动覆盖它（测试按本数组遍历）。
 *
 * ⚠️ **顺序即取值**：本数组的顺序被 `packages/core/test/project-membership.test.ts` 的
 * 闭集断言**逐值**钉住（多一项、少一项、换个位置都会红）。新增动作**追加在末尾**，
 * 别插在中间——插中间会让那条断言红在一个看起来像是「顺序无关」的地方。
 */
export const PROJECT_ACTIONS = ["invite", "remove", "leave", "archive", "restore", "rename", "delete"] as const
```

- [ ] 改 `RULES` 表，在 `restore` 那条**后面**追加两条（`:117` 的 `}` 之前）：

```ts
  // spec §7（2026-10-16）：**改名只有创建人**——共享项目的名字是所有人共用的那一份
  // （写 PG `project_meta`，spec §4.1），member 随手改会让别人莫名其妙。
  rename: (input) => input.actor === "owner",
  // spec §7：**删除只有创建人**——同一条规则，同一条理由；member 想走用现成的 `leave`。
  delete: (input) => input.actor === "owner",
```

- [ ] 改 `decide` 的归档分支（`:127-131`）：

```ts
/**
 * 判定的**唯一**实现。
 *
 * 写成「先归档、后动作」两层而不是每个动作里各带一句 `!archived`：
 * 后者要写七个地方，**加第八个动作时没人会回来补**（`LEARNINGS #002-06` 的形状）。
 * 这里只有一处，而 `RULES` 的键集由类型钉住。
 */
export function decide(input: DecisionInput): boolean {
  // 归档 = 冻结：出口是 owner 的找回（把文件拉回沙箱）与 owner 的删除（把项目整份拿掉）
  // ——两者都不产生活儿、都不依赖项目目录存在（见文件头「归档态的读法」）。
  // ⚠️ 删除是 2026-10-16 加的这个分支的**第二个**例外，理由是 spec §7 的
  // 「已归档的项目也能删除」：不开口的话「删除找不回」这个承诺在已归档项目上不成立
  // （备份还在 = 还能找回）。改名**不在此列**——归档项目的名字没有可作用的实体，先找回再改。
  if (input.archived) return (input.action === "restore" || input.action === "delete") && input.actor === "owner"
  return RULES[input.action](input)
}
```

### Step 4: 改到绿——搬入 `asRole` / `actorIn`

- [ ] 在 `membership.ts` **文件末尾**（`:159` 的 `}` 之后）追加：

```ts
/**
 * 角色的**闭集解码**：把一个来自库里 / 请求体的字符串收成 `MemberRole`，认不出就是 `null`。
 *
 * ⚠️ 这个函数 2026-10-16 之前**有三份副本**（`server/openhive/archive.ts:250` 一份、
 * `server/openhive/member.ts:185,190` 两份），因为「改名 / 删除」要第 4 份才收口到这里
 * （`LEARNINGS #002-06`：同一个判断不许两处各写一份）。收口的理由也是实的：**闭集的解码器
 * 该住在闭集旁边**——`MEMBER_ROLES` 在上面 20 行处，两者一起改才不会漂。
 *
 * 「认不出 ⇒ null」是**安全方向**：`null` 在 `decide` 里 = 非成员 ⇒ 什么都不能做。
 * 反过来（认不出就当 member / owner）是一次静默越权。
 */
export function asRole(value: string | undefined): MemberRole | null {
  return MEMBER_ROLES.find((role) => role === value) ?? null
}

/**
 * 从一份成员名单里读「这个人在这条链上是什么身份」。
 *
 * 不在名单里、角色认不出，都是 `null`（同 `asRole` 的安全方向）。名单的形状**按调用点定**
 * （`LEARNINGS #004-07`）：它要的只是「有 `userId` 和 `role` 两个字段」——
 * `membersOf` 吐的形状与它逐字兼容。
 */
export function actorIn(members: readonly { userId: string; role: string }[], userId: string): MemberRole | null {
  return asRole(members.find((member) => member.userId === userId)?.role)
}
```

- [ ] 改 `packages/opencode/src/server/openhive/archive.ts`：删掉 `:250-254` 那一整段本地 `asRole`（含它上方的注释），把 `:280` 与 `:349` 的 `asRole(...)` 改成 `ProjectMembership.asRole(...)`。

- [ ] 检查 `archive.ts` 的导入：`MEMBER_ROLES` 与 `MemberRole` 若不再被本文件使用，从那行 import 里删掉（保留 `ProjectMembership`）。⚠️ **只删这两个名字**，别动同一行里 `ProjectMembership` 本身。

- [ ] 改 `packages/opencode/src/server/openhive/member.ts`：删掉 `:185-192` 那两段本地实现（含注释），把 `:224` / `:252` / `:291` / `:307` / `:336` 的 `actorIn(` / `asRole(` 改成 `ProjectMembership.actorIn(` / `ProjectMembership.asRole(`。

- [ ] 改 `member.ts:64-66` 那条**残差注释**（它现在成了假话）：

```
 * - ~~**`asRole` / `actorIn` 与 `archive.ts` 的各一份**~~ **已于 2026-10-16 收口**——
 *   三者（这里两份、`archive.ts` 一份）搬进了 `@opencode-ai/core/project/membership`，
 *   理由是「改名 / 删除」要第 4 份。闭集的解码器住在闭集旁边，`MEMBER_ROLES` 变了两边一起变。
```

⚠️ **保留那段注释的其它条目**（「已在名单里」的预检、「被邀者不做 status 过滤」），只换这一条。

### Step 5: 跑它，确认绿

- [ ] 跑：

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test test/project-membership.test.ts
```

预期：**全绿**，且用例数 = 原 14 条 + 新增 6 条 = **20 pass / 0 fail**（`asRole` 一条、`actorIn` 一条、项目级动作那组 3 条、改名/删除那组 3 条——以实跑为准，逐条对得上即可）。

- [ ] 跑 core 全包（确认没有别的东西被 `RULES` 的形状变化带红）：

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test
```

预期：**全绿**，总数 ≥ Task 0 记下的基线。

### Step 6: 变异验证（`LEARNINGS #003-03` 三类据实记）

**先备份**（`#005-40`：本任务尚未提交 ⇒ 只能用 `cp`，**绝不用 `git checkout --`**）：

- [ ] 备份：`cp packages/core/src/project/membership.ts /tmp/membership.ts.bak`

- [ ] **变异 A：拆掉归档分支里新加的 `delete` 例外。** 把 `decide` 那行改回：

```ts
  if (input.archived) return input.action === "restore" && input.actor === "owner"
```

- [ ] 重跑 `cd packages/core && bun test test/project-membership.test.ts`，**据实记**红了几条、红在哪些断言的哪一行。
  预期：**至少 3 条红**——(a)「归档后 owner 只留『找回』与『删除』」里的 `expect(ask("owner", "delete", { archived: true })).toBe(true)`；(b)「冻结 ⟺ …」那条；(c)「已归档时：owner 仍可删除…」。若只红 1 条，说明后两条的守护不够，据实记并分析。

- [ ] **还原**：`cp /tmp/membership.ts.bak packages/core/src/project/membership.ts`

- [ ] **变异 B：把 `rename` 的规则从 `owner` 放宽成「谁都能改」。** 把 `rename:` 那行改成：

```ts
  rename: () => true,
```

- [ ] 重跑同一个文件，据实记（预期：闭集那组与项目级动作那组里，member / null 的三条 `toBe(false)` 变红）。
- [ ] **还原**：`cp /tmp/membership.ts.bak packages/core/src/project/membership.ts`

- [ ] **变异 C：把 `asRole` 的安全方向反过来。** 把 `asRole` 的函数体改成：

```ts
  return MEMBER_ROLES.find((role) => role === value) ?? "member"
```

- [ ] 重跑同一个文件，据实记（预期：`asRole` 那组的 `admin` / `Owner` / `""` / `undefined` 四条红，`actorIn` 那组的 `u3` / `u9` / `[]` 三条红）。
- [ ] **还原**：`cp /tmp/membership.ts.bak packages/core/src/project/membership.ts`

- [ ] 重跑一次确认回到全绿：`cd packages/core && bun test test/project-membership.test.ts`，并 `diff /tmp/membership.ts.bak packages/core/src/project/membership.ts`（预期：**无输出**）。

### Step 7: ⑥ 步——grep 全部同类落点

- [ ] 在**仓库根**跑：

```bash
cd /d/project/study/openhive/openhive && grep -rn "MEMBER_ROLES\|asRole\|actorIn" packages/core/src packages/opencode/src packages/app/src
```

逐个落点判定并写下结论（`LEARNINGS #005-45`：改了的与没改的都要当场判定）：

| 落点 | 是不是同一件事 | 本次处置 |
|---|---|---|
| `core/src/project/membership.ts` | 是（闭集的家） | 新增 `asRole` / `actorIn` |
| `opencode/src/server/openhive/archive.ts` | 是 | 改用 core 版 |
| `opencode/src/server/openhive/member.ts` | 是 | 改用 core 版 |
| `app/src/project/openhive-members.ts:40` | **不是**（那是前端侧对同一形状的**注释**提及，不构成第 4 份实现） | 不动；**但要看一眼**：若它真有一份 `asRole` 实现，本步要升级成一次裁定 |

- [ ] 再跑一次 grep 数新落点：

```bash
cd /d/project/study/openhive/openhive && grep -rn "function asRole\|function actorIn" packages/
```

预期：**只有 2 行**，都在 `packages/core/src/project/membership.ts`。
⚠️ **别用「数命中行 = 改全了」当判据**（`LEARNINGS #006-26`）——上面那张表才是判据，这条只是快速自查。

### Step 8: 门禁（在仓库根跑）

- [ ] typecheck：

```bash
cd /d/project/study/openhive/openhive/packages/core && bun run typecheck
cd /d/project/study/openhive/openhive/packages/opencode && bun run typecheck
```

预期：两条都 **exit 0**。

- [ ] oxlint：

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/core/src/project/membership.ts packages/core/test/project-membership.test.ts packages/opencode/src/server/openhive/archive.ts packages/opencode/src/server/openhive/member.ts
```

预期：**0 error**（warning 若有，逐条看是不是本改动引入的）。

- [ ] 跑 opencode 的相关测试（`archive.ts` / `member.ts` 被改过）：

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-archive.test.ts test/server/openhive-project-restore.test.ts test/server/openhive-project-member.test.ts
```

预期：**全绿**（若文件名与实际不符，用 `ls packages/opencode/test/server/ | grep openhive` 找齐，据实跑）。

### Step 9: 提交

- [ ] 写提交信息文件（**单引号 heredoc**）：

```bash
cat > /tmp/task1.txt <<'EOF'
feat(core): 项目判定加「改名」「删除」两动作，并把 asRole/actorIn 收口进 membership

- PROJECT_ACTIONS 追加 rename / delete（追加在末尾——闭集断言逐值钉住顺序）。
  RULES 两条都只认 owner（spec §7：两项都只有创建人能做）。
- decide 的归档分支从「只放行 restore」放宽成「restore 或 delete，且 owner」
  （spec §7：已归档的项目也能删除；不开口的话「删除找不回」在已归档项目上不成立）。
  改名**不**放宽——归档项目的名字没有可作用的实体，方向保持收紧。
- asRole / actorIn 从三份副本（archive.ts:250、member.ts:185/190）收口进 core
  membership.ts：闭集的解码器住在闭集旁边。三处调用点全改，
  archive.ts 的孤儿导入删除，member.ts:64-66 的残差注释订正。
- 三条既有核心用例**改写**（不是删）：闭集逐值、归档后 owner 只留两件事、
  frozen 的等价断言——加动作后它们必红，改法是保留反面断言并显式排除新例外。

这是要保留的定制。
EOF
```

- [ ] 提交：

```bash
cd /d/project/study/openhive/openhive && git add packages/core/src/project/membership.ts packages/core/test/project-membership.test.ts packages/opencode/src/server/openhive/archive.ts packages/opencode/src/server/openhive/member.ts && git commit -F /tmp/task1.txt
```

- [ ] 记下这次提交的哈希（Task 10 的收尾要用）：

```bash
cd /d/project/study/openhive/openhive && git log -1 --format=%H
```

---

## Task 2: auth——四个辅助（改名 / 清成员 / 清归档标记 / 清共享名字）

对应 spec §9 第一行 ＋ R4。

**Files:**
- Modify: `packages/auth/src/project-member.ts`（在 `recordProject` 那一段之后追加；`:190-260` 是 `removeMember` / `markArchived` / `markRestored`，照它们的风格写）
- Modify: `packages/auth/src/project-member.test.ts`（文件末尾追加一组）

**Interfaces:**
- Consumes: `ProjectMemberTarget`（`{ execute(query: SQL): PromiseLike<unknown> }`，`:101-103`）、`rowsOf`（从 `./migrate` 导入，`:8` 已导）
- Produces:
  - `updateProjectName(db: ProjectMemberTarget, input: { projectId: string; name: string }): Promise<void>`
  - `removeAllMembers(db: ProjectMemberTarget, input: { projectId: string }): Promise<void>`
  - `removeProjectArchive(db: ProjectMemberTarget, input: { projectId: string }): Promise<void>`
  - `removeProjectMeta(db: ProjectMemberTarget, input: { projectId: string }): Promise<void>`

### Step 1: 先写会红的用例

- [ ] 在 `packages/auth/src/project-member.test.ts` 末尾追加（先看清文件尾部的 `})` 位置；`freshDb` / `addUser` / `failure` 是本文件已有的辅助）：

```ts
describe("项目级维护（2026-10-16）：改名 / 清成员 / 清归档标记 / 清共享名字", () => {
  /**
   * **改名**——`project_meta.name` 今天**只有建项目时的那个 `insert`**，全仓没有 update
   * （spec §4.1）。这条钉的是「第二个写入点」存在且**只改名字那一列**。
   */
  test("updateProjectName：只改 name，type 一个字不动", async () => {
    const db = await freshDb()
    await recordProject(db, { projectId: "p1", name: "旧名字", type: "shared" })

    await updateProjectName(db, { projectId: "p1", name: "新名字" })

    const 行 = await 读meta(db, "p1")
    expect(行?.name).toBe("新名字")
    // type 是**另一件事**（spec §4.1 的名字有两处、类型只有一处）——改名字顺手改了类型
    // 不会报错也不会变红，只有这条在。
    expect(行?.type).toBe("shared")
  })

  test("updateProjectName：命中 0 行时**不抛错**（残差，见函数注释）", async () => {
    const db = await freshDb()
    // 库里压根没有 p9 这一行——调用方分辨不出，这是如实记账的残差，不是「已覆盖」。
    await expect(updateProjectName(db, { projectId: "p9", name: "随便" })).resolves.toBeUndefined()
  })

  /**
   * **清成员**——删的是**所有**成员的，不只发起人（spec §6 ①：只删自己的登记、留着成员关系的话，
   * 项目会从「我的项目」降级成影子行继续挂在列表上）。
   */
  test("removeAllMembers：一个项目的成员行**全体**删掉，别的项目一行不动", async () => {
    const db = await freshDb()
    await addUser(db, "u1", "010001")
    await addUser(db, "u2", "010002")
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 1 })
    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 2 })
    await addMember(db, { projectId: "p2", userId: "u1", role: "owner", timeCreated: 3 })

    await removeAllMembers(db, { projectId: "p1" })

    expect(await membersOf(db, "p1")).toEqual([])
    // 对照：另一个项目**一行不动**——写成「删掉 user 的全部成员行」会连 p2 一起清掉，
    // 而那样在只看 p1 的断言下**照样绿**。
    expect((await membersOf(db, "p2")).map((m) => m.userId)).toEqual(["u1"])
  })

  test("removeAllMembers：项目本来就没有成员行 ⇒ 不抛错（可重入）", async () => {
    const db = await freshDb()
    await expect(removeAllMembers(db, { projectId: "p9" })).resolves.toBeUndefined()
  })

  test("removeProjectArchive：归档行删掉；没有那一行 ⇒ 不抛错（可重入）", async () => {
    const db = await freshDb()
    await markArchived(db, { projectId: "p1", archivedAt: 100 })

    await removeProjectArchive(db, { projectId: "p1" })
    expect(await archiveStatesOf(db, ["p1"])).toEqual(new Map())

    await expect(removeProjectArchive(db, { projectId: "p1" })).resolves.toBeUndefined()
  })

  test("removeProjectMeta：共享名字行删掉；没有那一行 ⇒ 不抛错（可重入）", async () => {
    const db = await freshDb()
    await recordProject(db, { projectId: "p1", name: "甲项目", type: "private" })

    await removeProjectMeta(db, { projectId: "p1" })
    expect(await projectMetaOf(db, ["p1"])).toEqual(new Map())

    await expect(removeProjectMeta(db, { projectId: "p1" })).resolves.toBeUndefined()
  })
})
```

- [ ] 在同一文件里补一个读数辅助（放在 `describe` **之前**，与文件里其它辅助并列）：

```ts
/** 某项目的 `project_meta` 那一行（**裸 SQL**，不经被测对象——同本文件其它 oracle 的做法）。 */
async function 读meta(db: ProjectMemberTarget, projectId: string) {
  const result = await db.execute(sql`select name, type from auth.project_meta where project_id = ${projectId}`)
  return rowsOf(result)[0]
}
```

⚠️ 若文件里已有等价辅助（先 `grep -n "project_meta" packages/auth/src/project-member.test.ts`），**复用它**，别新写一份。

- [ ] 检查并补 import：文件顶部从 `./project-member` 那一行 import 里加上本次用到的名字（`updateProjectName` / `removeAllMembers` / `removeProjectArchive` / `removeProjectMeta`），并确认 `ProjectMemberTarget` 若被 `读meta` 用到则也在 import 里（它可能是 `import type`）。

### Step 2: 跑它，确认红

- [ ] 跑：

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun test src/project-member.test.ts
```

预期：**红**，7 条新用例红在 `is not a function` / `not defined` 型（`LEARNINGS #004-11`：这一片红**不是**因为在守着那条性质，是因为被测符号压根不存在——据实记这一点）。

### Step 3: 改到绿——`project-member.ts` 加四个函数

- [ ] 在 `recordProject` 那一整段**之后**（`:389` 的 `}` 之后）追加：

```ts
export interface UpdateProjectNameInput {
  readonly projectId: string
  readonly name: string
}

/**
 * 改写一个项目的**共享名字**（2026-10-16 项目改名）。
 *
 * ## 为什么需要它——`project_meta` 今天只有「建」
 *
 * 全仓对 `project_meta` 的写入点只有建项目时那一个 `insert`（`recordProject` 的注释逐字写着
 * 「同一个 id 不会有第二次创建」），**没有 update / upsert**。于是「改名」这条链需要第二个写入点。
 *
 * ## 为什么只有名字这一列
 *
 * 这张表有 `name` 与 `type` 两列，而**类型不是这次要改的东西**（spec 只说改名）。
 * 顺手把 `type` 一起写（`set name = …, type = …`）不会报错、不会变红——只有测试里那条
 * 「type 一个字不动」在。**类型今天没有改名出口**，将来要加再单独裁定。
 *
 * ## `update` 而不是 upsert；命中 0 行**静默成功**（残差，如实记）
 *
 * 同 `markRestored` 的理由（上面那段）：走得到这里 = 调用方刚读过这一行 / 刚建过这一行
 * ⇒ 那行必然在。写成 upsert 就等于允许「本来没有也行」，把「该改的那一行找不着」也静默算成成功。
 * ⚠️ 但 `update` 命中 0 行时**它同样返回成功**，调用方分辨不出——真要防它得去数返回行数，
 * 而那条形状在 PGlite 与生产 bun-sql 下是否一致**没验过**（`LEARNINGS #002-01` 咬的正是这条维度）
 * ⇒ **不写没验过的判据**，作为残差记在 `state.md` 的缺口表。
 */
export async function updateProjectName(db: ProjectMemberTarget, input: UpdateProjectNameInput): Promise<void> {
  await db.execute(sql`
    update auth.project_meta
    set name = ${input.name}
    where project_id = ${input.projectId}
  `)
}

export interface RemoveAllMembersInput {
  readonly projectId: string
}

/**
 * 把一个项目的**全部成员关系**删掉（2026-10-16 项目删除，spec §6 ①）。
 *
 * ⚠️ **不能只删发起人那一条**：本文件上面 `removeMember` 删的是「某人退出」那一条，而删除项目
 * 要的是**整组消失**。只删自己那条的话，项目会从「我的项目」**降级成影子行**继续挂在
 * 其他成员的清单上（影子行由 `membershipsOf` 产出，spec §6 ① 明写这一点，`project.ts:317-320`）。
 *
 * **删到 0 行算成功**（同 `removeMember` 的理由：可重入——第二次点删除时那几行已经不在了，
 * 那时抛错才是错的）。**按 `project_id` 删，不按 `user_id`**：后者会连别的项目一起清掉。
 */
export async function removeAllMembers(db: ProjectMemberTarget, input: RemoveAllMembersInput): Promise<void> {
  await db.execute(sql`
    delete from auth.project_member
    where project_id = ${input.projectId}
  `)
}

export interface RemoveProjectArchiveInput {
  readonly projectId: string
}

/**
 * 删掉一个项目的**归档标记**（2026-10-16 项目删除，spec §6 ②）。
 *
 * 跨库**没有外键**（`0005_project_member.sql:33-37`）⇒ 项目本体消失时这张表不会跟着清，必须手工删。
 * 留着它的后果不是「多一行垃圾」：一个 id 被复用时（今天不会，但不该指望）新项目会**一建出来就是已归档**。
 *
 * `delete` 而不是「翻成 `archived = false`」：`archived = false` 是**找回**那条链的语义
 * （`markRestored`），而这里是「这一行不该存在了」。
 * **删到 0 行算成功**——可重入。
 */
export async function removeProjectArchive(db: ProjectMemberTarget, input: RemoveProjectArchiveInput): Promise<void> {
  await db.execute(sql`
    delete from auth.project_archive
    where project_id = ${input.projectId}
  `)
}

export interface RemoveProjectMetaInput {
  readonly projectId: string
}

/**
 * 删掉一个项目的**共享名字 / 类型**行（2026-10-16 项目删除，spec §6 ②）。
 *
 * 跨库无外键（同 `removeProjectArchive`）。留着它的后果比归档标记那条更隐蔽：
 * 项目本体（每用户 SQLite 的 `project_ext` / `project` 行）已经不在了，而这张表里还挂着一行
 * 谁都读不到的名字——它不会出错、不会变红，只是**一直涨**。
 *
 * **删到 0 行算成功**——可重入。
 */
export async function removeProjectMeta(db: ProjectMemberTarget, input: RemoveProjectMetaInput): Promise<void> {
  await db.execute(sql`
    delete from auth.project_meta
    where project_id = ${input.projectId}
  `)
}
```

### Step 4: 跑它，确认绿

- [ ] 跑：

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun test src/project-member.test.ts
```

预期：**全绿**（原有 + 7 条新）。

- [ ] 跑 auth 全包：

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun test --timeout 30000
```

预期：**全绿**，≥ Task 0 基线。

### Step 5: 变异验证

- [ ] 备份：`cp packages/auth/src/project-member.ts /tmp/project-member.ts.bak`

- [ ] **变异 A：把 `updateProjectName` 的 `where` 拆掉**（改成 `set name = ${input.name}` 且删掉 `where` 行）。
  预期：**只红一条**——`updateProjectName：只改 name…` 里那条 `name` 断言（`旧名字` 没变）或另一条（若库里有多行会一起改，本用例库里只有一行 ⇒ 断言 `行?.name` 仍是 `旧名字` ⇒ 红）。据实记。
- [ ] 还原：`cp /tmp/project-member.ts.bak packages/auth/src/project-member.ts`

- [ ] **变异 B：把 `removeAllMembers` 的 `where` 从 `project_id` 换成 `user_id`。**
  把 `where project_id = ${input.projectId}` 改成 `where 1 = 1`（最粗暴的「删全表」）。
  预期：**红两条**——「全体删掉，别的项目一行不动」的两条断言（`p2` 那条会先红，因为 `p1` 已经在它之前断言过、此刻为空仍然通过）。据实记红在哪一句（`LEARNINGS #005-46`：一条用例里排了多条断言时，变异只会把红停在它最先撞倒的那一句）。
- [ ] 还原：`cp /tmp/project-member.ts.bak packages/auth/src/project-member.ts`

- [ ] **变异 C：把 `removeProjectArchive` 的 `delete` 换成 `update … set archived = false`。**
  预期：**红一条**——`removeProjectArchive：…` 里那条 `expect(await archiveStatesOf(db, ["p1"])).toEqual(new Map())`（改成 update 之后那一行还在，`archiveStatesOf` 会给出 `{ archived: false }`）。据实记。
- [ ] 还原：`cp /tmp/project-member.ts.bak packages/auth/src/project-member.ts`

- [ ] 重跑确认回到全绿，并 `diff /tmp/project-member.ts.bak packages/auth/src/project-member.ts`（预期：**无输出**）。

### Step 6: ⑥ 步——grep 同类落点

- [ ] 在仓库根跑：

```bash
cd /d/project/study/openhive/openhive && grep -rn "project_meta\|project_archive\|project_member" packages/auth/src packages/opencode/src --include=*.ts | grep -v "\.test\." | grep -i "delete\|update\|insert into"
```

逐个写下一步结论：除了本任务新增的四个函数、以及既有的 `removeMember` / `markArchived` / `markRestored` / `recordProject` / `addMember`，**还有没有第三个写入点**。预期：没有（若发现新的，按 `#002-06` 判定是不是同一件事并登记）。

### Step 7: 门禁

- [ ] typecheck：

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun run typecheck
```

预期：exit 0。

- [ ] oxlint：

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/auth/src/project-member.ts packages/auth/src/project-member.test.ts
```

预期：0 error。

### Step 8: 提交

```bash
cat > /tmp/task2.txt <<'EOF'
feat(auth): project_meta/project_member/project_archive 加四个项目级维护辅助

- updateProjectName：改写 auth.project_meta.name（今天这张表**只有建项目时那一个 insert**，
  全仓没有 update/upsert）。刻意只改 name 一列——type 不是这次要改的东西。
  用 update 不用 upsert，命中 0 行静默成功（残差，同 markRestored，进缺口表）。
- removeAllMembers：按 project_id 删**全体**成员行（spec §6 ①：只删自己那条的话，
  项目会降级成影子行继续挂在其他成员的清单上）。
- removeProjectArchive / removeProjectMeta：跨库无外键，项目本体消失时这两张表不会自动清，
  必须手工删（spec §6 ②）。四个辅助都**删到 0 行算成功**——删除可重入靠的是这一条。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/auth/src/project-member.ts packages/auth/src/project-member.test.ts && git commit -F /tmp/task2.txt
```

---

## Task 3: core 每用户库——`project_directory` 与 `project_ext` 的按项目删除

**Files:**
- Modify: `packages/core/src/project/directories.ts`（`Interface` 加一行 + 实现 + 注释）
- Modify: `packages/core/test/project-directories.test.ts`（文件末尾加一条）
- Modify: `packages/core/src/project/ext.ts`（加 `deleteByProjectID`）
- Modify: `packages/core/test/project-ext.test.ts`（文件末尾加一条）

**Interfaces:**
- Consumes: `ProjectDirectories.node`（`makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })`）、`DatabaseClient` / `Transaction` 两个局部类型；`ext.ts` 的 `Database = EffectDrizzleSqlite.EffectSQLiteDatabase`
- Produces:
  - `ProjectDirectories.Interface.removeAll(input: { projectID: string }, tx?: Transaction): Effect.Effect<boolean>`——`true` = 至少删掉一行
  - `ext.deleteByProjectID(db: Database, projectID: string): Effect.Effect<void>`——⚠️ **收裸 db，不是服务**（同族 `insertProjectExt` / `touchProjectExt` 的做法）

### Step 1: 先写会红的用例

- [ ] 在 `packages/core/test/project-directories.test.ts` 末尾追加：

```ts
describe("removeAll（2026-10-16 项目删除：清 project_directory 行）", () => {
  /**
   * 删除一个项目要清掉它的**全部**目录行（一个项目可能有多条——spec §6 ⑦）。
   * 用 `remove`（按 projectID + directory）得先 `list` 再逐条删，而那个 list-then-delete
   * 的循环写在调用方、跨越两条 await ⇒ 中途失败会留下半份。`removeAll` 是一条语句。
   */
  it.effect("一个项目的目录行全删、别的项目一行不动、返回 true", () =>
    Effect.gen(function* () {
      yield* setup()
      const 别的项目 = Project.ID.make("project-directories-别的")
      const 别处 = AbsolutePath.make("/tmp/project-directories/别处")
      // 本表带外键（`project_id → project(id)`）⇒ 另一个项目也要先有 `project` 行，
      // 写法与上面 `setup()` 一致。
      yield* Database.Service.use(({ db }) =>
        db
          .insert(ProjectTable)
          .values({ id: 别的项目, worktree: 别处, sandboxes: [], time_created: 1, time_updated: 1 })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie),
      )

      const service = yield* ProjectDirectories.Service
      yield* service.create({ projectID, directory })
      yield* service.create({ projectID, directory: AbsolutePath.make("/tmp/project-directories/甲/乙") })
      yield* service.create({ projectID: 别的项目, directory: 别处 })

      expect(yield* service.removeAll({ projectID })).toBe(true)
      expect(yield* service.list(projectID)).toEqual([])
      // 对照：另一个项目**一行不动**——写成「删全表」会连它一起清掉，
      // 而那样在只看本项目的断言下照样绿（`#005-47` 同族：期望值别撞上「什么都没做」也成立）。
      expect((yield* service.list(别的项目)).map((row) => row.directory)).toEqual([别处])
    }),
  )

  /**
   * ⚠️ 这条**另起一个项目 id**，不复用本文件上面那个共享的 `projectID`：本文件的 `layer` 是
   * **模块级**的（`testEffect(AppNodeBuilder.build(...))`），用例之间**共享同一份库**
   * （看上面「creates once」与「replaces the strategy」两条：后者接着前者的那一行做 replace）。
   * 复用 `projectID` 会让这条的读数取决于「上一条跑没跑」。
   */
  it.effect("本来就没有目录行 ⇒ 返回 false（可重入，不是错误）", () =>
    Effect.gen(function* () {
      const service = yield* ProjectDirectories.Service
      expect(yield* service.removeAll({ projectID: Project.ID.make("project-directories-空") })).toBe(false)
    }),
  )
})
```

⚠️ 本文件的 harness 就是这几样，**逐字沿用**（`#004-12`：同族测试的手段整段搬，只换判据点）：
`const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, ProjectDirectories.node])))`；
模块级 `const projectID = Project.ID.make("project-directories")` 与 `const directory = AbsolutePath.make("/tmp/project-directories")`；
`setup()` 返回 `Database.Service.use(...)` 那个 Effect；`it.effect(...)`（**不是** `it.provide(layer)`）。
新增用例**不需要**再加 import——`Project` / `AbsolutePath` / `Database` / `ProjectTable` / `Effect` 本文件都已在。

- [ ] 在 `packages/core/test/project-ext.test.ts` 末尾追加：

```ts
describe("deleteByProjectID（2026-10-16 项目删除：清 project_ext 行）", () => {
  it.effect("删掉这个项目的行；别的项目**整行原样**", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")
          yield* seedProject(alice.db, "proj_d1").pipe(Effect.orDie)
          yield* seedProject(alice.db, "proj_d2").pipe(Effect.orDie)
          yield* insertExt(alice.db, { project_id: "proj_d1", type: "private" }).pipe(Effect.orDie)
          yield* insertExt(alice.db, { project_id: "proj_d2", type: "private" }).pipe(Effect.orDie)

          yield* ProjectExt.deleteByProjectID(alice.db, "proj_d1")

          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_d1")).toBeUndefined()
          // 对照：隔壁那行**整行原样**（同「touchProjectExt 只动这一行」那条的写法）——
          // 写成「删全表」会连它一起清掉，而那样在只看本项目那一句下照样绿。
          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_d2")).toEqual({
            project_id: "proj_d2",
            type: "private",
            project_type: "单案",
            shared_directory: null,
            last_accessed_at: 1700000000000,
          })
        }),
      ),
    ),
  )

  it.effect("本来就没有那一行 ⇒ 不抛错（可重入，同 touchProjectExt 的「零行是正常路径」）", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")
          yield* ProjectExt.deleteByProjectID(alice.db, "proj_根本没有")
        }),
      ),
    ),
  )
})
```

⚠️ 本文件的 harness 与前几条**逐字同款**，直接沿用（`#004-12`）：`withTmp((root) => withRouter(root, (router) => ...))`、`const alice = yield* router.forUser("alice")`、裸 SQL 的 `seedProject(alice.db, id)` 与 `insertExt(alice.db, { project_id, type })`、`it.effect(...)`。种子的 `.pipe(Effect.orDie)` 照抄「touchProjectExt」那条。
⚠️ **不需要改 import**：`ProjectExt` 命名空间本文件已 import ⇒ 用 `ProjectExt.deleteByProjectID`，别写裸的 `deleteByProjectID`。
⚠️ `insertExt` 把 `project_type` 写成 `'单案'`、`last_accessed_at` 写成 `1700000000000`（裸 SQL 里的字面量）——上面「整行原样」那条的期望值就是照它写的；**改期望值前先回去看 `insertExt` 的 SQL**。

- [ ] 两个测试文件**都不用动 import**（上面两处已说明）。

### Step 2: 跑它，确认红

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test test/project-directories.test.ts test/project-ext.test.ts
```

预期：**红 4 条**，都是 `is not a function` 型（符号不存在）。据实记。

### Step 3: 改到绿——`directories.ts`

- [ ] 在 `Interface` 里 `remove` 那一行**之后**加一行：

```ts
  remove(input: RemoveInput, tx?: Transaction): Effect.Effect<boolean>
  /**
   * 删掉一个项目的**全部目录行**（2026-10-16 项目删除，spec §6 ⑦）。
   *
   * 与 `remove`（按 `directory` 删一条）是**两个**动作而不是一个带可选参数的：调用方在
   * 「用户删了一条目录」与「项目整个没了」这两件事上要的东西不同——后者不能只删已知的那几条。
   *
   * 返回值与 `remove` 同一口径：`true` = 至少删掉一行。**删到 0 行返回 `false`，不是错误**——
   * 项目删除**可重入**（spec §6），第二次点删除时这些行已经不在了。
   */
  removeAll(input: RemoveAllInput, tx?: Transaction): Effect.Effect<boolean>
```

- [ ] 在 `RemoveInput` 那一对（`RemoveInput` Schema ＋ `export type RemoveInput`）**之后**加同一形状的一对：

```ts
/**
 * `removeAll` 的入参。**走 `Schema.Struct` 而不是裸 `interface`**，与 `RemoveInput` 同一个理由
 * （同文件上面那三对输入都是这个形状）：`ProjectSchema.ID` 是**带 brand 的**（`schema/project-id.ts`
 * 的 `Schema.String.pipe(Schema.brand("Project.ID"))`），而 `project_directory.project_id` 那一列
 * 就是 `$type<ProjectSchema.ID>()`（`./sql.ts:23-26`）⇒ 入参写成裸 `string` 会在 `eq(...)` 那里
 * 类型不过。走 Schema 拿到的就是同一个 brand，调用方也得显式 `ProjectSchema.ID.make(...)`。
 */
export const RemoveAllInput = Schema.Struct({
  projectID: ProjectSchema.ID,
})
export type RemoveAllInput = typeof RemoveAllInput.Type
```

- [ ] 在 `remove` 的实现（`const remove = Effect.fn("ProjectDirectories.remove")(...)`）**之后**加同形状的一个：

```ts
    /**
     * 删掉一个项目的**全部目录行**（2026-10-16 项目删除，spec §6 ⑦）。
     *
     * ⚠️ **`db` 是构造期闭包里的那一份**（本层 `Layer.effect` 顶上 `const db = (yield* Database.Service).db`），
     * 与 `remove` / `create` / `list` **逐字同款**——这里**不许**再 `yield* Database.Service`：
     * 那会让返回的 Effect 额外要求一个 `Database.Service` 环境，而请求 fiber 的 context 里**没有**
     * app 层服务（`project.ts` / `archive.ts` 都记着这条实测）。
     *
     * `.all()` 判多行（`remove` 是 `.get()` 判一行）；返回值与 `remove` 同一口径：
     * `true` = 至少删掉一行。**删到 0 行返回 `false`，不是错误**——项目删除**可重入**（spec §6）。
     */
    const removeAll = Effect.fn("ProjectDirectories.removeAll")(function* (input: RemoveAllInput, tx?: Transaction) {
      const rows = yield* (tx ?? db)
        .delete(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, input.projectID))
        .returning({ directory: ProjectDirectoryTable.directory })
        .all()
        .pipe(Effect.orDie)
      return rows.length > 0
    })
```

- [ ] **别忘把 `removeAll` 挂进 `return Service.of({...})`**（本层末尾那个字面量现在是 `{ list, get, contains, create, remove }`）⇒ 改成 `{ list, get, contains, create, remove, removeAll }`。漏这一步的指纹是**两处一起响**：`bun run typecheck` 说 `Service.of` 的实参缺 `removeAll`，而单测报 `service.removeAll is not a function`——**别只修一处**（`#002-06`：同一个名字的两处写法必须一起改）。

⚠️ **`eq` / `ProjectDirectoryTable` / `Effect` / `Schema` / `ProjectSchema` 本文件顶部都已 import，一个都不用加**（`ProjectSchema` 见 `./schema` 那行）。

### Step 4: 改到绿——`ext.ts`

- [ ] 在 `touchProjectExt` 之后追加：

```ts
/**
 * 删掉一个项目的 `project_ext` 行（2026-10-16 项目删除，spec §6 ③）。
 *
 * ⚠️ **收裸 `db`，不是 Effect 服务**——同族的 `insertProjectExt` / `touchProjectExt` 都是这个形状
 * （本文件只有读侧 `findByProjectID` 那一族走服务）。
 *
 * **删到 0 行不算错**（可重入）：第二次点删除时那一行已经不在了，那时抛错才是错的
 * ——与 `removeMember`（auth 侧）同一条口径。
 *
 * ⚠️ **删的是「我的」登记行**：项目删除由创建人发起，而 `project_ext` 只对**创建人**存在
 * （成员没有 `project_ext` 行，`ext.ts` 上面那段注释逐字写着）。成员的清单靠 PG 的
 * `project_member` 产出，那一边由 `removeAllMembers` 负责。
 */
export function deleteByProjectID(db: Database, projectID: string) {
  return db
    .delete(ProjectExtTable)
    .where(eq(ProjectExtTable.project_id, projectID))
    .run()
    .pipe(Effect.orDie)
}
```

⚠️ `eq` 的导入与 `ProjectExtTable` 的名字照抄同文件 `findByProjectID`——**不要**新增 import。

### Step 5: 跑它，确认绿

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test test/project-directories.test.ts test/project-ext.test.ts
```

预期：**全绿**。

- [ ] 跑 core 全包：

```bash
cd /d/project/study/openhive/openhive/packages/core && bun test
```

预期：**全绿**，≥ 基线。

### Step 6: 变异验证

- [ ] 备份：`cp packages/core/src/project/directories.ts /tmp/directories.ts.bak`
          `cp packages/core/src/project/ext.ts /tmp/ext.ts.bak`

- [ ] **变异 A：把 `removeAll` 的 `where` 拆掉**（删掉 `.where(...)` 那一行），跑 directories 测试。
  预期：**红 1 条**（「别的项目一行不动」那句先红）。据实记红在哪一句。
- [ ] **变异 B：把 `removeAll` 的 `return rows.length > 0` 改成 `return true`**，跑测试。
  预期：**红 1 条**——「本来就没有目录行 ⇒ 返回 false」那条。
- [ ] 还原两个文件：`cp /tmp/directories.ts.bak packages/core/src/project/directories.ts`

- [ ] **变异 C：把 `deleteByProjectID` 的 `where` 拆掉**，跑 ext 测试。
  预期：**红 1 条**（「别的项目一行不动」）。
- [ ] 还原：`cp /tmp/ext.ts.bak packages/core/src/project/ext.ts`

- [ ] 重跑确认全绿，并 `diff` 两个备份文件（预期：无输出）。

### Step 7: ⑥ 步——`project_directory` 的读取者清点（spec §6 末「待实施时核实」的**第二条**）

```bash
cd /d/project/study/openhive/openhive && grep -rn "ProjectDirectories\|project_directory\|ProjectDirectoryTable" packages/ --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "migrations/"
```

逐个落点判定并写下来。已知的（本计划写作时核实）：

| 读取者 | 删掉行之后会怎样 | 处置 |
|---|---|---|
| `packages/opencode/src/project/project.ts:112` 的 `ProjectDirectories.Service`（`migrateProjectId` 里改 id） | 它只处理「存在的行」，行没了就是没事可做 | 不动 |
| `packages/core/src/project/directories.ts` 的 `contains` / `get` / `list` | 各自回答「没有这一行」 | 不动 |
| 内核文件出口（`server/openhive/file.ts` 一族） | 它们要的是**沙箱目录**（`<根>/<userId>/<projectId>`），不是这张表 | 不动 |

⚠️ **若有落点读这张表去判断「项目存在与否」，本步要停下来立案**——那说明删除 `project_directory` 行会改变别的行为，spec §6 ⑦ 的「待实施时确认无别的读取者」就落到「有」。

### Step 8: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/core && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/core/src/project/directories.ts packages/core/src/project/ext.ts packages/core/test/project-directories.test.ts packages/core/test/project-ext.test.ts
```

预期：两条都干净。

### Step 9: 提交

```bash
cat > /tmp/task3.txt <<'EOF'
feat(core): ProjectDirectories.removeAll 与 ProjectExt.deleteByProjectID

- removeAll：按 project_id 一条语句删**全部**目录行（spec §6 ⑦）。与 remove 是两个动作
  而不是一个带可选参数的：调用方在「用户删了一条目录」与「项目整个没了」上要的东西不同。
  删到 0 行返回 false，不是错误——项目删除可重入靠这一条。
- deleteByProjectID：删「我的」project_ext 登记行（spec §6 ③），收裸 db（同族
  insertProjectExt / touchProjectExt 的形状）。成员没有 project_ext 行，那一边归 PG 的
  removeAllMembers。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/core/src/project/directories.ts packages/core/src/project/ext.ts packages/core/test/project-directories.test.ts packages/core/test/project-ext.test.ts && git commit -F /tmp/task3.txt
```

---

## Task 4: 内核改名出口（`POST /openhive/project/rename`）

对应 spec §9 第二行 ①②③ 的改名那半 ＋ R3。

**Files:**
- Modify: `packages/opencode/src/server/openhive/project.ts`（`PATH` `:144-148`；错误构造附近 `:223-238` 之后；`handleCreate` 之后加处理器；`routes` `:196-220` 加一行）
- Create: `packages/opencode/test/server/openhive-project-rename.test.ts`

**Interfaces:**
- Consumes: `deps.project.update({ projectID: ProjectV2.ID.make(id), name })`（建项目第 ⑤ 步同款）、`updateProjectName(deps.pg(), { projectId, name })`（Task 2）、`membersOf` / `ProjectMembership.asRole`（Task 1）、`ProjectMembership.decide`
- Produces: `POST /openhive/project/rename`，体 `{ projectId: string; name: string }` ⇒ 200 `{ projectId, name, renamed: true }` ／ 400 `{ error }` ／ 401 空体 ／ 403 `{ error }`

⚠️ **为什么这个出口住在 `project.ts` 而不是 `archive.ts`**（R1 的另一半）：`project.ts` 的 `Deps` 已经有 `project` 与 `projectV2` 两个服务（改名要它们写本地那份名字），而 `archive.ts` 没有。反过来删除住 `archive.ts`（它已经有 MinIO 与成员名单读法）。**两个出口各住「已经拿着它要的东西」的那个文件**，这是 `LEARNINGS #002-06` 那条取向在文件级上的用法。

### Step 1: 先写会红的路由测试

- [ ] 新建 `packages/opencode/test/server/openhive-project-rename.test.ts`。**挂具整段照抄 `openhive-project-archive-unconfigured.test.ts`**（`#004-12`：同族接缝测试的手段整段搬，只换判据点），只改：文件头注释、`OPEN`（**要配全 MinIO 吗？不要**——改名不碰 MinIO，用那份**不带** `OPENHIVE_MINIO_*` 的 `OPEN`，越少越稳）、`ARCHIVE_PATH` 换成三个新路径、用例。

```ts
import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 2026-10-16 · **项目改名出口**（`POST /openhive/project/rename`）。
 *
 * ## 这条钉的为什么是「两处」
 *
 * 名字存在两处（spec §4.1）：每用户 SQLite 的 `project.name`（**owner 读的那份**）与
 * PG `auth.project_meta.name`（**成员读的那份**）。只写一处 ⇒「我改了，同事看到的还是旧的」，
 * 而且**不报错、不变红**——`handleList` 里 owner 读本地、成员读 PG（`project.ts:354/391`），
 * 两个读者各读各的，谁都不会发现另一半没变。
 *
 * 所以本文件的主判据是**两条**：① 本地那一份变了；② PG 那一份变了。
 * 「只钉其中一条」是本文件最该防的事——两条各钉一份写入动作，任何一条缺了都会红。
 *
 * ## 与 `openhive-project-archive.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入，整套约法照抄、只换判据点。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、不是任何项目的成员——「非创建人 ⇒ 403」那条要用他。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const RENAME_PATH = "/openhive/project/rename"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-rename-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 改名不碰 MinIO ⇒ 这份 env **刻意不含**任何 `OPENHIVE_MINIO_*`（越少越稳）。 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const asWho = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const as = (url: string, init: RequestInit = {}) => asWho(ALICE, url, init)

/** 读 JSON 体。**先断内容类型**——「未挂载」在本应用里落进 SPA 兜底、回 200 ＋ `text/html`。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 列表项的**线上形状**（逐字写字段名当契约钉死——`#003-05`）。 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `project_member.user_id` 有外键 ⇒ 会被加进项目的身份必须先有 `auth.user` 行。
  for (const subject of [ALICE, BOB]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }
})

afterAll(async () => {
  await pg?.stop()
})

/**
 * **PG 那份名字**（`auth.project_meta.name`）——**直接打 `pg.db`**，不经 `projectMetaOf`。
 * oracle 一律不经过被测对象（同族测试的约法）。
 */
const pg名字 = (projectId: string) =>
  Effect.promise(async () => {
    const result = await pg?.db.execute(sql`select name from auth.project_meta where project_id = ${projectId}`)
    return rowsOf(result)[0]?.name
  })

/** 建一个项目、回它的 id。 */
const 建项目 = (name: string) =>
  Effect.gen(function* () {
    const created = yield* as(PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "private" }),
    })
    return yield* json(Entry, created)
  })

describe("T-rename · 项目改名（spec §10 判据 1）", () => {
  it.live(
    "改名后**两处名字都变了**：清单里读到的是新名，且 PG `project_meta.name` 也是新名",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("8·17专案")
        // 前置条件**真的成立**（`#002-02`：先证明机制活着，再钉被测那条）——
        // 否则「两处都变了」在一个压根没建的 id 上也可能看着绿。
        expect(project.name).toBe("8·17专案")
        expect(yield* pg名字(project.id)).toBe("8·17专案")

        const response = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: "8·17专案（改）" }),
        })

        // ① 被测属性之一：出口自述改名成功（与归档 / 找回 / 删除**同款**的「自述一个布尔」）。
        expect(response.status).toBe(200)
        const body = yield* json(
          Schema.Struct({ projectId: Schema.String, name: Schema.String, renamed: Schema.Boolean }),
          response,
        )
        expect(body.renamed).toBe(true)
        expect(body.name).toBe("8·17专案（改）")

        // ② 被测属性之二：**本地那份**（owner 读的）——经公开出口读，不直查 SQLite。
        const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
        expect(listed.find((entry) => entry.id === project.id)?.name).toBe("8·17专案（改）")

        // ③ 被测属性之三：**PG 那份**（成员读的）。这一条与 ② 是**两个**写入点，
        //    少写一处时另一处照样绿——所以必须分成两条断言。
        expect(yield* pg名字(project.id)).toBe("8·17专案（改）")
      }),
    30_000,
  )

  /**
   * **判据 2**：改名后**被邀成员那一侧读到的也是新名字**。
   *
   * 与上一条的差别是**读的人不同**：上一条 ② 读的是 owner 那条本地来源，这条读的是
   * 成员那条 PG 来源（`handleList` 对非自己建的项目走 `projectMetaOf`）。**两条来源不同
   * 才是 spec §4.1 那条推论的全部内容**——只钉 owner 那侧，「同事看到的还是旧的」照样绿。
   */
  it.live(
    "改名后**被邀成员**在清单里读到的也是新名字（钉结果，不只钉写入动作）",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("乙也能看的项目")

        // 邀 BOB 进来：两段身份各发一次（档案链的入口与名字落点是两件事）。
        const 邀 = yield* as(`/openhive/project/member/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, policeNo: BOB.policeNo }),
        })
        expect(邀.status, "邀请应当成功——这条用例的前提是 BOB 真的成了成员").toBe(200)

        // 前置：**改名之前**，成员读到的是旧名（否则「读到新名」在一个本来就对的地方也可能绿）。
        const 改前 = yield* json(Schema.Array(Entry), yield* asWho(BOB, PROJECT_PATH))
        expect(改前.find((entry) => entry.id === project.id)?.name).toBe("乙也能看的项目")

        const 改名 = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: "乙也能看的项目（改）" }),
        })
        expect(改名.status).toBe(200)

        // ⚠️ **判据**：成员那一侧读到的也是新名。
        const 改后 = yield* json(Schema.Array(Entry), yield* asWho(BOB, PROJECT_PATH))
        expect(改后.find((entry) => entry.id === project.id)?.name).toBe("乙也能看的项目（改）")
      }),
    30_000,
  )

  /**
   * **判据 5 的改名那半**：非创建人 ⇒ 403。
   *
   * ⚠️ 观测面：BOB 有身份、**不是这个项目的成员**（不邀他）。这是唯一能问出「是不是
   * 授权拦下的」的组合——若邀请他进来，「403」与「member 本来就不许改名」两种情况**看起来一样绿**。
   */
  it.live("非创建人 ⇒ 403（说得清），且**两处名字一个字都没动**", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("不是乙的项目")

      const response = yield* asWho(BOB, RENAME_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: "乙给改的名字" }),
      })

      expect(response.status).toBe(403)
      expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)

      // 零副作用（`#004-14` 的次序：被测属性 → 副作用 → 伴随信号）：
      // 两条**分开**断（本地 / PG），因为它们是两个写入点。
      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.find((entry) => entry.id === project.id)?.name).toBe("不是乙的项目")
      expect(yield* pg名字(project.id)).toBe("不是乙的项目")
    }),
    30_000,
  )

  it.live("空名字 / 全空白名字 ⇒ 400，且名字一个字没动", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("不该被清空")

      for (const 空 of ["", "   ", "\t\n"]) {
        const response = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: 空 }),
        })
        expect(response.status, `名字 ${JSON.stringify(空)} 应当被拒`).toBe(400)
      }

      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.find((entry) => entry.id === project.id)?.name).toBe("不该被清空")
    }),
    30_000,
  )
})
```

⚠️ 邀请出口的路径与体**以实际为准**：跑之前先 `grep -rn "invite" packages/opencode/src/server/openhive/member.ts | head`，用真实的 `PATH` 常量值替换上面那个字面量；体字段名（`projectId` / `policeNo`）同样照实。`#003-05` 的取向是「写死字面量」，**但字面量必须与生产一致**。

### Step 2: 跑它，确认红

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-rename.test.ts
```

预期：**红**。形状据实记——`/openhive/project/rename` 未被接管 ⇒ 落进 SPA 兜底 ⇒ `json()` 里那句 `content-type` 断言先红（**不是** 404）。这正是 `#004-14` 那句「本应用里未挂载不是 404」的又一个现场。

### Step 3: 改到绿——`project.ts`

- [ ] 改 `PATH`（`:144-148`）：

```ts
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  touch: `${PREFIX}/touch`,
  /**
   * 改名（2026-10-16）。住在**本文件**而不是 `archive.ts`：本地那份名字要 `project` 与
   * `projectV2` 两个服务（本文件的 `Deps` 已经有它们），而 `archive.ts` 没有。
   */
  rename: `${PREFIX}/rename`,
} as const
```

- [ ] 在 `TouchBody` 那一段之后加请求体与错误构造：

```ts
/** 改名的请求体。`name` 是**已被前端 trim 过**的候选值——服务端**再 trim 一次**并判空（下面 `handleRename` 的 ②）。 */
const RenameBody = Schema.Struct({ projectId: Schema.String, name: Schema.String })
```

```ts
/**
 * 403 —— **本文件自己的一份**（`archive.ts` 也有一份，那是刻意的）。
 *
 * ⚠️ 不 import `archive.ts` 的：`archive.ts` 顶层 `import { PREFIX } from "./project"`，
 * 而 `project.ts` 若反过来 import `archive.ts` 就是**循环依赖**——ESM 下这类环会在
 * 模块求值期撞 TDZ，而**撞的时机取决于谁先被加载**（不是每次都能复现）。
 *
 * 为什么这次「各写一份」不违背 `LEARNINGS #002-06`：那条管的是**判断**（同一件事的判定逻辑），
 * 而这两行是 **HTTP 辞汇**（一个状态码 + 一个 JSON 形状），没有可漂的语义。真正的判断
 * （`asRole` / `decide`）已经收口在 core —— 那里才是那条教训的射程。
 */
const FORBIDDEN = 403
function forbidden(message: string) {
  return jsonUnsafe({ error: message }, { status: FORBIDDEN })
}
```

⚠️ `jsonUnsafe` 的导入名照抄 `badRequest` 那一段（同文件已有）。

- [ ] 在 `handleCreate` 之后加处理器：

```ts
/**
 * 改名（2026-10-16 spec §3/§7）。
 *
 * ## 为什么必须**两处一起写**（读 spec §4.1 之前别改这句）
 *
 * 名字存在两处，**读者不同**：owner 那条行读每用户 SQLite 的 `project.name`，
 * 被邀成员那条影子行读 PG `auth.project_meta.name`（`handleList` 的两支，`:354` / `:391`）。
 * 只写一处 ⇒「我改了，同事看到的还是旧的」——**不报错、不变红**，两个读者各读各的谁也发现不了。
 *
 * ## 次序：**PG 先、本地后**（计划裁定 R3）
 *
 * PG 写失败时本地还没动 ⇒ 用户重试即可收敛。
 * ⚠️ **「两处始终一致」是假话**（2026-10-17 终审订正）：PG 成功、本地失败 ⇒ 两处暂时分叉，
 * 重试收敛；两步不原子，并发改名会让中间态 / 最终态短暂或持久分叉。
 * 这条次序保证的是「**瞬时失败可重试收敛**」，不是任何时刻都一致。
 *
 * ## 为什么用 `deps.project.update` 而不接上游 `PATCH /project/:projectID`
 *
 * 上游那条链（`Project.update` → `ProjectTable`）**一个字都不碰 `project_meta`**
 * （spec §4.1 末段）、而且它服务于上游自己的 project 概念。这里复用的是**同一个服务函数**
 * （`deps.project.update`，建项目第 ⑤ 步也调它），但出口是 fork 自己的。
 */
function handleRename(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    // 畸形 JSON ⇒ 400（客户端的事，不是服务端故障），与 `handleCreate` 逐字同款。
    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(RenameBody)(body)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 name")

    const name = payload.value.name.trim()
    if (!name) return badRequest("项目名不能为空")

    const userId = user.value.id
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    const projectId = payload.value.projectId
    // ⚠️ **这不是形式主义**（与 `handleArchive` 逐字同一条）：`projectId` 是**库里那一行的键**，
    // 形状不正就根本不该走到读库那一步。改名不碰盘，但它与归档走的是同一条入口约定。
    if (!User.isSafePathSegment(projectId)) return badRequest("projectId 不是合法的路径段")

    const pg = deps.pg()
    // ① 身份：库里有没有我这一行（**缺席 = 不是成员**，不是「member」）。
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = ProjectMembership.actorIn(members, userId)
    // ② 归档态。⚠️ **键缺席 = 未归档**（`archiveStatesOf` 的口径）——写成 `?? true`
    //    会让**所有新项目都改不了名**，而那时改名的四条用例全红、读起来像「权限坏了」。
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    const archived = archives.get(projectId)?.archived ?? false

    // ③ 判定（纯函数，在 core）。**排在两处写入之前**——`#004-09`：被拒与「门在副作用之前」
    //    是两条独立判据，一条替代不了另一条（判定挪到写入之后时，非创建人那条用例的
    //    「两处名字一字未动」会红，见本 task 的变异 D）。
    if (!ProjectMembership.decide({ actor, action: "rename", target: null, archived }))
      return forbidden("无权重命名该项目")

    // ④ **先 PG**（成员读的那一份）。它失败 ⇒ 本地一个字未动，用户重试即可收敛。
    yield* Effect.promise(() => updateProjectName(pg, { projectId, name }))
    // ⑤ **后本地**（owner 读的那一份）。`ProjectV2.ID.make(...)` 这个包装照 `handleCreate`
    //    第 ⑤ 步，**不能省**——那是建项目那一处已经验证过的形状（直接传字符串类型上就不对）。
    yield* deps.project.update({ projectID: ProjectV2.ID.make(projectId), name })

    return HttpServerResponse.jsonUnsafe({ projectId, name, renamed: true })
  })
}
```

⚠️ **`Effect.match` / `request.json` / `Schema.decodeUnknownOption` 这三个是 `handleCreate`（`:419-521`）逐字用过的形状**——已在上面写全，**照抄即可，别改成 `Effect.promise(() => c.req.json())` 那类示意写法**（本应用的路由处理器的入参是 **Effect 的 `HttpServerRequest`**，不是 Hono 的 `c`）。

- [ ] 在 `routes` 的 `router.add` 那三行（`:216-218`）之后加一行（**照它们逐字同形**）：

```ts
    yield* router.add("POST", PATH.rename, (request) => handleRename(request, deps))
```

- [ ] 在 `TouchBody`（`:245-247`）之后加请求体**与** 403 那一对（**`project.ts` 此前没有 `forbidden`**，它只到 400/401 为止）：

```ts
/** 改名的请求体。`name` 是**已被前端 trim 过**的候选值——服务端**再 trim 一次**并判空（`handleRename` 第 ③ 步）。 */
const RenameBody = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
})
```

```ts
const FORBIDDEN = 403

/**
 * 403 —— **本文件自己的一份**（`archive.ts:235` 也有一份，那是刻意的）。
 *
 * ⚠️ 不 import `archive.ts` 那份的：`archive.ts` 顶层 `import { PREFIX } from "./project"`，
 * 而 `project.ts` 若反过来 import `archive.ts` 就是**循环依赖**——ESM 下这类环会在
 * 模块求值期撞 TDZ，而**撞的时机取决于谁先被加载**（不是每次都能复现，最难查的那种）。
 *
 * **为什么这次「各写一份」不违背 `LEARNINGS #002-06`**：那条管的是**判断**（同一件事的判定逻辑，
 * 典型正是本 feature 里 `asRole` 那三份副本），而这两行是 **HTTP 辞汇**（一个状态码 ＋ 一个 JSON
 * 形状），没有可漂的语义。真正的判断（`asRole` / `actorIn` / `decide`）已经收口在 core
 * —— 那里才是那条教训的射程。
 */
function forbidden(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: FORBIDDEN })
}
```

- [ ] 改 import 那一行（`:118` 的 `@opencode-ai/core/project/ext` 那行**不动**），**新增两行**：

```ts
import { archiveStatesOf, membersOf, updateProjectName } from "@opencode-ai/auth/project-member"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
```

⚠️ **先 `grep -n "project/membership\|auth/project-member" packages/opencode/src/server/openhive/project.ts` 确认没有重复导入**；若已有同名行，只把缺的名字补进去，别写第二行。

### Step 4: 跑它，确认绿

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-rename.test.ts
```

预期：**全绿**（4 条）。

⚠️ 若第二条（成员那一条）红了：**先怀疑邀请出口的路径/体写错了**（那是我给的字面量，未逐字核实），别先去改实现。跑 `grep -rn "PATH\b" packages/opencode/src/server/openhive/member.ts` 取真值。

### Step 5: 变异验证

- [ ] 备份：`cp packages/opencode/src/server/openhive/project.ts /tmp/project.ts.bak`

- [ ] **变异 A：拆掉「写第二处名字」那一行**（spec §10 明写的变异）。把第 8 步（`deps.project.update(...)`）**整行删掉**，跑测试。
  预期：**红**——第一条（判据 1）与成员那条都会红。据实记**红在哪一句**：第一条里 `:354` 那侧（清单里的名字）先红，PG 那条**不会红**（那正是它在守的另一半）。这一条**必须**验证，spec §10 把它点名为「不红 ⇒ 那条用例是空转」。

- [ ] **变异 B：把次序反过来**（本地先写、PG 后写）。跑测试。
  预期：**全绿**（次序在**成功路径上**不可观测——这正说明「次序」这条判据**没有测试守着**）。
  ⇒ **据实记**：这是一条**测不出来的性质**（`LEARNINGS #002-02` 的取向：没测到的要写成缺口，不是写成没问题）。补齐办法：把这条记进 `state.md` 的缺口表，并在 `handleRename` 的注释里写清「次序的保证是**论证**（拒绝时两处一致），不是**测试**」。

- [ ] 还原：`cp /tmp/project.ts.bak packages/opencode/src/server/openhive/project.ts`

- [ ] **变异 C：把 `decide` 那一步的 `archived` 读法从 `=== true` 改成 `?? true`。**
  预期：**全绿**（没有一条用例在**未归档**项目上问「能不能改名」时的 `archived` 取值做直接断言——所有用例都是未归档且成功）。
  ⇒ **据实记并补一条用例**：在 Step 1 里追加一条「新项目（未归档、库里没有归档行）⇒ 可以改名」，它正是钉 `?? false` 这个默认值的那条。**补完再重跑变异 C，此时应当红。**

- [ ] **变异 D：把判定那一步挪到写库之后。**
  预期：**红**——非创建人那条的「零副作用」两句（本地与 PG 的名字都变了）。
  ⚠️ 注意 `#005-46`：一条用例里排了多条断言时，变异只会把红停在它最先撞倒的那一句；这里「零副作用」排在状态码之后，所以要看**它有没有跑到**。若只红在状态码上，说明副作用那两句没被证到——**据实记**，并把副作用断言提到状态码之前（或单起一条）。

- [ ] 还原：`cp /tmp/project.ts.bak packages/opencode/src/server/openhive/project.ts`，确认 `diff` 无输出。

### Step 6: ⑥ 步——grep 同类落点

```bash
cd /d/project/study/openhive/openhive && grep -rn "deps.project.update\|project.update(\|recordProject(" packages/opencode/src packages/app/src
```

逐个判定：**「写项目名字」在仓里有几个落点？**已知三个：建项目第 ⑤ 步（本地）、建项目第 ⑦b 步（PG）、本次改名（两处）。逐个写结论：建项目那两处**不需要**跟着改（建不是改）；本次新增的两处是**同一件事的唯一实现**（都在 `handleRename` 里）。

```bash
cd /d/project/study/openhive/openhive && grep -rn "project_meta" packages/ --include=*.ts | grep -v "\.test\." | grep -v migrations
```

确认：`project_meta` 的写入点现在有**三个**（`recordProject` 的 insert、`updateProjectName` 的 update、`removeProjectMeta` 的 delete），**它们的语义各不相同**（建 / 改 / 清），不构成重复。

### Step 7: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/opencode/src/server/openhive/project.ts packages/opencode/test/server/openhive-project-rename.test.ts
```

- [ ] 跑受影响的既有路由测试（确认没把归档 / 建项目带红）：

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project.test.ts test/server/openhive-project-archive.test.ts
```

预期：全绿。

### Step 8: 提交

```bash
cat > /tmp/task4.txt <<'EOF'
feat(opencode): 新增内核改名出口 POST /openhive/project/rename

- 名字存在两处（spec §4.1）：每用户 SQLite 的 project.name（owner 读）与 PG
  auth.project_meta.name（成员读）。本出口**两处一起写**——只写一处会「我改了同事看的还是旧的」，
  且不报错不变红（handleList 的两个读者各读各的）。
- 次序取 **PG 先、本地后**：PG 失败时本地还没动 ⇒ 重试收敛；但**不保证两处始终一致**
  （PG 成功而本地失败 / 并发改名会短暂或持久分叉，2026-10-17 终审订正）。
  ⚠️ 这条次序在成功路径上不可观测 ⇒ 是**论证**不是**测试**，已写明并进缺口表。
- 判定走 ProjectMembership.decide（rename 只认 owner，spec §7），排在写库**之前**。
- 授权先于任何写入：非创建人 ⇒ 403 ＋ 两处名字一字不动（两条副作用断言分开写，两个写入点）。
- 403 的错误构造在本文件**另写一份**（不 import archive.ts 的）：archive.ts 顶层
  import 了本文件的 PREFIX，反向 import 成环会撞 ESM TDZ。这是 HTTP 辞汇而非判断，
  真正的判断已收口在 core。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/opencode/src/server/openhive/project.ts packages/opencode/test/server/openhive-project-rename.test.ts && git commit -F /tmp/task4.txt
```

---

## Task 5: 内核删除出口（`POST /openhive/project/delete`）

对应 spec §5/§6 ＋ R1、R2、R10。**这是本 feature 最重的一件**：清七处、可重入、且有一条禁令要写死在注释里。

**Files:**
- Modify: `packages/opencode/src/server/openhive/archive.ts`（`PATH` `:121`、`Deps` `:179-185`、`routes` `:194-205`、末尾加处理器与三个私有辅助）
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`（`:339-348` 那块加**一行** `Layer.provide`）
- Create: `packages/opencode/test/server/openhive-project-delete.test.ts`

**Interfaces:**
- Consumes: `removeAllMembers` / `removeProjectArchive` / `removeProjectMeta`（Task 2）、`ProjectDirectories.removeAll`（Task 3）、`ext.deleteByProjectID`（Task 3）、`ProjectMembership.actorIn` / `decide`（Task 1）、`Minio.makeStore` / `endpointOf` / `Option.isNone(deps.minio)`、`FileSystem` / `Path`（Node 的 `fs` / `path`，本文件已用于 `releaseAll` / `filesUnder`）
- Produces: `POST /openhive/project/delete`，体 `{ projectId: string }` ⇒ 200 `{ projectId, deleted: true }` ／ 401 空体 ／ 403 `{ error }`

### Step 1: 先写会红的路由测试

- [ ] 新建 `packages/opencode/test/server/openhive-project-delete.test.ts`。**挂具整段照抄 `openhive-project-archive.test.ts`**（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ **假 S3** ＋ 身份注入），只换判据点（`#004-12`）。头部注释写清三件事：这条钉的是 §10 判据 3/4/6/7；观测面是「假 S3 的到达请求 ＋ 盘上 `existsSync` ＋ `pg.db` 裸 SQL ＋ 公开出口读会话」；**本文件只建一个 app**（同族那条实测边界：一个文件建第二个 app 会让路由在首查炸 500，`openhive-project-archive.test.ts` 文件头逐字记着）。

```ts
import { afterAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { type FakeS3, startFakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"
import { endpointOf } from "../../src/server/openhive/archive"

/**
 * 2026-10-16 · **项目删除出口**（`POST /openhive/project/delete`）。
 *
 * ## 这条钉的是「删干净了」与「留底是真留底」两件事，它们**方向相反**
 *
 * - **删干净**（判据 3/7）：项目从清单消失、盘上目录没了、共享 bare 仓库没了、
 *   MinIO 备份清空、PG 三表那些行没了。
 * - **留底**（判据 4）：**会话行仍在**、而且**读得出来**——这是「删除 ≠ 清空一切」的全部内容。
 *
 * ⚠️ **两个方向必须同时钉**：只钉前者，一个「把每用户库一并清空」的实现会全绿（而它删掉了
 * 民警的聊天记录）；只钉后者，「什么都没删」也会冒充成绿。
 *
 * ## 观测面
 *
 * - MinIO：**假 S3 到达的请求**（`fakeS3.requests`，不经 `Minio.Interface.get`）；
 * - PG 三表：`pg.db` 上的**裸 SQL**（不经 `membershipsOf` / `archiveStatesOf` / `projectMetaOf`）；
 * - 盘上：`existsSync`；
 * - 会话「读得出来」：**公开出口**（`GET /session`）+ `GET /session/:id/message`——它们是
 *   spec §4.3 那条实测结论（目录删了照样读得出来）的**判据化**。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写字面量、刻意不 import 生产常量——`#003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const DELETE_PATH = "/openhive/project/delete"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-delete-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/**
 * 假 S3 与 `openApp` 的构造**次序是要求不是巧合**：配置服务在**层构造期**取值 ⇒
 * `OPEN` 必须在 `HttpApiApp.routes.pipe(...)` 求值之前就有 endpoint。
 */
const s3: FakeS3 = startFakeS3()

afterAll(restoreDefaultPassword)

afterAll(() => {
  s3.stop()
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  OPENHIVE_MINIO_ENDPOINT: new URL(s3.endpoint).host,
  OPENHIVE_MINIO_BUCKET: s3.bucket,
  OPENHIVE_MINIO_ACCESS_KEY_ID: "test-access-key",
  OPENHIVE_MINIO_SECRET_ACCESS_KEY: "test-secret-key",
  OPENHIVE_MINIO_USE_SSL: "false",
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const asWho = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const as = (url: string, init: RequestInit = {}) => asWho(ALICE, url, init)

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [ALICE, BOB]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }
})

afterAll(async () => {
  await pg?.stop()
})

/** 某人的沙箱里、某个项目的目录（与内核拼法一致：`<workspaceRoot>/<userId>/<projectId>`）。 */
const projectDirOf = (userId: string, projectId: string) => path.join(WORKSPACE_ROOT, userId, projectId)
/** 共享 bare 仓库（共享项目才有）。 */
const bareOf = (projectId: string) => path.join(SHARED_ROOT, `${projectId}.git`)

/** PG 三表里某个项目的行数（**裸 SQL**）。 */
const 三表行数 = (projectId: string) =>
  Effect.promise(async () => {
    const r = await pg?.db.execute(sql`
      select
        (select count(*) from auth.project_member  where project_id = ${projectId}) as 成员,
        (select count(*) from auth.project_archive where project_id = ${projectId}) as 归档,
        (select count(*) from auth.project_meta    where project_id = ${projectId}) as 名字
    `)
    const 行 = rowsOf(r)[0] ?? {}
    return { 成员: Number(行.成员 ?? 0), 归档: Number(行.归档 ?? 0), 名字: Number(行.名字 ?? 0) }
  })
```

⚠️ `Minio` 的五个 env 名与 `s3.endpoint` 的用法**照抄 `openhive-project-archive.test.ts` 的 `OPEN`**——上面那份是按本计划的记忆写的，**执行前必须逐字对齐那一条**（`grep -n "MINIO" packages/opencode/test/server/openhive-project-archive.test.ts`）。

- [ ] 加用例（**这条是判据 3/4/7 三件一起**；若红一片读不出谁是谁，按 Step 5 补单起用例）：

```ts
describe("T-delete · 项目删除（spec §10 判据 3 / 4 / 7）", () => {
  it.live(
    "删完之后：清单里没了、盘上目录与 bare 仓库没了、PG 三表清了、MinIO 备份清了，**而会话还读得出来**",
    () =>
      Effect.gen(function* () {
        // ── 造一个「有文件、有会话、有成员」的真项目 ──
        const created = yield* as(PROJECT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "要删的项目", type: "private" }),
        })
        const project = yield* json(Entry, created)

        // 盘上放一个文件（`handleCreate` 已建好沙箱目录与 bare 仓库）。
        writeFileSync(path.join(projectDirOf(ALICE.id, project.id), "话单.csv"), "主叫,被叫\n138,139\n")

        // 造一条会话（走**内核一等出口**，`noReply: true` ⇒ 不触模型、不需要 provider）。
        const 建会话 = yield* as("/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-openhive-project": project.id },
          body: JSON.stringify({}),
        })
        expect(建会话.status, "造会话这条前提必须真的成立").toBe(200)
        const 会话 = yield* json(Schema.Struct({ id: Schema.String }), 建会话)

        // ⚠️ 前置条件逐条**先证明成立**（`#002-02`：先证明机制活着，再钉被测那条）——
        // 否则下面的「都没了」在一个压根没造出来的现场上也会看着绿。
        expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(true)
        expect(existsSync(bareOf(project.id))).toBe(true)
        // MinIO 备份：先跑一次归档把文件传上去，这样删除时才有备份可清（spec §7：已归档也能删）。
        const 归档 = yield* as("/openhive/project/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })
        expect(归档.status, "归档应当成功——它是「有 MinIO 备份可清」这条前提的来源").toBe(200)
        const 备份键 = s3.keys().filter((key) => key.includes(project.id))
        expect(备份键.length, "归档之后应当真的落到 MinIO 上").toBeGreaterThan(0)

        // ── 被测动作 ──
        const response = yield* as(DELETE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })

        // ① 出口自述成功（与归档 / 找回 / 改名同款的「自述一个布尔」）。
        expect(response.status).toBe(200)
        expect(
          (yield* json(Schema.Struct({ projectId: Schema.String, deleted: Schema.Boolean }), response)).deleted,
        ).toBe(true)

        // ② 判据 3：从清单消失。
        const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
        expect(listed.some((entry) => entry.id === project.id)).toBe(false)

        // ③ 判据 7：盘上目录与 bare 仓库都没了。
        expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(false)
        expect(existsSync(bareOf(project.id))).toBe(false)

        // ④ spec §6 ②：PG 三表都清空了（成员关系**全体**删掉，不只发起人）。
        expect(yield* 三表行数(project.id)).toEqual({ 成员: 0, 归档: 0, 名字: 0 })

        // ⑤ spec §6 ⑤：MinIO 备份清空（逐键删，不是整个桶）。
        expect(s3.keys().filter((key) => key.includes(project.id))).toEqual([])

        // ⑥ 判据 4（**留底**，与上面五条方向相反）：会话行仍在、且**读得出来**。
        //    这是 spec §4.3 那条实测结论（目录删掉后读会话照样通）的判据化。
        const 会话表 = yield* as("/session", {
          headers: { "x-openhive-project": project.id },
        })
        expect(会话表.status, "目录没了之后列会话应当照样通（spec §4.3）").toBe(200)
        const 会话们 = yield* json(Schema.Array(Schema.Struct({ id: Schema.String })), 会话表)
        expect(会话们.some((s) => s.id === 会话.id), "会话应当仍在——「删除 ≠ 清空一切」").toBe(true)
      }),
    60_000,
  )

  /**
   * **判据 6：可重入**（spec §6 末段）——再点一次接着清、不报错。
   *
   * ⚠️ 这条**必须独立成一条用例**：混在上面那条里，第二次调用发生在「第一次已经清干净」之后，
   * 而那时上面那条的大多数断言已经跑过了 ⇒ 变异拆掉容错时它红不红**取决于排在哪儿**
   * （`LEARNINGS #005-46`）。
   */
  it.live("再删一次 ⇒ 仍然 200（可重入），不是 500", () =>
    Effect.gen(function* () {
      const created = yield* as(PROJECT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "删两次的项目", type: "private" }),
      })
      const project = yield* json(Entry, created)

      const 第一次 = yield* as(DELETE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })
      expect(第一次.status).toBe(200)

      const 第二次 = yield* as(DELETE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })
      expect(第二次.status, "可重入：第二次应当照样 200").toBe(200)
      expect(
        (yield* json(Schema.Struct({ projectId: Schema.String, deleted: Schema.Boolean }), 第二次)).deleted,
      ).toBe(true)
    }),
    30_000,
  )

  /** **判据 5 的删除那半**：非创建人 ⇒ 403 ＋ 项目一个字没动。 */
  it.live("非创建人 ⇒ 403，且项目**原样都在**（清单里有、目录在、PG 三表没清）", () =>
    Effect.gen(function* () {
      const created = yield* as(PROJECT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "乙删不掉的", type: "private" }),
      })
      const project = yield* json(Entry, created)

      const response = yield* asWho(BOB, DELETE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })

      expect(response.status).toBe(403)
      expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)
      // 零副作用：三个面各断一句（`#004-14`：被测属性 → 副作用 → 伴随信号）。
      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.some((entry) => entry.id === project.id)).toBe(true)
      expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(true)
      expect(yield* 三表行数(project.id)).toEqual({ 成员: 1, 归档: 0, 名字: 1 })
    }),
    30_000,
  )
})
```

### Step 2: 跑它，确认红

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-delete.test.ts
```

预期：**红**，且红在 `json()` 的 `content-type` 断言上（未挂载 ⇒ SPA 兜底 200 + `text/html`）。据实记。

### Step 3: 改到绿——`archive.ts`

- [ ] 改 `PATH`（`:121`）：

```ts
export const PATH = {
  archive: `${PREFIX}/archive`,
  restore: `${PREFIX}/restore`,
  /**
   * 删除（2026-10-16）。住在**本文件**而不是 `project.ts`：删除要 `MinIO`（清备份）与
   * 成员名单读法（清成员关系），本文件的 `Deps` 已经有它们；而它**顺带**需要共享根
   * （删 `/shared/<id>.git`）——那一项由 `server.ts` 多给一行 `Layer.provide` 补上。
   */
  delete: `${PREFIX}/delete`,
} as const
```

- [ ] 改 `Deps`（`:179-185`）——**加三个字段**，已有的三行一字不动：

```ts
interface Deps {
  root: string
  /** 共享根——删 `/shared/<projectId>.git` 要用（spec §6 ④；归档**不动**它，`archive.ts:88` 是反例）。 */
  shared: string
  minio: Option.Option<MinioSettings>
  pg: OpenhivePg.Interface["pg"]
  /** 每用户库——`project_ext` 的按项目删除要它（`deleteByProjectID` 收裸 `db`）。 */
  database: Database.Interface
  /**
   * `project_directory` 的按项目删除。
   * ⚠️ 存的是**接口实例**、不是 tag：本文件的服务**全在层构造期取**（见 `routes` 上面那段注释），
   * 请求期只 `yield* deps.directories.removeAll(...)`——**不要**在处理器里写
   * `yield* ProjectDirectories.Service`（请求 fiber 的 context 里没有 app 层服务）。
   */
  directories: ProjectDirectories.Interface
}
```

- [ ] 改 `routes`（`:194-205`）：多取三个服务、加到 `deps`、加一行路由。**逐字改成下面这样**（原来的三行 `yield*` 与两行 `router.add` 都在，末尾三行是新的）：

```ts
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const minio = yield* MinioConfig
    const openhivePg = yield* OpenhivePg.Service
    // 2026-10-16 项目删除新增的三个：共享根（删 `/shared/<projectId>.git`，spec §6 ④）与
    // 每用户库的两样（`project_ext` / `project_directory` 的按项目删除，spec §6 ③⑦）。
    // ⚠️ **全在构造期取**——同本文件上面那段注释记的实测约束。
    const shared = yield* SharedRootConfig
    const database = yield* Database.Service
    const directories = yield* ProjectDirectories.Service

    const deps: Deps = {
      root: config.root,
      shared: shared.root,
      minio: minio.connection,
      pg: openhivePg.pg,
      database,
      directories,
    }

    yield* router.add("POST", PATH.archive, (request) => handleArchive(request, deps))
    yield* router.add("POST", PATH.restore, (request) => handleRestore(request, deps))
    yield* router.add("POST", PATH.delete, (request) => handleDelete(request, deps))
  }),
)
```

⚠️ 三条 import 要补/改（**照 `project.ts` 的路径**）：
- `SharedRootConfig` 加进**已有的那一行** `import { PREFIX } from "./project"` ⇒ `import { PREFIX, SharedRootConfig } from "./project"`（同模块，不新增行）；
- `import { Database } from "@opencode-ai/core/database/database"`；
- `import { ProjectDirectories } from "@opencode-ai/core/project/directories"`。

⚠️ `handleArchive` / `handleRestore` 的签名**一字不动**（`(request, deps)`），别顺手改成 `(deps)`——上面那段 `routes` 是**照现状重抄一遍**再往后加，改坏了这两处等于把归档/找回一起换形状。

- [ ] 在 `handleRestore` 之后加处理器与三个私有辅助（**`handleDelete` 的骨架照 `handleArchive` 的形状写**：同一套错误返回、同一个 `deps` 闭包、同一套「取身份 → 读名单 → 判定 → 干活 → 回体」的次序）：

```ts
/**
 * 删除一个项目（2026-10-16 spec §5「拿掉登记」＋ §6「清哪几处、顺序、可重入」）。
 *
 * ## ⛔ 禁令：**绝不删每用户库里的 `project` 行**（`ProjectTable`）
 *
 * `session.project_id` 是 `NOT NULL` ＋ `ON DELETE CASCADE`（`packages/core/src/session/sql.ts:26-29`）
 * ⇒ **删项目行 = 会话被数据库连带删掉**，与用户 2026-10-16 的裁决 2（「只删项目、聊天记录留着」）
 * 正面冲突。**留它与留底是一回事**（spec §5 路 C）。
 * 本函数**一处都不碰** `ProjectTable`——要加东西时先回来读这三行。
 *
 * ## 清什么（spec §6 的①–⑦，次序按计划裁定 R2 调整过）
 *
 * | 序 | 清什么 | 为什么在这个位置 |
 * |---|---|---|
 * | 0 | 读成员名单（`membersOf`） | **一切的前提**：成员关系一旦删掉就重建不出「哪些人的前缀要清」 |
 * | 1 | ⑤ MinIO 备份（每个成员的 `<userId>/<projectId>/`） | ⚠️ **比 spec §6 的原序提前**——原序里它排在 ① 之后，而 ① 删掉 `project_member` 之后**第二次调用建不出目标清单** ⇒ 备份成永久孤儿、**可重入当场失效**（spec §6 自己要「可重入」，原序自相矛盾） |
 * | 2 | ④ 沙箱目录 ＋ 共享 bare 仓库 | 盘上的东西，删了不影响上面两步的判据 |
 * | 3 | ⑥ 快照 / worktree 残留（按 project id 分的父目录） | 同上 |
 * | 4 | ③ `project_ext` 行 ＋ ⑦ `project_directory` 行 | 「自己的账」——摘完这两样**只是清掉我自己的局部账**：`project_member` 还在 ⇒ `handleList` 的 `joinedEntries` 仍产出影子行，项目**没有**从我的清单消失（2026-10-17 终审订正） |
 * | 5 | ① `project_member`（**全体**）＋ ② `project_archive` / `project_meta` | **最后**：这一步才是「项目从所有人的清单里消失」那一下（spec §6 ①：只删自己的会降级成影子行） |
 *
 * ⚠️ ①②③④⑤⑥⑦ 是 spec §6 的**清点编号**，不是执行序；执行序以上面「序」列为准（计划裁定 R2）。
 *
 * ## 可重入（判据 6）
 *
 * **每一处都容忍「已经不在了」**：`rm -rf` 用 `force: true`、删行用 `delete`（命中 0 行不抛错）、
 * MinIO 的 `delete` 对不存在的键照抄真 S3 回 204（`fake-s3` 文件头）。第二次点删除是**空转**，
 * 不是错误。
 *
 * ## 与归档的次序对照：这里是**先删盘、后摘账**（计划裁定 R2）
 *
 * 归档最后一步是 `markArchived`（「登记」最后写）；删除**不是**它的镜像（2026-10-17 终审订正）。
 * 执行序见上表 R2：⑤ 必须排在 ① 前面，否则第二次调用建不出成员前缀 ⇒ ⑤ 不可重入。
 * 代价：盘在 ⑤/④/⑥ 已不可逆删除，之后 ③/⑦/①/② 任一失败 ⇒ 500 而文件已没了；
 * ① 成功而 ② 失败 ⇒ 项目已从所有人清单消失、界面无入口重试（spec §11 缺口 19）。
 */
function handleDelete(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    // ── 取身份 / 解析体 / 两道守卫：与 `handleArchive` **逐条同形**（同一条 `ProjectIdBody`、
    //    同一句文案、同一条 `isSafePathSegment`）——两处口径漂了不会报错，只会让一个出口能塞
    //    `../x`、另一个不能（`#002-06`）。
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(ProjectIdBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const projectId = payload.value.projectId
    if (!User.isSafePathSegment(projectId)) return badRequest("projectId 不是合法的路径段")

    const userId = user.value.id
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    const pg = deps.pg()
    // ── 0. 读成员名单（**必须在删任何东西之前**；见上面那张表的第 0 行）──
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = ProjectMembership.actorIn(members, userId)
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    const archived = archives.get(projectId)?.archived ?? false

    // ── 判定（排在一切副作用之前；spec §7）──
    if (!ProjectMembership.decide({ actor, action: "delete", target: null, archived }))
      return forbidden("无权删除该项目")

    // 成员 id 也要当路径段用（`dropTrees` 拿它拼沙箱路径）⇒ 与请求入参同一条判据。
    // 同 `handleArchive`：失败是 **die（500）**而不是 400（是库里的数据坏了），且**先全部判完再动手**。
    for (const member of members) {
      if (!User.isSafePathSegment(member.userId)) {
        yield* Effect.die(new Error(`项目 ${projectId} 的成员 id 不是合法路径段：${JSON.stringify(member.userId)}`))
      }
    }
    const userIds = members.map((member) => member.userId)

    // ── 1. ⑤ MinIO 备份（**先于**成员关系的删除；见上面那张表）──
    yield* Effect.promise(() => dropBackups(deps, projectId, userIds))
    // ── 2. ④ 沙箱目录 ＋ bare 仓库 ──
    yield* Effect.promise(() => dropTrees(deps, projectId, userIds))
    // ── 3. ⑥ 快照 / worktree 残留 ──
    yield* Effect.promise(() => dropResidue(projectId))
    // ── 4. ③ `project_ext` ＋ ⑦ `project_directory` ──
    //    ⚠️ `deps.database.db` / `deps.directories` 都是**构造期取到的**（见 `Deps` 的注释）——
    //    这里不写 `yield* Database.Service`，也不写 `Effect.provideService`。
    yield* deleteByProjectID(deps.database.db, projectId)
    //    ⚠️ `removeAll` 的入参是**带 brand 的** `ProjectSchema.ID`（`./directories.ts` 的
    //    `RemoveAllInput`）⇒ 这里必须 `.make(...)`，不能直接把裸串塞进去。
    yield* deps.directories.removeAll({ projectID: ProjectV2.ID.make(projectId) })
    // ── 5. ① 成员关系（**全体**，不只是我这一行）＋ ② 归档标记 / 共享名字 ──
    //    这一步是「项目从所有人的清单里消失」那一下；前面的失败重试到这里都还是空转（可重入）。
    yield* Effect.promise(() => removeAllMembers(pg, { projectId }))
    yield* Effect.promise(() => removeProjectArchive(pg, { projectId }))
    yield* Effect.promise(() => removeProjectMeta(pg, { projectId }))

    return HttpServerResponse.jsonUnsafe({ projectId, deleted: true })
  })
}
```

⚠️ 四条硬约束，写完逐条自检：
1. **`handleArchive` / `handleRestore` 一字不动**——本步只**加** `handleDelete`。
2. **一处都不碰 `ProjectTable`**（每用户库的 `project` 行）——理由见上面那段禁令。
3. `ProjectV2.ID.make(projectId)` 是**必须的**（`ProjectV2.ID` 就是 `ProjectSchema.ID`，`./directories.ts` 的入参 brand 与它同源）。`ProjectV2` 已在 `project.ts` 里这么用（`ProjectV2.ID.make(id)`），`archive.ts` 要**新加** `import { ProjectV2 } from "@opencode-ai/core/project"`。
4. `removeAllMembers(pg, { projectId })` 的**入参名**是 `projectId`（不是 `projectID`）——以 Task 2 写下的签名为准；若 Task 2 落的是 `projectID`，**改这里**，别改 Task 2 已过的测试。

- [ ] 加三个私有辅助（放在 `releaseAll` 那一带，照它的形状）：

```ts
/**
 * ⑤ 清一个项目的 MinIO 备份：**逐成员前缀、逐键删**（spec §6 ⑤）。
 *
 * ⚠️ **MinIO 没配（`Option.isNone`）时直接返回**——删除**不因为 MinIO 没配而不可用**
 * （与归档 / 找回不同：那两条**没有** MinIO 就干不了活，删除没有备份照样删得掉）。
 * 若这里也回 503，「MinIO 没配的部署上项目永远删不掉」——那不是设计要的。
 *
 * 用 `list()` ＋ `delete({path})`（`Minio.Interface` 已有 delete，spec §6 末「待实施时核实」
 * 的第一条已核实），**不是**整桶清空：同一桶里还有别的项目、别的用户的键。
 */
async function dropBackups(deps: Deps, projectId: string, userIds: readonly string[]): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const settings = deps.minio.value
  for (const userId of userIds) {
    const store = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      scope: { userId, projectId },
    })
    for (const path of await store.list()) await store.delete({ path })
  }
}
```

```ts
/**
 * ④ 删盘：每个成员的沙箱项目目录 ＋ 共享 bare 仓库（spec §6 ④）。
 *
 * `rm` 用 `{ recursive: true, force: true }` —— `force` 就是**可重入**那一半
 * （目录不在 = 正常路径，不是错误）。bare 仓库同理：**私有项目没有它**，那也是正常路径。
 *
 * ⚠️ 与 `releaseAll`（归档那条链）**刻意不合并**：归档删的是**成员沙箱**、且**不碰** bare
 * （`archive.ts:88` 逐字写着）；删除两者都删。同一个函数名字下藏两种语义，正是 `#002-06` 的坑。
 */
async function dropTrees(deps: Deps, projectId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    await rm(path.join(deps.root, userId, projectId), { recursive: true, force: true })
  }
  await rm(path.join(deps.shared, `${projectId}.git`), { recursive: true, force: true })
}
```

```ts
/**
 * ⑥ 删「按项目 id 分的残留目录」（spec §6 ⑥）：快照与 worktree 两个父目录。
 *
 * 路径**逐字**取自它们的生产者：
 * - 快照：`snapshot/index.ts:71` 的 `path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))`
 *   ⇒ 按项目 id 的那一层正是 `join(Global.Path.data, "snapshot", projectId)`；
 * - worktree：`worktree/index.ts:208` 的 `pathSvc.join(Global.Path.data, "worktree", ctx.project.id)` ⇒ 同理。
 *
 * `Global.Path` 是**模块级纯值常量**（`core/src/global.ts`）⇒ 可以 import，不必走服务。
 * `force: true` 同 `dropTrees`——不在 = 正常路径。
 */
async function dropResidue(projectId: string): Promise<void> {
  for (const 源 of ["snapshot", "worktree"]) {
    await rm(path.join(Global.Path.data, 源, projectId), { recursive: true, force: true })
  }
}
```

- [ ] 补 import（`archive.ts` 顶部）。**逐条给准**（本计划写作时已在本仓核实过路径）：

| 要加的东西 | 写成 | 落在哪一行 |
|---|---|---|
| `ProjectDirectories` | `import { ProjectDirectories } from "@opencode-ai/core/project/directories"` | 新行（挨着 `@opencode-ai/core/project/membership` 那行） |
| `deleteByProjectID` | `import { deleteByProjectID } from "@opencode-ai/core/project/ext"` | 新行 |
| `ProjectV2` | `import { ProjectV2 } from "@opencode-ai/core/project"` | 新行 |
| `Database` | `import { Database } from "@opencode-ai/core/database/database"` | 新行 |
| `Global` | `import { Global } from "@opencode-ai/core/global"` | 新行 |
| `removeAllMembers` / `removeProjectArchive` / `removeProjectMeta` | 加进**已有的那行** `import { archiveStatesOf, markArchived, markRestored, membersOf } from "@opencode-ai/auth/project-member"`（按字母序插进花括号里） | 改 `:101` |
| `SharedRootConfig` | 加进已有的 `import { PREFIX } from "./project"` ⇒ `import { PREFIX, SharedRootConfig } from "./project"` | 改 `:115` |

**不用加的**：`rm` / `mkdir` / `readFile` / `writeFile` / `readdir` 在 `node:fs/promises` 那行**已有**（`:111`）；`join` / `dirname` 在 `node:path` 那行已有（`:112`）；`Minio` / `endpointOf` / `Option` / `Schema` / `Effect` / `User` / `HttpServerRequest` / `HttpServerResponse` 都已有。
⚠️ 加完 `grep -n "^import" packages/opencode/src/server/openhive/archive.ts` 看一遍：**不许有重复的 import 行**（同模块两行 import 编译得过但下次合并会打架）。

### Step 4: 改到绿——`server.ts` 那一行 `Layer.provide`

- [ ] 改 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 的 `OpenhiveArchive.routes.pipe(...)` 块（`:339-348`），加**一行**：

```ts
      OpenhiveArchive.routes.pipe(
        Layer.provide(OpenhiveArchive.MinioConfig.layer),
        Layer.provide(AnchorWorkspace.Config.layer),
        Layer.provide(OpenhivePg.layer),
        // 2026-10-16：删除出口要共享根（删 `/shared/<projectId>.git`，spec §6 ④）——
        // 归档 / 找回**都不需要它**，所以这一行是本 feature 加的。少它 ⇒ 层构造期报缺依赖。
        Layer.provide(OpenhiveProject.SharedRootConfig.layer),
      ),
```

⚠️ **只加这一行**，别动同块里已有的三行。

### Step 5: 跑它，确认绿

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-delete.test.ts
```

预期：**全绿**（3 条）。

⚠️ 若第一条里的**会话**那两段红了：先分清是**造会话**红还是**读会话**红——「造」用的是内核一等出口，注解见 `LEARNINGS #006-35`（`noReply: true` 不触模型）；「读」是 spec §4.3 的判据化。**别把它们合并成一条断言**。

### Step 6: 变异验证（spec §10 点名的两条都在这儿）

- [ ] 备份：`cp packages/opencode/src/server/openhive/archive.ts /tmp/archive.ts.bak`

- [ ] **变异 A（spec §10 点名）：拆掉「删成员关系」那一步**（把 `removeAllMembers(...)` 那一行删掉）。跑测试。
  预期：**红**——判据 3（从清单消失）与判据 4 那条（`三表行数` 的「成员: 0」）都会红。据实记**具体红在哪一句**：`listed.some(...)` 是 `false !== true` 还是 `三表行数` 先红（`LEARNINGS #005-46`：一条用例里排了多条断言时，变异只会把红停在它最先撞倒的那一句）。
  ⚠️ spec §10 逐字点名了这条变异「不红 ⇒ 那条用例是空转」——**红不了就先修用例**。

- [ ] **变异 B（spec §10 点名）：拆掉「可重入」的容错。** 把 `dropTrees` 的 `rm` 改成 **不带 `force`**（`{ recursive: true }`），跑测试。
  预期：**红**——「再删一次」那条（第二次调用时目录已经不在 ⇒ `rm` 抛 ENOENT ⇒ 500）。
  ⚠️ **若它不红**：说明第二次调用**压根没走到 `rm`**（比如判定那一步先挡住了）。据实记，并检查 `decide` 在「项目已删」时的行为——那是一个**真缺口**（删完之后再点，判定读不到成员 ⇒ `actor = null` ⇒ 403 而不是 200）。
  **这一条要特别当心**：它可能不是「用例没牙」，而是**产品真的不可重入**。若如此，处置是**明确的**：把「删除在无成员关系时仍对 owner 放行」写进 `decide` 或 `handleDelete`（并在 spec 的缺口表登记这次裁定），而不是把用例改软。

- [ ] 还原：`cp /tmp/archive.ts.bak packages/opencode/src/server/openhive/archive.ts`

- [ ] **变异 C：拆掉「删 MinIO 备份」那一步。** 预期：红在 `s3.keys().filter(...)` 那条（备份还在）。
- [ ] **变异 D：把 `dropResidue` 的两个目录名从 `["snapshot", "worktree"]` 改成 `["snapshot"]`。**
  预期：**全绿**（没有用例造过 worktree 残留 ⇒ 这一半**没有守护者**）。
  ⇒ **据实记**进缺口表（`#002-02`：没测到的写成缺口，不是写成没问题），并写清理由（构造一个 worktree 残留要真跑一次 worktree 流程，成本与本 feature 不成比例）。

- [ ] 还原并确认 `diff` 无输出。

### Step 7: ⑥ 步——grep 全部同类落点

```bash
cd /d/project/study/openhive/openhive && grep -rn "rm(\|rmSync\|unlinkSync\|ldel" packages/opencode/src/server/openhive/ packages/core/src/project/
```

列出**每一个删目录的落点**，逐个判定：它是「归档那条链的」（`releaseAll`）、「文件操作的」（`file.ts` 一族）、还是「删除那条链的」（本次三个辅助）。写下一步表结论。

```bash
cd /d/project/study/openhive/openhive && grep -rn "Global.Path\" packages/opencode/src | head -20
```

确认 `Global.Path` 的 import 路径与「它是纯值」这条前提（若发现它其实是服务，`dropResidue` 要改成 `yield*` 取）。

```bash
cd /d/project/study/openhive/openhive && grep -rn "ProjectTable" packages/opencode/src/server/openhive/
```

预期：**0 行**——这就是那条禁令的**可执行判据**（spec §5：删除绝不能删 `ProjectTable` 行）。把这条命令与它的输出写进 `handleDelete` 的注释里，让下一个想在这里加 `delete(ProjectTable)` 的人先撞上它。

### Step 8: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/opencode/src/server/openhive/archive.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/test/server/openhive-project-delete.test.ts
```

- [ ] 跑受影响的既有路由测试：

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-project-archive.test.ts test/server/openhive-project-restore.test.ts test/server/openhive-project-archive-unconfigured.test.ts
```

预期：**全绿**（那一行 `Layer.provide` 加得不对时，这三条会先炸）。

### Step 9: 提交

```bash
cat > /tmp/task5.txt <<'EOF'
feat(opencode): 新增内核删除出口 POST /openhive/project/delete

按 spec §5「拿掉登记」＋ §6「清哪几处 / 顺序 / 可重入」：

- ⛔ 禁令写死在注释里：**绝不删每用户库的 ProjectTable 行**——session.project_id 是
  NOT NULL + ON DELETE CASCADE ⇒ 删它 = 会话被连带删掉，与「聊天记录留底」正面冲突。
  注释里附一条可执行判据：grep ProjectTable 在 server/openhive/ 下应当是 0 行。
- 次序取 spec §6 的①–⑦，但把 ⑤ MinIO **提到最前**：原序里 ① 先删 project_member ⇒
  第二次调用建不出「哪些人的前缀要清」⇒ 备份成永久孤儿、**可重入当场失效**。
  新序：读名单 → ⑤ MinIO → ④ 沙箱+bare → ⑥ 残留 → ③ext + ⑦directory → ①member + ②archive/meta。
- 每一处都容忍「已经不在了」（rm force / delete 命中 0 行不抛错 / MinIO delete 幂等）⇒ 可重入。
- MinIO **没配时直接返回**：删除不因为没配 MinIO 而不可用（与归档 / 找回不同）。
- 判定（decide，delete 只认 owner，已归档也放行）排在一切副作用之前。
- server.ts 的 OpenhiveArchive 那块加一行 Layer.provide(SharedRootConfig.layer)——
  删除要共享根去删 /shared/<id>.git，归档/找回都不需要它。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/opencode/src/server/openhive/archive.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/test/server/openhive-project-delete.test.ts && git commit -F /tmp/task5.txt
```

---

## Task 6: 前端薄客户端（`projectAction` 泛化成四动作共用件）

对应 R7 ＋ spec §9 第四行。

**Files:**
- Modify: `packages/app/src/project/openhive-project.ts`（`PATH` `:44-50`；`projectAction` `:99-129`；`archiveProject` / `restoreProject` `:131-160`）
- Modify: `packages/app/src/project/openhive-project.test.ts`（加两组）
- Modify: `packages/app/src/project/project-data.ts`（接口 `:55` 加两条、`PROJECT_DATA` `:135-153` 加两条）
- Modify: `packages/app/src/project/project-data.test.ts`（加两条）

**Interfaces:**
- Consumes: `trySend` / `isSessionExpired` / `readJson` / `isRecord` / `messageOf`（本文件已有的私有辅助）、`renameProject` / `deleteProject` 的出口路径
- Produces:
  - `renameProject(projectId: string, name: string, send?: ForkFetch): Promise<ProjectActionOutcome>`
  - `deleteProject(projectId: string, send?: ForkFetch): Promise<ProjectActionOutcome>`
  - `ProjectData.rename(projectId: string, name: string): Promise<ProjectActionOutcome>`
  - `ProjectData.deleteProject(projectId: string): Promise<ProjectActionOutcome>`

### Step 1: 先写会红的用例

- [ ] 在 `packages/app/src/project/openhive-project.test.ts` 末尾追加（`stub` / `json` / `html` 是本文件已有辅助）：

```ts
describe("renameProject（2026-10-16：项目改名）", () => {
  test("发的是 POST /openhive/project/rename，体里带 projectId 与 name", async () => {
    const { send, sent } = stub(json({ projectId: "p1", name: "新名字", renamed: true }))

    const 结论 = await renameProject("p1", "新名字", send)

    expect(结论).toEqual({ kind: "done" })
    expect(sent[0]?.path).toBe("/openhive/project/rename")
    expect(sent[0]?.method).toBe("POST")
    expect(sent[0]?.credentials).toBe("same-origin")
    expect(sent[0]?.contentType).toBe("application/json")
    expect(sent[0]?.body).toEqual({ projectId: "p1", name: "新名字" })
  })

  /**
   * ⚠️ **响应体里的状态字段是判据的一部分**：这条链要的是「服务端**自述**改名成功」。
   * 一个只回 200 而体里 `renamed` 是 `false` / 压根没有这个字段的实现，
   * 在这里必须红——否则「静默没改名」会被当成功（同族 `archive` 那条的 `archived` 判据）。
   */
  test("200 但体里没有自述成功 ⇒ failed（不是 done）", async () => {
    const { send } = stub(json({ projectId: "p1", name: "新名字" }))
    expect(await renameProject("p1", "新名字", send)).toEqual({ kind: "failed", message: "重命名项目失败" })
  })

  test("400 ⇒ rejected，并把服务端那句话原样带出来", async () => {
    const { send } = stub(json({ error: "项目名不能为空" }, 400))
    expect(await renameProject("p1", " ", send)).toEqual({ kind: "rejected", message: "项目名不能为空" })
  })

  test("403 ⇒ rejected（无权改这个项目）", async () => {
    const { send } = stub(json({ error: "无权重命名该项目" }, 403))
    expect(await renameProject("p1", "新名字", send)).toEqual({ kind: "rejected", message: "无权重命名该项目" })
  })

  test("未挂载（200 + text/html）⇒ failed，**不是** done", async () => {
    const { send } = stub(html())
    expect(await renameProject("p1", "新名字", send)).toEqual({ kind: "failed", message: "重命名项目失败" })
  })
})

describe("deleteProject（2026-10-16：项目删除）", () => {
  test("发的是 POST /openhive/project/delete，体里只有 projectId", async () => {
    const { send, sent } = stub(json({ projectId: "p1", deleted: true }))

    const 结论 = await deleteProject("p1", send)

    expect(结论).toEqual({ kind: "done" })
    expect(sent[0]?.path).toBe("/openhive/project/delete")
    expect(sent[0]?.method).toBe("POST")
    expect(sent[0]?.credentials).toBe("same-origin")
    expect(sent[0]?.body).toEqual({ projectId: "p1" })
  })

  test("200 但体里没有自述成功 ⇒ failed", async () => {
    const { send } = stub(json({ projectId: "p1" }))
    expect(await deleteProject("p1", send)).toEqual({ kind: "failed", message: "删除项目失败" })
  })

  /**
   * ⚠️ **`deleted: false` 也必须红**——不能只断「字段在不在」。
   *
   * 这条与上面那条是**两条**判据：上面钉「字段缺席」，这条钉「字段存在但值是 false」。
   * 只写一条时，另一个形状会从缝里过去（`LEARNINGS #005-47`：期望值恰好等于下游默认值时，
   * 那条断言从来没被代码满足过）。
   */
  test("200 但 deleted 是 false ⇒ failed", async () => {
    const { send } = stub(json({ projectId: "p1", deleted: false }))
    expect(await deleteProject("p1", send)).toEqual({ kind: "failed", message: "删除项目失败" })
  })

  test("403 ⇒ rejected（无权删这个项目）", async () => {
    const { send } = stub(json({ error: "无权删除该项目" }, 403))
    expect(await deleteProject("p1", send)).toEqual({ kind: "rejected", message: "无权删除该项目" })
  })
})
```

- [ ] 补 import：文件顶部从 `./openhive-project` 那一行加 `renameProject`、`deleteProject`。

### Step 2: 跑它，确认红

```bash
cd /d/project/study/openhive/openhive/packages/app && bun test --conditions=solid --preload ./happydom.ts src/project/openhive-project.test.ts
```

预期：**红**，两个新 describe 里的每一条都红在 `is not a function`。据实记。

### Step 3: 改到绿——`openhive-project.ts`

- [ ] 改 `PATH`（`:44-50`）加两项：

```ts
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  archive: `${PREFIX}/archive`,
  restore: `${PREFIX}/restore`,
  touch: `${PREFIX}/touch`,
  /** 改名（2026-10-16）。 */
  rename: `${PREFIX}/rename`,
  /** 删除（2026-10-16）。 */
  delete: `${PREFIX}/delete`,
} as const
```

- [ ] 把 `projectAction`（`:99-129`）整段替换成泛化版（**逐字保留原有的失败分类次序与注释**，只把「哪个字段叫什么、应当等于什么」抽出来）：

```ts
/**
 * 一个项目级动作的**形状**——四个动作（归档 / 找回 / 改名 / 删除）共用这一张表。
 *
 * ⚠️ 之所以抽成表而不是写四个函数：四条的**请求形状、失败分类、成功判据逐字同形**
 * （都是 `POST` ＋ `{projectId, …}` ＋ 一个布尔自述），差别只有三个字符串
 * （路径、那个字段叫什么、应当等于什么）。写成四份就是 `LEARNINGS #002-06` 那句话本身。
 *
 * `stateKey` / `stateValue` 让「服务端**自述**这个动作成了」这条判据在四个动作上**同形**——
 * 少了它，一个「只回 200、什么都没干」的实现会在四个动作里全绿。
 */
interface ActionShape {
  readonly path: string
  /** 响应体里那个「自述成功」的字段名（`archived` / `renamed` / `deleted`）。 */
  readonly stateKey: "archived" | "renamed" | "deleted"
  /** 那个字段**应当**等于什么——四个动作今天都是 `true`（归档也自述 `archived: true`）。 */
  readonly stateValue: boolean
  /** 失败（网络 / 非 2xx 且不是 400·403 / 体不成形 / 自述为假）时显示的那句话。 */
  readonly failed: string
  /** 请求体里除 `projectId` 之外还要带的字段（改名要 `name`；其余两个没有）。 */
  readonly extra?: Readonly<Record<string, string>>
}

async function projectAction(shape: ActionShape, projectId: string, send: ForkFetch): Promise<ProjectActionOutcome> {
  const response = await trySend(send, shape.path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...shape.extra }),
  })
  // 发不出去（网络层）——不是「服务端说你不行」，是「我们这边没问到」。
  if (!response) return { kind: "failed", message: shape.failed }
  // 会话过期：与 400 / 403 分开——它要的是「重新登录」，不是「你填得不对」。
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }
  // 400 / 403 是**服务端有话要说**（规则挡下了）：把它的原话带出去，不自己改写措辞
  // ——前端不知道是哪一条规则挡下的（同 T018 的 400 那条）。
  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    return { kind: "rejected", message: messageOf(body) ?? shape.failed }
  }
  if (!response.ok) return { kind: "failed", message: shape.failed }
  const body = await readJson(response)
  // 体不成形 / 字段缺席 / 字段是假 ⇒ **一律 failed**。响应 200 不等于这件事办成了：
  // 「未挂载」在本应用里落进 SPA 兜底、回 200 + text/html（本文件头的表），
  // 那时 `readJson` 给 `undefined` ⇒ 这一句就是拦它的地方。
  if (!isRecord(body) || body[shape.stateKey] !== shape.stateValue) return { kind: "failed", message: shape.failed }
  return { kind: "done" }
}
```

- [ ] 把 `archiveProject` / `restoreProject` 换成调用新形状，并加两个新的：

```ts
/** 归档一个项目（FR-008）。**判据在 `projectAction`**：服务端自述 `archived: true` 才算成。 */
export async function archiveProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.archive, stateKey: "archived", stateValue: true, failed: ARCHIVE_FAILED }, projectId, send)
}

/** 找回一个已归档的项目（FR-009）。服务端自述 `archived: false` 才算成。 */
export async function restoreProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.restore, stateKey: "archived", stateValue: false, failed: RESTORE_FAILED }, projectId, send)
}

/**
 * 改一个项目的名字（2026-10-16）。服务端自述 `renamed: true` 才算成。
 *
 * ⚠️ `name` **不在这里 trim**：判据在**调用方**（`就地改名输入` 的 `改名草稿`）——它同时管
 * 「空草稿不算改」「没改不算改」两件事，在这里再判一遍就是两处各写一份（`LEARNINGS #002-06`）。
 * 服务端**仍会**再 trim 一次并判空（`handleRename`），那是**服务端自己的**守卫，不是这条的重复。
 */
export async function renameProject(
  projectId: string,
  name: string,
  send: ForkFetch = defaultSend,
): Promise<ProjectActionOutcome> {
  return projectAction(
    { path: PATH.rename, stateKey: "renamed", stateValue: true, failed: RENAME_FAILED, extra: { name } },
    projectId,
    send,
  )
}

/**
 * 删一个项目（2026-10-16）。服务端自述 `deleted: true` 才算成。
 *
 * ⚠️ **不可恢复**（spec §1 裁决 1）——确认框那一层在面板上，这层只管发请求。
 */
export async function deleteProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.delete, stateKey: "deleted", stateValue: true, failed: DELETE_FAILED }, projectId, send)
}
```

- [ ] 在 `ARCHIVE_FAILED` / `RESTORE_FAILED` 那两行**之后**加两行：

```ts
const RENAME_FAILED = "重命名项目失败"
const DELETE_FAILED = "删除项目失败"
```

### Step 4: 跑它，确认绿

```bash
cd /d/project/study/openhive/openhive/packages/app && bun test --conditions=solid --preload ./happydom.ts src/project/openhive-project.test.ts
```

预期：**全绿**（原有 + 新 10 条）。

### Step 5: 先写会红的用例（`project-data.test.ts`）＋ 改到绿（`project-data.ts`）

⚠️ **本步骤内按 TDD 次序做四步，一件都不许省**：
① 先**只**加本步骤末尾那段用例（标着「① 先写用例」的那一项）⇒ 跑出**红**；
② 再落 `project-data.ts` 的三处改动（标着「②」的那三项，就在上面）；
③ 再跑一次 ⇒ **绿**；
④ 记下两次的实得输出。

⚠️ **三处带「②」的改动物理位置在本步骤靠前、① 的用例在靠后**——**别按行号顺序读**，按 ① ② ③ 的编号做。**别先落实现再补测试**：那样这条用例从写下那天起就没红过（`LEARNINGS #005-49` 的取向：RED 只证明「用例写下来了」，所以要真看到它红）。

- [ ] **② 落实现（第一处）**：在 `ProjectData` 接口的 `restore` 那一行**之后**加两条：

```ts
  /**
   * 改一个项目的名字（2026-10-16）。**两处名字一起改**是服务端的事（本层只管转发）——
   * 但「两处」这件事在这里值得留一句话：接错了（只发一次请求）不报错、不变红，
   * 而后果是「我改了，同事看到的还是旧的」。
   */
  rename(projectId: string, name: string): Promise<ProjectActionOutcome>
  /**
   * 删一个项目（2026-10-16）。**不可恢复**。
   *
   * ⚠️ 名字带 `Project` 后缀：同一个接口上 `remove` 已经是**移除一位成员**了
   * （`remove(projectId, policeNo)`），两个 `remove` 并排摆着是下一个人接错线的现成入口
   * （同 `createEntry` 那条注释的道理）。
   */
  deleteProject(projectId: string): Promise<ProjectActionOutcome>
```

- [ ] **② 落实现（第二处）**：在 `PROJECT_DATA` 里 `restore` 那一行**之后**加两条实现：

```ts
  rename: (projectId, name) => renameProject(projectId, name),
  deleteProject: (projectId) => deleteProject(projectId),
```

- [ ] **② 落实现（第三处）**：改 import 那一行（`:33`），加上 `renameProject`、`deleteProject`。

- [ ] **① 先写用例**：在 `packages/app/src/project/project-data.test.ts` 末尾追加：

```ts
describe("项目级两件新接线（2026-10-16：改名 / 删除）", () => {
  test("rename 打到 /openhive/project/rename，体里带 projectId 与 name", async () => {
    const 发出 = 假服务({
      "/openhive/project/rename": { projectId: "p1", name: "新名字", renamed: true },
    })

    const 结论 = await PROJECT_DATA.rename("p1", "新名字")

    expect(结论).toEqual({ kind: "done" })
    expect(发出[0]?.url).toBe("/openhive/project/rename")
    expect(发出[0]?.method).toBe("POST")
    expect(JSON.parse(String(发出[0]?.体))).toEqual({ projectId: "p1", name: "新名字" })
  })

  test("deleteProject 打到 /openhive/project/delete，体里只有 projectId", async () => {
    const 发出 = 假服务({
      "/openhive/project/delete": { projectId: "p1", deleted: true },
    })

    const 结论 = await PROJECT_DATA.deleteProject("p1")

    expect(结论).toEqual({ kind: "done" })
    expect(发出[0]?.url).toBe("/openhive/project/delete")
    expect(发出[0]?.method).toBe("POST")
    expect(JSON.parse(String(发出[0]?.体))).toEqual({ projectId: "p1" })
  })

  /**
   * ⚠️ **两条动作互相接反**是这一层唯一的失效方式（文件头那段）：`rename` 与 `deleteProject`
   * 的签名差一个 `name`、路径差一个词，接反了类型上完全合法。上面两条各断路径就是为这件事。
   * 这里再补一条**交叉**断言：同一个项目的两个动作，路径**必须不同**。
   */
  test("改名与删除打的是**两个不同**的路径（接反了不报错，只有这条在）", async () => {
    const 改 = 假服务({ "/openhive/project/rename": { projectId: "p1", name: "新名字", renamed: true } })
    await PROJECT_DATA.rename("p1", "新名字")
    const 删 = 假服务({ "/openhive/project/delete": { projectId: "p1", deleted: true } })
    await PROJECT_DATA.deleteProject("p1")

    expect(改[0]?.url).not.toBe(删[0]?.url)
  })
})
```

- [ ] **① 先跑它，确认红**（此刻 `ProjectData` 接口与实现**都还没落** ⇒ 类型报错 ＋ 运行期 `PROJECT_DATA.rename is not a function`）：

```bash
cd /d/project/study/openhive/openhive/packages/app && bun test --conditions=solid --preload ./happydom.ts src/project/project-data.test.ts
```

**据实记红成什么样**（`LEARNINGS #005-49`：报「N 条红」时要同时说清**这几条是因为什么红的**——`not defined` / `is not a function` 型的红只证明「用例写下来了」，**不证明它有牙**；有牙要等 ③ 绿之后的变异来证）。

- [ ] **③ 落完三处实现之后，再跑同一条命令 ⇒ 确认全绿。** 记下实得 `N pass`（这条测试文件本来就有用例，数目要一起报）。

### Step 6: 变异验证

- [ ] 备份：`cp packages/app/src/project/openhive-project.ts /tmp/openhive-project.ts.bak`
          `cp packages/app/src/project/project-data.ts /tmp/project-data.ts.bak`

- [ ] **变异 A：把 `deleteProject` 的 `stateKey` 改成 `"archived"`。**
  预期：**红 1 条**（`deleteProject` 那条「发的是 POST …」里的 `结论` 断言 — 体里没有 `archived` ⇒ failed）。据实记。
- [ ] 还原 openhive-project.ts。

- [ ] **变异 B：把 `renameProject` 的 `extra` 拆掉**（去掉 `extra: { name }`）。
  预期：**红**——`renameProject` 那条「体里带 projectId 与 name」。
- [ ] 还原 openhive-project.ts。

- [ ] **变异 C：把 `PROJECT_DATA.rename` 接到 `deleteProject` 上**（`rename: (projectId, name) => deleteProject(projectId)`）。
  预期：**红**——`project-data.test.ts` 里 `rename` 那条（路径不对，假服务回 404 ⇒ failed）。
  ⚠️ 这条红的形状是「**failed 而不是 done**」——**不是**「路径不匹配」型。据实记，因为这条正是「接错线不报错」的现场。
- [ ] 还原 project-data.ts，确认 `diff` 两个备份都无输出。

### Step 7: ⑥ 步——grep 同类落点

```bash
cd /d/project/study/openhive/openhive && grep -rn "projectAction\|PATH.archive\|PATH.restore\|PATH.rename\|PATH.delete" packages/app/src
```

逐个判定：`projectAction` 的调用点应当**恰好四**处（archive / restore / rename / delete），全在本文件内。若发现外部有 import 它（它没导出），或第五个落点，登记。

```bash
cd /d/project/study/openhive/openhive && grep -rn "PROJECT_DATA\b" packages/app/src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

确认 `PROJECT_DATA` 的消费者是 `layout-new.tsx`（**不改**，spec §9 明写）。写下一步结论。

### Step 8: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/app/src/project/openhive-project.ts packages/app/src/project/openhive-project.test.ts packages/app/src/project/project-data.ts packages/app/src/project/project-data.test.ts
```

- [ ] 跑 app 的 unit 套件（这两个文件在 `test:unit` 里）：

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:unit
```

预期：全绿，≥ 基线。

### Step 9: 提交

```bash
cat > /tmp/task6.txt <<'EOF'
feat(app): 项目客户端加 rename / deleteProject，projectAction 泛化成四动作共用件

- projectAction 的 expected: boolean 泛化成 ActionShape（path / stateKey / stateValue / failed
  / 可选 extra）：四个动作（归档 / 找回 / 改名 / 删除）的请求形状、失败分类、成功判据
  **逐字同形**，差别只有三个字符串。四条响应体一律自述一个布尔（archived / renamed / deleted）
  ——少了这条判据，一个「只回 200、什么都没干」的实现会在四个动作里全绿。
- renameProject / deleteProject 两个客户端函数（同族 archiveProject 的形状）。
- ProjectData 接口加 rename / deleteProject，PROJECT_DATA 补实现。
  两个名字刻意带上对象（deleteProject 而不是 delete），因为同一接口上 remove 已经是移除成员了。
- 补三条「接错线不报错」的判据：路径各断一条，再加一条交叉断言（两个动作路径必须不同）。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/app/src/project/openhive-project.ts packages/app/src/project/openhive-project.test.ts packages/app/src/project/project-data.ts packages/app/src/project/project-data.test.ts && git commit -F /tmp/task6.txt
```

---

## Task 7: 面板 UI——行内 ⋯ 菜单 ＋ 就地改名 ＋ 删除确认

对应 spec §3/§8 ＋ §10 判据 8/9/10。

**Files:**
- Modify: `packages/app/src/project/project-action-dialog.tsx`（`ProjectActionKind` `:59`、`文案` `:76-92`）
- Modify: `packages/app/src/project/project-panel.tsx`（`canArchive` 那一带 `:244-270` 加两个判定；`活跃行` `:481-537`；`归档行` `:545-590`；`Group` `:593-620`；`问动作` `:741-749`；`ProjectPanelProps` `:164-230`）
- Modify: `packages/app/src/project/project-panel.test.tsx`（加两组）

**Interfaces:**
- Consumes: `就地改名输入` / `改名草稿`（`@/components/inline-rename-input`，**一个字不改**）、`DropdownMenu`（`@opencode-ai/ui/dropdown-menu`，同 `file-tree.tsx`）、`ProjectMembership.decide`
- Produces:
  - `ProjectActionKind = "archive" | "restore" | "delete"`
  - `ProjectPanelProps.onRename?: (project: ProjectEntry, name: string) => string | undefined | Promise<string | undefined> | void`
  - `ProjectPanelProps.onDelete?: ProjectActionCallback`
  - DOM 记号：行内 `⋯` 触发器 `[data-project-action='menu']`；菜单项 `[data-project-action='rename']` / `[data-project-action='delete']`；就地改名输入 `[data-slot='project-rename-input']`；删除确认弹窗复用 `[data-slot='project-action-dialog']` 那一套

### Step 1: 先写会红的用例

- [ ] 在 `packages/app/src/project/project-panel.test.tsx` 末尾追加两组。**辅助照本文件已有的**（`挂` / `点` / `槽` / `弹窗` / `点弹窗确认` / `等一拍` / `等到`）。**菜单的开关要派真实指针序列**（`LEARNINGS #006-37`：Kobalte 的菜单项在 `pointerup` 选中，`.click()` 那条链不含 `onSelect`），配方照 `file-tree.test.tsx` 的 `点加号` / `点菜单项`：

```ts
/**
 * 点一颗钮，派**真实的指针序列**——`pointerdown` 开菜单、`pointerup` 选中项。
 *
 * ⚠️ 不能用 `.click()`：Kobalte 的菜单项选择发生在 **`pointerup`**（`menu-item-base`：
 * `e.button === 0` 且未 disabled ⇒ `onSelect()`），而 `.click()` 派的那条链**不含**它
 * ⇒ 点菜单项**什么都不发生**、而用例**不报错**（`LEARNINGS #006-37`）。
 * 先例：`file-tree.test.tsx` 的 `点加号` / `点菜单项`。
 */
const 指 = (el: HTMLElement | null | undefined) => {
  if (!el) throw new Error("指针目标不在——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/** 某一行上那颗「⋯」（菜单触发器）。菜单 Portal 到 `document.body` ⇒ 内容要查 `document`。 */
const 行菜单钮 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-item-name']")?.textContent?.trim() === 名)
    ?.querySelector<HTMLElement>("[data-project-action='menu']")

/** 菜单里某一项（**Portal 到 body**，不在 host 里）。 */
const 菜单项 = (action: string) => document.body.querySelector<HTMLElement>(`[data-project-action='${action}']`)

/** 某一行上那个就地改名输入框（编辑态才有）。 */
const 改名框 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-rename-input']") !== null)
    ?.querySelector<HTMLInputElement>("[data-slot='project-rename-input']")

/** 往输入框里打字：Solid 的 `onInput` 读 `event.currentTarget.value` ⇒ 先落值再派事件。 */
const 打字 = (el: HTMLInputElement, 值: string) => {
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}
```

```ts
describe("项目行 ⋯ 菜单（spec §8 / §10 判据 8）", () => {
  const 项目 = (over: Partial<ProjectEntry> = {}): ProjectEntry => ({
    id: "p1",
    name: "8·17专案",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
    ...over,
  })

  test("接了 onRename / onDelete ⇒ 那一行有 ⋯；菜单里两项：改名、删除", async () => {
    const host = 挂(() => <ProjectPanel projects={[项目()]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()

    expect(菜单项("rename")?.textContent?.trim()).toBe("改名")
    expect(菜单项("delete")?.textContent?.trim()).toBe("删除")
  })

  /**
   * **未接线 ⇒ 不画**（本文件那条既有的约定：不给回调 ⇒ 那个动作不长出来）。
   * 只钉「接了就有」会漏掉这一半——一个「总是画」的实现照样绿，而它给民警的是
   * 两颗点了没反应的钮（本文件 `问归档` 那段注释逐字记着这条的理由）。
   */
  test("一个回调都不接 ⇒ 那一行**没有** ⋯", () => {
    const host = 挂(() => <ProjectPanel projects={[项目()]} />)
    expect(行菜单钮(host, "8·17专案") === undefined).toBe(true)
  })

  /**
   * **归档态下只有删除、没有改名**（`decide` 的归档分支：只对 owner 的 restore 与 delete 开口）。
   * 这条同时是「面板不重写规则、只把事实交给 `decide`」的判据。
   */
  test("已归档的行：⋯ 里只有删除（改名在归档态下被拒）", async () => {
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目({ archived: true })]}
        onRename={() => {}}
        onDelete={() => {}}
        onRestore={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()

    expect(菜单项("rename") === null).toBe(true)
    expect(菜单项("delete")?.textContent?.trim()).toBe("删除")
  })

  /**
   * **member 看到的是「能不能」而不是「点了会怎样」**：非 owner 的 ⋯ 一项都不该有
   * （spec §7：改名与删除都只有创建人能做）。
   */
  test("角色是 member ⇒ 那一行**没有** ⋯（两个动作都不是他能做的）", () => {
    const host = 挂(() => (
      <ProjectPanel projects={[项目({ role: "member" })]} onRename={() => {}} onDelete={() => {}} />
    ))
    expect(行菜单钮(host, "8·17专案") === undefined).toBe(true)
  })
})

describe("就地改名（spec §8 / §10 判据 9）", () => {
  const 项目: ProjectEntry = {
    id: "p1",
    name: "8·17专案",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
  }

  test("点「改名」⇒ 那一行的名字那格变输入框，**预填着原名**", async () => {
    const host = 挂(() => <ProjectPanel projects={[项目]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()
    指(菜单项("rename"))
    await 等一拍()

    expect(改名框(host, "8·17专案")?.value).toBe("8·17专案")
  })

  test("回车 ⇒ `onRename` 收到**那一行**的项目与 trim 后的新名字", async () => {
    const 收到: Array<[string, string]> = []
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(p, name) => {
          收到.push([p.id, name])
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()
    指(菜单项("rename"))
    await 等一拍()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "  8·17专案（改）  ")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(收到).toEqual([["p1", "8·17专案（改）"]])
  })

  /**
   * **Esc 与空草稿都不提交**（判据 9 的后半句）——两条**分开**写：它们走的是同一条
   * `on取消`，但**理由不同**（一个是用户反悔、一个是「清空名字不是一次改名」），
   * 合成一条时只会在改一处时漏掉另一处（`LEARNINGS #005-12`：同一个修法落在 N 个入口就写 N 条）。
   */
  test("Esc ⇒ 一个回调都不喊，那一行退回展示态", async () => {
    const 收到: unknown[] = []
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(...args) => {
          收到.push(args)
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()
    指(菜单项("rename"))
    await 等一拍()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "改到一半")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await 等一拍()

    expect(收到).toEqual([])
    expect(改名框(host, "8·17专案") === undefined).toBe(true)
  })

  test("空草稿回车 ⇒ 不提交（清空名字不是一次改名），那一行退回展示态", async () => {
    const 收到: unknown[] = []
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={(...args) => {
          收到.push(args)
        }}
        onDelete={() => {}}
      />
    ))

    指(行菜单钮(host, "8·17专案"))
    await 等一拍()
    指(菜单项("rename"))
    await 等一拍()
    const 框 = 改名框(host, "8·17专案")
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "   ")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await 等一拍()

    expect(收到).toEqual([])
    expect(改名框(host, "8·17专案") === undefined).toBe(true)
  })
})

describe("删除确认（spec §8 / §10 判据 10）", () => {
  const 项目: ProjectEntry = {
    id: "p1",
    name: "甲项目",
    type: "private",
    lastAccessedAt: 1_759_600_000_000,
    role: "owner",
  }

  test("点「删除」⇒ 开确认框，措辞是 spec §8 那两句（**不提聊天记录**）", async () => {
    const host = 挂(() => <ProjectPanel projects={[项目]} onRename={() => {}} onDelete={() => {}} />)

    指(行菜单钮(host, "甲项目"))
    await 等一拍()
    指(菜单项("delete"))
    await 等一拍()

    expect(有动作弹窗()).toBe(true)
    expect(弹窗文本("project-action-name")).toBe("甲项目")
    expect(弹窗文本("project-action-hint")).toBe("项目里的文件会一并删掉，删了找不回来。")
  })

  test("点「取消」⇒ `onDelete` **一个请求都不发**，弹窗关掉", async () => {
    const 收到: unknown[] = []
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={() => {}}
        onDelete={(...args) => {
          收到.push(args)
        }}
      />
    ))

    指(行菜单钮(host, "甲项目"))
    await 等一拍()
    指(菜单项("delete"))
    await 等一拍()
    点弹窗取消()

    expect(收到).toEqual([])
    // ⚠️ 关弹窗是**两步**（状态立刻、节点 ~100ms 后 dispose，`LEARNINGS #005-33`）
    // ⇒ 用有界轮询等它没了，不用固定延时。
    await 等到(() => !有动作弹窗())
  })

  test("点确认 ⇒ `onDelete` 收到那一行项目", async () => {
    const 收到: ProjectEntry[] = []
    const host = 挂(() => (
      <ProjectPanel
        projects={[项目]}
        onRename={() => {}}
        onDelete={(p) => {
          收到.push(p)
        }}
      />
    ))

    指(行菜单钮(host, "甲项目"))
    await 等一拍()
    指(菜单项("delete"))
    await 等一拍()
    点弹窗确认()

    expect(收到.map((p) => p.id)).toEqual(["p1"])
  })
})
```

- [ ] 补一个 `点弹窗取消` 辅助（本文件已有 `点弹窗确认`，照它写）：

```ts
/** 点弹窗里那颗「取消」（三个动作**共用同一个槽位**——它们是同一个弹窗）。 */
const 点弹窗取消 = () => 弹窗("project-action-cancel")?.click()
```

### Step 2: 跑它，确认红

```bash
cd /d/project/study/openhive/openhive/packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/project-panel.test.tsx
```

预期：**红**，两条新 describe 里的每一条都红（`行菜单钮` 找不到元素 ⇒ 辅助自己 `throw`，`#004-14`）。据实记红在哪一句。

### Step 3: 改到绿——`project-action-dialog.tsx` 加「删除」

- [ ] 改 `ProjectActionKind`（`:59`）：

```ts
/** 这一问是为了哪件事。三个动作共用一条弹窗，差别全在这张表上。 */
export type ProjectActionKind = "archive" | "restore" | "delete"
```

- [ ] 在 `文案`（`:76-92`）里加第三段（**逐字用 spec §8 的两句话**）：

```ts
  /**
   * 删除（2026-10-16 spec §8）。
   *
   * ⚠️ **不提聊天记录**（用户 2026-10-16 裁决 7）：这句话只说文件会删、找不回来。
   * 它**不是假话**——它没有声称「所有数据都没了」；但**它是省略**（会话与消息仍在库里，
   * spec §11 取舍 3）。那件事**必须对管理员写清楚**，不是对民警。
   */
  delete: {
    title: "删除",
    question: "确定删除",
    hint: "项目里的文件会一并删掉，删了找不回来。",
    ok: "删除",
    variant: "danger",
  },
```

### Step 4: 改到绿——`project-panel.tsx`

- [ ] 在 `canRestore`（`:264-270`）之后加两个判定（**逐字照 `canArchive` 的形状**）：

```ts
/**
 * 能不能改这一行的名字（2026-10-16 spec §7：只有创建人）。
 *
 * ⚠️ 与 `canArchive` / `canRestore` 是**同一条**「面板不重写规则、只把事实交给 `decide`」——
 * 归档态下 `decide` 不给 rename 开口（理由见 `membership.ts`），所以已归档的行上这一项
 * **自动**不出现，本函数不需要再判一次 `archived`。
 */
const canRename = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "rename",
    target: null,
    archived: project.archived === true,
  })

/** 能不能删这一行（同 `canRename`）。⚠️ 归档态下**仍然可以**——spec §7：「已归档的项目也能删除」。 */
const canDelete = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "delete",
    target: null,
    archived: project.archived === true,
  })
```

- [ ] 加一个行菜单组件（放在 `归档行` 之后、`Group` 之前）：

```tsx
/**
 * 一行尾巴上那颗「⋯」——**改名字与不可恢复的删除**的入口（2026-10-16 spec §3/§8）。
 *
 * ## 为什么是菜单而不是两颗常显钮
 *
 * spec §3 的原则一：**不可恢复的动作必须跟可恢复的动作长得不一样**——归档在行上是一颗常显钮
 * （今天就这样），删除藏进 ⋯。形态不同是**刻意**的，不是布局巧合。
 *
 * ## 未接线 / 无权 ⇒ 整个菜单不画
 *
 * 与「归档 / 找回」同一条约定（`问归档` 那段注释）：不给回调 ⇒ 不画；给了回调也还要过 `decide`。
 * 两样都不成立时**连 ⋯ 都不出现**——画一颗点开来空空的菜单是纯噪音。
 *
 * ## 槽位名为什么是 `data-project-action` 而不是 `data-slot`
 *
 * `DropdownMenuItem` 把 `data-slot` 写在 `{...rest}` **之后**（`LEARNINGS #005-22`）⇒
 * 调用方传的 `data-slot` 会被静默覆盖、**那个名字在 DOM 里从来不存在**，而用例会一直绿着空转。
 * 换一个宿主不占的名字（`data-project-action`），先例见 `file-tree.tsx` 的 `data-create-kind`。
 *
 * ## 视觉：悬停出现、**键盘聚焦也出现**（spec §8）
 *
 * `hover-reveal` 是全 app 的既有 utility（默认 `opacity-0`，`@media (hover:none)` 恒可见
 * ⇒ 触屏也够得着）；配 `group-hover/row:opacity-100` ＋ `focus-within:opacity-100`
 * ——后者是 spec §8「不做成鼠标专属」那半句的**唯一实现**（先例
 * `pages/home/home-projects-view.tsx:474-495` 的 `group/project`）。
 *
 * ⚠️ **组件层量不出它可见不可见**（happy-dom 没有 CSS 引擎，`LEARNINGS #005-07`）——
 * 本层的判据只能断「元素在不在」，**真的悬停会不会出现**归真栈（Task 9）。
 */
function 行菜单(props: {
  project: ProjectEntry
  /**
   * 「改名」被点了。⚠️ **不带新名字**——菜单这一下只是**把这一行切成编辑态**，
   * 名字还没被输入（真正带名字的那一层是 `活跃行` 的 `onRename`）。
   * 同一个文件里有两个同名但不同形的 `onRename`，**刻意的**：`行菜单` 是「谁来接这个动作」，
   * `活跃行` 是「新名字是多少」——把两件事合成一个签名，就会逼菜单项编一个假名字出来。
   */
  onRename?: () => void
  onAskDelete?: (project: ProjectEntry) => void
}) {
  const 改名 = () => props.onRename !== undefined && canRename(props.project)
  const 删除 = () => props.onAskDelete !== undefined && canDelete(props.project)
  return (
    <Show when={改名() || 删除()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger as={菜单钮} data-project-action="menu" aria-label={`${props.project.name} 的更多操作`} />
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-slot="project-row-menu">
            <Show when={改名()}>
              <DropdownMenu.Item data-project-action="rename" onSelect={() => props.onRename?.()}>
                <DropdownMenu.ItemLabel>改名</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
            <Show when={删除()}>
              <DropdownMenu.Item data-project-action="delete" onSelect={() => props.onAskDelete?.(props.project)}>
                <DropdownMenu.ItemLabel>删除</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
```

⚠️ 调用方（`活跃行`）是这么接的：`onRename={props.onRename === undefined ? undefined : () => set在改名(true)}`——**零参**，与上面 `() => void` 对上（见 Step 5）。

⚠️ `DropdownMenu` 的 import 是 `import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"`（同 `file-tree.tsx:3`）。

- [ ] 加那个宿主钮（放在 `行菜单` 之前）：

```tsx
/**
 * 「⋯」那一颗的宿主。
 *
 * ⚠️ 形状照 `file-tree.tsx` 的 `工具钮`（它是 `DropdownMenu.Trigger` 的宿主，见那个文件
 * `:1236-1243` 的注释）：`DropdownMenuTrigger` 会给宿主加自己的 `data-*`，所以本组件
 * **不设 `data-slot`**——只有 `data-project-action` 是我们自己的名字（见 `行菜单` 的注释）。
 */
function 菜单钮(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class", "children"])
  return (
    <button
      type="button"
      class={`hover-reveal flex shrink-0 cursor-pointer items-center rounded-[4px] px-1 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover group-hover/row:opacity-100 focus-within:opacity-100 ${local.class ?? ""}`}
      {...rest}
    >
      ⋯
    </button>
  )
}
```

⚠️ 若 `splitProps` / `JSX` 的 import 在本文件还没有，补上（`JSX` 走 `solid-js`）。

- [ ] 改 `活跃行`（`:481-537`）：加 `onRename` / `onAskDelete` 两个 prop、一个**行内**的编辑态信号、以及把名字那一格换掉：

```tsx
function 活跃行(props: {
  project: ProjectEntry
  current: boolean
  onOpen?: (project: ProjectEntry) => void
  onAskArchive?: (project: ProjectEntry) => void
  /** 这一行的「改名」被点了之后进来（`新名` 已 trim、且与原样不同——判据在 `就地改名输入` 里）。 */
  onRename?: (project: ProjectEntry, 新名: string) => void
  /** 这一行的「删除」被点了之后、**确认之前**（真正的执行在弹窗那一层）。 */
  onAskDelete?: (project: ProjectEntry) => void
}) {
  /**
   * 这一行**正在就地改名**——**行级**信号而不是面板级。
   *
   * 做成面板级（`createSignal<string | undefined>` 存「哪个 id 在改」）要多传一层 prop、
   * 还要在清单重拉时对账「那个 id 还在不在」；而编辑态是**一次编辑的事**，它天然属于这一行。
   */
  const [在改名, set在改名] = createSignal(false)
  return (
    <div data-slot="project-row" class={`${ITEM_ROW} group/row`}>
      <Show
        when={在改名()}
        fallback={
          <button
            type="button"
            data-slot="project-item"
            data-current={props.current ? "true" : undefined}
            class={ITEM_NAME_BUTTON}
            classList={{
              "bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base": props.current,
            }}
            disabled={props.onOpen === undefined}
            onClick={() => props.onOpen?.(props.project)}
          >
            <ItemBody project={props.project} current={props.current} />
          </button>
        }
      >
        {/*
          就地改名（spec §8）：**整颗名字按钮被换掉**，不是把输入框塞进按钮里
          ——`<button>` 里放 `<input>` 是非法嵌套。
          复用 `就地改名输入`（**一个字不改**）：它带着「一次编辑只结一次账」那条真栈实测出来的守卫。
        */}
        <就地改名输入
          槽位="project-rename-input"
          可访问名称="项目名称"
          原名={props.project.name}
          on提交={(新名) => {
            set在改名(false)
            props.onRename?.(props.project, 新名)
          }}
          on取消={() => set在改名(false)}
        />
      </Show>
      {/* 超期提醒：**在编辑态下也不该消失**（它不是这一行名字的一部分）。 */}
      <Show when={props.project.stale === true && canArchive(props.project)}>
        <span
          data-slot="project-stale"
          aria-label={`${props.project.name} 超过 3 个月未访问`}
          class="shrink-0 rounded-[4px] bg-v2-background-bg-layer-03 px-1 text-[11px] text-v2-text-text-muted"
        >
          超期未归档
        </span>
      </Show>
      <Show when={props.onAskArchive !== undefined && canArchive(props.project)}>
        <button
          type="button"
          data-slot="project-archive"
          aria-label={`归档 ${props.project.name}`}
          class={CREATE_BUTTON}
          onClick={() => props.onAskArchive?.(props.project)}
        >
          归档
        </button>
      </Show>
      <行菜单
        project={props.project}
        onRename={props.onRename === undefined ? undefined : () => set在改名(true)}
        onAskDelete={props.onAskDelete}
      />
    </div>
  )
}
```

⚠️ **同一个文件里三个名字里都带 `onRename` 的东西，形状各不同——别把它们改成一个**（改「齐」了就当编译错误看）：

| 位置 | 形状 | 它是「什么时候」的回调 |
|---|---|---|
| `ProjectPanelProps.onRename` | `(project: ProjectEntry, name: string) => void \| Promise<...>` | **已经拿到新名字**，交出去（由 `workspace-entry` 打内核出口） |
| `活跃行` 的 `props.onRename` | `(project: ProjectEntry, 新名: string) => void` | 同上（`活跃行` 只是转发给面板那一层） |
| `行菜单` 的 `props.onRename` | `() => void` | **只是「进入编辑态」**——名字还没被输入 |

三者的**落到一起**是 `活跃行` 里那一行：`onRename={props.onRename === undefined ? undefined : () => set在改名(true)}`——**左边是菜单那种（零参）**。

- [ ] 改 `归档行`（`:545-590`）：加 `onAskDelete`，并在尾巴上加 `行菜单`：

```tsx
function 归档行(props: {
  project: ProjectEntry
  current: boolean
  onRestore?: (project: ProjectEntry) => void
  /** 已归档的行**也能删除**（spec §7）——它比找回更彻底，藏进 ⋯。 */
  onAskDelete?: (project: ProjectEntry) => void
  带归档标记?: boolean
}) {
  return (
    <div data-slot="project-item" data-current={props.current ? "true" : undefined} class={`${ITEM_STATIC} group/row`}>
      <ItemBody project={props.project} current={props.current} />
      <Show when={props.带归档标记}>
        <span
          data-slot="project-item-archived"
          class="shrink-0 rounded-[4px] bg-v2-background-bg-layer-03 px-1 text-[11px] text-v2-text-text-muted"
        >
          已归档
        </span>
      </Show>
      <Show when={props.onRestore !== undefined && canRestore(props.project)}>
        <button
          type="button"
          data-slot="project-restore"
          aria-label={`找回 ${props.project.name}`}
          class={CREATE_BUTTON}
          onClick={() => props.onRestore?.(props.project)}
        >
          找回
        </button>
      </Show>
      {/* ⚠️ 归档行**不传 `onRename`**：归档态下 `decide` 不给 rename 开口（`canRename` 恒 false）
          ⇒ 传了也不会画。不传是**刻意的**：多传一个恒被过滤掉的回调，只会在读代码时误导人
          以为「归档行也能改名」。 */}
      <行菜单 project={props.project} onAskDelete={props.onAskDelete} />
    </div>
  )
}
```

⚠️ **`归档行` 的 `data-slot` 是 `project-item`（它整行就是那个记号）**——上面那条新用例的 `行菜单钮` 是按 `[data-slot='project-row']` 找行的，**归档行没有这个壳**。把 `行菜单钮` 的辅助改成**两种壳都认**：

```ts
const 行菜单钮 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row'], [data-slot='project-item'][data-current], [data-slot='project-group'] > div[data-slot='project-item']")]
    ...
```

—— ⚠️ **这写法太脆**。**改成给归档行也套一层壳**：把 `归档行` 的最外层 `div` 改成 `class={ITEM_ROW}` 外包一层 `data-slot="project-row"`、里面再用 `ITEM_STATIC`：

```tsx
  return (
    <div data-slot="project-row" class={`${ITEM_ROW} group/row`}>
      <div data-slot="project-item" data-current={props.current ? "true" : undefined} class={ITEM_STATIC}>
        …内容与尾巴原样…
      </div>
    </div>
  )
```

⚠️ **这会改变既有用例查 `[data-slot='project-item']` 的结果形状**（它现在在里层）——`document.querySelectorAll` 仍查得到，但**任何 `host.querySelector("[data-slot='project-item']")` 取外层 div 的用例会改取到里层**。**跑一遍本文件全部用例**（Step 6），红的逐条按 `#005-36` 分诊（改写判据 / 显式补前提），**不要**为了让它绿而把结构改回去。

- [ ] 改 `Group`（`:593-620`）与 `ArchivedGroup`（`:623-646`）：把两个新回调透下去。

```tsx
function Group(props: {
  group: string
  label: string
  items: readonly ProjectEntry[]
  currentId?: string
  onOpen?: (project: ProjectEntry) => void
  onAskArchive?: (project: ProjectEntry) => void
  onRename?: (project: ProjectEntry, 新名: string) => void
  onAskDelete?: (project: ProjectEntry) => void
}) {
  // …结构原样，只是在 <活跃行 …> 上多传 onRename / onAskDelete
}
```

```tsx
function ArchivedGroup(props: {
  items: readonly ProjectEntry[]
  currentId?: string
  onRestore?: (project: ProjectEntry) => void
  onAskDelete?: (project: ProjectEntry) => void
}) {
  // …结构原样，只是在 <归档行 …> 上多传 onAskDelete
}
```

- [ ] 改 `ProjectPanelProps`（`:164-230`）：加两个回调（**逐字照 `onArchive` / `onRestore` 的形状与注释密度**）：

```ts
  /**
   * 改一个项目的名字（2026-10-16）。**交出去的是「哪一个 ＋ 新名字」**——与 `onArchive` /
   * `onRestore` 不同（那两条只交「哪一个」）：改名的动作**内容**就是那个名字。
   *
   * 约定同另两条：**回一句字符串 = 没办成**（显示在面板最底下），`undefined` / 没回 = 收工。
   */
  onRename?: (project: ProjectEntry, name: string) => string | undefined | Promise<string | undefined> | void
  /**
   * 删一个项目（2026-10-16）。**破坏性、不可恢复**——所以面板先开一条确认（spec §8）。
   * 同 `onArchive`：这里传出去的是「就这一个项目」，真正交出去发生在弹窗确认那一步。
   */
  onDelete?: ProjectActionCallback
```

- [ ] 改 `问动作`（`:741-749`）与加 `办改名` / `问删除`：

```ts
  /**
   * 把新名字交出去，等回话。与 `办` 同一条约定（字符串 = 没办成）。
   *
   * 与 `办` 分成两条而不是合成一条：`办` 交的是「一个动作」，这条交的是「一个动作 ＋ 一个值」
   * ——合并要给它加一个可选的第二参，而那会让 `onArchive` / `onRestore` 的调用点也跟着长出一个
   * 恒不传的位置（`LEARNINGS #002-06` 的取向：别为省一行把两件事塞进一个判定）。
   */
  const 办改名 = async (project: ProjectEntry, name: string) => {
    set没办成(undefined)
    const 回话 = await props.onRename?.(project, name)
    if (typeof 回话 === "string") set没办成(回话)
  }

  /**
   * 问一句再办（归档 / 找回 / 删除共用）。
   *
   * ⚠️ 三个动作的接收方**在 `onConfirm` 里现读**（不是开弹窗时捕获一份）：弹窗可能开着的时候
   * 调用方重新接了线，那时该走的是新的那一份。表写成 `Record<ProjectActionKind, …>` ⇒
   * **将来加第四个动作时不补这一行是编译错误**（同 `RULES` 表那条理由）。
   */
  const 问动作 = (action: ProjectActionKind, project: ProjectEntry) => {
    void dialog.show(() => (
      <ProjectActionDialog
        action={action}
        projectName={project.name}
        onConfirm={() => {
          const 接: Record<ProjectActionKind, ProjectActionCallback | undefined> = {
            archive: props.onArchive,
            restore: props.onRestore,
            delete: props.onDelete,
          }
          void 办(project, 接[action])
        }}
      />
    ))
  }
```

```ts
  /**
   * 删除的入口（2026-10-16）。**上面那条规矩的第三个出口，同款三元**——`活跃行` / `归档行`
   * 那侧写着「不给回调即不画」，所以这里同样**只在不为空时递下去**。
   */
  const 问删除 = (project: ProjectEntry) => 问动作("delete", project)
```

- [ ] 在渲染处把这几个回调透下去（**每一处 `Group` / `ArchivedGroup` / `活跃行` / `归档行` 的调用点**）：

```tsx
  // 三个 tab 的 Group：`onRename` / `onAskDelete` 按 same 三元递（不给回调 ⇒ 不画）。
  onRename={props.onRename === undefined ? undefined : 办改名}
  onAskDelete={props.onDelete === undefined ? undefined : 问删除}
```

⚠️ **"全部 == 落点"清点**（`#002-06`）：本文件里 `活跃行` 的调用点有**三处**（搜索结果的活跃分支、`Group` 里的 `For`、——以实际 grep 为准），`归档行` 有**两处**（搜索结果、`ArchivedGroup`），`Group` 有**两处**（最近 tab 的 `For`、全部 tab 的两组），`ArchivedGroup` **一处**。
逐个改，改完跑：

```bash
cd /d/project/study/openhive/openhive && grep -n "活跃行\|归档行\|<Group\|<ArchivedGroup\|<行菜单" packages/app/src/project/project-panel.tsx
```

把每一行逐个打勾（**这就是 ⑥ 步的落点清单**）。

- [ ] 补 import：`就地改名输入`（`@/components/inline-rename-input`）、`DropdownMenu`（`@opencode-ai/ui/dropdown-menu`）、`splitProps` / `createSignal` / `JSX`（**按文件已有的 import 补**，别重复）。

### Step 5: 跑它，确认绿

```bash
cd /d/project/study/openhive/openhive/packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/project/project-panel.test.tsx
```

预期：**全绿**。

⚠️ **同时**跑本文件里**既有**的用例——`归档行` 那层新壳一定会动到它们（见 Step 4 那段警告）。红的逐条按 `#005-36` 分诊，写清「改写判据」还是「显式补前提」。

- [ ] 跑整个组件套件（确认没把别的文件带红）：

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:components
```

预期：全绿，≥ 基线。

### Step 6: 变异验证

- [ ] 备份：`cp packages/app/src/project/project-panel.tsx /tmp/project-panel.tsx.bak`

- [ ] **变异 A：把 `行菜单` 里两个 `Show` 的 `canRename` / `canDelete` 判定拆掉**（改成恒真）。
  预期：**红 1 条**——「角色是 member ⇒ 那一行**没有** ⋯」。据实记。
- [ ] **变异 B：把 `活跃行` 里 `就地改名输入` 的 `原名` prop 拆掉。**
  预期：**红 1 条**——「预填着原名」。据实记。
- [ ] **变异 C：把 `就地改名输入` 换成裸 `<input>`（不走通用件的判定）。**
  预期：**红 2 条**——「Esc ⇒ 一个回调都不喊」与「空草稿回车 ⇒ 不提交」。
  ⚠️ 这一条**特别要跑**：它证明的是「**复用**那个通用件」这件事本身**有牙**——不复用它，那两条判据就没了（这正是 spec §8「复用它是刻意的」那半句）。
- [ ] **变异 D：把 `问动作` 里 `onConfirm` 的 `接[action]` 改成恒取 `props.onArchive`。**
  预期：**红 1 条**——「点确认 ⇒ `onDelete` 收到那一行项目」（因为回调落到 archive 上、`onDelete` 一条都没收到）。
- [ ] 还原：`cp /tmp/project-panel.tsx.bak packages/app/src/project/project-panel.tsx`，`diff` 无输出。

- [ ] **变异 E（`project-action-dialog.tsx`）：把 `delete` 那段的 `hint` 改成归档那段的话。**
  预期：**红 1 条**——「措辞是 spec §8 那两句」。
- [ ] 还原那个文件。

### Step 7: ⑥ 步——grep 同类落点

```bash
cd /d/project/study/openhive/openhive && grep -rn "ProjectActionKind\|ProjectActionDialog\|data-slot=\"project-action" packages/app/src
```

逐个判定：`ProjectActionKind` 现在有**两个**消费者（`project-action-dialog.tsx` 自己的 `文案` 表 ＋ `project-panel.tsx` 的 `接` 表），两处都是 `Record<ProjectActionKind, …>` 型的**编译器逼全**的表——**加第四个动作时两处都会编译报错**。写下一步结论。

```bash
cd /d/project/study/openhive/openhive && grep -rn "hover-reveal" packages/app/src/project/
```

本仓 `project/` 目录里第一次出现 `hover-reveal`。确认它带来的**新落点**（`菜单钮`）与全 app 的既有用法（`titlebar-tab-nav.tsx` / `home-projects-view.tsx` / `new-session-view.tsx`）形状一致（`group-hover/X:opacity-100` ＋ `focus-within:opacity-100`）。

```bash
cd /d/project/study/openhive/openhive && grep -rn "group/row\|group-hover/row" packages/app/src
```

确认 `group/row` 这个名字**在本仓唯一**（Tailwind 的具名 group 是全局字符串，重名不会报错但会让一个文件的悬停点亮另一个文件的元素）。若发现有别的 `group/row`，换一个更专的名字（如 `group/project-row`）并同时改 `菜单钮` 里的 `group-hover/…`。

### Step 8: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/app/src/project/project-panel.tsx packages/app/src/project/project-panel.test.tsx packages/app/src/project/project-action-dialog.tsx
```

- [ ] 跑 app 两套：

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:unit
```

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:components
```

预期：都全绿，≥ 基线。

### Step 9: 提交

```bash
cat > /tmp/task7.txt <<'EOF'
feat(app): 项目行加「⋯」菜单（改名 / 删除）、就地改名与删除确认

- 行内 ⋯ 菜单：删在 ⋯ 里、归档仍是常显钮——spec §3 原则一，形态不同是刻意的。
  未接线 / 无权 ⇒ 连 ⋯ 都不画（同「不给回调即不画」那条约定）。
  member 与「已归档」行上两项各按 decide 自动收敛（面板不重写规则）。
- 菜单项槽位用 data-project-action 而不是 data-slot：DropdownMenuItem 把 data-slot
  写在 {...rest} 之后，调用方传的会被静默覆盖（LEARNINGS #005-22，先例 data-create-kind）。
- 就地改名复用 components/inline-rename-input（**一个字不改**）——它带着「一次编辑只结一次账」
  那条真栈实测出来的守卫，且 Esc / 空草稿 / 未改动三条判据只有一份实现。
  整颗名字按钮被换掉（button 里放 input 是非法嵌套）。
- 删除确认扩 ProjectActionDialog 的文案表；措辞逐字取 spec §8（**不提聊天记录**）。
  问动作表写成 Record<ProjectActionKind, …> ⇒ 加第四个动作时不补是编译错误。
- 归档行多套一层 project-row 壳（⋯ 要挂在行上）——既有用例按 LEARNINGS #005-36 分诊。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/app/src/project/project-panel.tsx packages/app/src/project/project-panel.test.tsx packages/app/src/project/project-action-dialog.tsx && git commit -F /tmp/task7.txt
```

---

## Task 8: 工作台接线（`workspace-entry.tsx`）

对应 spec §9 第六行 ＋ §10 判据 11。

**Files:**
- Modify: `packages/app/src/workspace/workspace-entry.tsx`（`:954-997` 那一带，在 `onRestore` 之后加两段）

**Interfaces:**
- Consumes: `projectData.rename` / `projectData.deleteProject`（Task 6）、`拉清单`（`:274`）、`currentProject` / `setCurrentProject`
- Produces: `ProjectPanel` 的 `onRename` / `onDelete` 两处接线

⚠️ **本任务改的是上游文件**（`workspace-entry.tsx`）——**只「加」不「改」**：现有 `onCreate` / `onArchive` / `onRestore` 三段一个字都不动。

### Step 1: 加两段接线

- [ ] 在 `onRestore={…}` 那一整段（`:988-997`）**之后**追加：

```tsx
                      /*
                        改名（2026-10-16）。办成之后只做一件事：**清单重拉**。

                        为什么不就地改 `currentProject()` 里的名字：清单重拉会把它一并带回来
                        （`拉清单并还原` 那条路径），而就地改会造出**两处名字来源**——
                        面板读清单、锚点行读 `currentProject()`，改一处漏一处时就出现
                        「面板上新名字、左栏锚点上旧名字」，且不报错（`LEARNINGS #004-02`
                        的取向：一份判定不要长出两个投影）。
                        ⚠️ 重拉回来之前那一小段缝里，锚点行显示的可能还是旧名——那是**收敛中**
                        的中间态，不是错误。

                        没办成 ⇒ 把服务端那句话原样交回去（同 `onArchive`：`rejected` 与 `failed`
                        两支都带 `message`，接线这一层不需要、也不该分开看）。
                      */
                      onRename={
                        projectData
                          ? async (project, name) => {
                              const 结论 = await projectData.rename(project.id, name)
                              if (结论.kind !== "done") return 结论.message
                              await 拉清单(projectData)
                              return undefined
                            }
                          : undefined
                      }
                      /*
                        删除（2026-10-16）。**破坏性、不可恢复**，所以办成之后有两件收尾
                        ——与 `onArchive` 逐字同形（`onArchive` 那段注释的 ①② 在这里逐条成
                        立：清单重拉 ＋ 删的是当前项目就清掉它）。

                        ⚠️ 与 `onArchive` 只差一处、而那处**不能少**：删除**没有找回**，
                        所以「当前项目被删掉」之后它**永远不会回来**——不 `setCurrentProject(undefined)`
                        的话，锚点行会长期挂着一个已经不存在的项目（点进去任何文件操作必失败）。

                        ⚠️ 与归档 / 找回一样**不带 `x-openhive-project` 头**（`project-data.ts`
                        那条注释逐字记着理由）：删除的要是**当前项目**，带了头会让请求先撞上
                        「项目已不存在」那道门自己挡住自己。
                      */
                      onDelete={
                        projectData
                          ? async (project) => {
                              const 结论 = await projectData.deleteProject(project.id)
                              if (结论.kind !== "done") return 结论.message
                              if (currentProject()?.id === project.id) setCurrentProject(undefined)
                              await 拉清单(projectData)
                              return undefined
                            }
                          : undefined
                      }
```

### Step 2: 门禁

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run typecheck
```

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/app/src/workspace/workspace-entry.tsx
```

- [ ] 跑 app 两套（`workspace-entry.test.tsx` 在这个仓里存在，跑它）：

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:components
```

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run test:unit
```

预期：全绿，≥ 基线。

### Step 3: ⑥ 步——grep 同类落点

```bash
cd /d/project/study/openhive/openhive && grep -n "拉清单\|setCurrentProject" packages/app/src/workspace/workspace-entry.tsx
```

逐个判定「清单重拉」与「清当前项目」两个动作的落点，写下一步表：

| 落点 | 清当前项目？ | 理由 |
|---|---|---|
| `onCreate` | 否（**设成**新项目） | 建完成为当前项目（FR-003） |
| `onArchive` | 是（若是当前项目） | 沙箱已删，界面不能挂着一个不存在的目录 |
| `onRestore` | **否** | 找回不等于切过去 |
| `onRename` | **否** | 名字变了，项目还在、沙箱还在 |
| `onDelete` | 是（若是当前项目） | 不可恢复 |

⚠️ **`onRename` 不清当前项目**这条要当场判定并写下来——「不清」与「忘了清」在报告里长得一样（`LEARNINGS #005-45`）。

### Step 4: 提交

```bash
cat > /tmp/task8.txt <<'EOF'
feat(app): workspace-entry 接上项目改名与删除

- onRename：办成后只重拉清单。**不就地改 currentProject() 里的名字**——那会造出两处名字
  来源（面板读清单、锚点行读 currentProject），改一处漏一处就出现「面板新名、锚点旧名」且不报错。
- onDelete：与 onArchive 逐字同形（清单重拉 + 删的是当前项目就清掉它）。删除**没有找回**，
  所以「当前项目被删掉」之后永远不会回来，清掉这一步不能少。
- 两条都不带 x-openhive-project 头（同归档/找回）：删的要是当前项目，带头会让请求
  先撞上「项目已不存在」那道门自己挡住自己。
- 只「加」不「改」：onCreate / onArchive / onRestore 三段一个字未动。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/app/src/workspace/workspace-entry.tsx && git commit -F /tmp/task8.txt
```

---

## Task 9: 真栈端到端（spec §10 判据 12）

**Files:**
- Create: `packages/app/e2e/real-stack/project-rename-delete-real.spec.ts`

**Interfaces:**
- Consumes: 真栈挂具（`%TEMP%\openhive-real-stack.json` 的 `{kernel, front, token}`）、`openhive_session` cookie、内核出口 `/openhive/project`、`/openhive/project/rename`、`/openhive/project/delete`、`/session`
- Produces: 一条真栈 spec，钉「建 → 改名 → 两处都对 → 删除 → 列表里没了、直接读会话读得出来」

### Step 1: 起真栈

- [ ] 读 `packages/app/e2e/real-stack/README.openhive.md`（**跑真栈的权威说明**），照它起栈。要点（本机实测的固定配方）：

```bash
cd /d/project/study/openhive/openhive/packages/app && E2E_BROWSER="<chromium-1234 的路径>" REAL_STACK_STATE_DIR="D:/openhive-stack-state" bun e2e/real-stack/stack.ts
```

⚠️ **端口被残留栈占住就换 `REAL_STACK_KERNEL_PORT` / `REAL_STACK_FRONT_PORT`，绝不杀进程**。
⚠️ 交接文件落在 `%TEMP%\openhive-real-stack.json`。
⚠️ `E2E_BROWSER` 指向 chromium-1234（若 README 记的路径不同，以 README 为准）。

### Step 2: 写 spec

- [ ] 新建 `packages/app/e2e/real-stack/project-rename-delete-real.spec.ts`。**挂具照 `file-op-error-real.spec.ts` 抄**（`readStack` / `FRONT` / `KERNEL` / `COOKIE` / `kernelJson` / `建真项目` / `进项目`），**建会话／列会话那两条照 `sidebar-project-switch-real.spec.ts` 的 `建项目内会话` 抄**（`POST /api/session?directory=<沙箱项目目录>` ＋ 头 `x-openhive-project`，回 `{data:{id}}`；列会话是同一条 URL 的 `GET`，回 `{data:[...]}`），只换判据：

```ts
import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-16 · **项目改名与删除**的真栈端到端（spec §10 判据 12）。
 *
 * ## 为什么这条必须落真栈
 *
 * 单测喂的是手写的清单、组件测试喂的是手写的 `projects` —— 两层都**假定了名清单与
 * 会话清单是「本来就对」的**。而这条要钉的是**跨两个存储**的一件事：
 * 名字存在两处（每用户 SQLite 的 `project.name` ＋ PG 的 `project_meta.name`），
 * 而**两处的写入点是同一段代码里的两行**——只有真内核 + 真 PG + 真每用户库才验得了
 * 「两行都真的落了」。
 *
 * 删除那一半同理：它要证明「删完之后**会话还读得出来**」（spec §4.3 那条实测结论）——
 * 而那需要真 PG ＋ 真的会话行 ＋ 目录真的不在盘上。
 *
 * ## 跑法前提
 *
 * 本 spec **会删掉自己的项目**（它自己建的）⇒ 在持久态上跑会留下一条「目录已删」的记录。
 * 与 `file-op-error-real.spec.ts` 的注意事项相同：请给它自己的临时 `REAL_STACK_STATE_DIR`。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

async function 进项目(page: Page, context: BrowserContext, id: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
}

/** 建一条**项目内**会话（真内核出口当 oracle，不经前端）。回它的 id。 */
async function 建会话(projectId: string, directory: string, title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json", "x-openhive-project": projectId },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

/** 列**项目内**会话（同一条 URL 的 GET）。当 oracle 用。 */
async function 列会话(projectId: string, directory: string) {
  return kernelJson(`/api/session?directory=${encodeURIComponent(directory)}`, {
    headers: { "x-openhive-project": projectId },
  })
}

/**
 * 面板里**按名字**取一行。
 *
 * ⚠️ 两处记号都是**本 feature 与上游现成的**，不是猜的：
 * `data-slot='project-row'` 是 `活跃行` 的根（`project-panel.tsx:492`）；
 * `data-slot='project-item-name'` 是名字那一格（同文件 `:450`，`ItemBody` 里）。
 * 用**名字**过滤而不是按序取第 N 行：`hasText` 是子串匹配，所以先钉住名字这一格、再由它筛行。
 */
const 行 = (page: Page, 名字: string) =>
  page.locator("[data-slot='project-row']").filter({
    has: page.locator("[data-slot='project-item-name']", { hasText: 名字 }),
  })

test("建项目 → 改名 → 删除 → 清单里没了、**直接读会话读得出来**", async ({ page, context }) => {
  const 原名 = `真栈改名删除·${Date.now()}`
  const 新名 = `${原名}（改）`
  const 甲 = await 建真项目(原名)

  // ── 造一条会话（走内核一等出口；真栈上这条链是真的）──
  // ⚠️ 必须带 `x-openhive-project`：不带的话锚定会把 `?directory=` 改写成**沙箱根**，
  // 会话落到另一个目录里 —— 后面那条「会话还读得出来」会红在与被测属性无关的前置上。
  const 会话ID = await 建会话(甲.id, 甲.directory, `留底·${Date.now()}`)

  // ── 打开项目面板：锚点行那颗 toggle（`project-list-failure-real.spec.ts:132` 同一颗）──
  await 进项目(page, context, 甲.id)
  await page.locator("[data-slot='project-anchor-toggle']").click()
  await expect(page.locator("[data-component='project-panel']"), "面板应当开出来").toBeVisible({ timeout: 30_000 })

  const 我行 = 行(page, 原名)
  await expect(我行, "面板里应当有刚建的那个项目").toBeVisible({ timeout: 30_000 })

  // ── 改名：经界面（spec §8 的入口是 ⋯ 菜单 → 改名 → 就地输入框 → 回车）──
  // 悬停才出现的 ⋯（spec §11 取舍 1：触屏与不用电脑的人可能发现不了——这条**正是**那条缺口的现场）。
  await 我行.hover()
  await 我行.locator("[data-project-action='menu']").click()
  // ⚠️ 菜单项按 `data-project-action` 定位，**不按 `data-slot`**（`#005-22`：
  // `DropdownMenuItem` 把 `data-slot` 写在 `{...rest}` 之后，调用方传的那个名字在 DOM 里不存在）。
  await page.locator("[data-project-action='rename']").click()

  const 框 = 我行.locator("[data-slot='project-rename-input']")
  await expect(框, "就地改名输入框应当出现").toBeVisible()
  await expect(框, "预填着原名").toHaveValue(原名)
  await 框.fill(新名)
  await 框.press("Enter")

  // ── 被测 ①：界面上那一行换成了新名 ──
  await expect(行(page, 新名), "改名之后那一行应当显示新名字").toBeVisible({ timeout: 15_000 })

  // ── 被测 ②：本地那份名字真的变了（owner 读的就是它）──
  const 列后 = await kernelJson("/openhive/project")
  const 行后 = (列后.body as { id: string; name: string }[]).find((entry) => entry.id === 甲.id)
  expect(行后?.name, "清单里读到的应当是**新**名字（本地那份）").toBe(新名)

  // ⚠️ PG 那一份（成员读的）**在真栈上从客户端读不到**（没有那个出口）。
  // 它的判据在 `packages/opencode/test/server/openhive-project-rename.test.ts` 里（真 PG 直查）。
  // 这条真栈 spec 因此**只**钉「本地那份 ＋ 界面」——**如实记**，不要写成「两处都验了」。

  // ── 删除：经界面（⋯ → 删除 → 确认框 → 确认）──
  await 行(page, 新名).hover()
  await 行(page, 新名).locator("[data-project-action='menu']").click()
  await page.locator("[data-project-action='delete']").click()
  const 弹窗 = page.locator("[data-slot='project-action-dialog']")
  await expect(弹窗, "删除要先问一句").toBeVisible()
  await expect(弹窗.locator("[data-slot='project-action-hint']"), "那句「找不回来」是这一档的告示").toContainText(
    "找不回来",
  )
  await 弹窗.locator("[data-slot='project-action-ok']").click()

  // ── 被测 ③：清单里没了（面板上 ＋ 服务端清单两处都读一遍）──
  await expect(行(page, 新名), "删完之后那一行应当从面板上消失").toHaveCount(0, { timeout: 15_000 })
  const 列最后 = await kernelJson("/openhive/project")
  expect(
    (列最后.body as { id: string }[]).some((entry) => entry.id === 甲.id),
    "服务端清单里也不该再有它",
  ).toBe(false)

  // ── 被测 ④：**会话还读得出来**（spec §4.3 那条实测结论的判据化）──
  // ⚠️ 直打内核出口，不经界面——项目与目录都没了，界面上已经没有它的落脚点
  // （那正是「纯留底」的形状）；**目录参数照传**（它已经被删了，而这条判据要的正是
  // 「目录不在也照样读得出来」）。
  const 会话表 = await 列会话(甲.id, 甲.directory)
  expect(会话表.status, "目录与项目都不在了，列会话应当照样通（200）").toBe(200)
  const 会话们 = (会话表.body as { data?: { id: string }[] } | undefined)?.data ?? []
  expect(会话们.some((s) => s.id === 会话ID), "会话应当仍在——「删除 ≠ 清空一切」").toBe(true)
})
```

⚠️ **每个选择器都在真源码里核过**，别改回「看着更像」的名字：面板容器 `[data-component='project-panel']`、锚点 toggle `[data-slot='project-anchor-toggle']`、行 `[data-slot='project-row']`、名字格 `[data-slot='project-item-name']`、菜单触发器 `[data-project-action='menu']`、菜单项 `[data-project-action='rename'|'delete']`、就地输入 `[data-slot='project-rename-input']`、确认弹窗 `[data-slot='project-action-dialog']` ＋ `-hint` ＋ `-ok`（后三个是 `project-action-dialog.tsx:107/115/129` 已有的）。
⚠️ **`data-slot='project-anchor-toggle'` 与 `[data-component='project-panel']` 的先后**：面板是浮层，开出来会盖住左栏——本 spec **不开左栏 tab**，所以不受那条「先点 tab 再开面板」的约束影响（对照 `project-list-failure-real.spec.ts:134-137` 的注释，那条是为了别的原因）。
⚠️ 第一遍跑**必然会因为「稳定等待」不够而偶红**：面板开出来之后那一行是异步到的（`拉清单` 回来才画），所以每一处都给了 `timeout`（`#006-31`：等条件不等时间）。若仍在某一步不稳，**先探哪一步**（打印 `页面上的行数`），别加大超时了事。

### Step 3: 跑它

```bash
cd /d/project/study/openhive/openhive/packages/app && bunx playwright test --config e2e/real-stack/playwright.config.ts e2e/real-stack/project-rename-delete-real.spec.ts
```

预期：**1 passed**。若红，按 `superpowers:systematic-debugging` 定根因（**先怀疑测量**：选择器 / 时机，再怀疑产品）。

⚠️ **本任务没有「先写会红」那一步，这是**如实**的、不是跳过**：这条 spec 写在 feature 已实现之后（Task 4–8 都已提交），**它不可能红**。铁律里「② 先写一条会红的用例」在这里换成了唯一能给真栈 spec 发牙的手段——④ 变异（下一步）。**报告里要写明这一点**，不要写成「红→绿」走过了一遍。

### Step 4: 变异验证（真栈这一条**只能做这一条**）

- [ ] 备份：`cp packages/opencode/src/server/openhive/archive.ts /tmp/archive-real.bak`

- [ ] **变异（借 Task 5 的变异 A，但这次在真栈上量）**：把 `handleDelete` 里 `removeAllMembers(...)` 那一行删掉 —— 即让项目**以影子行身份**留在清单里（spec §4.4）。

- [ ] 重启内核（改的是内核源码，**必须重启栈**才生效；前端不用重启）。

- [ ] 跑本 spec，**预期：红**，且**红在「删完之后那一行应当从面板上消失」那一句**（`toHaveCount(0)`）。据实记**红在哪一句**（`LEARNINGS #005-46`：一条用例里排了多条断言时，红只停在它最先撞倒的那一句）——这正是本 spec 与组件层不同的地方：**它量的是「面板真的去重取了清单」**，而组件层的 `workspace-entry` 接线**没有**这条判据（Task 10 缺口表已登记）。

- [ ] 还原：`cp /tmp/archive-real.bak packages/opencode/src/server/openhive/archive.ts`，重启内核，确认 `diff` 无输出、spec 复跑**绿**。

- [ ] **据实记这一条缺口**（不是省略）：判据 ④「**会话还读得出来**」（spec §5 那条禁令：绝不删每用户库的 `project` 行）**没有在真栈上做变异**——要让它会红，得去改产品、真把会话行删掉，而那正是 §5 明令禁止的做法，代价（造一个「违约版」实现）与本 feature 不成比例。它在路由层有一条真正的守护者（`openhive-project-delete.test.ts` 的 ⑥），**真栈这一层如实记为未变异**。

### Step 5: 缺口表

- [ ] 在 spec 的缺口记录处（本 feature 的 `state.md` 或 spec §11）追加这条**如实记**：

```
- 真栈 spec（`project-rename-delete-real.spec.ts`）**只**钉「本地那份名字 + 界面 + 清单消失 +
  会话读得出来」。**PG 那份名字（成员读的）在真栈上从客户端读不到**（没有那个出口）
  ⇒ 那一半的判据在 `packages/opencode/test/server/openhive-project-rename.test.ts`（真 PG 直查）。
  不写成「真栈验了两处」。
```

### Step 6: 提交

```bash
cat > /tmp/task9.txt <<'EOF'
test(e2e): 真栈——建项目 → 改名 → 删除 → 清单里没了、直接读会话读得出来

- 钉 spec §10 判据 12：跨两个存储的改名（界面 + 本地那份）与删除之后的「留底」。
- ⚠️ 缺口如实记：PG 那份名字（成员读的）**在真栈上从客户端读不到**（没有那个出口）
  ⇒ 那一半的判据在内核路由测试里（真 PG 直查）。本 spec **不**声称验了两处。
- 本 spec 会删掉它自己建的项目 ⇒ 给它自己的临时 REAL_STACK_STATE_DIR（同
  file-op-error-real.spec.ts 的注意事项）。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add packages/app/e2e/real-stack/project-rename-delete-real.spec.ts && git commit -F /tmp/task9.txt
```

---

## Task 10: 门禁收尾、缺口表、与 spec §11 对账

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-project-rename-delete-design.md`（§11 取舍与缺口；§6 的「待实施时核实」两条改成已核实）
- Modify: `LEARNINGS-full.md`（顶部追加本 feature 的条目）＋ `LEARNINGS.md`（索引）

**Interfaces:**
- Consumes: Task 0 的基线数字
- Produces: 一份对得上的收尾账

### Step 1: 三个包各自跑门禁（**串行，一次一个**）

```bash
cd /d/project/study/openhive/openhive/packages/core && bun run typecheck && bun test
```

```bash
cd /d/project/study/openhive/openhive/packages/auth && bun run typecheck && bun test --timeout 30000
```

```bash
cd /d/project/study/openhive/openhive/packages/opencode && bun run typecheck && bun test --timeout 30000
```

```bash
cd /d/project/study/openhive/openhive/packages/app && bun run typecheck && bun run test:unit && bun run test:components
```

逐条记下**实得输出**（`N pass / M fail`），与 Task 0 的基线对比。**低于基线的**：先按 `#005-31`（注释吞用例）／`#004-06`（`*/` 提前闭合）两条形状查一遍，再报。

### Step 2: oxlint（改动目录逐个）

```bash
cd /d/project/study/openhive/openhive && bunx oxlint packages/core/src/project packages/core/test packages/auth/src packages/opencode/src/server/openhive packages/app/src/project packages/app/src/workspace
```

预期：**0 error**（warning 逐条看是不是本改动引入的；根 `bun run lint` 天生红，**不跑它**）。

### Step 3: 锁文件

```bash
cd /d/project/study/openhive/openhive && git diff --stat bun.lock
```

预期：**空**。非空 ⇒ `git checkout -- bun.lock` 还原（本 feature 没加依赖）。

### Step 4: 与 spec §10 的十二条判据逐条对账

- [ ] 填这张表（**实得**那一列必须来自真跑的输出，不是记忆）：

| # | 判据 | 钉它的用例 | 实得 |
|---|---|---|---|
| 1 | 改名后两处名字都变了 | `openhive-project-rename.test.ts` 第一条 | |
| 2 | 改名后被邀成员读到的也是新名 | 同上第二条 | |
| 3 | 删除后项目从清单消失 | `openhive-project-delete.test.ts` 第一条 ② | |
| 4 | 删除后会话行仍在且读得出来 | 同上 ⑥ | |
| 5 | 非创建人 ⇒ 403 | 两个路由文件各一条 | |
| 6 | 删除再点一次不报错 | `openhive-project-delete.test.ts` 第二条 | |
| 7 | 删除后共享仓库 / 盘上目录确实没了 | 同上 ③ | |
| 8 | ⋯ 菜单：悬停出现、键盘聚焦也出现 | 组件层只钉「在不在」⇒ **悬停出现归真栈**（Task 9 Step 2 的 `行.hover()`） | |
| 9 | 就地改名：回车提交 / Esc / 空名字不提交 | `project-panel.test.tsx` 那组 | |
| 10 | 确认框取消 ⇒ 一个请求都不发 | 同上 | |
| 11 | 删除成功后项目从列表消失、并重取清单 | **真栈**（Task 9）＋ `workspace-entry` 的接线（组件层没有 `workspace-entry` 的清单重拉判据 ⇒ 如实记） | |
| 12 | 真栈：建 → 改名 → 两处都对 → 删除 → 会话读得出来 | `project-rename-delete-real.spec.ts`（**PG 那一处是真栈读不到的，见 Task 9 Step 4**） | |

⚠️ 判据 8 与判据 11 的「覆盖到什么程度」要**逐字写清**，别用「已覆盖」三个字盖过去。

### Step 5: 缺口表（**不把测不了的写成已覆盖**）

- [ ] 在 spec §11 追加这些条目（**每条都要写清「为什么测不了」与「危险在哪」**）：

```
10. **`updateProjectName` 命中 0 行时静默成功**（R4）：调用方分辨不出「改了」与「本来就没有」。
    真要防它得数返回行数，而那条形状在 PGlite 与生产 bun-sql 下是否一致**没验过**（#002-01）。
11. **改名的写入次序（PG 先、本地后）在成功路径上不可观测**：拆掉／调换它，用例全绿
    （Task 4 Step 5 变异 B 实测）。那条次序的保证是**论证**（拒绝时两处一致），不是测试。
12. **`dropResidue` 的 worktree 那一半没有守护者**：造一个 worktree 残留要真跑一次 worktree
    流程，成本与本 feature 不成比例（Task 5 Step 6 变异 D 实测：只删 snapshot 也全绿）。
13. **真栈验不到 PG 那份名字**（Task 9 Step 4）。
14. **判据 8 的「悬停出现」只在真栈一条路径上量过**：键盘 `focus-within` 那半条
    **组件层量不出**（happy-dom 没有 CSS 引擎，#005-07）——真栈上也只量了 `hover` 一种。
15. **删除的「可重入」在真栈上未覆盖**：真栈只删一次；第二次调用只在路由测试里钉。
16. **spec §11 取舍 1 那条**（悬停「⋯」不摸到就不出现）**是设计接受的缺口**，不是本轮能修的
    ——缓解只有键盘聚焦也出现，而那需要浏览器真的用 Tab 走一遍（真栈未做）。
17. **spec §11 取舍 8「删掉快照 / worktree 残留之后会不会影响执行」本轮没量出来**：真栈 spec
    （Task 9）**没有造过任何快照或 worktree 残留** ⇒ `dropResidue` 在那条链上**删的是空**
    （目录本来就不存在），「删了它会不会影响后续执行」这件事**一次都没被观测到**。
    **为什么测不了**：要观测它得先在真栈上真跑一次产生快照 / worktree 的流程（改一次文件、
    进一次 worktree），再删项目、再验证后续操作不受影响——成本与本 feature 不成比例。
    **危险在哪**：`dropResidue` 删的是 `join(Global.Path.data, "snapshot"|"worktree", projectId)`
    ——那是**全局数据目录**下的路径，删错一层就是别人的数据。当前它只靠
    「路径由 `projectId` 拼成」这一条**论证**保着，没有实测（同 `#002-02` 的取向：
    没测到的写成缺口，不写成没问题）。

```

- [ ] 改 spec §6 末「待实施时核实的两条」——两条都已核实，逐条写明：

```
**已核实（2026-10-17 实施时）**：
- ✅ MinIO 删除对象的能力**已有**：`Minio.Interface.delete({path})`（`packages/core/src/minio.ts`）
  ⇒ 删除备份 = 按成员 scope `list()` ＋ 逐键 `delete`（不是整桶清空）。
- ✅ `project_directory` 行**没有别的读取者按「项目存在与否」依赖它**（⑥ 步清点见 Task 3 Step 7）
  ⇒ 删除它是安全的。
```

### Step 6: 与 spec §12 对账

- [ ] 确认：本 feature 的提交与 `2026-10-16-file-op-failure-in-place` 那份**不混在一个提交里**（spec §12 明写）——`git log --oneline -20` 看一遍，写下一步结论。

- [ ] 确认 §9 的「明确不改」三处真的一个字没动：

```bash
cd /d/project/study/openhive/openhive && git log --oneline --name-only -12 | grep -E "inline-rename-input|layout-new" ; echo "（无输出 = 确实没动）"
```

### Step 7: LEARNINGS 追加（`CLAUDE.md` 要求：feature 收尾时人工追加 1-5 条）

- [ ] 在 `LEARNINGS-full.md` 顶部与 `LEARNINGS.md` 顶部各追加同号条目。本 feature 的候选（**逐条判断值不值得记**，宁可少记）：

```
## #007-01 · 2026-10-17 · decision-rethink · 007-project-rename-delete
**一句话**：spec 写下的**次序**自己可能跟 spec 自己写下的**另一条性质**打架——§6 的删除次序
（① 先删 `project_member` … ⑤ 最后清 MinIO）让 §6 末尾那条「可重入」**当场不成立**：
成员关系一删，第二次调用就重建不出「哪些成员的前缀要清」⇒ 备份成永久孤儿。
**应对**：把 spec 里的**清单**（清哪几处）与**次序**（先摘账后删盘）分开读——清单是需求，
次序是**论证**，而论证要与该节其它性质**一起**验一遍（尤其「可重入 / 幂等 / 失败可重试」这类
跨步性质，它们约束的正是次序本身）。
**应用范围**：任何多步清理 / 迁移 / 建置的 spec；任何「每步都幂等 ⇒ 整体可重入」的假设
（**每步都幂等 ≠ 整体可重入**：步子之间的**依赖**会让前一步把后一步的输入删掉）。

## #007-02 · 2026-10-17 · pitfall · 007-project-rename-delete
**一句话**：同一个值存在**两个存储**里、而**读者按身份分流**时（owner 读本地、成员读共享库），
「两处一起写」这件事**没有任何单项断言看得出来**——两个读者各读各的，谁都不会发现另一半没变。
**应对**：判据要**按读者**各写一条（「owner 读到的变了」＋「成员读到的变了」），
而不是「写入动作调了两次」；变异验证时**只拆一处**，看是否**恰好那一条**红。
**应用范围**：任何「一份数据两处存、读者按角色 / 协议 / 缓存层分流」的仓库（v1/v2、本地/远端、
缓存/主库；同 `#006-27` 的族）。
```

- [ ] 逐条对照 `LEARNINGS.md` 的模板（现象/决策、应对、应用范围）写全，**正文进 `LEARNINGS-full.md`、索引条目进 `LEARNINGS.md`**。

### Step 8: 最终提交

```bash
cat > /tmp/task10.txt <<'EOF'
docs: 项目重命名与删除收尾——门禁、与 spec §10 §11 对账、缺口表、LEARNINGS

- spec §11 追加七条缺口（minio 删除行的残差、改名写入次序在成功路径上不可观测、
  dropResidue 的 worktree 那一半没有守护者、真栈验不到 PG 那份名字、悬停可见性的量法缺口、
  可重入的真栈覆盖缺口）。
- spec §6 末「待实施时核实的两条」改成已核实（MinIO 删除能力已有；project_directory 无别的读取者）。
- LEARNINGS 追加 #007-01（spec 的次序与它自己的另一条性质打架）、
  #007-02（一个值两处存、读者按身份分流 ⇒ 判据要按读者各写一条）。

这是要保留的定制。
EOF
```

```bash
cd /d/project/study/openhive/openhive && git add docs/superpowers/specs/2026-10-16-project-rename-delete-design.md LEARNINGS.md LEARNINGS-full.md && git commit -F /tmp/task10.txt
```

- [ ] 清理本 feature 的临时工作区（Task 0 建的 `.superpowers/sdd/2026-10-16-project-rename-delete/`）——它只记基线，用完即弃。

---

## 收尾

全部任务完成后：

- [ ] 跑 `superpowers:verification-before-completion` 做一次收尾对账。
- [ ] 用 `superpowers:finishing-a-development-branch` 决定分支去处（**推送是对外且不可逆的 —— 未经明确指示不得推送**）。
- [ ] **不要**把本 feature 与 `2026-10-16-file-op-failure-in-place` 的提交合在一起（spec §12）。
