# 项目级 skill 启用（送达）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 民警在资产中心点「启用」，把一份已发布的 skill 链接进**自己那个项目**的 `.opencode/skill/`，使下一次对话真的能调用它；每项目最多 20 个。

**Architecture:** **数据库是事实，目录是投影。** `auth.project_asset_enablement` 记「哪个项目启用了哪个资产、谁启用的、什么时候」；文件系统上在每个项目目录的 `.opencode/skill/{assetId}` 建一条**链接**（Windows 用 junction，POSIX 用符号链接）指向已发布资产目录。启用/停用都在一个 HTTP 模块里：写库 → 改链接 → 丢弃该项目的内核实例缓存（`InstanceStore.disposeDirectory`）→ 记审计。列表接口每次返回服务端权威的启用集合，前端只渲染，不自己算。

**Tech Stack:** Bun monorepo · TypeScript 5.8 · Effect 4.0.0-beta（`HttpRouter` / `Effect.gen`）· Drizzle ORM（裸 `sql` 模板）· PostgreSQL（`auth` schema）· SolidJS 1.9 · bun:test。

**Spec:** 本计划没有独立的 spec 文件；需求来源是 2026-10-27 用户与助手的会话裁定（三态卡片、每项目 20 上限、链接送达、重新打开生效），以及 `D:\project\study\openhive\2026-10-27-openhive-assets-delivery-review.md` §5（链接方案）与 §7（送达要看得见、收得回）。本文件把这些裁定固化成可验收的步骤。

---

## Global Constraints

以下每条对本计划**所有**任务生效，逐字照做：

1. **最小化与上游合并冲突**：只**新增**文件（`0021_*.sql`、`enablement.ts`、`project-skill-link.ts`、`project-assets.ts`、前端两个新文件）；对既有文件的改动只允许「加一行 import / 加一个 prop / 加一行注册」，并在改动处写 `// 【保留的定制 · 同步上游时不要丢】`。
2. **根目录禁止 `bun test`**（`package.json` 的 `test` 脚本 `exit 1`）。一律进受影响 package 内跑：`cd packages/asset-service`、`cd packages/opencode`、`cd packages/app`。
3. **红线**：不谎称改了（报告只写跑过的命令与实得输出）；不做表面修改（找不到根因不动代码）；不把测不了的写成已覆盖。
4. **不碰**：`bun.lock`（`bun install` 后必须 `git diff --stat bun.lock` 为空）、`%TEMP%\openhive-real-stack-state`、`D:\openhive-stack-state`、远端库的演示数据与 `is_admin`。
5. **不改上游文件**：`packages/opencode/src/skill/index.ts`、`packages/opencode/src/config/paths.ts`、`packages/app/src/ai-assets/asset-card.tsx` 的**既有语义**都不改；`asset-card.tsx` 只加 prop 与一个 sibling 按钮。
6. **审计动作词表是闭集**：新增动作必须同时进 `packages/auth/src/audit.ts` 的 `AUDIT_ACTIONS` 与 `packages/app/src/governance/audit-log-api.ts` 的标签映射（后者是 `Record<AuditAction, string>`，漏了会类型错——这是护栏，别绕）。
7. **一条判定只有一份实现**：能不能读资产一律调 `canReadAsset()`；项目成员判定一律调 `rolesOf()`；资产目录一律由 `publishDirectory()` 算；项目目录一律由 `projectDirectory()` 算。
8. **每个 task 结束跑门禁**：受影响 package 的 `bun test` 子集 ＋ `bun run typecheck`（仓库根跑 turbo）＋ `bun run lint`。输出贴进报告。
9. **跑测试必须带钟罩（2026-10-27 用户指令：防止死循环/内存溢出把机器搞死）**：每条 `bun test` 前面加 `timeout`，例如
   `timeout 300 bun test src/enablement.test.ts`；**禁止**不带上限地跑整包/整仓测试。
   理由是实测过的：`bun test` 的 `--timeout` 只对**异步**用例生效，**同步死循环**里 bun 自己中断不了——
   2026-10-27 17:26 有一个 `bun test src/ai-assets/asset-center.test.tsx` 在 84 秒内涨到 12.6 GB、
   单核 100% 空转，靠外部 `wmic ... call terminate` 才停住。没有外部钟罩就会一路吃到换页、整机卡死。
   若命令被 `timeout` 杀掉（退出码 124），**不许自动重跑**：先查那条用例是不是死循环，写进报告。

## 范围裁定（执行前必读，已向用户明示）

| # | 裁定 | 理由 | 若判错的代价 |
|---|---|---|---|
| R1 | **只有 `status='published'` 的 skill 可启用**，草稿/待审/迭代中/下线一律 409 | 只有已发布资产有共享目录可链接（`publishDirectory` 只认 global/department；草稿停在作者沙箱，没有可链接的落点） | 用户若要求「自己的草稿在自己项目里即用」，需另起一个 feature（要在启用时带上作者沙箱路径，今天是未知量） |
| R2 | **项目成员（owner 或 member）都能启用/停用**，不限于 owner | 启用是「干活」不是「项目治理」；owner 专属的是归档/改名/移除成员 | 若要求仅 owner，改 `rolesOf` 判定一处即可 |
| R3 | 同名拦截以 **SKILL.md frontmatter 的 `name`** 为准，用内核同一个解析器（`ConfigMarkdown.parse`） | 资产显示名 `auth.asset.name` 与 skill 真实名可能不同；内核按 frontmatter 名去重，我们拦的必须是同一个东西 | 若改用资产名，两份同 frontmatter 名的资产能同时启用，内核静默 last-wins |
| R4 | 启用/停用后调 `InstanceStore.disposeDirectory(项目目录)` 使**下一条消息**生效，不再只靠「重开项目」 | 内核 skill 清单是 `InstanceState` 按目录缓存一次（实测代码：`skill/index.ts:259-266`），不丢弃缓存则本进程内永不重读 | 若该调用在某些场景抛错，退回「重启内核才生效」，功能形同废纸 |

---

## 文件结构

**新增（后端）**

| 文件 | 职责 |
|---|---|
| `packages/auth/src/migrations/0021_project_asset_enablement.sql` | 启用关系表（项目 × 资产 × 启用人 × 时间） |
| `packages/auth/src/migrations/0021_project_asset_enablement.down.sql` | 回滚 |
| `packages/asset-service/src/enablement.ts` | 只碰库：读启用集合、启用（带上限守卫）、停用 |
| `packages/asset-service/src/enablement.test.ts` | 上者的单测（真 PG 夹具，同 `preferences.test.ts` 风格） |
| `packages/asset-service/src/project-skill-link.ts` | 只碰文件系统：建/删/对账链接，算链接目标 |
| `packages/asset-service/src/project-skill-link.test.ts` | 上者的单测（临时目录，真链接） |
| `packages/opencode/src/server/openhive/project-assets.ts` | HTTP 出口：三条路由 ＋ 编排（校验、上限、同名、链接、丢缓存、审计） |
| `packages/opencode/test/server/openhive-project-assets.test.ts` | 真应用 ＋ 真 PG ＋ 真目录的集成测 |

**新增（前端）**

| 文件 | 职责 |
|---|---|
| `packages/app/src/ai-assets/enable-api.ts` | 三条出口的客户端（同源 HTTP），`Outcome` 三态 |
| `packages/app/src/ai-assets/enable-api.test.ts` | 上者 |
| `packages/app/src/ai-assets/enable-state.ts` | Solid 状态：当前项目的启用集合、计数、上限、busy、错误；跟随当前项目切换 |
| `packages/app/src/ai-assets/enable-state.test.tsx` | 上者 |

**修改（逐处都写 `【保留的定制 · 同步上游时不要丢】`）**

| 文件 | 改什么 |
|---|---|
| `packages/auth/src/audit.ts:61-80` | `AUDIT_ACTIONS` 加 `"asset.enable"`、`"asset.disable"` |
| `packages/app/src/governance/audit-log-api.ts:52` 附近 | 两个新动作的中文标签 |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 注册 `project-assets` 路由层（照抄 `project.ts` 那一行） |
| `packages/app/src/ai-assets/asset-card.tsx` | 加三个可选 prop ＋ 一个 sibling「启用」按钮 |
| `packages/app/src/ai-assets/asset-grid.tsx` | 把 enablement 透传给卡片 |
| `packages/app/src/ai-assets/asset-center.tsx` | 顶部「已启用 N/20」计数条 ＋ 透传 |
| `packages/app/src/workspace/workspace-entry.tsx` | 加一个可选 prop `enablement`，往中栏透传 |
| `packages/app/src/pages/layout-new.tsx` | 建 `createProjectEnablement()`，绑到 `currentProject`，传进 `WorkspaceEntry` |

---

### Task 1: 启用关系表与库层

**Files:**
- Create: `packages/auth/src/migrations/0021_project_asset_enablement.sql`
- Create: `packages/auth/src/migrations/0021_project_asset_enablement.down.sql`
- Create: `packages/asset-service/src/enablement.ts`
- Test: `packages/asset-service/src/enablement.test.ts`

**Interfaces:**
- Produces:
  - `ENABLEMENT_LIMIT: 20`
  - `interface EnablementState { enabled: readonly string[]; enabledCount: number; limit: number }`
  - `enablementOf(db, projectId): Promise<EnablementState>`
  - `enableAsset(db, { projectId, assetId, userId, now? }): Promise<"enabled" | "already_enabled" | "limit_reached">`
  - `disableAsset(db, { projectId, assetId }): Promise<boolean>`
  - `enabledAssetIds(db, projectId): Promise<string[]>`
  - `interface EnablementTarget { execute(query: SQL): PromiseLike<unknown> }`

- [ ] **Step 1: 写迁移**

`packages/auth/src/migrations/0021_project_asset_enablement.sql`：

```sql
-- 0021_project_asset_enablement：项目级 skill 启用关系（2026-10-27，用户裁定）。
--
-- 「发布」只是把 skill 复制进共享卷；内核从不读共享卷（`skill/index.ts:186-218` 只扫
-- 项目 `.opencode`、全局配置目录、`.claude/skills`、`.agents/skills`）。本表补的就是
-- 「谁把哪一份装进了哪个项目」——**事实在库，目录是它的投影**（`project-skill-link.ts`）。
--
-- 设计取向：
-- - **只有一张表**：启用＝一行，停用＝删那行。不存「目录是否真的建好了」——目录状态由
--   每次打开资产中心 / 每次启停时的对账修回来，落库反而会漂（`LEARNINGS #007-02`）。
-- - `enabled_by` 记得住是谁开的这个口子：共享项目里任何成员都能启用（本计划 R2），
--   出事要能答「谁装的」。
-- - `asset_id` 外键**级联删除**：资产被 `discardAsset` 删掉时，启用关系跟着走，
--   不留指向空目录的行（与 `0019_user_preference.sql` 对 `user_id` 的处置同取向）。
-- - `enabled_by` 外键**也级联**（同 `0012` / `0019` 的所有 user 外键）：账号注销不能被启用
--   记录挡住。「谁装的」这件事的可查性由审计表（`auth.audit_event` 存 actor 快照）承担，
--   不靠这张关系表——两件事别混。⚠️ 别拿 `0009_asset.sql` 的 `owner_id` 当先例：那条**刻意
--   不级联**，因为「资产成了无主行」比「删不掉账号」更难查；启用关系不是资产本体。
-- - `project_id` **没有外键、也不可能有**：项目本体是 opencode 原生 `project` 表，
--   活在每用户 SQLite，与 PG 是两个库（同 `0005_project_member.sql` 的注释）。
--   悬空 project_id 本层查不出来，能拦它的只有写入侧（`project-assets.ts` 先查 `rolesOf`）。
-- - 主键 `(project_id, asset_id)`：同一份资产在一个项目里只会有一行，重复启用是空操作。
--
-- ⚠️ 上限（20）**不进 CHECK**：它是产品参数，要能调；落在 `enablement.ts` 的
--    `ENABLEMENT_LIMIT`，写入用「count < 上限」的子查询守卫。
--
-- ⚠️ 不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。

CREATE TABLE auth.project_asset_enablement (
  project_id text    NOT NULL,
  asset_id   text    NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  enabled_by text    NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  enabled_at integer NOT NULL,
  PRIMARY KEY (project_id, asset_id)
);

--> statement-breakpoint

-- 主键已覆盖「按项目查全部」；这条索引服务「这份资产被哪些项目启用了」——
-- 下线一份 skill 时要能反查并撤回（本计划尚未实现撤回，索引先留：反查是必然的下一条）。
CREATE INDEX project_asset_enablement_asset_idx
  ON auth.project_asset_enablement (asset_id);

