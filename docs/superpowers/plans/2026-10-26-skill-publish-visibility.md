# Skill 发布范围（发布时选本部门 / 全局）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让发布者在「技术发布」这一步选定本部门或全局，把可见范围与发布状态原子写库，并把文件落到对应共享目录。

**Architecture:** 领域层解析范围并把「生效后的 metadata」交给既有的 `prepareStorageStep`；`updateAssetLifecycle` 在同一条条件 UPDATE 里写入 `visibility`；HTTP / MCP / 前端只做参数传递与闭集校验，不复制规则。

**Tech Stack:** Bun monorepo、TypeScript（tsgo）、Effect 4 beta、Drizzle 1.0 rc（bun-sql）、SolidJS 1.9、Kobalte、PGlite 测试夹具、oxlint 1.60。

**Spec:** `docs/superpowers/specs/2026-10-26-skill-publish-visibility-design.md`

## Global Constraints

- **工作目录**：仓库根 `D:\project\study\openhive\openhive`，分支 `multi-tenant`。
- **测试**：`bun test` 只在受影响 **package 内**跑；仓库根 `bun test` 被 scripts 强制 `exit 1`，禁止。
- **门禁命令在仓库根跑**：`bun run typecheck`、`bunx oxlint <改到的文件>`。
- **不跑 `bun install`**；若不得不跑，结束必须 `git diff --stat bun.lock` 为空或只剩有意新增，否则 `git checkout -- bun.lock`。
- **授权先于副作用**（`#004-09`）：范围解析放在 `authorizeTransition()` 之后、任何文件搬运之前。
- **同名落点要一起改**（`#002-06`）：发布有三个出口——服务层、HTTP 路由、MCP 工具；三处都要接线，且规则只有服务层一份。
- **断言要钉住「值变了」而不是「没报错」**（`#005-47`）：每个成功用例都要同时断言 `status`、`visibility` 和文件位置。
- **提交**：每个 Task 单独提交，中文提交信息；本仓库是官方 fork，每个提交都属「要保留的定制」。
- **文案**：所有面向民警的文案用中文，不用「确定吗」，直接写后果。

## 执行安全约束（防死循环 / 防内存溢出·本机死过机）

**本机曾因内存耗尽死机**（见记忆 `sysmon-resource-sampler`）。每个执行者（含每个 subagent）开工前必须遵守，违反即停：

1. **每条测试 / 门禁命令都带硬超时**：`timeout 420 bun test …`；Bun 侧再加 `--timeout 30000`。命令不许「挂那儿等」。超时退出码 124 ⇒ 停手，把命令与最后几行输出贴回来，**不重试**。
2. **禁止长驻 / 监听进程**：`bun run dev`、`bun run dev:web`、`vite`、`--watch`、`bun e2e/real-stack/stack.ts` 一律**不由执行者启动**；真栈只在 Task 6 由你手动跑。子代理只允许跑「跑完就退」的命令。
3. **禁止 `bun install`**（锁文件污染，见 Global Constraints）。
4. **禁止循环重试**：同一条命令失败后，只在**改过代码**之后重跑；同一命令最多跑 2 次，仍红就停手上报。不许 `while` / `until` 包重跑，不许 `for i in $(seq …)` 刷测试。
5. **串行**：同一时刻只有一个测试进程。PGlite 每个用例起实例，禁止并行两个包（不并发 `&`、不 `Promise.all` 跑测试）。
6. **不跑全仓测试**，不跑无过滤器的 `bun test`；输出一律 `| tail -N` 截断，避免把几千行灌进上下文。
7. **实现侧不许引入无界循环**：新代码里只有纯函数与线性遍历；`while` / 递归一律不新增（前端既有的 `等到` 已有 1s 上限，照用）。
8. **每个 Task 收尾对账**：`git status --short` ＋ `git diff --stat` 与计划里列的文件集一致；多出来的文件不许留。

> 下文命令示例为方便阅读**没写** `timeout` 前缀；实际执行时一律写成 `timeout 420 <原命令>`，并通过 `| tail -N` 截断输出。

---

### Task 0: 先提交既有的 409 修复（前置，需用户确认）

**背景：** 工作区已有 7 个未提交文件，属于「个人资产发布原来是 500」的修复（错误翻译 ＋ 三层红绿用例）。它必须先独立提交，否则后面的 Task 会把两件事混进同一个 diff。

**Files（已改好，只需提交）：**
- `packages/asset-service/src/storage.ts`
- `packages/asset-service/src/lifecycle.ts`
- `packages/asset-service/src/service.ts`
- `packages/asset-service/src/service.test.ts`
- `packages/asset-service/src/governance.test.ts`
- `packages/opencode/src/server/openhive/governance-assets.ts`
- `packages/opencode/test/server/openhive-governance-assets.test.ts`

- [ ] **Step 1: 确认没有别人的暂存改动**

```bash
cd /d/project/study/openhive/openhive
git diff --cached --name-only   # 期望：空
```

- [ ] **Step 2: 只提交这 7 个文件**

```bash
git add packages/asset-service/src/storage.ts packages/asset-service/src/lifecycle.ts \
  packages/asset-service/src/service.ts packages/asset-service/src/service.test.ts \
  packages/asset-service/src/governance.test.ts \
  packages/opencode/src/server/openhive/governance-assets.ts \
  packages/opencode/test/server/openhive-governance-assets.test.ts
git commit -F - <<'EOF'
fix(asset-service): 个人资产发布给领域错误码，HTTP 出口回 409（不是 500）

- 存储层裸 Error → PersonalAssetDirectoryError → personal_asset_not_shared
- 三层用例：领域 / HTTP 路由 / MCP publish_skill；真栈复验 409 且零副作用
- 参考 #002-06（三个发布出口同名落点）、#004-09（授权先于副作用）
EOF
```