--> statement-breakpoint

COMMENT ON TABLE auth.project_asset_enablement IS
  '项目级 skill 启用关系（项目 × 资产）；启用写一行、停用删一行，目录是其投影';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.project_id IS
  '项目标识（悬空值本层查不出来：项目本体在每用户 SQLite，跨库无外键）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.asset_id IS
  '被启用的资产 id（指向 auth.asset；资产删除时本行级联消失）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.enabled_by IS
  '启用人（共享项目里任一成员都可启用，出事要能答「谁装的」）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.enabled_at IS
  '启用时间（Unix 秒；不要写毫秒，见 0001_init.sql 的警告）';
```

`packages/auth/src/migrations/0021_project_asset_enablement.down.sql`：

```sql
DROP TABLE IF EXISTS auth.project_asset_enablement;
```

- [ ] **Step 2: 先写会红的用例**

`packages/asset-service/src/enablement.test.ts`（夹具与 `preferences.test.ts` 同源：先读那个文件，照它的 `beforeAll` 造 `auth.user` / `auth.asset` 行；**不要**自己另造一套 PG 启动代码）：

```ts
import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import {
  disableAsset,
  enableAsset,
  enabledAssetIds,
  enablementOf,
  ENABLEMENT_LIMIT,
} from "./enablement"

// 夹具：`beforeAll` 里建好两个用户（`u1` / `u2`）与 25 份 published 资产（`asset_t01` … `asset_t25`）。
// 项目 id **不需要预建**：`project_id` 没有外键（项目本体在每用户 SQLite），`proj_a` … `proj_f`
// 随便起。具体写法照抄 `preferences.test.ts` 的 `startProductionDb` + `migrate` + 手工 insert，
// 不要新写一份。
describe("enablement", () => {
  test("空项目：启用集合为空，上限是 20", async () => {
    const state = await enablementOf(db, "proj_a")
    expect(state).toEqual({ enabled: [], enabledCount: 0, limit: ENABLEMENT_LIMIT })
    expect(ENABLEMENT_LIMIT).toBe(20)
  })

  test("启用一次写入一行，重复启用是空操作（不重复计数）", async () => {
    expect(await enableAsset(db, { projectId: "proj_a", assetId: "asset_t01", userId: "u1", now: 1000 })).toBe(
      "enabled",
    )
    expect(await enableAsset(db, { projectId: "proj_a", assetId: "asset_t01", userId: "u1", now: 2000 })).toBe(
      "already_enabled",
    )
    expect(await enabledAssetIds(db, "proj_a")).toEqual(["asset_t01"])
    // 启用人/时间以**首次**为准：第二次不覆盖
    const rows = rowsOf(
      await db.execute(sql`
        select enabled_by, enabled_at from auth.project_asset_enablement
         where project_id = 'proj_a' and asset_id = 'asset_t01'
      `),
    )
    expect(rows).toEqual([{ enabled_by: "u1", enabled_at: 1000 }])
  })

  test("第 21 个被上限挡下，前 20 个都在", async () => {
    for (let index = 1; index <= ENABLEMENT_LIMIT; index += 1) {
      const id = `asset_t${String(index).padStart(2, "0")}`
      await enableAsset(db, { projectId: "proj_b", assetId: id, userId: "u1", now: 1000 })
    }
    expect(await enableAsset(db, { projectId: "proj_b", assetId: "asset_t21", userId: "u1", now: 1000 })).toBe(
      "limit_reached",
    )
    const state = await enablementOf(db, "proj_b")
    expect(state.enabledCount).toBe(ENABLEMENT_LIMIT)
    expect(state.enabled).not.toContain("asset_t21")
  })

  test("停用删掉那一行；再停用一次返回 false", async () => {
    expect(await disableAsset(db, { projectId: "proj_b", assetId: "asset_t01" })).toBe(true)
    expect(await disableAsset(db, { projectId: "proj_b", assetId: "asset_t01" })).toBe(false)
    expect(await enabledAssetIds(db, "proj_b")).not.toContain("asset_t01")
  })

  test("两个项目互不相干", async () => {
    await enableAsset(db, { projectId: "proj_a", assetId: "asset_t02", userId: "u1", now: 1000 })
    expect(await enabledAssetIds(db, "proj_a")).toEqual(["asset_t01", "asset_t02"])
    expect(await enabledAssetIds(db, "proj_b")).not.toContain("asset_t02")
  })

  // 上限已满时，**已经启用过**的那一份再点一次必须是 `already_enabled`，不能被上限误判成
  // 「装不下了」。守卫一旦被重排成「先判上限、再判是否已启用」，用户就再也点不动已装的那份。
  test("满员时重复启用已启用项 ⇒ already_enabled（不是 limit_reached）", async () => {
    for (let index = 1; index <= ENABLEMENT_LIMIT; index += 1) {
      await enableAsset(db, { projectId: "proj_c", assetId: `asset_t${String(index).padStart(2, "0")}`, userId: "u1" })
    }
    expect(await enableAsset(db, { projectId: "proj_c", assetId: "asset_t05", userId: "u1" })).toBe("already_enabled")
  })

  test("最近启用的在前（时间不同，不是靠 id 排序凑出来的）", async () => {
    await enableAsset(db, { projectId: "proj_d", assetId: "asset_t03", userId: "u1", now: 1000 })
    await enableAsset(db, { projectId: "proj_d", assetId: "asset_t01", userId: "u1", now: 2000 })
    await enableAsset(db, { projectId: "proj_d", assetId: "asset_t02", userId: "u1", now: 3000 })
    expect(await enabledAssetIds(db, "proj_d")).toEqual(["asset_t02", "asset_t01", "asset_t03"])
  })

  test("删掉资产 ⇒ 它的启用行跟着消失（外键级联）", async () => {
    await enableAsset(db, { projectId: "proj_e", assetId: "asset_t24", userId: "u1" })
    await db.execute(sql`delete from auth.asset where id = 'asset_t24'`)
    expect(await enabledAssetIds(db, "proj_e")).toEqual([])
  })

  test("删掉启用人 ⇒ 启用行跟着消失（enabled_by 也级联）", async () => {
    await db.execute(sql`insert into auth.user (id, name) values ('u_del', '待删')`)
    await enableAsset(db, { projectId: "proj_f", assetId: "asset_t25", userId: "u_del" })
    await db.execute(sql`delete from auth.user where id = 'u_del'`)
    expect(await enabledAssetIds(db, "proj_f")).toEqual([])
  })
})
```

> 夹具注意：`auth.user` 的必填列以 `0001_init.sql` 为准（上面那行 `insert` 只是形状示例，
> 实现者按真实列补齐，别照抄）。`asset_t24` / `asset_t25` 专供这两条级联用例，别的用例不碰。

- [ ] **Step 3: 跑，确认红**

Run: `cd packages/asset-service && bun test src/enablement.test.ts`
Expected: FAIL — `Cannot find module './enablement'`（模块还没有就对了）。

- [ ] **Step 4: 写实现**

`packages/asset-service/src/enablement.ts`：

```ts
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"

/**
 * 项目级 skill 启用关系（2026-10-27）。
 *
 * ## 事实在库，目录是投影
 *
 * 本文件只碰 `auth.project_asset_enablement` 一张表。把 skill 链接进项目目录那件事在
 * `project-skill-link.ts`，两件事**分开**：链接失败（权限、磁盘）不该把库写脏，
 * 库写成功而链接失败时由下一次对账修回来（`reconcileSkillLinks`）。
 *
 * ## 上限用子查询守卫，**但它只是软上限**
 *
 * `insert ... select ... where (count < 上限)` 把「查」和「写」收进一条语句，省掉应用层的
 * 两次往返。**它挡不住并发**：PG 默认 READ COMMITTED（`migrations/README.md` 的迁移运行器
 * 前提），`count` 子查询不锁任何行 ⇒ 两个并发语句各按自己的快照看到 19，资产不同则主键不冲突，
 * 都插进去，最终 21 行。
 *
 * 这个残差是**接受**的：启用是人的点击动作，两次点击相隔以秒计；且真超了也只是多装一个 skill，
 * 下一次停用就回来了。真要硬保证得上事务 ＋ `pg_advisory_xact_lock(hashtext(项目 id))`
 * （`auth/migrate.ts` 有同样的先例），但 `EnablementTarget` 只有 `execute`、拿不到那把锁——
 * **不为一个人工动作引入事务边界**。
 *
 * 并发下另一种瞬时态：实际插入 0 行、随后再读也不是已启用 ⇒ 回 `limit_reached`，
 * 比回「已启用」安全（前者让用户重试，后者骗他说装好了）。
 *
 * ## 时间一律 Unix 秒
 *
 * 毫秒装不进 `integer`（`0001_init.sql` 的警告；`auth/time.ts` 的 `nowSeconds()`）。
 */

/** 每个项目最多启用的 skill 数（产品参数，不进 DB CHECK：要能调）。 */
export const ENABLEMENT_LIMIT = 20

/** 能跑 SQL 的句柄（形状同 `PreferenceTarget` / `AssetTarget`）。 */
export interface EnablementTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface EnablementState {
  /** 已启用的资产 id，**最近启用的在前**（同时间按 id 升序，保证稳定）。 */
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
}

function nowSeconds(now: number | undefined): number {
  return now ?? Math.floor(Date.now() / 1000)
}

/**
 * 一个项目的启用集合（服务端权威；前端只渲染这个）。
 *
 * `limit` **不接受入参**：上报给前端的数与守卫用的数必须是同一个常量，两处各传一份迟早
 * 漂成「启用说没到上限、读回来显示超了」（`#002-06`：同一个判断两处各写一份，早晚不等）。
 */
export async function enablementOf(db: EnablementTarget, projectId: string): Promise<EnablementState> {
  const enabled = await enabledAssetIds(db, projectId)
  return { enabled, enabledCount: enabled.length, limit: ENABLEMENT_LIMIT }
}

export async function enabledAssetIds(db: EnablementTarget, projectId: string): Promise<string[]> {
  const result = await db.execute(sql`
    select asset_id
      from auth.project_asset_enablement
     where project_id = ${projectId}
     order by enabled_at desc, asset_id asc
  `)
  return rowsOf(result).map((row) => String(row.asset_id))
}

export interface EnableInput {
  readonly projectId: string
  readonly assetId: string
  /** 启用人（审计与「谁装的」）。 */
  readonly userId: string
  /** Unix 秒；测试传固定值。 */
  readonly now?: number
}

export type EnableResult = "enabled" | "already_enabled" | "limit_reached"

/**
 * 启用一份资产。返回值三态：
 * - `enabled`：这次真的插了；
 * - `already_enabled`：早就启用过（幂等，不覆盖启用人/时间）；
 * - `limit_reached`：数到上限，没插。
 */