- [ ] **Step 3: 确认工作区干净**

```bash
git status --short   # 期望：只剩本计划相关的未跟踪文档（如有）
```

---

### Task 1: 领域层——解析发布范围并原子落库

**Files:**
- Modify: `packages/asset-service/src/lifecycle.ts:135-145`（错误码闭集）
- Modify: `packages/asset-service/src/asset.ts:268-308`（`AssetLifecycleUpdate` ＋ 条件 UPDATE）
- Modify: `packages/asset-service/src/service.ts:263-280`（入参）、`:342-362`（接线）、`:443-463` 之前（新 helper）
- Test: `packages/asset-service/src/service.test.ts`（`describe("transitionAsset · 生命周期流转（T008）")` 内）

**Interfaces:**
- Produces: `TransitionAssetInput.visibility?: AssetVisibility`；错误码 `department_missing`、`visibility_not_applicable`。
- Consumes: `assetById`、`applySkillTransition`、`authorizeTransition`、`prepareStorageStep`（均已存在）。

- [ ] **Step 1: 写会红的用例（4 条，加到 `describe("transitionAsset · 生命周期流转（T008）")` 末尾）**

```ts
test("个人资产发布时选定「本部门」：状态、可见范围与文件一起落地", async () => {
  const db = await freshDb()
  const root = tempRoot()
  const source = join(tempRoot(), "sandbox")
  await writeSkill(source, "个人稿")
  // 创建时选了个人可见（`create_skill_draft` 的默认值）：发布前必须由发布者补选共享范围。
  await seedSkill(db, { visibility: "personal" })
  await transitionAsset({
    db, root, assetId: "asset_1", action: "submit_review",
    viewer: 作者, grants: [], sourceDirectory: source, now: 2_000,
  })
  await transitionAsset({
    db, root, assetId: "asset_1", action: "approve_business",
    viewer: 业务管理员, grants: 审, now: 2_001,
  })

  const published = await transitionAsset({
    db, root, assetId: "asset_1", action: "publish_tech",
    viewer: 系统管理员, grants: 管, visibility: "department", now: 2_002,
  })

  expect(published.status).toBe("published")
  expect(published.visibility).toBe("department")
  expect(await exists(join(发布目录(root), "SKILL.md"))).toBe(true)
  expect(await exists(待审目录(root))).toBe(false)
})

test("发布者可以改作者原先选的共享范围：部门 → 全局，文件落到 global/", async () => {
  const db = await freshDb()
  const root = tempRoot()
  const source = join(tempRoot(), "sandbox")
  await writeSkill(source, "部门稿")
  await seedSkill(db)
  await transitionAsset({
    db, root, assetId: "asset_1", action: "submit_review",
    viewer: 作者, grants: [], sourceDirectory: source, now: 2_000,
  })
  await transitionAsset({
    db, root, assetId: "asset_1", action: "approve_business",
    viewer: 业务管理员, grants: 审, now: 2_001,
  })

  const published = await transitionAsset({
    db, root, assetId: "asset_1", action: "publish_tech",
    viewer: 系统管理员, grants: 管, visibility: "global", now: 2_002,
  })

  expect(published.visibility).toBe("global")
  expect(await exists(join(root, "global", "skills", "asset_1", "SKILL.md"))).toBe(true)
  expect(await exists(发布目录(root))).toBe(false)
})

test("选「本部门」但资产没有部门信息：department_missing，状态与文件不动", async () => {
  const db = await freshDb()
  const root = tempRoot()
  const source = join(tempRoot(), "sandbox")
  await writeSkill(source, "无部门稿")
  // 个人可见时元数据校验不要求部门（`metadata.ts:149`），所以这条脏数据进得来。
  await seedSkill(db, { visibility: "personal", department: "" })
  await transitionAsset({
    db, root, assetId: "asset_1", action: "submit_review",
    viewer: 作者, grants: [], sourceDirectory: source, now: 2_000,
  })
  await transitionAsset({
    db, root, assetId: "asset_1", action: "approve_business",
    viewer: 业务管理员, grants: 审, now: 2_001,
  })

  const error = await failure(() =>
    transitionAsset({
      db, root, assetId: "asset_1", action: "publish_tech",
      viewer: 系统管理员, grants: 管, visibility: "department", now: 2_002,
    }),
  )

  expect(codeOf(error)).toBe("department_missing")
  expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
  expect(await exists(join(待审目录(root), "SKILL.md"))).toBe(true)
})

test("非发布动作带可见范围：visibility_not_applicable，状态不动", async () => {
  const db = await freshDb()
  const root = tempRoot()
  const source = join(tempRoot(), "sandbox")
  await writeSkill(source, "越界参数")
  await seedSkill(db)
  await transitionAsset({
    db, root, assetId: "asset_1", action: "submit_review",
    viewer: 作者, grants: [], sourceDirectory: source, now: 2_000,
  })

  const error = await failure(() =>
    transitionAsset({
      db, root, assetId: "asset_1", action: "approve_business",
      viewer: 业务管理员, grants: 审, visibility: "global", now: 2_001,
    }),
  )

  expect(codeOf(error)).toBe("visibility_not_applicable")
  expect((await assetById(db, "asset_1"))?.status).toBe("in_review")
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /d/project/study/openhive/openhive/packages/asset-service
bun test src/service.test.ts 2>&1 | tail -20
```