export async function enableAsset(db: EnablementTarget, input: EnableInput): Promise<EnableResult> {
  const inserted = await db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    select ${input.projectId}, ${input.assetId}, ${input.userId}, ${nowSeconds(input.now)}
     where (
       select count(*) from auth.project_asset_enablement where project_id = ${input.projectId}
     ) < ${ENABLEMENT_LIMIT}
    on conflict (project_id, asset_id) do nothing
    returning asset_id
  `)
  if (rowsOf(inserted).length > 0) return "enabled"
  // 没插进去只有两种可能：已经启用过，或者数已到上限。再读一次分辨。
  const existing = await db.execute(sql`
    select 1 from auth.project_asset_enablement
     where project_id = ${input.projectId} and asset_id = ${input.assetId}
  `)
  return rowsOf(existing).length > 0 ? "already_enabled" : "limit_reached"
}

/** 停用。返回 `true` = 真的删了一行（重复停用是空操作）。 */
export async function disableAsset(
  db: EnablementTarget,
  input: { readonly projectId: string; readonly assetId: string },
): Promise<boolean> {
  const result = await db.execute(sql`
    delete from auth.project_asset_enablement
     where project_id = ${input.projectId} and asset_id = ${input.assetId}
    returning 1
  `)
  return rowsOf(result).length > 0
}

/**
 * 删项目时清掉它的全部启用行（**不是**本模块的启停链，是项目删除链的同类落点）。
 *
 * 为什么必须有：`project_id` 没有外键（项目本体在每用户 SQLite），删项目时没有任何东西
 * 会替我们清这张表 ⇒ 删掉的项目会永久留下一批读不到、也清不掉的启用行。仓库里同类的
 * 项目级 PG 表（`project_member` / `project_archive` / `project_meta`）都在
 * `archive.ts` 的删除链第 5 步逐个 `remove*`，本函数是那一组的第四个成员（`#002-06`：
 * 找的是「谁在按同一个前提做同一件事」）。
 *
 * 调用点：`packages/opencode/src/server/openhive/archive.ts` 的删除链第 5 步。
 */
export async function removeProjectEnablement(
  db: EnablementTarget,
  input: { readonly projectId: string },
): Promise<void> {
  await db.execute(sql`
    delete from auth.project_asset_enablement where project_id = ${input.projectId}
  `)
}
```

`enablement.test.ts` 里补上缺的 import：`import { rowsOf } from "@opencode-ai/auth/migrate"`。

- [ ] **Step 5: 跑，确认绿**

Run: `cd packages/asset-service && bun test src/enablement.test.ts`
Expected: 5 passed。

- [ ] **Step 6: 变异验证**（CLAUDE.md 六步轨道的第 ④ 步）

把 `enableAsset` 里的 `where ( ... ) < ${limit}` 整段删掉，重跑 → 「第 21 个被上限挡下」必须红，实得 `expect(received).toBe(expected)`，received `"enabled"`。改回。把 `on conflict ... do nothing` 删掉，重跑 → 「重复启用是空操作」必须红（抛唯一键冲突）。改回。

- [ ] **Step 7: 门禁**

Run: `cd packages/asset-service && bun test && bun run typecheck`；仓库根 `bun run lint`。全部通过才继续。

- [ ] **Step 8: 提交**

```bash
git add packages/auth/src/migrations/0021_project_asset_enablement.sql \
        packages/auth/src/migrations/0021_project_asset_enablement.down.sql \
        packages/asset-service/src/enablement.ts \
        packages/asset-service/src/enablement.test.ts
git commit -m "feat(assets): 项目级 skill 启用关系表与库层（每项目上限 20）"
```

---

### Task 2: 链接投影（文件系统）

**Files:**
- Create: `packages/asset-service/src/project-skill-link.ts`
- Test: `packages/asset-service/src/project-skill-link.test.ts`

**Interfaces:**
- Consumes: `publishDirectory` / `assertSafeSegment`（`./storage`）
- Produces:
  - `SKILL_LINK_DIR = ".opencode/skill"`
  - `skillLinkTarget(assetsRoot, asset): string`
  - `skillLinkPath(projectDir, assetId): string`
  - `linkSkill(projectDir, assetId, target): Promise<void>`
  - `unlinkSkill(projectDir, assetId): Promise<void>`
  - `reconcileSkillLinks(projectDir, desired: ReadonlyMap<string, string>): Promise<{ created: number; removed: number; skipped: string[] }>`
  - `class NotALinkError extends Error`

**实测背景（2026-10-27 本机 Windows 10 + Node 内建 fs，已跑过）：**

```
junction 建：fs.symlinkSync(target, link, "junction")  —— 不需要管理员权限、不需要 mklink
lstat：isSymbolicLink() === true（**junction 被 lstat 认成链接**，可直接用它判类型）
readlinkSync：回绝对目标路径
重复建：EEXIST
removal：fs.unlinkSync(link) 成功，**目标文件仍在**
fs.rmSync(link, {recursive:true, force:true}) 也安全，但只删链接
```

⇒ 删除一律走 `unlink`，**不用 `rm --recursive`**：对真目录 `unlink` 会 EISDIR/EPERM（我们因此不会误删用户自己的 skill 目录），对链接则只摘链。

- [ ] **Step 1: 先写会红的用例**

`packages/asset-service/src/project-skill-link.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  linkSkill,
  NotALinkError,
  reconcileSkillLinks,
  SKILL_LINK_DIR,
  skillLinkPath,
  skillLinkTarget,
  unlinkSkill,
} from "./project-skill-link"

let 根: string
let 项目: string
let 已发布: string

beforeEach(() => {
  根 = mkdtempSync(join(tmpdir(), "openhive-link-"))
  项目 = join(根, "sandbox", "u1", "proj_1")
  已发布 = join(根, "assets", "global", "skills", "asset_1")
  mkdirSync(项目, { recursive: true })
  mkdirSync(已发布, { recursive: true })
  writeFileSync(join(已发布, "SKILL.md"), "---\nname: 资金分析\ndescription: 测试\n---\n")
})

afterEach(() => rmSync(根, { recursive: true, force: true }))

describe("project-skill-link", () => {
  test("链接目标按 published 目录算；全局与部门两档", () => {
    expect(skillLinkTarget("/assets", { id: "a1", visibility: "global", department: "" })).toBe(
      join("/assets", "global", "skills", "a1"),
    )
    expect(skillLinkTarget("/assets", { id: "a2", visibility: "department", department: "刑侦" })).toBe(
      join("/assets", "dept", "刑侦", "skills", "a2"),
    )
  })

  test("建、读、删：删完链接没了、目标还在", async () => {
    const link = skillLinkPath(项目, "asset_1")
    await linkSkill(项目, "asset_1", 已发布)
    expect(link).toBe(join(项目, SKILL_LINK_DIR, "asset_1"))
    expect(readlinkSync(link)).toBe(已发布)
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toContain("资金分析")
    await unlinkSkill(项目, "asset_1")
    expect(existsSync(link)).toBe(false)
    expect(existsSync(join(已发布, "SKILL.md"))).toBe(true)
  })

  test("重复建是空操作（幂等）", async () => {
    await linkSkill(项目, "asset_1", 已发布)
    await linkSkill(项目, "asset_1", 已发布)
    expect(readlinkSync(skillLinkPath(项目, "asset_1"))).toBe(已发布)
  })

  test("目标变了就换链接（重发布后指向新目录）", async () => {
    const 新的 = join(根, "assets", "dept", "刑侦", "skills", "asset_1")
    mkdirSync(新的, { recursive: true })
    await linkSkill(项目, "asset_1", 已发布)
    await linkSkill(项目, "asset_1", 新的)
    expect(readlinkSync(skillLinkPath(项目, "asset_1"))).toBe(新的)
  })

  test("删一个不是链接的真目录：抛 NotALinkError，目录原封不动", async () => {
    const 真目录 = skillLinkPath(项目, "asset_9")
    mkdirSync(真目录, { recursive: true })
    writeFileSync(join(真目录, "SKILL.md"), "手写的")
    await expect(unlinkSkill(项目, "asset_9")).rejects.toBeInstanceOf(NotALinkError)
    expect(existsSync(join(真目录, "SKILL.md"))).toBe(true)
  })

  test("删不存在的链接是空操作", async () => {
    await unlinkSkill(项目, "asset_x")
  })

  test("对账：多出来的链接被摘、缺的补上、真目录被跳过", async () => {
    const 另一个 = join(根, "assets", "global", "skills", "asset_old")
    mkdirSync(另一个, { recursive: true })
    await linkSkill(项目, "asset_old", 另一个)
    mkdirSync(skillLinkPath(项目, "asset_manual"), { recursive: true })

    const 结果 = await reconcileSkillLinks(项目, new Map([["asset_1", 已发布], ["asset_2", 已发布]]))
    expect(结果).toEqual({ created: 2, removed: 1, skipped: [] })
    expect(existsSync(skillLinkPath(项目, "asset_old"))).toBe(false)
    expect(existsSync(skillLinkPath(项目, "asset_1"))).toBe(true)
    expect(existsSync(skillLinkPath(项目, "asset_manual"))).toBe(true)
  })

  // 两种「真目录」要分开：`desired` 之外的（上一条用例）是用户自己的，静默不动；
  // `desired` 里的名字被真目录占住时，那一份 skill **送不到**，必须据实报给调用方去告警
  // ——而且不能因此中断整次对账（其余条目的链接照样要建）。
  test("对账：要建的名字被手写真目录占住 ⇒ 进 skipped、不中断、其余照建", async () => {
    const 占位 = skillLinkPath(项目, "asset_9")
    mkdirSync(占位, { recursive: true })
    writeFileSync(join(占位, "SKILL.md"), "手写的")

    const 结果 = await reconcileSkillLinks(
      项目,
      new Map([
        ["asset_9", 已发布],
        ["asset_1", 已发布],
      ]),
    )

    expect(结果).toEqual({ created: 1, removed: 0, skipped: [占位] })
    expect(readFileSync(join(占位, "SKILL.md"), "utf8")).toBe("手写的")
    expect(existsSync(skillLinkPath(项目, "asset_1"))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑，确认红**

Run: `cd packages/asset-service && bun test src/project-skill-link.test.ts`
Expected: FAIL — `Cannot find module './project-skill-link'`。

- [ ] **Step 3: 写实现**

`packages/asset-service/src/project-skill-link.ts`：

```ts
import { lstat, mkdir, readdir, readlink, symlink, unlink } from "node:fs/promises"
import { join } from "node:path"
import { assertSafeSegment, publishDirectory } from "./storage"

/**
 * 把已发布的 skill **链接**进项目目录（2026-10-27）。
 *
 * 内核发现 skill 的路径之一就是项目自己的 `.opencode/{skill,skills}/**\/SKILL.md`
 * （`skill/index.ts:24` 的 `OPENCODE_SKILL_PATTERN`，配合 `Glob.scan(..., symlink:true)`
 * 会跟进链接）。所以「送达」= 在 `<项目目录>/.opencode/skill/<assetId>` 建一条指向
 * `/assets/.../{assetId}` 的链接，**不复制**：一处更新处处生效，也不占额外空间。
 *
 * ## 平台差异（2026-10-27 本机实测）
 *
 * - Windows：`symlink(target, link, "junction")`。**不需要管理员**，也**不要**走
 *   `mklink` 子进程（`LEARNINGS #003-07`：别过 PowerShell）。junction 的 `lstat`
 *   照样 `isSymbolicLink() === true`，可直接用来判类型。
 * - 其他平台：`symlink(target, link, "dir")`。
 *
 * 链接目标**必须存在**（junction 的硬要求），所以调用方要先确认已发布目录在。
 *
 * ## 删只用 unlink
 *
 * `unlink` 对真目录会 EISDIR/EPERM ⇒ 手写进项目目录的真 skill 永远不会被我们误删。
 * 反过来 `rm -rf` 对链接虽然也安全，但这一层的判据就塌了：**它的安全性全靠调用参数**，
 * 而 `unlink` 的安全性靠**文件系统本身**。
 */

export const SKILL_LINK_DIR = join(".opencode", "skill")

/** skill 链接指向哪儿：与发布用的是同一个 `publishDirectory`（`#002-06`：一份算法）。 */
export function skillLinkTarget(
  assetsRoot: string,
  asset: { readonly id: string; readonly visibility: string; readonly department: string },
): string {
  return publishDirectory(
    assetsRoot,
    "skill",
    { visibility: asset.visibility as "global" | "department" | "personal", department: asset.department },
    asset.id,
  )
}

/** `<项目目录>/.opencode/skill/<assetId>`。assetId 逐段校验，不许带分隔符。 */
export function skillLinkPath(projectDir: string, assetId: string): string {
  return join(projectDir, SKILL_LINK_DIR, assertSafeSegment(assetId, "资产 id"))
}

/** 目标路径上不是我们建的链接（是手写的真目录 / 普通文件）。 */
export class NotALinkError extends Error {
  constructor(readonly path: string) {
    super(`不是链接，拒绝删除：${path}`)
    this.name = "NotALinkError"
  }
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null
    throw error
  }
}

function linkType(): "junction" | "dir" {
  return process.platform === "win32" ? "junction" : "dir"
}

/**
 * 建链接（幂等）：不存在就建；已是链接且指向同一目标就什么都不做；
 * 指向别处（重发布换了目录）就摘掉重建。
 */
export async function linkSkill(projectDir: string, assetId: string, target: string): Promise<void> {
  const link = skillLinkPath(projectDir, assetId)
  const 现有 = await lstatOrNull(link)
  if (现有 !== null) {
    if (!现有.isSymbolicLink()) throw new NotALinkError(link)
    if ((await readlink(link)) === target) return
    await unlink(link)
  }
  await mkdir(join(projectDir, SKILL_LINK_DIR), { recursive: true })
  await symlink(target, link, linkType())
}

/** 删链接（幂等）。真目录 ⇒ 抛 `NotALinkError`，一个字节都不动。 */
export async function unlinkSkill(projectDir: string, assetId: string): Promise<void> {
  const link = skillLinkPath(projectDir, assetId)
  const 现有 = await lstatOrNull(link)
  if (现有 === null) return
  if (!现有.isSymbolicLink()) throw new NotALinkError(link)
  await unlink(link)
}

export interface ReconcileResult {
  readonly created: number
  readonly removed: number
  /**
   * 想建却被占住的链接位（那个名字上是人自己放的真目录 / 文件）。
   * 据实回给调用方去记日志，不静默；`desired` **之外**的手写条目只是不动，不进这里
   * （那通常是用户自己放的项目级 skill，每次打开资产中心都告警一遍就是噪声）。
   */
  readonly skipped: string[]
}

/**
 * 对账：让 `.opencode/skill/` 下的**链接**与 `desired` 一致。
 *
 * - `desired` 里有、目录里没有 ⇒ 建；
 * - 目录里有链接、`desired` 里没有 ⇒ 摘；
 * - 目录里不是链接的条目 ⇒ **不动**。`desired` 之外的手写条目静默留着（那是人自己放的，
 *   不是我们的投影）；`desired` 里的名字被手写条目占住时记进 `skipped`，让调用方去告警，
 *   并且**不中断**整次对账（其余条目的链接照建）。
 */
export async function reconcileSkillLinks(
  projectDir: string,
  desired: ReadonlyMap<string, string>,
): Promise<ReconcileResult> {
  const dir = join(projectDir, SKILL_LINK_DIR)
  await mkdir(dir, { recursive: true })

  let created = 0
  let removed = 0
  const skipped: string[] = []

  const 现有: string[] = []
  try {
    for (const entry of await readdir(dir)) 现有.push(entry)
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error
  }

  for (const assetId of 现有) {
    if (desired.has(assetId)) continue
    const path = join(dir, assetId)
    const info = await lstatOrNull(path)
    if (info === null) continue
    if (!info.isSymbolicLink()) continue
    await unlink(path)
    removed += 1
  }

  for (const [assetId, target] of desired) {
    const path = skillLinkPath(projectDir, assetId)
    const 前 = await lstatOrNull(path)
    if (前 !== null && !前.isSymbolicLink()) {
      skipped.push(path)
      continue
    }
    await linkSkill(projectDir, assetId, target)
    if (前 === null) created += 1
  }

  return { created, removed, skipped }
}

// 没有 `removeSkillLinkDir`：项目删除时整个沙箱目录一起没了，不需要专门摘这一层；
// 而它会是本文件唯一的 `rm -r`，与本文件「删只用 unlink」的安全论证并列容易被误用。
```

> 实现者注意：注释里的 `**\/SKILL.md` 是为了不把注释提前闭合（`LEARNINGS #004-06`）。

- [ ] **Step 4: 跑，确认绿**

Run: `cd packages/asset-service && bun test src/project-skill-link.test.ts`
Expected: 7 passed。若「对账」那条在 Windows 上 `created` 报 1 而不是 2，说明 `desired` 里的 `asset_2` 目标不存在导致 junction 建不出来——先 `mkdir` 那个目标再测，别改断言。

- [ ] **Step 5: 变异验证**

把 `unlinkSkill` 里的 `if (!现有.isSymbolicLink()) throw new NotALinkError(link)` 删掉 → 「真目录」那条必须红（`unlink` 抛 EISDIR/EPERM，`rejects.toBeInstanceOf(NotALinkError)` 失败）。改回。

- [ ] **Step 6: 门禁 ＋ 提交**

Run: `cd packages/asset-service && bun test && bun run typecheck`；仓库根 `bun run lint`。

```bash
git add packages/asset-service/src/project-skill-link.ts packages/asset-service/src/project-skill-link.test.ts
git commit -m "feat(assets): skill 链接投影（junction/symlink，只摘链接不删真目录）"
```

---

### Task 3: HTTP 出口与编排

**Files:**
- Create: `packages/opencode/src/server/openhive/project-assets.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`（加一行注册）
- Modify: `packages/auth/src/audit.ts:61-80`（`AUDIT_ACTIONS` 加两个词）
- Test: `packages/opencode/test/server/openhive-project-assets.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `enablementOf / enableAsset / disableAsset / enabledAssetIds / ENABLEMENT_LIMIT`；Task 2 的 `skillLinkTarget / reconcileSkillLinks / linkSkill / unlinkSkill`；`assetById`、`canReadAsset`、`publishDirectory`、`assetsRoot`、`projectDirectory`、`rolesOf`、`InstanceStore.Service`、`OpenhiveAudit.板块`。
- Produces: 三条路由
  - `GET  /openhive/project/assets?projectId=` → `{ enabled: string[], enabledCount: number, limit: number }`
  - `POST /openhive/project/assets/enable`，体 `{ projectId, assetId }`
  - `POST /openhive/project/assets/disable`，体 `{ projectId, assetId }`
  - 失败体一律 `{ error: string, code?: string }`；`code ∈ "bad_request" | "forbidden" | "not_found" | "asset_not_skill" | "asset_not_published" | "asset_files_missing" | "duplicate_skill_name" | "enablement_limit"`

- [ ] **Step 1: 先加审计动作词**

`packages/auth/src/audit.ts` 的 `AUDIT_ACTIONS` 数组里，`"asset.transition"` 之后加两行：

```ts
  // 【保留的定制 · 同步上游时不要丢】项目级启用（2026-10-27）
  "asset.enable",
  "asset.disable",
```

`packages/app/src/governance/audit-log-api.ts` 的标签映射里，`"asset.transition": "资产流转",` 之后加：

```ts
  // 【保留的定制 · 同步上游时不要丢】项目级启用（2026-10-27）
  "asset.enable": "资产启用",
  "asset.disable": "资产停用",
```

- [ ] **Step 2: 先写会红的集成测**

`packages/opencode/test/server/openhive-project-assets.test.ts`。**harness 整段照抄** `packages/opencode/test/server/openhive-project.test.ts` 的 `openApp` / 身份 cookie / `startProductionDb`（`LEARNINGS #004-12`：新出口第一动作是搬同族 harness），只换判据点。判据前移到 `Content-Type`（未挂载的路径会被 SPA 兜底成 `text/html` 200，见那个文件头）。

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { publishDirectory } from "@opencode-ai/asset-service/storage"
import { projectDirectory } from "@opencode-ai/auth/workspace"

// …照抄 openhive-project.test.ts 的夹具（真 PG、每用户 SQLite、cookie 身份、openApp）…

const 我的项目 = "proj_enable_1"
const 别人的项目 = "proj_enable_2"
const 已发布资产 = "asset_skill_ok"

describe("项目级 skill 启用（真应用）", () => {
  // beforeAll 里额外造：
  //  - auth.asset 一行：id=已发布资产, type='skill', status='published', visibility='global'
  //  - auth.asset 一行：id='asset_skill_draft', status='draft', visibility='personal', owner=我
  //  - auth.project_member：我 owner 我的项目；别人 owner 别人的项目
  //  - 已发布目录：`publishDirectory(assetsRoot(process.env),"skill",{visibility:"global"},"asset_skill_ok")`
  //    下写一份 `SKILL.md`（frontmatter name: 资金分析）

  test("未挂载不是 404：挂上的出口回 application/json", async () => {
    const response = await app.request(`/openhive/project/assets?projectId=${我的项目}`, { headers: 身份 })
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: [], enabledCount: 0, limit: 20 })
  })

  test("启用：库里一行 + 项目目录里一条链接 + 返回计数 1", async () => {
    const response = await post("/openhive/project/assets/enable", { projectId: 我的项目, assetId: 已发布资产 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: [已发布资产], enabledCount: 1, limit: 20 })

    // oracle 不经过被测对象：裸 SQL 读库
    const rows = rowsOf(await pg.db.execute(sql`
      select asset_id, enabled_by from auth.project_asset_enablement where project_id = ${我的项目}
    `))
    expect(rows).toEqual([{ asset_id: 已发布资产, enabled_by: 我的用户id }])

    // 链接真的在项目目录里，且指向 published 目录
    const 链接 = join(projectDirectory(沙箱根, 我的用户id, 我的项目), ".opencode", "skill", 已发布资产)
    const 目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 已发布资产)
    expect(readlinkSync(链接)).toBe(目标)
    expect(readFileSync(join(链接, "SKILL.md"), "utf8")).toContain("资金分析")
  })

  test("重复启用是幂等的（200，仍是 1）", async () => {
    const response = await post("/openhive/project/assets/enable", { projectId: 我的项目, assetId: 已发布资产 })
    expect(response.status).toBe(200)
    expect((await response.json()).enabledCount).toBe(1)
  })

  test("停用：库行没了、链接没了", async () => {
    const response = await post("/openhive/project/assets/disable", { projectId: 我的项目, assetId: 已发布资产 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: [], enabledCount: 0, limit: 20 })
    const 链接 = join(projectDirectory(沙箱根, 我的用户id, 我的项目), ".opencode", "skill", 已发布资产)
    expect(existsSync(链接)).toBe(false)
  })

  test("草稿不可启用：409 asset_not_published", async () => {
    const response = await post("/openhive/project/assets/enable", {
      projectId: 我的项目,
      assetId: "asset_skill_draft",
    })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("asset_not_published")
  })

  test("不是成员：403", async () => {
    const response = await post("/openhive/project/assets/enable", {
      projectId: 别人的项目,
      assetId: 已发布资产,
    })
    expect(response.status).toBe(403)
  })

  test("不存在的资产：404", async () => {
    const response = await post("/openhive/project/assets/enable", { projectId: 我的项目, assetId: "asset_nope" })
    expect(response.status).toBe(404)
  })

  test("缺身份：401 空体", async () => {
    const response = await app.request(`/openhive/project/assets?projectId=${我的项目}`)
    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 3: 跑，确认红**

Run: `cd packages/opencode && bun test test/server/openhive-project-assets.test.ts`
Expected: 全红，且是 `content-type` 断言先红（`text/html`）——这说明路由还没挂，正是我们要的红。

- [ ] **Step 4: 写路由模块**

`packages/opencode/src/server/openhive/project-assets.ts`（完整实现，按顺序读注释再写）：

```ts
export * as OpenhiveProjectAssets from "./project-assets"

/**
 * 项目级 skill 启用（2026-10-27，用户裁定）。
 *
 * ## 它补的是哪一段
 *
 * 「发布」把 skill 复制进共享卷，但内核从不读共享卷（`skill/index.ts` 的扫描根只有
 * 项目 `.opencode`、全局配置目录、`.claude/skills`、`.agents/skills`）⇒ 发布 ≠ 能用。
 * 本模块把「启用」落成两件事：**库里的关系行** ＋ **项目目录里的一条链接**。
 *
 * ## 顺序：先写库、再改链接、最后丢缓存
 *
 * 库是事实、目录是投影。反过来（先链接后写库）一旦写库失败，就留下一条对不上的链接，
 * 而没有任何记录说它该存在。今天这个顺序的残余是「库有、链接没建」（磁盘故障），
 * 由下一次 `GET` 的对账（`reconcileSkillLinks`）自动补上。
 *
 * ## 丢缓存：`InstanceStore.disposeDirectory`
 *
 * 内核的 skill 清单是 `InstanceState` 按**目录**缓存一次（`skill/index.ts:259-266`）。
 * 不丢缓存，这次启用在本进程内**永远**不生效——用户会看到「点了启用、问了还是不会用」。
 * 丢缓存后下一次请求重建实例、重扫目录 ⇒ **下一条消息生效**。
 *
 * ⚠️ 这是本模块唯一一处会打断在跑实例的调用：正在生成的会话会经历一次实例重建
 * （表现为前端收到 `server.instance.disposed` 后重拉该目录的状态）。启用是显式的用户动作，
 * 这个代价可以接受；**不要**把它加进任何自动路径。
 *
 * ## 谁能启用
 *
 * 项目**成员**（owner 或 member）都能启用/停用（本计划 R2）：启用是干活不是治理。
 * 判定只调 `rolesOf()`（`#002-06`：成员判定只该有一份）。
 *
 * ## 能启用哪一份
 *
 * 必须**同时**满足：`type='skill'`、`status='published'`、当前读者 `canReadAsset()` 放行
 * ⇒ 否则 409 / 403。前者是没有可链接的落点（草稿停在作者沙箱，`publishDirectory` 直接拒），
 * 后者是「不能看的东西不能装」。
 */

import { assetById } from "@opencode-ai/asset-service/asset"
import { canReadAsset } from "@opencode-ai/asset-service/authorization"
import { disableAsset, enabledAssetIds, enableAsset, enablementOf, ENABLEMENT_LIMIT } from "@opencode-ai/asset-service/enablement"
import { linkSkill, reconcileSkillLinks, skillLinkTarget, unlinkSkill } from "@opencode-ai/asset-service/project-skill-link"
import { assetsRoot } from "@opencode-ai/asset-service/storage"
import { rolesOf } from "@opencode-ai/auth/project-member"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { User } from "@opencode-ai/core/user"
import { InstanceStore } from "@/project/instance-store"
import { ConfigMarkdown } from "@/config/markdown"
import { AnchorWorkspace } from "@/server/routes/instance/httpapi/middleware/anchor-workspace"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { 记治理 } from "./audit"
import { OpenhivePg } from "./pg"

export const PREFIX = "/openhive/project/assets"

export const PATH = {
  state: PREFIX,
  enable: `${PREFIX}/enable`,
  disable: `${PREFIX}/disable`,
} as const

const BOARD = "asset-governance"

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  readonly root: string
  readonly store: Option.Option<InstanceStore.Interface>
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    // 测试里可能没有内核实例层（只挂路由的子集）：缺席时丢弃缓存这一步跳过并告警，不静默
    // 假装做了（`#002-02`）。
    const store = yield* Effect.serviceOption(InstanceStore.Service)
    const deps: Deps = { pg: openhivePg.pg, root: config.root, store }

    yield* router.add("GET", PATH.state, (request) => handleState(request, deps))
    yield* router.add("POST", PATH.enable, (request) => handleToggle(request, deps, "enable"))
    yield* router.add("POST", PATH.disable, (request) => handleToggle(request, deps, "disable"))
  }),
)
```

实现体（同一文件，接在 `routes` 之后）：

```ts
function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

/** 这个人在这个项目里是什么角色；`undefined` = 不是成员（含项目不存在）。 */
function 成员角色(deps: Deps, userId: string, projectId: string) {
  return Effect.promise(async () => {
    const roles = await rolesOf(deps.pg(), { userId, projectIds: [projectId] })
    return roles.get(projectId)
  })
}

function 是合法段(value: unknown): value is string {
  return typeof value === "string" && value !== "" && User.isSafePathSegment(value)
}

async function 读体(request: HttpServerRequest.HttpServerRequest): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await request.json
    if (typeof body !== "object" || body === null) return undefined
    return body as Record<string, unknown>
  } catch {
    return undefined
  }
}