期望：4 条新用例全红。类型上 `visibility` 还不存在（tsc 不拦 `bun test`，但运行时报 `personal_asset_not_shared` / 没有 `department_missing`）。

- [ ] **Step 3: 加错误码**（`packages/asset-service/src/lifecycle.ts:135-145`）

```ts
export type TransitionErrorCode =
  | "unknown_action"
  | "invalid_source"
  | "actor_not_allowed"
  | "reason_required"
  | "asset_not_found"
  | "unsupported_asset_type"
  | "source_directory_required"
  | "concurrent_transition"
  /** 个人资产没有共享发布目录：要发布，得先把可见范围改成部门 / 全局。 */
  | "personal_asset_not_shared"
  /** 选「本部门」发布，但资产没有部门信息（作者档案部门为空）。 */
  | "department_missing"
  /** 非发布类动作不接受可见范围参数：调用方理解错了，不静默忽略。 */
  | "visibility_not_applicable"
```

- [ ] **Step 4: 让生命周期更新能写可见范围**（`packages/asset-service/src/asset.ts:268-276`）

```ts
export interface AssetLifecycleUpdate {
  /** 只有库里仍是这个状态才写——并发改状态时更新落空，而不是覆盖别人的结果。 */
  readonly expectedStatus: AssetStatus
  readonly status: AssetStatus
  readonly version: number
  readonly updatedAt: number
  readonly publishedAt: number | null
  readonly archivedAt: number | null
  /** 发布时选定的可见范围；省略表示不改。 */
  readonly visibility?: AssetVisibility
}
```

SQL（`:296-305`）：

```ts
  const rows = rowsOf(await db.execute(sql`
    update auth.asset set
      status = ${update.status},
      version = ${update.version},
      updated_at = ${update.updatedAt},
      published_at = ${update.publishedAt},
      archived_at = ${update.archivedAt},
      visibility = coalesce(${update.visibility ?? null}, visibility)
    where id = ${id} and status = ${update.expectedStatus}
    returning ${COLUMNS}
  `))
```

并在 `asset.ts` 顶部把 `AssetVisibility` 加进已有的 `./metadata` 类型导入。

- [ ] **Step 5: 加解析函数与接线**（`packages/asset-service/src/service.ts`）

在 `PUBLISHING_ACTIONS` 之后加：

```ts
/** 只有发布类动作可以选可见范围：其它动作带了就是调用方理解错了（不静默忽略）。 */
const SCOPE_SELECTING_ACTIONS: ReadonlySet<SkillAction> = new Set(["publish_tech", "publish_iteration"])

/**
 * 解析这次流转的可见范围，返回**生效后**的 metadata（发布时可能替换 `visibility`）。
 *
 * 个人资产没有共享发布目录：发布必须由发布者选一个共享范围（设计 §2），否则仍是
 * `personal_asset_not_shared`（409）。发布者可以覆盖作者原先选的部门 / 全局。
 */
function withPublishScope(
  asset: AssetMetadata,
  applied: AppliedSkillTransition,
  requested: AssetVisibility | undefined,
): AssetMetadata {
  if (!SCOPE_SELECTING_ACTIONS.has(applied.action)) {
    if (requested !== undefined) {
      throw new AssetTransitionError(
        "visibility_not_applicable",
        `${applied.action} 不接受可见范围（只有发布类动作可以选）`,
      )
    }
    return asset
  }

  const 范围 = requested ?? asset.visibility
  if (范围 === "personal") {
    throw new AssetTransitionError(
      "personal_asset_not_shared",
      `个人资产不进入共享空间：${asset.id}（发布时请选择本部门或全局）`,
    )
  }
  if (范围 === "department" && asset.department.trim() === "") {
    throw new AssetTransitionError(
      "department_missing",
      `资产 ${asset.id} 没有部门信息：请发布为全局，或先补部门`,
    )
  }
  return 范围 === asset.visibility ? asset : { ...asset, visibility: 范围 }
}
```

`TransitionAssetInput`（`:263-280`）加字段：

```ts
  /** 发布类动作（技术发布 / 迭代发布）的可见范围；省略沿用资产现状。 */
  readonly visibility?: AssetVisibility
```

`transitionAsset` 内接线（`:342-362` 一带）：

```ts
  const applied = applySkillTransition(asset.status, input.action, {
    actor,
    reason: input.reason,
  })
  const now = input.now ?? Math.floor(Date.now() / 1000)

  // 范围解析在授权之后、任何文件搬运之前（`#004-09`）。
  const 生效 = withPublishScope(asset, applied, input.visibility)

  const step = await prepareStorageStep(root, 生效, applied, input.sourceDirectory)
```

条件更新里带上可见范围：

```ts
    const result = await updateAssetLifecycle(db, asset.id, {
      expectedStatus: asset.status,
      status: applied.to,
      version: VERSION_BUMPING_ACTIONS.has(applied.action) ? asset.version + 1 : asset.version,
      updatedAt: now,
      publishedAt: PUBLISHING_ACTIONS.has(applied.action) ? now : asset.publishedAt,
      archivedAt: applied.action === "archive" ? now : asset.archivedAt,
      ...(生效.visibility === asset.visibility ? {} : { visibility: 生效.visibility }),
    })
```

- [ ] **Step 6: 跑测试确认绿**

```bash
cd /d/project/study/openhive/openhive/packages/asset-service
bun test src/service.test.ts 2>&1 | tail -10
```

期望：新增 4 条通过，**原有全部用例仍通过**（尤其「个人 + 不传范围 ⇒ 409」那条）。

- [ ] **Step 7: 变异验证（两处，必须红）**

**变异 A——拆掉范围解析**：把 `service.ts` 里 `const 范围 = requested ?? asset.visibility` 改成 `const 范围 = asset.visibility`。

```bash
cd /d/project/study/openhive/openhive/packages/asset-service
bun test src/service.test.ts 2>&1 | grep -E "个人资产发布时选定|部门 → 全局|pass|fail" | tail -6
```

期望：前两条新用例红（第一条撞 `personal_asset_not_shared`），其余绿。

**变异 B——只拆「把范围写进库」**：恢复 A，再把 `updateAssetLifecycle` 调用里的 `...(生效.visibility === asset.visibility ? {} : { visibility: 生效.visibility })` 删掉。

```bash
bun test src/service.test.ts 2>&1 | grep -E "个人资产发布时选定|部门 → 全局|pass|fail" | tail -6
```

期望：两条都红在 `visibility` 断言上（目录已对、库里仍旧值）。

两处都改回原样，重跑确认全绿。

- [ ] **Step 8: 提交**

```bash
cd /d/project/study/openhive/openhive
git add packages/asset-service/src/lifecycle.ts packages/asset-service/src/asset.ts \
  packages/asset-service/src/service.ts packages/asset-service/src/service.test.ts
git commit -F - <<'EOF'
feat(asset-service): 发布时可选定可见范围（领域 + 原子落库）

- publish_tech / publish_iteration 接受 visibility；省略沿用资产现状
- 个人资产必须选共享范围，否则 personal_asset_not_shared（409）
- 部门为空选「本部门」⇒ department_missing（409）；非发布动作带范围 ⇒ 400 类错误
- visibility 与 status 在同一条条件 UPDATE 里写入；目标目录用生效后的 metadata 计算
- 参考 #002-06 / #004-09 / #005-47
EOF
```

---

### Task 2: HTTP 出口——接收可见范围、映射错误、记审计

**Files:**
- Modify: `packages/opencode/src/server/openhive/governance-assets.ts:194-286`（请求体）、`:339-369`（错误映射）、文件头注释
- Test: `packages/opencode/test/server/openhive-governance-assets.test.ts`

**Interfaces:**
- Consumes: `TransitionAssetInput.visibility`（Task 1）。
- Produces: POST body 字段 `visibility: "department" | "global"`；409 `department_missing`；400 `visibility_not_applicable`。

- [ ] **Step 1: 写会红的用例（加到发布成功用例之后）**

```ts
it.live("个人资产发布时带可见范围 ⇒ 200；库、文件、审计一起落地", () =>
  Effect.gen(function* () {
    const id = "asset-personal-scope-0001"
    if (!pg) throw new Error("真库没起来")
    const db = pg.db
    yield* Effect.promise(() =>
      insertAsset(
        db,
        资产({ id, name: "个人讲话稿", status: "pending_tech", visibility: "personal", updatedAt: 1_100 }),
      ),
    )
    造目录(join(ASSETS_ROOT, "pending", id))

    const response = yield* post(ADMIN, transitionUrl(id), {
      action: "publish_tech",
      visibility: "department",
    })

    expect(response.status).toBe(200)
    expect((yield* json(TransitionResponse, response)).asset.visibility).toBe("department")
    // 部门目录是 `dept/`（`storage.ts:96`）。
    expect(有文件(join(ASSETS_ROOT, "dept", "基座部门", "skills", id, "SKILL.md"))).toBe(true)
    expect(有文件(join(ASSETS_ROOT, "pending", id))).toBe(false)

    // `detail` 是 text 列（0015 迁移），不是 jsonb：解析后再比对键值。
    const [审计] = rowsOf(
      yield* Effect.promise(() =>
        db.execute(sql`select detail from auth.audit_event where target_id = ${id} order by id desc limit 1`),
      ),
    )
    const 详情 = JSON.parse(String(审计?.detail)) as Record<string, unknown>
    expect(详情["visibility"]).toBe("department")
  }),
)

it.live("发布范围参数不合法 ⇒ 400；个人资产不带范围仍 409", () =>
  Effect.gen(function* () {
    const id = "asset-personal-scope-0002"
    if (!pg) throw new Error("真库没起来")
    const db = pg.db
    yield* Effect.promise(() =>
      insertAsset(db, 资产({ id, name: "个人讲话稿二", status: "pending_tech", visibility: "personal", updatedAt: 1_100 })),
    )
    造目录(join(ASSETS_ROOT, "pending", id))

    const 未知 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "world" })
    expect(未知.status).toBe(400)
    expect((yield* json(ErrorResponse, 未知)).error).toContain("未知可见范围")

    const 个人 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "personal" })
    expect(个人.status).toBe(400)
    expect((yield* json(ErrorResponse, 个人)).error).toContain("部门或全局")

    const 缺省 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech" })
    expect(缺省.status).toBe(409)

    // 非发布动作带范围：服务层拒绝，出口翻 400。
    // 用**本用例自建**的资产，不借共享夹具（`IDS.review` 会被别的用例改成 pending_tech，
    // 那时先撞 `invalid_source`）。
    const 越界ID = "asset-scope-out-0003"
    yield* Effect.promise(() =>
      insertAsset(db, 资产({ id: 越界ID, name: "越界参数", status: "in_review", updatedAt: 1_100 })),
    )
    const 越界 = yield* post(EXPERT, transitionUrl(越界ID), {
      action: "approve_business",
      visibility: "global",
    })
    expect(越界.status).toBe(400)
    expect((yield* json(ErrorResponse, 越界)).error).toContain("不接受可见范围")
  }),
)
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /d/project/study/openhive/openhive/packages/opencode
bun test test/server/openhive-governance-assets.test.ts 2>&1 | tail -20
```

期望：新用例红——第一条拿到 409（路由还没传 `visibility`），第二条的 400 断言也不成立。

- [ ] **Step 3: 路由收参数（`governance-assets.ts`，`reason` 解析之后）**

```ts
    const visibility = body["visibility"]
    if (visibility !== undefined) {
      if (visibility === "personal") {
        return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, "发布范围必须是部门或全局", "visibility")
      }
      if (visibility !== "department" && visibility !== "global") {
        return yield* 失败(
          deps, userId, 未知对象, BAD_REQUEST, `未知可见范围：${String(visibility)}`, "visibility",
        )
      }
    }
    const 范围 = visibility === "department" || visibility === "global" ? visibility : undefined