function 项目目录(deps: Deps, userId: string, projectId: string): string {
  return projectDirectory(deps.root, userId, projectId)
}

/** 丢掉该项目的实例缓存：让下一次请求重扫 skill 目录（见文件头「丢缓存」）。 */
function 丢缓存(deps: Deps, directory: string) {
  if (Option.isNone(deps.store)) {
    return Effect.logWarning("实例层缺席，跳过缓存丢弃；启用在重启前不生效", { directory })
  }
  return Effect.promise(() => Effect.runPromise(deps.store.value.disposeDirectory(directory))).pipe(
    Effect.catchCause((cause) => Effect.logError("实例缓存丢弃失败", { directory, cause })),
  )
}

/** 读者部门（`AssetViewer` 要它判部门/个人空间）。 */
function 取部门(deps: Deps, userId: string) {
  return Effect.promise(async (): Promise<string> => {
    const rows = rowsOf(await deps.pg().execute(sql`select dept from auth.user where id = ${userId}`))
    const 部门 = rows[0]?.["dept"]
    return typeof 部门 === "string" ? 部门 : ""
  })
}

/** 发布目录在不在。**只把 ENOENT 当「不在」**：权限 / IO 故障要暴露，不折成「文件缺失」。 */
async function 路径存在(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return false
    throw error
  }
}

/** 已启用集合 + 把目录对账到与库一致。`GET` 也顺手对账：用户换机器 / 目录被清理都靠它自愈。 */
function 对账并读(deps: Deps, userId: string, projectId: string) {
  return Effect.gen(function* () {
    const state = yield* Effect.promise(() => enablementOf(deps.pg(), projectId))
    const 目录 = 项目目录(deps, userId, projectId)
    const 根 = assetsRoot(process.env)
    // 读者本人的部门：可见性要按**这个读者**判，不是按启用者（见下面那道门）。
    const 部门 = yield* 取部门(deps, userId)
    const viewer = { userId, department: 部门 }

    const desired = new Map<string, string>()
    const 可见: string[] = []
    for (const assetId of state.enabled) {
      const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      // 已下线 / 被删掉的资产：不再链（对账时会被摘掉）
      if (asset === undefined || asset.status !== "published" || asset.type !== "skill") continue
      // 个人空间没有共享目录 ⇒ 算不出 target（`skillLinkTarget` 会抛）。启用入口已经拦了，
      // 这里再挡一次是给「历史遗留行 / 直接写库」兜底：不挡就是每次打开资产中心都 500。
      if (asset.visibility === "personal") continue
      // ⚠️ **启用是项目级事实，送达是读者级授权**：甲部门成员启用的部门内 skill，
      // 不能因为「项目里启用了」就送进乙部门成员的沙箱（内核会真的加载它）。
      // 可见性判定只此一份——`canReadAsset()`（`#002-06`）。
      if (!canReadAsset(viewer, asset)) continue
      可见.push(assetId)
      const target = skillLinkTarget(根, asset)
      if (!(yield* Effect.promise(() => 路径存在(target)))) continue
      desired.set(assetId, target)
    }

    // 对账失败**不翻掉整页 GET**：库里的状态仍然要回（目录残差由下一次对账修）。
    const 结果 = yield* Effect.promise(() => reconcileSkillLinks(目录, desired)).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("对账失败，目录状态待下次修复", { projectId, 目录, cause }).pipe(Effect.as(undefined)),
      ),
    )
    if (结果 !== undefined && 结果.skipped.length > 0) {
      yield* Effect.logWarning("项目目录里有不是链接的 skill 目录，未动", { skipped: 结果.skipped })
    }
    // `enabled` 只回**这个读者看得见**的那些（不然等于给出了一个「项目里有哪些 id」的探针）；
    // `enabledCount` 仍回项目真相——上限是项目级参数，用户要知道还剩多少位置。
    return { ...state, enabled: 可见 }
  })
}

function handleState(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const params = new URL(request.url, "http://localhost").searchParams
    const projectId = params.get("projectId") ?? ""
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined) return fail(403, "不是该项目成员", "forbidden")
    return ok(yield* 对账并读(deps, user.value.id, projectId))
  })
}

function handleToggle(request: HttpServerRequest.HttpServerRequest, deps: Deps, 动作: "enable" | "disable") {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const userId = user.value.id

    const body = yield* Effect.promise(() => 读体(request))
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = body["projectId"]
    const assetId = body["assetId"]
    if (!是合法段(projectId) || !是合法段(assetId)) return fail(400, "projectId / assetId 非法", "bad_request")

    if ((yield* 成员角色(deps, userId, projectId)) === undefined) return fail(403, "不是该项目成员", "forbidden")

    if (动作 === "enable") {
      const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      if (asset === undefined) return fail(404, "资产不存在", "not_found")
      if (asset.type !== "skill") return fail(409, "只有 skill 能装进项目", "asset_not_skill")
      if (asset.status !== "published") return fail(409, "只有已发布的 skill 能启用", "asset_not_published")
      // 个人空间的资产**留在作者沙箱**，没有共享发布目录：`publishDirectory` 对 personal 直接抛
      // `PersonalAssetDirectoryError`（`storage.ts:98-100`）。不在这里拦住，就会以 500 收场，
      // 而产品口径要的是可读的 409。等「个人资产也进共享卷」那天再放开。
      if (asset.visibility === "personal")
        return fail(409, "个人空间的 skill 还不能装进项目，请先发布到部门或全局", "personal_not_linkable")

      const 部门 = yield* 取部门(deps, userId)
      if (!canReadAsset({ userId, department: 部门 }, asset)) return fail(403, "无权使用该资产", "forbidden")

      const target = skillLinkTarget(assetsRoot(process.env), asset)
      if (!(yield* Effect.promise(() => 路径存在(target))))
        return fail(409, "资产文件缺失，请重新发布", "asset_files_missing")

      // 同名拦截：以 SKILL.md 的 frontmatter name 为准（内核也按它去重）
      const 新名 = yield* Effect.promise(() => ConfigMarkdown.parse(join(target, "SKILL.md")).then((md) => md.data["name"], () => undefined))
      const 已启用 = yield* Effect.promise(() => enabledAssetIds(deps.pg(), projectId))
      for (const 已有 of 已启用) {
        if (已有 === assetId) continue
        const 另一份 = yield* Effect.promise(() => assetById(deps.pg(), 已有))
        if (另一份 === undefined || 另一份.visibility === "personal") continue
        const 另一目标 = skillLinkTarget(assetsRoot(process.env), 另一份)
        const 另一名 = yield* Effect.promise(() =>
          ConfigMarkdown.parse(join(另一目标, "SKILL.md")).then((md) => md.data["name"], () => undefined),
        )
        if (typeof 新名 === "string" && 新名 === 另一名)
          return fail(409, `项目里已启用同名 skill：${新名}`, "duplicate_skill_name")
      }

      // 上限是 `ENABLEMENT_LIMIT` 常量，由库层自己带（`enablement.ts`），这里不传
      const 结果 = yield* Effect.promise(() =>
        enableAsset(deps.pg(), { projectId, assetId, userId }),
      )
      if (结果 === "limit_reached") return fail(409, `每个项目最多启用 ${ENABLEMENT_LIMIT} 个 skill，请先停用一个`, "enablement_limit")

      const 目录 = 项目目录(deps, userId, projectId)
      yield* Effect.promise(() => linkSkill(目录, assetId, target)).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("链接失败，等待下一次对账修复", { projectId, assetId, cause }),
        ),
      )
      yield* 丢缓存(deps, 目录)
      yield* 记治理(deps, userId, {
        board: BOARD,
        action: "asset.enable",
        targetType: "asset",
        targetId: assetId,
        result: "ok",
        detail: { projectId },
      })
    } else {
      yield* Effect.promise(() => disableAsset(deps.pg(), { projectId, assetId }))
      const 目录 = 项目目录(deps, userId, projectId)
      yield* Effect.promise(() => unlinkSkill(目录, assetId)).pipe(
        Effect.catchCause((cause) => Effect.logError("摘链接失败，等待下一次对账修复", { projectId, assetId, cause })),
      )
      yield* 丢缓存(deps, 目录)
      yield* 记治理(deps, userId, {
        board: BOARD,
        action: "asset.disable",
        targetType: "asset",
        targetId: assetId,
        result: "ok",
        detail: { projectId },
      })
    }

    return ok(yield* 对账并读(deps, userId, projectId))
  })
}
```

实现者注意（这些是**必须**处理的编译/语义问题，不是可选项）：

- `deps.store` 是 `Option<InstanceStore.Interface>`：`disposeDirectory` 返回 `Effect<void>`，在 promise 回调里要用 `Effect.runPromise`——**不要**在 `Effect.gen` 里 `yield*` 一个来自别的 runtime 的 Effect。写成 `Effect.promise(() => Effect.runPromise(...))` 是刻意的。
- `AssetViewer` 的字段是 `{ userId, department }`（见 `authorization.ts`）。
- `ConfigMarkdown.parse` 返回 `{ data, content }`，`data["name"]` 可能不是字符串 ⇒ 用 `typeof 新名 === "string"` 收窄，别强制转换。
- `// oxlint-disable` 不要加，先把代码写干净。
- 审计 `result` 一律写 `"ok"`：走到那一行说明启用已落库（`already_enabled` 也是「本来就有」，
  不是失败）。`limit_reached` 在上面已经 return 409 了，不会到这。

- [ ] **Step 5: 注册路由**

在 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 里，紧挨着 `OpenhiveProject.routes` 那一行加（保持同一种写法）：

```ts
      // 【保留的定制 · 同步上游时不要丢】项目级 skill 启用（2026-10-27）
      OpenhiveProjectAssets.routes,
```

并在 import 区加 `import { OpenhiveProjectAssets } from "@/server/openhive/project-assets"`。

- [ ] **Step 5b: 项目删除链接上启用关系（`#002-06`：谁还在按「这个项目的数据都在这儿」的前提删东西）**

`packages/opencode/src/server/openhive/archive.ts` 的删除链最后一步（步骤 5）现在是三个并排调用
（`archive.ts:653-655`）。删除项目要清掉「这个项目的一切」，启用关系也是这个项目的行——漏了它就是
**孤儿行**：项目 id 永久占着 20 个名额里的一份，而那个项目已经不存在了。

在 `removeProjectMeta` 后面加第四行：

```ts
        yield* Effect.promise(() => removeProjectEnablement(pg, { projectId }))
```

import 区加（**单独一条**，`removeProjectEnablement` 在 asset-service，不在 auth）：

```ts
import { removeProjectEnablement } from "@opencode-ai/asset-service/enablement"
```

为什么放在「成员关系那一组里」而不是更早：删除链的前四步都是**可重入的空转**（对象没了就是没了），
这一步同样幂等（`delete ... where project_id = ...`）；放进这一组才不会破坏「前四步失败重试」的次序判据。