```

- [ ] **Step 4: 传给服务层并记进审计**

```ts
    const result = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          transitionAsset({
            db: deps.pg(),
            root: assetsRoot(process.env),
            assetId,
            action: 动,
            viewer,
            grants,
            ...(reason === undefined ? {} : { reason }),
            ...(范围 === undefined ? {} : { visibility: 范围 }),
          }),
        catch: (error) => error,
      }),
    )
```

成功分支的审计 detail：

```ts
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: {
          transition: 动,
          ...(reason === undefined ? {} : { reason }),
          ...(范围 === undefined ? {} : { visibility: 范围 }),
        },
      })
```

- [ ] **Step 5: 映射新错误码**（`映射错误()`）

```ts
      case "unknown_action":
      case "unsupported_asset_type":
      case "visibility_not_applicable":
        return { status: BAD_REQUEST, message: error.message }
      case "invalid_source":
      case "concurrent_transition":
      case "source_directory_required":
      case "personal_asset_not_shared":
      case "department_missing":
        return { status: CONFLICT, message: error.message }
```

同时把函数头注释里的「409 覆盖四种」改成「五种」，补一句 `department_missing`。

- [ ] **Step 6: 跑测试确认绿**

```bash
cd /d/project/study/openhive/openhive/packages/opencode
bun test test/server/openhive-governance-assets.test.ts 2>&1 | tail -8
```

期望：全部通过（含原有 19 条）。

- [ ] **Step 7: 变异验证**

把 `...(范围 === undefined ? {} : { visibility: 范围 })` 从 `transitionAsset` 调用里删掉：

```bash
bun test test/server/openhive-governance-assets.test.ts 2>&1 | grep -E "个人资产发布时带可见范围|pass|fail" | tail -4
```

期望：该条红（409）。恢复后重跑全绿。

- [ ] **Step 8: 提交**

```bash
cd /d/project/study/openhive/openhive
git add packages/opencode/src/server/openhive/governance-assets.ts \
  packages/opencode/test/server/openhive-governance-assets.test.ts
git commit -F - <<'EOF'
feat(opencode): 治理发布出口接收可见范围，新错误码映射 400 / 409

- body.visibility 闭集校验：未知值 / personal / 非对象类型 ⇒ 400
- 成功流转的审计 detail 记下最终范围
- department_missing → 409；visibility_not_applicable → 400
EOF
```

---

### Task 3: MCP `publish_skill` 支持发布范围

**Files:**
- Modify: `packages/asset-service/src/governance.ts:109-121`（schema）、`:340-375`（`runTool`）
- Test: `packages/asset-service/src/governance.test.ts:607` 的 `describe("publish_skill")`

**Interfaces:**
- Consumes: `TransitionAssetInput.visibility`（Task 1）。
- Produces: 工具入参 `visibility?: "department" | "global"`。

- [ ] **Step 1: 写会红的用例（加到 `describe("publish_skill")`）**

```ts
test("个人资产带 visibility=department 可发布：元数据与目录一起变", async () => {
  const { db, root, client } = await harness()
  await insertAsset(db, metadata({ status: "pending_tech", visibility: "personal" }))
  await mkdir(join(root, "pending", "asset_1"), { recursive: true })
  await writeFile(join(root, "pending", "asset_1", "SKILL.md"), "# 个人稿\n")
  await grant(db, "u2", "admin")

  const result = await call(client, "publish_skill", { assetId: "asset_1", visibility: "department" }, "u2")

  expect(result.isError).toBe(false)
  const [row] = rowsOf(await db.execute(sql`select visibility from auth.asset where id = 'asset_1'`))
  expect(row?.visibility).toBe("department")
  // 部门目录是 `dept/`（`storage.ts:75-76,96`），不是 `department/`。
  expect(await exists(join(root, "dept", "经侦支队", "skills", "asset_1", "SKILL.md"))).toBe(true)
})

test("发布范围不是 department / global ⇒ invalid_arguments", async () => {
  const { db, client, root } = await harness()
  await insertAsset(db, metadata({ status: "pending_tech", visibility: "personal" }))
  await mkdir(join(root, "pending", "asset_1"), { recursive: true })
  await grant(db, "u2", "admin")

  const result = await call(client, "publish_skill", { assetId: "asset_1", visibility: "world" }, "u2")

  expect(result.isError).toBe(true)
  expect(result.text).toContain("invalid_arguments")
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /d/project/study/openhive/openhive/packages/asset-service
bun test src/governance.test.ts 2>&1 | tail -15
```

期望：第一条红（仍是 `personal_asset_not_shared`）；第二条红（schema 关掉了 `additionalProperties`，SDK 可能直接报错——按实得调整断言，但必须看到红）。

- [ ] **Step 3: 扩 schema**（`publish_skill` 的 `inputSchema.properties`）

```ts
        visibility: {
          type: "string",
          enum: ["department", "global"],
          description: "发布范围：department（作者所在部门）或 global；个人资产必须传",
        },
```

- [ ] **Step 4: `runTool` 解析并传递**

```ts
  let visibility: "department" | "global" | undefined
  const 声明范围 = args["visibility"]
  if (声明范围 !== undefined) {
    if (name !== "publish_skill") {
      // 与 HTTP 出口同一条取向：不静默忽略调用方传错的参数。
      return errorResult("invalid_arguments", `${name} 不接受 visibility（只有 publish_skill 可以选）`)
    }
    if (声明范围 !== "department" && 声明范围 !== "global") {
      return errorResult("invalid_arguments", "visibility 必须是 department / global 之一")
    }
    visibility = 声明范围
  }
```

调用处：

```ts
    const updated = await transitionAsset({
      db: deps.db,
      root: deps.root,
      assetId,
      action,
      viewer: viewerOf(user),
      ...(source === undefined ? {} : { sourceDirectory: source }),
      ...(visibility === undefined ? {} : { visibility }),
    })
```

- [ ] **Step 5: 跑测试确认绿**

```bash
cd /d/project/study/openhive/openhive/packages/asset-service
bun test src/governance.test.ts 2>&1 | tail -8
```

- [ ] **Step 6: 变异验证**

删掉 `...(visibility === undefined ? {} : { visibility })`，重跑 —— 第一条必须红；恢复。

- [ ] **Step 7: 提交**

```bash
cd /d/project/study/openhive/openhive
git add packages/asset-service/src/governance.ts packages/asset-service/src/governance.test.ts
git commit -F - <<'EOF'
feat(asset-service): publish_skill 支持发布范围（MCP 出口与 HTTP 同一套规则）

- 入参 visibility 只收 department / global；其它值 invalid_arguments
- 个人资产不带范围仍回 personal_asset_not_shared
EOF
```

---

### Task 4: 前端 API——流转载荷带可见范围

**Files:**
- Modify: `packages/app/src/governance/asset-api.ts:93-100`（接口）、`:244-250`（实现）
- Test: `packages/app/src/governance/asset-api.test.ts`（`describe("资产客户端 · 流转")`）

**Interfaces:**
- Produces: `transition(id, action, reason?, visibility?: "department" | "global")`。
- Consumes: 无。

- [ ] **Step 1: 写会红的用例**

```ts
test("带可见范围时体是 { action, visibility }；不带时体里没有这个键", async () => {
  const { send, calls } = 替身(() => json({ asset: 资产("a1", { status: "published" }) }))

  await createAssetApi(send).transition("a1", "publish_tech", undefined, "department")
  await createAssetApi(send).transition("a1", "publish_tech")

  expect(calls[0]?.init?.body).toBe(JSON.stringify({ action: "publish_tech", visibility: "department" }))
  expect(calls[1]?.init?.body).toBe(JSON.stringify({ action: "publish_tech" }))
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /d/project/study/openhive/openhive/packages/app
bun test src/governance/asset-api.test.ts 2>&1 | tail -12
```

期望：红——第四个参数被忽略，第一个 body 里没有 `visibility`。

- [ ] **Step 3: 改接口与实现**

```ts
export interface AssetApi {
  list(query?: AssetQuery): Promise<AssetOutcome<readonly AssetRow[]>>
  /**
   * 流转一份资产。`reason` 只在 `reject_business` 上是必填；
   * 发布类动作可带 `visibility`（本部门 / 全局），个人资产发布时必填。
   *
   * 刻意**不**新造 `PublishScope` 这个名字：`asset-service/storage.ts` 里已经有一个同名的
   * 存储入参类型（`{visibility, department}`），两个意思不同、不该同名。
   */
  transition(
    id: string,
    action: GovernanceAction,
    reason?: string,
    visibility?: "department" | "global",
  ): Promise<AssetOutcome<{ readonly asset: AssetRow; readonly notice?: string }>>
}
```

```ts
    transition: (id, action, reason, visibility) =>
      请求(send, PATH.transition(id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(reason === undefined ? {} : { reason }),
          ...(visibility === undefined ? {} : { visibility }),
        }),
      }, 流转结果),
```

（只改两处：入参加 `visibility`、`body` 换成对象拼接。`method` / `headers` / 第四个参数 `流转结果` 一律照旧——漏掉解码器会让返回值从 `AssetOutcome` 变成裸回包。）

- [ ] **Step 4: 跑测试确认绿**

```bash
cd /d/project/study/openhive/openhive/packages/app
bun test src/governance/asset-api.test.ts 2>&1 | tail -8
```

- [ ] **Step 5: 提交**

```bash
cd /d/project/study/openhive/openhive
git add packages/app/src/governance/asset-api.ts packages/app/src/governance/asset-api.test.ts
git commit -F - <<'EOF'
feat(app): 治理流转 API 支持可见范围载荷
EOF
```

---

### Task 5: 前端确认框——发布时选择本部门 / 全局

**Files:**
- Modify: `packages/app/src/governance/asset-governance.tsx:128-225`（信号与提交）、`:413-462`（确认框）
- Test: `packages/app/src/governance/asset-governance.test.tsx`

**Interfaces:**
- Consumes: `AssetApi.transition(id, action, reason?, visibility?)`（Task 4）。
- Produces: DOM 槽位 `asset-publish-scope-department` / `-global` / `asset-publish-hint` / `asset-scope-error`。

- [ ] **Step 1: 写会红的用例**

先扩 `记录` 与假后端（`asset-governance.test.tsx:55-82`）：

```ts
interface 记录 {
  readonly list: AssetQuery[]
  readonly transition: Array<{
    readonly id: string
    readonly action: GovernanceAction
    readonly reason?: string
    readonly visibility?: "department" | "global"
  }>
}

    transition: async (id, action, reason, visibility) => {
      记录.transition.push({
        id,
        action,
        ...(reason === undefined ? {} : { reason }),
        ...(visibility === undefined ? {} : { visibility }),
      })
      const 原行 = 样本.find((row) => row.id === id) ?? 资产(id)
      // 原实现回 `pending_tech`；假后端只被断言「记下了什么」，不改它。
      return { kind: "ok", value: { asset: { ...原行, status: "pending_tech" } } }
    },
```

再加两条用例（`点击` 只认 `HTMLButtonElement`，单选要单独一个帮手）：

```ts
function 点单选(selector: string) {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLInputElement)) throw new Error(`不是单选：${selector}`)
  目标.click()
}