验证（**不需要新用例**：这条 SQL 没有分支，`removeProjectEnablement` 的幂等性由
`enablement.ts` 的单条 delete 保证）：

Run: `cd packages/opencode && bun test test/server/openhive-project-delete.test.ts`
Expected: 全绿（既有删除用例不该因为多一行 delete 变红）。

- [ ] **Step 6: 跑，确认绿**

Run: `cd packages/opencode && bun test test/server/openhive-project-assets.test.ts`
Expected: 全绿。若「链接真的在项目目录里」那一步红且报 target 不存在，检查夹具是否真的把 `SKILL.md` 写进了 `publishDirectory(...)` 那个目录。

- [ ] **Step 7: 变异验证**

把 `丢缓存(deps, 目录)` 两处注释掉 → 现有用例**不会红**（它们不测内核缓存）。这是**已知未覆盖**，写进报告与 `state.md` 缺口表，并在 Task 5 用真栈验收补上。把 `rolesOf` 判定改成恒 `true` → 「不是成员：403」必须红。改回。

- [ ] **Step 8: 门禁 ＋ 提交**

Run: `cd packages/opencode && bun test test/server/openhive-project-assets.test.ts && bun run typecheck`；仓库根 `bun run lint`。

```bash
git add packages/opencode/src/server/openhive/project-assets.ts \
        packages/opencode/src/server/routes/instance/httpapi/server.ts \
        packages/auth/src/audit.ts packages/app/src/governance/audit-log-api.ts \
        packages/opencode/test/server/openhive-project-assets.test.ts
git commit -m "feat(assets): 项目级 skill 启用/停用出口（链接送达 + 丢实例缓存 + 审计）"
```

---

### Task 4: 前端出口客户端

**Files:**
- Create: `packages/app/src/ai-assets/enable-api.ts`
- Test: `packages/app/src/ai-assets/enable-api.test.ts`

**Interfaces:**
- Produces:
  - `PATH = { state: "/openhive/project/assets", enable: ".../enable", disable: ".../disable" }`
  - `interface EnablementState { enabled: readonly string[]; enabledCount: number; limit: number }`
  - `type EnableOutcome = { kind: "ok"; value: EnablementState } | { kind: "error"; message: string; code?: string }`
  - `type EnableFetch = (input: string, init?: RequestInit) => Promise<Response>`
  - `interface EnableApi { read(projectId): Promise<EnableOutcome>; enable(input): Promise<EnableOutcome>; disable(input): Promise<EnableOutcome> }`
  - `createEnableApi(send?: EnableFetch): EnableApi`

- [ ] **Step 1: 先写会红的用例**

`packages/app/src/ai-assets/enable-api.test.ts`（照抄 `preferences-api.test.ts` 的假 `fetch` 写法）：

```ts
import { describe, expect, test } from "bun:test"
import { createEnableApi, PATH } from "./enable-api"

function 假发送(回包: Array<{ status: number; body: unknown }>, 记录: Array<{ url: string; init?: RequestInit }>) {
  let i = 0
  return async (url: string, init?: RequestInit) => {
    记录.push({ url, init })
    const 当前 = 回包[Math.min(i, 回包.length - 1)]
    i += 1
    return new Response(JSON.stringify(当前.body), {
      status: 当前.status,
      headers: { "content-type": "application/json" },
    })
  }
}

describe("enable-api", () => {
  test("read：GET 带 projectId 查询参数，200 解析成三态", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: { enabled: ["a"], enabledCount: 1, limit: 20 } }], 记录))
    const 结果 = await api.read("p 1")
    expect(结果).toEqual({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } })
    expect(记录[0]?.url).toBe("/openhive/project/assets?projectId=p%201")
  })

  test("enable：POST JSON 体，声明 content-type", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: { enabled: ["a"], enabledCount: 1, limit: 20 } }], 记录))
    await api.enable({ projectId: "p1", assetId: "a" })
    expect(记录[0]?.url).toBe(PATH.enable)
    expect(记录[0]?.init?.method).toBe("POST")
    expect((记录[0]?.init?.headers as Record<string, string>)["content-type"]).toBe("application/json")
    expect(JSON.parse(String(记录[0]?.init?.body))).toEqual({ projectId: "p1", assetId: "a" })
  })

  test("409 带上 code，文案原样回给人看", async () => {
    const api = createEnableApi(
      假发送([{ status: 409, body: { error: "每个项目最多启用 20 个 skill，请先停用一个", code: "enablement_limit" } }], []),
    )
    expect(await api.enable({ projectId: "p1", assetId: "a" })).toEqual({
      kind: "error",
      message: "每个项目最多启用 20 个 skill，请先停用一个",
      code: "enablement_limit",
    })
  })

  test("网络异常也回 error，不抛", async () => {
    const api = createEnableApi(async () => {
      throw new Error("断网")
    })
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("error")
  })

  test("回包形状不对（缺 enabled）⇒ error，不静默当空集合", async () => {
    const api = createEnableApi(假发送([{ status: 200, body: { enabledCount: 0 } }], []))
    expect((await api.read("p1")).kind).toBe("error")
  })
})
```

- [ ] **Step 2: 跑，确认红** → `cd packages/app && bun test src/ai-assets/enable-api.test.ts`，FAIL `Cannot find module './enable-api'`。

- [ ] **Step 3: 写实现**

```ts
/**
 * 项目级 skill 启用的客户端（2026-10-27）。
 *
 * 三条出口的分工见 `packages/opencode/src/server/openhive/project-assets.ts` 文件头。
 * 这里只做四件事：拼 URL、发请求、把**成功/失败**收成三态、把服务端的 `code` 原样带回去。
 *
 * **失败不抛**：调用方（`enable-state.ts`）把它变成一条给人看的错误，再决定是否回滚乐观态。
 * 与服务端回包同口径：`{ error }` 就是那句人话。
 */

export const PATH = {
  state: "/openhive/project/assets",
  enable: "/openhive/project/assets/enable",
  disable: "/openhive/project/assets/disable",
} as const

export const TIMEOUT_MS = 10_000

export interface EnablementState {
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
}

export type EnableOutcome =
  | { readonly kind: "ok"; readonly value: EnablementState }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type EnableFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface EnableApi {
  readonly read: (projectId: string) => Promise<EnableOutcome>
  readonly enable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
  readonly disable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
}

const 默认发送: EnableFetch = (input, init) => fetch(input, init)

function 解析状态(body: unknown): EnablementState | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const 值 = body as Record<string, unknown>
  if (!Array.isArray(值["enabled"])) return undefined
  if (typeof 值["enabledCount"] !== "number") return undefined
  if (typeof 值["limit"] !== "number") return undefined
  return {
    enabled: 值["enabled"].map((item) => String(item)),
    enabledCount: 值["enabledCount"],
    limit: 值["limit"],
  }
}

async function 解包(response: Response): Promise<EnableOutcome> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: "error", message: `服务端回了非 JSON（${response.status}）` }
  }
  if (!response.ok) {
    const 值 = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>
    const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
    const code = typeof 值["code"] === "string" ? 值["code"] : undefined
    return code === undefined ? { kind: "error", message } : { kind: "error", message, code }
  }
  const 状态 = 解析状态(body)
  if (状态 === undefined) return { kind: "error", message: "服务端回包形状不对" }
  return { kind: "ok", value: 状态 }
}

export function createEnableApi(send: EnableFetch = 默认发送): EnableApi {
  const 发送 = async (url: string, init?: RequestInit): Promise<EnableOutcome> => {
    try {
      return await 解包(await send(url, init))
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "网络请求失败" }
    }
  }

  const 切换 = (url: string, input: { projectId: string; assetId: string }) =>
    发送(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId, assetId: input.assetId }),
    })

  return {
    read: (projectId) => 发送(`${PATH.state}?projectId=${encodeURIComponent(projectId)}`),
    enable: (input) => 切换(PATH.enable, input),
    disable: (input) => 切换(PATH.disable, input),
  }
}
```

- [ ] **Step 4: 跑绿 → 变异**（删掉 `解析状态` 的 `Array.isArray` 判断 → 「回包形状不对」必须红）→ 改回。

- [ ] **Step 5: 门禁 ＋ 提交**

```bash
git add packages/app/src/ai-assets/enable-api.ts packages/app/src/ai-assets/enable-api.test.ts
git commit -m "feat(assets): 项目级启用出口的前端客户端"
```

---

### Task 5: 前端状态（跟随当前项目）

**Files:**
- Create: `packages/app/src/ai-assets/enable-state.ts`
- Test: `packages/app/src/ai-assets/enable-state.test.tsx`

**Interfaces:**
- Consumes: `EnableApi` / `EnablementState`（Task 4）
- Produces: `createProjectEnablement(api?): ProjectEnablement`，其中

```ts
export interface ProjectEnablement {
  readonly projectId: () => string | undefined
  readonly enabled: () => ReadonlySet<string>
  readonly enabledCount: () => number
  readonly limit: () => number
  readonly error: () => string | undefined
  /** 正在切换的 assetId（按钮转忙）；`undefined` = 空闲。 */
  readonly busy: () => string | undefined
  /** 由入口绑定「当前项目」的读口（响应式）：项目一换就重拉。 */
  readonly bind: (projectId: () => string | undefined) => void
  readonly toggle: (assetId: string) => void
  /** 同项目重拉（进入资产视图时）。 */
  readonly reload: () => void
}
```

- [ ] **Step 1: 先写会红的用例**

`packages/app/src/ai-assets/enable-state.test.tsx`：

```ts
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import { createProjectEnablement } from "./enable-state"

function 假 api(回包: Record<string, Array<{ kind: "ok"; value: any } | { kind: "error"; message: string; code?: string }>>) {
  const 记录: string[] = []
  const 取 = (key: string) => {
    记录.push(key)
    const 队列 = 回包[key]
    return 队列!.shift()!
  }
  return {
    记录,
    api: {
      read: async (projectId: string) => 取(`read:${projectId}`),
      enable: async (input: { projectId: string; assetId: string }) => 取(`enable:${input.assetId}`),
      disable: async (input: { projectId: string; assetId: string }) => 取(`disable:${input.assetId}`),
    },
  }
}

const 空 = { enabled: [], enabledCount: 0, limit: 20 }

test("bind：项目一换就重拉，没项目时清空", async () => {
  const { api } = 假 api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
  })
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>(undefined)
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    expect(状态.enabled().size).toBe(0)
    设项目("p1")
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["a"])
    expect(状态.enabledCount()).toBe(1)
    设项目(undefined)
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.enabled().size).toBe(0)
    dispose()
  })
})

test("toggle：启用成功后以服务端回包为准（不自己算）", async () => {
  const { api } = 假 api({
    "read:p1": [{ kind: "ok", value: 空 }],
    "enable:b": [{ kind: "ok", value: { enabled: ["b"], enabledCount: 1, limit: 20 } }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.busy()).toBeUndefined()
    状态.toggle("b")
    expect(状态.busy()).toBe("b")
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"])
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("已启用的再点 = 停用", async () => {
  const { 记录, api } = 假 api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
    "disable:a": [{ kind: "ok", value: 空 }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.toggle("a")
    await new Promise((r) => setTimeout(r, 0))
    expect(记录).toContain("disable:a")
    expect(状态.enabled().size).toBe(0)
    dispose()
  })
})

test("失败：错误原样留着，既有集合不动（不假清空）", async () => {
  const { api } = 假 api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
    "enable:b": [{ kind: "error", message: "每个项目最多启用 20 个 skill，请先停用一个", code: "enablement_limit" }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.toggle("b")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toContain("最多启用 20")
    expect([...状态.enabled()]).toEqual(["a"])
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("没有项目时 toggle 不发请求", async () => {
  const { 记录, api } = 假 api({})
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => undefined)
    状态.toggle("a")
    expect(记录).toEqual([])
    dispose()
  })
})
```

- [ ] **Step 2: 跑，确认红** → `cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/ai-assets/enable-state.test.tsx`，FAIL 模块不存在。
  ⚠️ **后缀必须是 `.tsx`、必须带 `--conditions=browser`**（2026-10-27 实测）：solid-js 1.9.10 的 `exports` 没有 `solid` 条件，bun 在 `test:unit` 口径下命中 `node` ⇒ `dist/server.js`，`createEffect` 是空函数，本任务 7/8 条用例必红（实得 `1 pass / 7 fail`，`Expected 1 / Received 0`）。`.test.tsx` 会被 `test:unit` 的 `--path-ignore-patterns="**/*.test.tsx"` 跳过、被 `test:components` 收走，正是包内既有分工。

- [ ] **Step 3: 写实现**

```ts
import { createEffect, createSignal } from "solid-js"
import { createEnableApi, type EnableApi, type EnablementState } from "./enable-api"

/**
 * 「当前项目启用了哪些 skill」的**唯一读取点**（2026-10-27）。
 *
 * ## 服务端权威，前端不算
 *
 * 每次切换/重拉都以服务端回包替换整份状态：前端自己「加一个 id、加一」就会与服务端的
 * 同名拦截、上限、已下线撤销三件事漂开——那三件事只有服务端知道。
 *
 * ## 旧回包按「项目 + 代次」丢弃
 *
 * 用户连点两下、或在两个项目间来回切，回包顺序不保证。每次请求领一个代次号，
 * 回来时**代次不是最新、或项目已经不是那一个**就整份丢弃（`LEARNINGS #008-03`：
 * await 之后不许再读「当前是谁」）。
 *
 * ## 失败不清空
 *
 * 与 `asset-catalog.ts` 同一条：失败只置错误，现有集合留着——旧状态比白屏有用；
 * 空集合会被读成「一个都没启用」，那是另一件事（`#002-02`）。
 */
export interface ProjectEnablement {
  readonly projectId: () => string | undefined
  readonly enabled: () => ReadonlySet<string>
  readonly enabledCount: () => number
  readonly limit: () => number
  readonly error: () => string | undefined
  readonly busy: () => string | undefined
  readonly bind: (projectId: () => string | undefined) => void
  readonly toggle: (assetId: string) => void
  readonly reload: () => void
}

const 默认上限 = 20

export function createProjectEnablement(api: EnableApi = createEnableApi()): ProjectEnablement {
  const [项目, set项目] = createSignal<string | undefined>()
  const [集合, set集合] = createSignal<ReadonlySet<string>>(new Set())
  const [数量, set数量] = createSignal(0)
  const [上限, set上限] = createSignal(默认上限)
  const [错误, set错误] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal<string | undefined>()

  let 代次 = 0

  const 应用 = (状态: EnablementState) => {
    set集合(new Set(状态.enabled))
    set数量(状态.enabledCount)
    set上限(状态.limit)
  }

  const 清空 = () => {
    代次 += 1
    set集合(new Set())
    set数量(0)
    set上限(默认上限)
    set错误(undefined)
    set忙(undefined)
  }

  const 拉 = (projectId: string) => {
    const 本次 = ++代次
    void api.read(projectId).then((结果) => {
      if (本次 !== 代次 || 项目() !== projectId) return
      if (结果.kind === "ok") {
        应用(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  const bind = (读: () => string | undefined) => {
    createEffect(() => {
      const 当前 = 读()
      set项目(当前)
      if (当前 === undefined) {
        清空()
        return
      }
      拉(当前)
    })
  }

  const toggle = (assetId: string) => {
    const projectId = 项目()
    if (projectId === undefined) return
    const 本次 = ++代次
    set忙(assetId)
    const 请求 = 集合().has(assetId) ? api.disable({ projectId, assetId }) : api.enable({ projectId, assetId })
    void 请求.then((结果) => {
      if (本次 !== 代次 || 项目() !== projectId) return
      set忙(undefined)
      if (结果.kind === "ok") {
        应用(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  const reload = () => {
    const projectId = 项目()
    if (projectId === undefined) return
    拉(projectId)
  }

  return { projectId: 项目, enabled: 集合, enabledCount: 数量, limit: 上限, error: 错误, busy: 忙, bind, toggle, reload }
}
```

- [ ] **Step 4: 跑绿 → 变异**（删掉 `本次 !== 代次` 判断 → 需补一条「连点两次、旧回包不回写」的用例；若现有用例不红，**先补用例再改**，不要接受不红的变异）→ 改回。

- [ ] **Step 5: 门禁 ＋ 提交**

```bash
git add packages/app/src/ai-assets/enable-state.ts packages/app/src/ai-assets/enable-state.test.tsx
git commit -m "feat(assets): 当前项目的启用状态（服务端权威 + 代次丢弃旧回包）"
```

---

### Task 6: 卡片上的启用按钮

**Files:**
- Modify: `packages/app/src/ai-assets/asset-card.tsx`
- Modify: `packages/app/src/ai-assets/asset-grid.tsx`
- Test: `packages/app/src/ai-assets/asset-card.test.tsx`（新建）＋ 既有 `asset-grid.test.tsx` 不动

**为什么必须动结构：** 今天整张卡片是一个 `<button>`（`asset-card.tsx:27`）。按钮里再放按钮是非法 HTML、屏幕阅读器会读乱。改成「外层 `div[role=listitem]` ＋ 两个 sibling 按钮」：打开的按钮铺满卡片，启用按钮绝对定位在右上角、`z-10`。

- [ ] **Step 1: 先写会红的用例**

`packages/app/src/ai-assets/asset-card.test.tsx`：

```tsx
import { describe, expect, test } from "bun:test"
import { render } from "@solidjs/testing-library"
import { AssetCard } from "./asset-card"
import { 资产夹具 } from "./asset-story-fixtures"

const 资产 = 资产夹具({ id: "a1", name: "资金分析", status: "published", visibility: "global" })

function 挂(props: Parameters<typeof AssetCard>[0]) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <AssetCard {...props} />, host)
  return { host, dispose }
}

describe("AssetCard 的启用按钮", () => {
  test("不给 onToggleEnabled ⇒ 卡片上没有启用按钮（storybook / 旧测试不受影响）", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {} })
    expect(host.querySelector('[data-slot="asset-card-enable"]')).toBeNull()
    dispose()
  })

  test("给了就渲染，文案随 enabled 变", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {} })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]')!
    expect(按钮.getAttribute("aria-pressed")).toBe("false")
    expect(按钮.textContent).toContain("启用")
    dispose()
  })

  test("已启用态：aria-pressed=true、文案是「已启用」", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, enabled: true })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]')!
    expect(按钮.getAttribute("aria-pressed")).toBe("true")
    expect(按钮.textContent).toContain("已启用")
    dispose()
  })

  test("点启用不会顺带打开详情（两个按钮是 sibling，不是嵌套）", () => {
    let 打开 = 0
    let 切换 = 0
    const { host, dispose } = 挂({
      asset: 资产,
      onOpen: () => (打开 += 1),
      onToggleEnabled: () => (切换 += 1),
    })
    ;(host.querySelector('[data-slot="asset-card-enable"]') as HTMLButtonElement).click()
    expect(切换).toBe(1)
    expect(打开).toBe(0)
    dispose()
  })

  test("被禁用时按钮 disabled 且把原因写在 title 上", () => {
    const { host, dispose } = 挂({
      asset: 资产,
      onOpen: () => {},
      onToggleEnabled: () => {},
      enableHint: "请先在左侧选择项目",
    })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]') as HTMLButtonElement
    expect(按钮.disabled).toBe(true)
    expect(按钮.title).toBe("请先在左侧选择项目")
    dispose()
  })

  test("busy：按钮 disabled、aria-busy=true", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, busy: true })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]') as HTMLButtonElement
    expect(按钮.disabled).toBe(true)
    expect(按钮.getAttribute("aria-busy")).toBe("true")
    dispose()
  })
})
```

> `asset-story-fixtures.ts` 里若没有可直接调用的 `资产夹具`，先看它导出什么，照它的形状造一份局部夹具——**不要**为了这条用例改那个文件。

- [ ] **Step 2: 跑，确认红** → `cd packages/app && bun test src/ai-assets/asset-card.test.tsx`，红在「卡上没有启用按钮 / 传 props 不存在」。

- [ ] **Step 3: 改组件**

`asset-card.tsx` 的 `AssetCardProps` 追加：

```ts
  /** 已启用（服务端权威；缺省 = 未启用）。 */
  readonly enabled?: boolean
  /** 省略 ⇒ 不渲染启用按钮（storybook、旧测试、无数据源的场景）。 */
  readonly onToggleEnabled?: (asset: AssetMetadata) => void
  /** 按钮不可用的原因（没有当前项目 / 已达上限）；非空 ⇒ 按钮 disabled 且写进 title。 */
  readonly enableHint?: string
  /** 正在切换（转忙）。 */
  readonly busy?: boolean
```

结构改成（`role="listitem"` 外层保留，内部两个 sibling 按钮）：

```tsx
export function AssetCard(props: AssetCardProps): JSX.Element {
  const 可切换 = () => props.onToggleEnabled !== undefined
  const 不可用 = () => (props.busy === true ? "正在切换…" : props.enableHint)
  return (
    <div role="listitem" data-slot="asset-card" data-asset-id={props.asset.id} class="relative h-[132px]">
      <button
        type="button"
        data-slot="asset-card-open"
        aria-label={`查看资产：${props.asset.name}`}
        onClick={() => props.onOpen(props.asset)}
        class="flex h-full w-full cursor-pointer flex-col gap-2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-3 pr-16 text-left shadow-[var(--v2-elevation-raised)] hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
      >
        {/* …图标 + 名称 + 描述 + 徽章，与原实现逐行相同… */}
      </button>
      <Show when={可切换()}>
        <button
          type="button"
          data-slot="asset-card-enable"
          data-enabled={props.enabled === true}
          aria-pressed={props.enabled === true}
          aria-busy={props.busy === true}
          disabled={props.busy === true || props.enableHint !== undefined}
          title={不可用()}
          onClick={() => props.onToggleEnabled?.(props.asset)}
          class="absolute top-2 right-2 z-10 cursor-pointer rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 py-1 text-[11px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-not-allowed disabled:opacity-60 data-[enabled=true]:border-v2-border-border-accent data-[enabled=true]:text-v2-text-text-accent"
        >
          {props.enabled === true ? "已启用" : "启用"}
        </button>
      </Show>
    </div>
  )
}
```

需要的 import：`Show`（`solid-js`）。卡片正文那一段**逐字保留**（图标 span、名称 span、描述 p、徽章行），只把外层 `div` 上的 `flex/…` 类挪到内层按钮上、并给按钮加 `pr-16` 给右上角按钮让位。

`asset-grid.tsx` 的 `AssetGridProps` 追加：

```ts
  /** 已启用判定（服务端权威）。省略 ⇒ 卡片不显示启用按钮。 */
  readonly enabledOf?: (asset: AssetMetadata) => boolean
  readonly onToggleEnabled?: (asset: AssetMetadata) => void
  readonly enableHint?: string
  readonly busyId?: string
```

卡片渲染处改成：

```tsx
{(asset) => (
  <AssetCard
    asset={asset}
    onOpen={props.onOpen}
    {...(props.onToggleEnabled === undefined
      ? {}
      : {
          enabled: props.enabledOf?.(asset) === true,
          onToggleEnabled: props.onToggleEnabled,
          enableHint: props.enableHint,
          busy: props.busyId === asset.id,
        })}
  />
)}
```

- [ ] **Step 4: 跑绿**

Run: `cd packages/app && bun test src/ai-assets/asset-card.test.tsx src/ai-assets/asset-grid.test.tsx`
Expected: 全绿（`asset-grid.test.tsx` 是回归：不传新 prop 时行为不变）。

- [ ] **Step 5: 变异验证**：把启用按钮挪进打开的按钮内部（嵌套）→ 「点启用不会顺带打开详情」必须红（点击冒泡到外层）。改回。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/ai-assets/asset-card.tsx packages/app/src/ai-assets/asset-card.test.tsx \
        packages/app/src/ai-assets/asset-grid.tsx
git commit -m "feat(assets): 卡片上的启用/已启用按钮（与详情按钮并列，不嵌套）"
```

---

### Task 7: 中栏计数条与入口接线

**Files:**
- Modify: `packages/app/src/ai-assets/asset-center.tsx`
- Modify: `packages/app/src/workspace/workspace-entry.tsx:2196`
- Modify: `packages/app/src/pages/layout-new.tsx:84` 附近与 `WorkspaceEntry` 的使用处
- Test: `packages/app/src/ai-assets/asset-center.test.tsx`（追加）＋ `packages/app/src/workspace/workspace-entry.test.tsx`（追加一条）

**Interfaces:**
- Consumes: `ProjectEnablement`（Task 5）
- Produces: `AssetCenterProps.enablement?: ProjectEnablement`；`WorkspaceEntryProps.enablement?: ProjectEnablement`

- [ ] **Step 1: 先写会红的用例**（追加到 `asset-center.test.tsx`）