test("个人资产发布：无默认范围、发布按钮禁用，选了全局才能提交并带上范围", async () => {
  const 个人待发布 = 资产("p1", { name: "个人讲话稿", status: "pending_tech", visibility: "personal" })
  const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [个人待发布] }))
  挂上(api)
  await 等到(() => 有("[data-slot='asset-row']") !== null)

  选状态("pending_tech")
  await 等到(() => 有("[data-slot='asset-row']") !== null)
  点击("[data-slot='asset-action-publish_tech']")

  expect(文章("[data-slot='asset-publish-hint']")).toContain("个人可见")
  expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)
  expect(有("[data-slot='asset-publish-scope-department']")).not.toBeNull()

  点单选("[data-slot='asset-publish-scope-global']")
  await 等到(() => !按钮("[data-slot='asset-confirm-submit']").disabled)
  点击("[data-slot='asset-confirm-submit']")
  await 等到(() => 记录.transition.length === 1)

  expect(记录.transition[0]).toEqual({ id: "p1", action: "publish_tech", visibility: "global" })
})

test("部门资产发布：预选本部门，可直接提交", async () => {
  const 部门待发布 = 资产("p2", { name: "部门工具", status: "pending_tech", visibility: "department" })
  const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [部门待发布] }))
  挂上(api)
  选状态("pending_tech")
  await 等到(() => 有("[data-slot='asset-row']") !== null)
  点击("[data-slot='asset-action-publish_tech']")

  const 本部门 = 有("[data-slot='asset-publish-scope-department']")
  expect(本部门 instanceof HTMLInputElement && 本部门.checked).toBe(true)
  expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)

  点击("[data-slot='asset-confirm-submit']")
  await 等到(() => 记录.transition.length === 1)
  expect(记录.transition[0]).toEqual({ id: "p2", action: "publish_tech", visibility: "department" })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /d/project/study/openhive/openhive/packages/app
bun test src/governance/asset-governance.test.tsx 2>&1 | tail -15
```

期望：两条红（找不到槽位 / 提交没带范围）。

- [ ] **Step 3: 加信号与派生**

```ts
  const [发布范围, 设发布范围] = createSignal<"department" | "global">()
  const [范围错误, 设范围错误] = createSignal<string>()
```

```ts
  const 是发布动作 = (action: GovernanceAction) =>
    action === "publish_tech" || action === "publish_iteration"

  const 需要选范围 = () => {
    const 目标 = 确认()
    return 目标 !== undefined && 是发布动作(目标.action)
  }
```

`打开确认` 里初始化：

```ts
  function 打开确认(row: AssetRow, action: GovernanceAction) {
    设提示(undefined)
    设动作错误(undefined)
    设理由("")
    设理由错误(undefined)
    设范围错误(undefined)
    设发布范围(row.visibility === "personal" ? undefined : row.visibility)
    设确认({ row, action })
  }
```

`关确认` 里清掉：`设范围错误(undefined); 设发布范围(undefined)`。

- [ ] **Step 4: 提交时校验并传参**

```ts
  async function 提交() {
    const 目标 = 确认()
    if (!目标) return
    const 需要理由 = 目标.action === "reject_business"
    const 理由值 = 理由().trim()
    if (需要理由 && 理由值 === "") {
      设理由错误("请填写驳回理由")
      return
    }
    const 选范围 = 是发布动作(目标.action)
    if (选范围 && 发布范围() === undefined) {
      设范围错误("请选择发布范围")
      return
    }

    设处理中(true)
    设动作错误(undefined)
    设理由错误(undefined)
    设范围错误(undefined)
    const out = await props.api.transition(
      目标.row.id,
      目标.action,
      需要理由 ? 理由值 : undefined,
      选范围 ? 发布范围() : undefined,
    )
    设处理中(false)

    if (out.kind !== "ok") {
      if (out.kind === "rejected" && out.field === "reason") 设理由错误(out.message)
      else 设动作错误(out.message)
      return
    }

    设确认(undefined)
    const 名 = out.value.asset.name
    设提示(
      out.value.notice === undefined
        ? `已${动作文案[目标.action]}「${名}」`
        : `已${动作文案[目标.action]}「${名}」；但${out.value.notice}`,
    )
    await 读()
  }