```tsx
test("没有项目：卡片上的启用按钮禁用，提示先选项目", async () => {
  const 假 = 假启用({ projectId: undefined })
  const { host } = 挂中栏({ enablement: 假 })
  const 按钮 = host.querySelector('[data-slot="asset-card-enable"]') as HTMLButtonElement
  expect(按钮.disabled).toBe(true)
  expect(按钮.title).toContain("选择项目")
})

test("有项目：顶部显示「已启用 1/20」，卡片按集合标已启用", async () => {
  const 假 = 假启用({ projectId: () => "p1", enabled: () => new Set(["a1"]), enabledCount: () => 1, limit: () => 20 })
  const { host } = 挂中栏({ enablement: 假 })
  expect(host.querySelector('[data-slot="asset-enable-count"]')!.textContent).toContain("已启用 1/20")
  expect(host.querySelector('[data-asset-id="a1"] [data-slot="asset-card-enable"]')!.getAttribute("aria-pressed")).toBe(
    "true",
  )
})

test("达到上限：未启用的卡片按钮禁用并提示先停用", async () => {
  const 假 = 假启用({
    projectId: () => "p1",
    enabled: () => new Set(["a1"]),
    enabledCount: () => 20,
    limit: () => 20,
  })
  const { host } = 挂中栏({ enablement: 假 })
  const 按钮 = host.querySelector('[data-asset-id="a2"] [data-slot="asset-card-enable"]') as HTMLButtonElement
  expect(按钮.disabled).toBe(true)
  expect(按钮.title).toContain("停用")
})

test("错误如实显示，不当成「没有错误」", async () => {
  const 假 = 假启用({ projectId: () => "p1", error: () => "每个项目最多启用 20 个 skill，请先停用一个" })
  const { host } = 挂中栏({ enablement: 假 })
  expect(host.querySelector('[data-slot="asset-enable-error"]')!.textContent).toContain("最多启用 20")
})
```

> `假启用` 是本文件里的一行 helper，返回一个满足 `ProjectEnablement` 的对象（未提供的字段给空实现）。

- [ ] **Step 2: 跑，确认红**

- [ ] **Step 3: 改 `asset-center.tsx`**

`AssetCenterProps` 追加 `readonly enablement?: ProjectEnablement`。在搜索框那一行下面加一条计数带：

```tsx
<Show when={props.enablement?.projectId() !== undefined}>
  <div data-slot="asset-enable-count" class="...">
    已启用 {props.enablement?.enabledCount()} / {props.enablement?.limit()} · 下一条消息生效
  </div>
</Show>
<Show when={props.enablement?.error()}>
  <div data-slot="asset-enable-error" role="alert" class="... text-v2-text-text-danger">
    {props.enablement?.error()}
  </div>
</Show>
```

传给网格：

```tsx
<AssetGrid
  assets={props.catalog?.assets}
  onOpen={打开}
  {...(props.enablement === undefined
    ? {}
    : {
        enabledOf: (asset) => props.enablement!.enabled().has(asset.id),
        onToggleEnabled: (asset) => props.enablement!.toggle(asset.id),
        enableHint:
          props.enablement.projectId() === undefined
            ? "请先在左侧选择项目"
            : props.enablement.enabledCount() >= props.enablement.limit() &&
                !props.enablement.enabled().has(asset.id)
              ? `每个项目最多启用 ${props.enablement.limit()} 个，请先停用一个`
              : undefined,
        busyId: props.enablement.busy(),
      })}
/>
```

> 在资产视图被打开时重拉一次：现有代码里有 `onAssetsOpen` 那条时机，把 `props.enablement?.reload()` 和 `props.catalog?.reload()` 放在**同一个**回调里（同一处时机，别另起一条链）。

- [ ] **Step 4: 接线到入口**

`workspace-entry.tsx`：`WorkspaceEntryProps` 追加 `readonly enablement?: ProjectEnablement`，在 `<AssetCenter …>`（`:2196`）加 `enablement={props.enablement}`。

`layout-new.tsx`：在 `资产目录` 那一块旁边加

```ts
  // 【保留的定制 · 同步上游时不要丢】项目级 skill 启用（2026-10-27）：
  // 绑定「当前项目」读口，项目一换就重拉启用集合；没选项目时整块功能禁用。
  const 启用状态 = createProjectEnablement()
  启用状态.bind(() => currentProject()?.id)
```

并把 `enablement={启用状态}` 传给 `<WorkspaceEntry …>`。

- [ ] **Step 5: 跑绿 ＋ 回归**

Run（**两条，分别对应两套条件；缺一条就是把 `.tsx` 用例按 node 构建跑，必红**）:
```bash
cd packages/app && timeout 300 bun test --conditions=solid --path-ignore-patterns="**/*.test.tsx" src/ai-assets
cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/ai-assets
```
Expected: 全绿（等价于包内 `bun run test:unit` + `bun run test:components` 的过滤子集）。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/ai-assets/asset-center.tsx packages/app/src/ai-assets/asset-center.test.tsx \
        packages/app/src/workspace/workspace-entry.tsx packages/app/src/workspace/workspace-entry.test.tsx \
        packages/app/src/pages/layout-new.tsx
git commit -m "feat(assets): 中栏显示已启用 N/20，入口按当前项目接线"
```

---

### Task 8: 全量门禁

- [ ] **Step 1** `cd packages/auth && timeout 300 bun test src/comments.test.ts src/migrate.test.ts && bun run typecheck`
  （⚠️ 别写 `bun test src/migrations`——那是目录，`src/` 下测试文件是扁平放的，命令会「匹配不到任何
  测试文件」空转 exit 1。实得：`comments.test.ts` 1 pass / 1 fail（`template` 等表缺中文注释，
  0013–0020 既有）；`migrate.test.ts` 17 pass / 1 fail（`0017_data_source.down.sql` 两条 `DROP`
  缺 `--> statement-breakpoint`，`42601`）。两条都把 `0021` 临时移出后原样复现过，属基线缺口——
  如实记进报告，**不修别人的迁移**）
- [ ] **Step 2** `cd packages/asset-service && bun test && bun run typecheck`
- [ ] **Step 3** `cd packages/opencode && bun test test/server/openhive-project-assets.test.ts test/server/openhive-project-delete.test.ts && bun run typecheck`
- [ ] **Step 4** `cd packages/app && timeout 300 bun run test:unit && timeout 300 bun run test:components && bun run typecheck`
  （**别写裸 `bun test src/ai-assets`**：`enable-state.test.tsx` 需要 `--conditions=browser`，裸跑拿到 `dist/server.js`、
  `createEffect` 是空函数，7 条必红——2026-10-27 实测 `1 pass / 7 fail`。`AUDIT_ACTIONS` 加词后
  `audit-log-api.ts` 的 `Record<AuditAction,string>` 若漏词，红在这里）
- [ ] **Step 5** 仓库根 `bun run lint`（⚠️ 已知基线红在 `packages/session-ui/.../prompt-input/index.tsx:163`，
  与本次改动无关；判据是「本次改动的文件在 oxlint 输出里不出现」）
- [ ] **Step 6** `git diff --stat bun.lock` 必须为空
- [ ] **Step 7** 把每条命令的**实得输出**贴进报告；任何一条没跑，明说没跑。

---

### Task 9: 真栈验收（人工，按 CLAUDE.md「不把测不了的写成已覆盖」）

**前提**：真栈在跑（内核 4711 / 前门 3010，远端 PG `openhive_dev`）。栈可能没起——那就**如实写「未跑」**，不要写成已覆盖。

- [ ] **Step 1** 迁移：确认 `0021` 已落到远端库

```bash
# 用与建栈相同的入口跑迁移（见 CONFIG.md / 栈启动方式），然后：
#   select 1 from information_schema.tables
#    where table_schema='auth' and table_name='project_asset_enablement'
```

- [ ] **Step 2** 浏览器（http://127.0.0.1:3010，020602 / Deploy-Only-9527!）：
  1. 左栏选一个项目 → 进 AI 资产 → 卡片右上角出现「启用」；顶部出现「已启用 0 / 20」。
  2. 点一份已发布 skill 的「启用」→ 变「已启用」，计数变 1。
  3. 开一个新会话，问「你有哪些 skill」，**必须能看到它**（这是「送达」的唯一真判据）。
  4. 回资产中心停用 → 计数回 0；同一条会话**再问一次**，它必须消失（丢缓存生效）。
  5. 切到另一个项目 → 计数是那个项目自己的。
- [ ] **Step 3** 目录落点核对（不看界面，看盘）：

```bash
ls -l "<沙箱根>/<userId>/<projectId>/.opencode/skill/"
# 期望：一条指向 /assets/global/skills/<assetId>（或 dept 那档）的链接
```

- [ ] **Step 4** 上限：把某项目灌到 20（直接 SQL 插 20 行 + 对账），第 21 个点「启用」必须弹「请先停用一个」，且库行数仍 20。
- [ ] **Step 5** 把实测结果（含失败）写进本 feature 的 `state.md` 缺口表；**没做到的就写没做到**。

---

## 自检（写完计划后已跑）

**1. Spec 覆盖**

| 谈定的 6 条 | 落在哪 |
|---|---|
| ① 项目 × 资产的启用表（含启用人、时间、审计） | Task 1（表）＋ Task 3（审计两个动作词） |
| ② 卡片三态 ＋「已启用 3/20」计数 ＋ 到顶替换流程 | Task 6（启用/已启用/禁用＋提示）＋ Task 7（计数条、上限提示） |
| ③ 启用→链接进项目目录；停用→删链接；打开项目对账 | Task 2（链接与对账）＋ Task 3（每次 GET/启停都对账） |
| ④ 同名拦截、已下线不可启用、草稿仅作者可启用 | Task 3（同名 frontmatter 比对、`published` 门槛）；**草稿那半裁掉了**，理由见「范围裁定 R1」，已明示用户 |
| ⑤ 列表接口返回当前项目的 enabled 标记 | 改为独立出口 `GET /openhive/project/assets`（见下「与计划的偏差」） |
| ⑥ 明确提示「重新打开项目后生效」 | Task 7 计数条文案改成「下一条消息生效」（R4 让立刻生效，比原设计更强），并保留 Task 9 的真栈判据 |

**2. 占位符扫描**：无 TBD/TODO；每个代码步骤都是可直接落盘的实现。两处留了「照抄同族 harness」的指示（Task 3 的测试夹具、Task 6 的夹具 helper），这是**指向真实文件**而非占位：`openhive-project.test.ts` / `preferences.test.ts` / `asset-story-fixtures.ts` 都在仓库里。

**3. 类型一致性**：`EnablementState`（服务端三字段 `enabled/enabledCount/limit`）与前端 `EnablementState` 逐字相同；`EnableResult` 三态在 Task 1 定义、Task 3 使用；`ProjectEnablement` 的方法名在 Task 5 定义、Task 6/7 使用（`enabled()` / `enabledCount()` / `limit()` / `busy()` / `error()` / `projectId()` / `toggle()` / `reload()` / `bind()`）。

**4. 与计划的偏差（明示，不藏）**：第 ⑤ 条原写「列表接口返回 enabled 标记」，实现改成**独立出口**。理由：`GET /openhive/assets` 是使用面唯一的列表，它按页返回资产、**不知道项目**；把项目塞进去会让「一页 20 条」和「启用集合」两条生命周期缠在一起，而且每次翻页都要重算。独立出口一次取全量启用（≤20 条 id），前端做本地标记，两者解耦。

## 已知未覆盖（进 `state.md` 缺口表）

1. **「丢缓存后下一条消息生效」没有自动化用例**：`InstanceStore.disposeDirectory` 的效应要靠真栈 Step 2-3 验。Variant 验证时它会「绿得可疑」，见 Task 3 Step 7。
2. **Linux 容器的链接行为未实测**：本机只验了 Windows junction。POSIX 分支用的是 `symlink(..., "dir")`，容器里的挂载卷是否允许建链接要上线前单独验。
3. **共享项目里其他成员的项目目录不会自动补链**：启用后，别人只有在自己打开资产中心（触发 GET 对账）或自己的内核实例重建后才拿到。这是 R2 的代价，接受。
4. **下线一份 skill 不会自动从所有项目撤回**：`project_asset_enablement_asset_idx` 索引是为这条留的，撤回逻辑不在本计划（`GET` 对账会把 `status != published` 的链接摘掉，但只在有人打开资产中心时）。
5. **`packages/auth` 的 `comments.test.ts` 在 0013–0020 上既有红**（迁移缺中文 `COMMENT ON`），
   与本 feature 无关（`0021` 的注释是齐的）。本次不动别人的迁移（Karpathy 原则 3），
   Task 8 Step 1 要如实记录这一点，别把它算成本 feature 的红。
6. **启用上限是软上限**（`enablement.ts` 的守卫是 `count(*) < 20` 子查询，READ COMMITTED 下并发
   两次启用可能停在 21 行）。与「每项目 20 个」产品口径的偏差在 1 条，第一版接受；真要硬上限得加
   行锁或把上限挪到项目行上，不在本计划。