```

（除新增的「选范围」校验与第四个实参外，其余逐字照旧——失败分支仍只区分 `field === "reason"`，其它错误进 `动作错误`，`field: "visibility"` 的 400 也走这条。）

- [ ] **Step 5: 确认框加单选**（放在说明文字与驳回理由之间）

```tsx
              <Show when={需要选范围()}>
                <fieldset class="flex flex-col gap-2" data-slot="asset-publish-scope">
                  <legend class="text-[12px] text-v2-text-text-muted">发布范围</legend>
                  <Show when={确认()?.row.visibility === "personal"}>
                    <p data-slot="asset-publish-hint" class="text-[12px] text-v2-text-text-muted">
                      这份资产当前是个人可见，请选择发布范围
                    </p>
                  </Show>
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="asset-publish-scope-department"
                      type="radio"
                      name="asset-publish-scope"
                      value="department"
                      checked={发布范围() === "department"}
                      disabled={处理中()}
                      onChange={() => {
                        设发布范围("department")
                        设范围错误(undefined)
                      }}
                    />
                    <span>本部门{确认()?.row.department ? `（${确认()?.row.department}）` : ""}</span>
                  </label>
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="asset-publish-scope-global"
                      type="radio"
                      name="asset-publish-scope"
                      value="global"
                      checked={发布范围() === "global"}
                      disabled={处理中()}
                      onChange={() => {
                        设发布范围("global")
                        设范围错误(undefined)
                      }}
                    />
                    <span>全局</span>
                  </label>
                  <Show when={范围错误()}>
                    {(message) => (
                      <span data-slot="asset-scope-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                        {message()}
                      </span>
                    )}
                  </Show>
                </fieldset>
              </Show>
```

- [ ] **Step 6: 提交按钮禁用条件**

```tsx
                disabled={处理中() || (需要选范围() && 发布范围() === undefined)}
```

- [ ] **Step 7: 跑测试确认绿**

```bash
cd /d/project/study/openhive/openhive/packages/app
bun test src/governance/asset-governance.test.tsx src/governance/asset-api.test.ts 2>&1 | tail -8
```

- [ ] **Step 8: 变异验证**

把提交里的 `选范围 ? 发布范围() : undefined` 改成 `undefined`：第一条新用例必须红（记录里没有 `visibility`）；恢复。

- [ ] **Step 9: 提交**

```bash
cd /d/project/study/openhive/openhive
git add packages/app/src/governance/asset-governance.tsx packages/app/src/governance/asset-governance.test.tsx
git commit -F - <<'EOF'
feat(app): 发布弹窗选择本部门 / 全局

- 个人资产无默认、必须选；部门 / 全局资产预选原范围
- 未选时发布按钮禁用；提交后沿用提示语与列表刷新
EOF
```

---

### Task 6: 门禁、文档对账与真栈验收

**Files:**
- Modify: `docs/superpowers/specs/009-ai-assets/lifecycle.md:79`（旧说法已过时）
- 无新增代码

- [ ] **Step 1: 仓库根跑门禁**

```bash
cd /d/project/study/openhive/openhive
bun run typecheck 2>&1 | tail -8
bunx oxlint packages/asset-service/src/service.ts packages/asset-service/src/asset.ts \
  packages/asset-service/src/governance.ts packages/opencode/src/server/openhive/governance-assets.ts \
  packages/app/src/governance/asset-api.ts packages/app/src/governance/asset-governance.tsx 2>&1 | tail -5
```

期望：typecheck 全绿；oxlint 0 error 0 warning。

- [ ] **Step 2: 受影响 package 的测试全跑**

```bash
cd /d/project/study/openhive/openhive/packages/asset-service && bun test 2>&1 | tail -6
cd /d/project/study/openhive/openhive/packages/opencode && bun test test/server/openhive-governance-assets.test.ts 2>&1 | tail -6
cd /d/project/study/openhive/openhive/packages/app && bun test src/governance 2>&1 | tail -6
```

- [ ] **Step 3: 文档对账**（`docs/superpowers/specs/009-ai-assets/lifecycle.md:79`）

把：

```markdown
| 个人资产发布 | `publishDirectory` 拒绝 `personal`；`transitionAsset` 让这个错误显式抛出 | 发布前需先把可见范围改成 global/dept（编辑路径未落） |
```

改成：

```markdown
| 个人资产发布 | `publishDirectory` 拒绝 `personal`；发布时由发布者选定 department / global（`2026-10-26-skill-publish-visibility-design.md`） | 个人资产必须补选共享范围；部门为空时只能发全局 |
```

- [ ] **Step 4: 真栈验收（进程归用户，先问再动）**

```bash
# 1) 杀掉两个进程（前门 3010 与内核 4711 是两个进程，见 #010-03）
#    用 netstat 找 PID，不要只杀 stack.ts
# 2) 重启
cd /d/project/study/openhive/openhive/packages/app
REAL_STACK_DB=remote bun e2e/real-stack/stack.ts
# 3) 等 STACK_READY，确认 "db":"remote"（见 openhive-dev-db-remote-postgres）
# 4) 浏览器登录李四 020600 → AI 资产 → 技术发布审核 → 发布「湖州公安风格领导讲话稿」
# 5) 选「全局」→ 发布
```

期望：200；卡片显示「全局 / 已发布」；`D:\assets\pending\asset_15c2d13f-…` 消失；`D:\assets\global\skills\asset_15c2d13f-…\SKILL.md` 出现。

- [ ] **Step 5: 收尾对账**

- [ ] 本轮所有提交信息里写明参考了 `#002-06` / `#004-09` / `#005-47`
- [ ] `git status --short` 只剩有意改动
- [ ] `git diff --stat bun.lock` 为空
