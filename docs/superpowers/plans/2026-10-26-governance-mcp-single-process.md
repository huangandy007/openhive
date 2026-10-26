# 治理 MCP 单进程形态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把资产治理 MCP 从「每个用户×项目一份 stdio 子进程 + 一份手写 `opencode.json`」改成「内核自起一份本地 HTTP MCP（127.0.0.1）+ 每次调用带 `_meta{openhive/user, openhive/directory}`」，使容器内恒定 2 进程、配置全局一份、部署零额外运维。

**Architecture:** 内核启动时（`createRoutes` 的 scoped layer）spawn 一个 `asset-service/src/mcp-http.ts` 子进程，读它的就绪行拿到端口，再用 `Config.updateGlobal()` 把 `mcp.openhive-governance` 写成一条 `type: "remote"` 的全局配置。沙箱边界不再靠子进程 cwd，而由服务端按每次调用带的 `_meta["openhive/directory"]` 独立判定（必须落在 `${OPENHIVE_WORKSPACE_ROOT}/${user}/` 之内）。

**Tech Stack:** Bun 1.4.x / TypeScript 5.8 / Effect 4.0.0-beta.74（`Layer.effectDiscard`、`Effect.forkScoped`）/ `@modelcontextprotocol/sdk@1.29.0`（`WebStandardStreamableHTTPServerTransport`、`StreamableHTTPClientTransport`）/ drizzle。

**Spec:** `docs/superpowers/specs/2026-10-26-governance-mcp-single-process-design.md`（实现期以它和本文件为准；两份冲突时以 spec 的「决策记录」为准）

**LEARNINGS 命中（实现与提交信息都要写）：** `#010-03`（重启只杀包装进程 ⇒ 子进程占端口／按进程树收）、`#002-06`（同一个前提只留一份写法；收尾 grep 全部同类落点）、`#004-11`（env 不经 Effect Config 共享，`process.env` 与 `Config` 是两条路）、`#006-05`（确认工具跑在哪个运行时）、`#005-24`（校验接在共同出口）。

## Global Constraints

- `_meta` 键名逐字：`"openhive/user"`、`"openhive/directory"`；错误码逐字：`identity_required`、`source_outside_sandbox`、`source_outside_workspace`（既有）、`invalid_arguments`。
- 配置键名逐字：`"openhive-governance"`（= `@opencode-ai/auth/builtin-mcp` 的 `GOVERNANCE_MCP_SERVER`），类型 `type: "remote"`。
- 就绪行逐字：`GOVERNANCE_MCP_READY {"port":N}`（前缀 + 一个空格 + JSON）。
- 环境变量：`OPENHIVE_ASSET_SERVICE_DIR`（asset-service 包目录）、`OPENHIVE_GOVERNANCE_MCP`（`off` 关）、`OPENHIVE_GOVERNANCE_MCP_CMD`（JSON 数组，覆盖默认命令）、`OPENHIVE_GOVERNANCE_MCP_PORT`（固定端口，缺省 0 = 系统分配）。
- 不改上游 `packages/opencode/src/mcp/index.ts`；不删 `asset-service/src/mcp-main.ts`（stdio 降级路径与单测仍用）。
- 「加」而不「改」：`createRoutes` 只加一行 layer，不动上游 endpoint 定义。
- 提交：按项目约定**每个任务一个提交**；**只在用户明确要求时才提交**，未要求时把改动留在工作区并在收尾报告里列出待提交清单。
- 门禁一律**在仓库根**跑（`#004-10`）：`cd packages/asset-service && bun run typecheck` / `bun test src/<file>` 是 package 内命令；`bun run lint` 在仓库根。
- 每条改动的完成判据都要先声明、拿实测输出（`#006-29`：报告只写跑过的命令与它实际的输出）。

## 文件结构（先定边界，再定任务）

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/asset-service/src/governance.ts` | 三个工具的语义 + 沙箱边界判定 | 改：`sourceRoot` → `workspaceRoot`，新增 `sandboxDirectoryOf()` |
| `packages/asset-service/src/mcp-main.ts` | stdio 入口（降级路径） | 改：只换 deps 的一行 |
| `packages/asset-service/src/mcp-http.ts` | HTTP 入口（新形态的生产入口） | 新增 |
| `packages/opencode/src/mcp/openhive-identity.ts` | 出站 MCP `_meta` 注入 | 改：增补目录键 |
| `packages/opencode/src/server/openhive/governance-mcp-supervisor.ts` | spawn / 就绪解析 / 退避重启 / 写全局配置 | 新增 |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 路由合并处 | 改：导入一行 + 合并一行 |
| `packages/app/e2e/real-stack/stack.ts` | 真栈编排（给内核注入隔离的 `XDG_CONFIG_HOME`） | 改：两行 env |

---

### Task 1: 沙箱判定（`_meta` 目录 + 服务端校验）

**Files:**
- Modify: `packages/asset-service/src/governance.ts:49-61`（文件头「源目录边界」段）、`:63-64`（常量区）、`:161-168`（`GovernanceDeps`）、`:284-298`（`isRecord`/`userIdOf` 附近新增函数）、`:325-326`、`:403-404`（两处调用点）
- Modify: `packages/asset-service/src/mcp-main.ts:27-31`
- Test: `packages/asset-service/src/governance.test.ts:101-139`（harness + `call`）、新增断言块
- Test: `packages/asset-service/src/acceptance-sc003-mcp.test.ts:146-201`（harness + `call`）
- Test: `packages/asset-service/src/real-pg.test.ts:266-320`（B4 真进程用例）

**Interfaces:**
- Produces:
  - `export const DIRECTORY_META_KEY = "openhive/directory"`（governance.ts）
  - `export function sandboxDirectoryOf(workspaceRoot: string, userId: string, meta: unknown): string`（抛 `GovernanceError`）
  - `GovernanceDeps = { db: AssetTarget; root: string; workspaceRoot: string }`
- Consumes: 无（本任务自成一体）。

> 顺序说明：先做**纯改名**（`sourceRoot` → `workspaceRoot`，行为不变），拿到绿基线；再写三条会红的用例；最后收紧校验。这样「红」钉的是**新行为**，不是编译错误。

- [ ] **Step 1: 接口改名（行为不变），并把三个测试文件的夹具改成「工作区根 + 用户沙箱」形状**

`packages/asset-service/src/governance.ts`：

```ts
export interface GovernanceDeps {
  /** 生产是 `connect(process.env)`；测试注入真库夹具。 */
  readonly db: AssetTarget
  /** 资产共享根（`assetsRoot(process.env)`）。 */
  readonly root: string
  /** 沙箱根的上级（`workspaceRoot(process.env)`，默认 `/workspaces`）：`<workspaceRoot>/<userId>/…` 之内才收。 */
  readonly workspaceRoot: string
}
```

`resolveSourceDirectory(deps.workspaceRoot, …)` 暂时保持原样（本步只改名）。`packages/asset-service/src/mcp-main.ts`：

```ts
import { workspaceRoot } from "@opencode-ai/auth/workspace"
// …
const server = createGovernanceServer({
  db: connect(process.env),
  root: assetsRoot(process.env),
  workspaceRoot: workspaceRoot(process.env),
})
```

`packages/asset-service/src/governance.test.ts` 的 harness 与 `call` 改成（`tempDir`/`prepareSkillSource` 等其余代码不动）：

```ts
/** 最近一次 harness 建的工作区根——`call()` 用它给 `_meta` 补默认目录。 */
let currentWorkspaceRoot = ""

interface Harness {
  readonly db: ProductionDb["db"]
  readonly root: string
  readonly workspaceRoot: string
  /** 「甲民警（u1）的沙箱根」——绝大多数用例把源目录建在这里。 */
  readonly sourceRoot: string
  readonly client: Client
}

async function harness(options: { sourceRoot?: string } = {}): Promise<Harness> {
  const db = await freshDb()
  const root = await tempDir("gov-assets-")
  const workspaceRoot = await tempDir("gov-workspace-")
  currentWorkspaceRoot = workspaceRoot
  const sourceRoot = options.sourceRoot ?? join(workspaceRoot, "u1")
  await mkdir(sourceRoot, { recursive: true })

  const server = createGovernanceServer({ db, root, workspaceRoot })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test-client", version: "0" }, { capabilities: {} })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  closers.push(async () => {
    await client.close()
    await server.close()
  })

  return { db, root, workspaceRoot, sourceRoot, client }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  userId?: string,
  directory?: string,
): Promise<{ isError: boolean; text: string }> {
  const params: Record<string, unknown> = { name, arguments: args }
  if (userId !== undefined) {
    params._meta = {
      "openhive/user": userId,
      "openhive/directory": directory ?? join(currentWorkspaceRoot, userId),
    }
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SDK 的 callTool 入参是联合类型，测试按名字分派
  const result = (await client.callTool(params as never)) as {
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }
  return { isError: result.isError === true, text: result.content[0]?.text ?? "" }
}
```

`packages/asset-service/src/acceptance-sc003-mcp.test.ts` 同款改动：文件顶部加 `let currentWorkspaceRoot = ""`（与上一文件同名同义），`Harness` 加 `workspaceRoot`，harness 里

```ts
async function harness(who: { readonly id?: string | undefined; readonly perm?: 身份["perm"] | undefined }): Promise<Harness> {
  const db = await freshDb()
  const root = await tempDir("mcp-assets-")
  const workspaceRoot = await tempDir("mcp-workspace-")
  currentWorkspaceRoot = workspaceRoot
  // 「未注入身份」那一栏没有目录可言，隔离一个临时目录即可。
  const sourceRoot = who.id === undefined ? await tempDir("mcp-source-") : join(workspaceRoot, who.id)
  const skillDir = join(sourceRoot, "fund-analysis")
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), `---\nname: fund-analysis\ndescription: 按账户汇总资金流水\n---\n\n# 资金流水分析\n`)
  // …（insertAsset / pending 夹具不变）
  const server = createGovernanceServer({ db, root, workspaceRoot })
  // …（其余不变）
}
```

`call()` 与 `governance.test.ts` 逐字相同（加 `directory?` 形参与 `_meta` 两键）。

`packages/asset-service/src/real-pg.test.ts` B4（真 stdio 进程）——沙箱改由 env 声明：

```ts
      const workspaceRoot = await tempDir("realpg-stdio-workspace-")
      const workspace = join(workspaceRoot, "u1")
      await mkdir(join(workspace, "fund-analysis"), { recursive: true })
      // …
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
          OPENHIVE_ASSETS_ROOT: assetsRoot,
          OPENHIVE_WORKSPACE_ROOT: workspaceRoot,
        },
      // …
          _meta: { "openhive/user": "u1", "openhive/directory": workspace },
```

- [ ] **Step 2: 跑改名后的三套用例，确认基线仍绿**

Run（在 `packages/asset-service` 内）：

```bash
bun test src/governance.test.ts src/acceptance-sc003-mcp.test.ts
bun run typecheck
```

Expected: 全绿（B4 属于 `bun run test:real-pg`，本机需要真 PG，Step 6 记缺口/单独跑）。

- [ ] **Step 3: 写三条会红的用例（钉住新行为）**

`packages/asset-service/src/governance.test.ts` 末尾新增：

```ts
describe("调用目录（_meta openhive/directory）", () => {
  test("缺目录 ⇒ identity_required，且不登记资产", async () => {
    const { db, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const result = await call(
      client,
      "create_skill_draft",
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source },
      "u1",
      "",
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain("identity_required")
    expect(await assetCount(db)).toBe(0)
  })

  test("目录在别人的沙箱里 ⇒ source_outside_sandbox，且不登记资产", async () => {
    const { db, workspaceRoot, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const result = await call(
      client,
      "create_skill_draft",
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source },
      "u1",
      join(workspaceRoot, "u2"),
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain("source_outside_sandbox")
    expect(await assetCount(db)).toBe(0)
  })

  test("目录用 .. 逃出沙箱 ⇒ source_outside_sandbox", async () => {
    const { db, workspaceRoot, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const result = await call(
      client,
      "create_skill_draft",
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source },
      "u1",
      join(workspaceRoot, "u1", "..", ".."),
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain("source_outside_sandbox")
    expect(await assetCount(db)).toBe(0)
  })

  test("目录在沙箱里（可再深一层） ⇒ 正常登记", async () => {
    const { db, workspaceRoot, client } = await harness()
    const project = join(workspaceRoot, "u1", "project-a")
    await mkdir(join(project, "fund-analysis"), { recursive: true })
    await writeFile(
      join(project, "fund-analysis", "SKILL.md"),
      "---\nname: fund-analysis\ndescription: x\n---\n\n# 资金流水分析\n",
    )

    const result = await call(
      client,
      "create_skill_draft",
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: "fund-analysis" },
      "u1",
      project,
    )

    expect(result.isError).toBe(false)
    expect(await assetCount(db)).toBe(1)
  })
})
```

- [ ] **Step 4: 跑它，确认是「因为新行为没做」而红**

Run: `bun test src/governance.test.ts -t "调用目录"`

Expected: 4 条里前 3 条红（第 1 条实得 `ok`/资产 1 行，第 2、3 条实得 `ok`），第 4 条绿。把**实得值**抄进任务记录（`#006-29`）。

- [ ] **Step 5: 实现 `sandboxDirectoryOf` 并接到两处调用点**

`packages/asset-service/src/governance.ts`，常量区（`USER_META_KEY` 之后）：

```ts
/** 与 `packages/opencode/src/mcp/openhive-identity.ts` 的 `DIRECTORY_META_KEY` 逐字一致。 */
export const DIRECTORY_META_KEY = "openhive/directory"
```

`isRecord` 之后新增：

```ts
/**
 * 调用方声明的「当前项目目录」，校验它落在 `<workspaceRoot>/<userId>/` 之内。
 *
 * 单进程形态下 server 不再靠 cwd 区分用户（cwd 恒为内核目录），所以目录由内核按调用带过来
 * （`_meta["openhive/directory"]`）。**这个值不可信**：越界就拒，否则一次
 * `{"openhive/user":"甲","openhive/directory":"/etc"}` 就能把任意系统目录登记成资产。
 *
 * 只做规范化比较，**不 stat**：目录不存在时后续 `skill_file_not_found` 会给出更具体的错误码，
 * 而安全性质（能不能逃出去）只取决于包含关系。
 */
export function sandboxDirectoryOf(workspaceRoot: string, userId: string, meta: unknown): string {
  if (!isRecord(meta)) {
    throw new GovernanceError("identity_required", "缺少调用目录：_meta 未注入 openhive/directory")
  }
  const value = meta[DIRECTORY_META_KEY]
  if (typeof value !== "string" || value.trim() === "") {
    throw new GovernanceError("identity_required", "缺少调用目录：_meta 未注入 openhive/directory")
  }
  if (!isAbsolute(value)) {
    throw new GovernanceError("source_outside_sandbox", `调用目录必须是绝对路径：${value}`)
  }
  const userRoot = resolve(workspaceRoot, userId)
  const directory = resolve(value)
  const rel = relative(userRoot, directory)
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new GovernanceError("source_outside_sandbox", `调用目录越出作者沙箱：${value}`)
  }
  return directory
}
```

`runTool`（原 `:325-326`）：

```ts
  const user = await userOf(deps.db, userIdOf(meta))
  const source =
    sourceDirectory === undefined
      ? undefined
      : resolveSourceDirectory(sandboxDirectoryOf(deps.workspaceRoot, user.id, meta), sourceDirectory)
```

`runCreateDraft`（原 `:403-404`）：

```ts
    const user = await userOf(deps.db, userIdOf(meta))
    const source = resolveSourceDirectory(sandboxDirectoryOf(deps.workspaceRoot, user.id, meta), sourceDirectory)
```

文件头 `## 源目录边界` 段替换为：

```ts
 * ## 源目录边界
 *
 * 提交要把作者沙箱里的成果复制进共享卷。边界分两层：
 * ① **调用目录**（`_meta["openhive/directory"]`）必须落在 `<workspaceRoot>/<userId>/` 之内
 *    （`sandboxDirectoryOf`）——单进程形态下同一个人可能同时在多个项目里，目录只能由内核带；
 * ② **源目录**（工具入参 `sourceDirectory`）只收相对路径，相对调用目录解析，且解析后必须仍在
 *    调用目录内（`resolveSourceDirectory`）。
 *
 * 两层缺任一层，一次 `../..` 就能把服务器上的任意目录复制成「已提交的 skill」。
```

- [ ] **Step 6: 跑用例到绿，然后 grep 全部同类落点**

Run: `bun test src/governance.test.ts src/acceptance-sc003-mcp.test.ts && bun run test:real-pg`（真 PG 不可用时如实记缺口，**不写成已覆盖**）

落点清单（逐个打勾，`#002-06`）：

```bash
grep -rn "sourceRoot" packages/asset-service/src packages/opencode/src --include=*.ts
grep -rn "openhive/user" packages/asset-service/src packages/opencode/src --include=*.ts
grep -rn "createGovernanceServer(" packages --include=*.ts | grep -v node_modules
```

Expected: 第一条只剩 `resolveSourceDirectory` 的参数名（局部变量，不再是 deps 字段）；第二条列出**全部** `_meta` 生产点与夹具点；第三条只有 `mcp-main.ts` / `mcp-http.ts`（Task 2 加）/ 两个测试文件。

- [ ] **Step 7: 变异验证（拆掉修复必须红）**

把 `sandboxDirectoryOf` 里的 `if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) { … }` 整段删掉 → 跑 `bun test src/governance.test.ts -t "调用目录"`：

Expected: 「别人的沙箱」「`..` 逃逸」两条红，实得 `ok`/资产 1 行。恢复代码，再跑一遍绿。

- [ ] **Step 8: 门禁 + 提交**

```bash
cd packages/asset-service && bun run typecheck
cd packages/asset-service && bun test src/governance.test.ts src/acceptance-sc003-mcp.test.ts
cd ../.. && bun run lint
```

`git add` 四个文件后提交（**用户批准提交再执行**）：

```bash
git commit -m "feat(asset-service): 治理 MCP 沙箱改由 _meta 目录 + 服务端校验（单进程形态 1/4）

- GovernanceDeps.sourceRoot → workspaceRoot；新增 sandboxDirectoryOf()
- 越界码 source_outside_sandbox；缺目录码 identity_required
- 测试夹具改成 <workspaceRoot>/<user>/ 形状（含 real-pg B4 真进程）
命中 LEARNINGS #002-06（同类落点）/#006-29（报告口径）"
```

---

### Task 2: HTTP 入口 `mcp-http.ts`

**Files:**
- Create: `packages/asset-service/src/mcp-http.ts`
- Test: `packages/asset-service/src/mcp-http.test.ts`

**Interfaces:**
- Consumes: `createGovernanceServer({db, root, workspaceRoot})`（Task 1）、`assetsRoot(env)`、`workspaceRoot(env)`、`connect(env)`
- Produces:
  - `export const READY_PREFIX = "GOVERNANCE_MCP_READY"`
  - `export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"`
  - `export interface GovernanceHttpDeps { db: AssetTarget; root: string; workspaceRoot: string }`
  - `export function startGovernanceHttp(deps: GovernanceHttpDeps, options?: { hostname?: string; port?: number }): { port: number; stop(): void }`

- [ ] **Step 1: 写会红的测试（真端口、真 MCP 客户端握手）**

`packages/asset-service/src/mcp-http.test.ts`：

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { GOVERNANCE_TOOL_NAMES } from "./governance"
import { startGovernanceHttp } from "./mcp-http"

/**
 * 治理 MCP 的 HTTP 传输（单进程形态）。
 *
 * 判据只两条：① 真端口上三个工具可列可调（说明 transport 接对了，不是「handler 直调」的假覆盖）；
 * ② `/healthz` 与 `/mcp` 之外一律 404（监督器只会探 `/mcp`，多开出口就是多一个攻击面）。
 */
const databases: ProductionDb[] = []
const tempDirs: string[] = []
const stops: Array<() => void> = []

afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  await Promise.all(databases.splice(0).map((database) => database.stop()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function start() {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  const root = await mkdtemp(join(tmpdir(), "http-assets-"))
  const workspaceRoot = await mkdtemp(join(tmpdir(), "http-workspace-"))
  tempDirs.push(root, workspaceRoot)
  const server = startGovernanceHttp({ db: database.db, root, workspaceRoot })
  stops.push(() => server.stop())
  return { server, connectUrl: `http://127.0.0.1:${server.port}/mcp` }
}

async function client(url: string): Promise<Client> {
  const instance = new Client({ name: "http-test", version: "0" }, { capabilities: {} })
  await instance.connect(new StreamableHTTPClientTransport(new URL(url)))
  return instance
}

describe("HTTP 传输", () => {
  test("真端口列出三个治理工具，且能真的调一次（缺身份 ⇒ identity_required）", async () => {
    const { connectUrl } = await start()
    const instance = await client(connectUrl)
    try {
      const { tools } = await instance.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([...GOVERNANCE_TOOL_NAMES].sort())

      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SDK 的 callTool 入参是联合类型
      const result = (await instance.callTool({
        name: "create_skill_draft",
        arguments: { name: "x", description: "x", category: "intelligence", sourceDirectory: "." },
      } as never)) as { isError?: boolean; content: Array<{ type: string; text?: string }> }

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text ?? "").toContain("identity_required")
    } finally {
      await instance.close()
    }
  })

  test("/healthz 回 ok；其它路径 404", async () => {
    const { server } = await start()
    expect(await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).text()).toBe("ok")
    expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑它，确认红**

Run: `bun test src/mcp-http.test.ts`

Expected: FAIL — `Cannot find module './mcp-http'`（模块还没建）。

- [ ] **Step 3: 写实现**

`packages/asset-service/src/mcp-http.ts`：

```ts
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { connect } from "@opencode-ai/auth/db"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import type { AssetTarget } from "./asset"
import { createGovernanceServer } from "./governance"
import { assetsRoot } from "./storage"

/**
 * 资产治理 MCP server 的 HTTP 入口（单进程形态，2026-10-26）。
 *
 * 由 opencode 内核拉起**一份**（不是每用户一份）：只绑 `127.0.0.1`，端口默认由系统分配，
 * 就绪后向 stdout 打一行 `GOVERNANCE_MCP_READY {"port":N}` 供内核解析。
 * 身份与目录都**不靠进程边界**，而是每次调用由内核注入 `_meta`
 * （`packages/opencode/src/mcp/openhive-identity.ts`）——所以一份进程能服务所有人，
 * 且越界判定在 `governance.ts` 里独立成立。
 *
 * 无状态：每个请求一套 transport + server（SDK 的 stateless 用法），不维护会话表。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** 固定端口（重启后复用同一端口，已下发的配置就不会指向死端口）；缺省 0 = 系统分配。 */
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"
export const MCP_PATH = "/mcp"
export const HEALTH_PATH = "/healthz"

export interface GovernanceHttpDeps {
  readonly db: AssetTarget
  readonly root: string
  readonly workspaceRoot: string
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function handleMcp(deps: GovernanceHttpDeps, request: Request): Promise<Response> {
  if (request.method === "GET") {
    // 无状态模式没有可回放的事件流，SDK 要求 GET 回 405（否则客户端会卡在等 SSE）。
    return new Response(null, { status: 405, headers: { allow: "POST" } })
  }
  const server = createGovernanceServer(deps)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export function startGovernanceHttp(
  deps: GovernanceHttpDeps,
  options: { hostname?: string; port?: number } = {},
): { port: number; stop(): void } {
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname === HEALTH_PATH) return new Response("ok")
      if (url.pathname !== MCP_PATH) return jsonError(404, { error: "not_found" })
      return handleMcp(deps, request)
    },
  })
  return { port: server.port ?? 0, stop: () => void server.stop(true) }
}

if (import.meta.main) {
  const server = startGovernanceHttp(
    { db: connect(process.env), root: assetsRoot(process.env), workspaceRoot: workspaceRoot(process.env) },
    { port: Number(process.env[PORT_ENV] ?? 0) },
  )
  process.stdout.write(`${READY_PREFIX} ${JSON.stringify({ port: server.port })}\n`)
  const shutdown = () => {
    server.stop()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}
```

- [ ] **Step 4: 跑测试到绿，并手验就绪行真的打出来**

Run:

```bash
bun test src/mcp-http.test.ts
```

Expected: PASS（2 条）。

就绪行手验（用真库不一定可用，用一个必然失败的 env 也可，只验「失败时不谎称就绪」）：

```bash
OPENHIVE_GOVERNANCE_MCP_PORT=0 timeout 10 bun run src/mcp-http.ts
```

Expected: 缺 `PG_*` 时**进程报错退出、不打就绪行**（如实记下实际报错文本）。

- [ ] **Step 5: 门禁 + 提交（用户批准后）**

```bash
cd packages/asset-service && bun run typecheck && bun test src/mcp-http.test.ts
cd ../.. && bun run lint
```

```bash
git commit -m "feat(asset-service): 治理 MCP 增加 HTTP 入口（单进程形态 2/4）

- 新增 mcp-http.ts：127.0.0.1 + 系统分配端口 + 就绪行 + /healthz
- 无状态 transport：每请求一套 server/transport
命中 LEARNINGS #006-05（确认运行时）"
```

---

### Task 3: `_meta` 增补 `openhive/directory`

**Files:**
- Modify: `packages/opencode/src/mcp/openhive-identity.ts:51-66`
- Test: `packages/opencode/test/mcp/openhive-user-meta.test.ts`（新增）

**Interfaces:**
- Consumes: `InstanceRef`（`@/effect/instance-ref`，`Context.Reference<InstanceContext | undefined>`）
- Produces: `export const DIRECTORY_META_KEY = "openhive/directory"`；`userMeta()` 仍返回 `Meta | undefined`（无 `User.Service` ⇒ `undefined`，一个键都不带）

- [ ] **Step 1: 写会红的测试**

`packages/opencode/test/mcp/openhive-user-meta.test.ts`：

```ts
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { User } from "@opencode-ai/core/user"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceRef } from "@/effect/instance-ref"
import { DIRECTORY_META_KEY, USER_META_KEY, userMeta } from "@/mcp/openhive-identity"
import { testEffect } from "../lib/effect"

/**
 * 治理 MCP 单进程形态：`_meta` 除身份外还要带「当前项目目录」。
 *
 * 服务端靠这一对键做沙箱判定（`packages/asset-service/src/governance.ts` 的
 * `sandboxDirectoryOf`）。少带目录 ⇒ 服务端 `identity_required`；目录越界 ⇒
 * `source_outside_sandbox`。所以这里钉两件事：**带身份时两个键都在**、**没身份时一个键都不带**。
 */
const ALICE: User.Info = { id: "u_alice", policeNo: "0451", name: "甲民警", isAdmin: false }
const DIRECTORY = "/workspaces/u_alice/project-a"
const instance = {
  directory: DIRECTORY,
  worktree: DIRECTORY,
  project: { id: ProjectV2.ID.global, worktree: DIRECTORY, time: { created: 0, updated: 0 }, sandboxes: [] },
}

const withIdentity = testEffect(Layer.succeed(User.Service, ALICE))

withIdentity.effect("带身份 + 实例目录 ⇒ _meta 里两个键都在", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toEqual({ [USER_META_KEY]: ALICE.id, [DIRECTORY_META_KEY]: DIRECTORY })
  }).pipe(Effect.provideService(InstanceRef, instance)),
)

withIdentity.effect("带身份但没有实例（非 HTTP 入口）⇒ 只带身份，不编目录", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toEqual({ [USER_META_KEY]: ALICE.id })
  }),
)

testEffect(Layer.empty).effect("没有身份 ⇒ 一个键都不带（不是带个空值）", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toBeUndefined()
  }),
)
```

- [ ] **Step 2: 跑它，确认红**

Run（在 `packages/opencode` 内）: `bun test test/mcp/openhive-user-meta.test.ts`

Expected: FAIL — 第一条 `Expected ... toEqual` 少 `openhive/directory`；第三条可能已绿（对照组）。

- [ ] **Step 3: 实现**

`packages/opencode/src/mcp/openhive-identity.ts`：在 `USER_META_KEY` 后加常量，并把 `userMeta` 换成：

```ts
/** 调用方（内核）声明的「当前项目目录」；服务端据此判沙箱边界（不信任值本身，见 asset-service）。 */
export const DIRECTORY_META_KEY = "openhive/directory"

export const userMeta = (): Effect.Effect<Meta | undefined> =>
  Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return undefined
    const instance = yield* InstanceRef
    return {
      [USER_META_KEY]: user.value.id,
      ...(instance === undefined ? {} : { [DIRECTORY_META_KEY]: instance.directory }),
    }
  })
```

并加 import：

```ts
import { InstanceRef } from "@/effect/instance-ref"
```

文件头「做什么」段补一行：`_meta` 形状变成

```ts
 *     { "openhive/user": "<user id>", "openhive/directory": "<当前实例的项目目录>" }
 *
 * 目录键只在有实例上下文时带（非 HTTP 入口 / CLI 没有实例就只带身份）——**不编一个默认目录**，
 * 与「没身份就不带身份」同一条理由。
```

- [ ] **Step 4: 跑它到绿，再跑受影响的既有权衡用例**

Run:

```bash
bun test test/mcp/openhive-user-meta.test.ts
bun test test/mcp/openhive-mcp-identity.test.ts
bun test test/session/openhive-mcp-identity.test.ts
bun test test/session/prompt.test.ts -t "MCP 资源"
```

Expected: 全绿。那四个 `toEqual({ "openhive/user": … })` 断言（`test/session/openhive-mcp-identity.test.ts:230/314/415`、`test/session/prompt.test.ts:693`）走的是**无实例**的 `testEffect(...).effect(...)`，因此仍应绿；**若它们红了**，说明该 harness 其实提供了实例 ⇒ 把断言改成 `{ "openhive/user": ALICE.id, "openhive/directory": <实得目录> }`（不要改成 `objectContaining`——那会把「多带了一个键」也放过去）。

- [ ] **Step 5: 门禁 + 提交（用户批准后）**

```bash
cd packages/opencode && bun run typecheck
cd ../.. && bun run lint
```

```bash
git commit -m "feat(mcp): 出站 _meta 增补 openhive/directory（单进程形态 3/4）

- 有实例才带目录；没身份仍一个键都不带
命中 LEARNINGS #004-11（env 与配置是两条路）"
```

---

### Task 4: 监督器模块（spawn / 就绪解析 / 退避重启）

**Files:**
- Create: `packages/opencode/src/server/openhive/governance-mcp-supervisor.ts`
- Test: `packages/opencode/test/server/governance-mcp-supervisor.test.ts`

**Interfaces:**
- Consumes: `GOVERNANCE_MCP_SERVER`（`@opencode-ai/auth/builtin-mcp`）
- Produces:
  - `export const READY_PREFIX = "GOVERNANCE_MCP_READY"`
  - `export const ENTRY_DIR_ENV = "OPENHIVE_ASSET_SERVICE_DIR"`、`export const COMMAND_ENV = "OPENHIVE_GOVERNANCE_MCP_CMD"`、`export const DISABLE_ENV = "OPENHIVE_GOVERNANCE_MCP"`、`export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"`
  - `export function parseReadyLine(line: string): number | undefined`
  - `export function backoffMs(attempt: number): number`
  - `export type CommandPlan = { kind: "off" } | { kind: "command"; command: readonly string[] } | { kind: "invalid"; reason: string }`
  - `export function governanceCommand(env: Record<string, string | undefined>): CommandPlan`
  - `export interface Launched { ready: Promise<number>; exited: Promise<void>; stop(): void }`
  - `export function spawnGovernanceMcp(input: { command: readonly string[]; cwd?: string; port?: number }): Launched`
  - `export function supervise(deps: SupervisionDeps): Effect.Effect<never, never, never>`
  - `export const OpenhiveGovernanceMcp = { layer }`（Task 5 挂载用）

- [ ] **Step 1: 写会红的测试（纯函数 + 假 launch 的循环）**

`packages/opencode/test/server/governance-mcp-supervisor.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import {
  backoffMs,
  governanceCommand,
  parseReadyLine,
  supervise,
  type Launched,
} from "@/server/openhive/governance-mcp-supervisor"

/**
 * 治理 MCP 监督器的判据（不需要真进程）：
 * ① 就绪行解析严格（前缀 + JSON + 合法端口）；
 * ② 退避 1s→60s 封顶；
 * ③ 命令三态：off / 显式命令 / 缺省命令 / 坏 JSON（**不崩**，交给上层记 WARN）；
 * ④ 循环：就绪 ⇒ onReady；退出 ⇒ 退避后重启；就绪超时 ⇒ stop + 退避。
 */
describe("parseReadyLine", () => {
  test("合法行给出端口", () => {
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":41234}')).toBe(41234)
    expect(parseReadyLine('  GOVERNANCE_MCP_READY {"port":41234}  \n')).toBe(41234)
  })

  test("前缀不对 / JSON 坏 / 端口非法 ⇒ undefined", () => {
    expect(parseReadyLine("READY {\"port\":1}")).toBeUndefined()
    expect(parseReadyLine("GOVERNANCE_MCP_READY not-json")).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":0}')).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":"41234"}')).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":70000}')).toBeUndefined()
  })
})

describe("backoffMs", () => {
  test("1s/2s/4s… 封顶 60s", () => {
    expect([0, 1, 2, 3, 6, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 60000, 60000])
  })
})

describe("governanceCommand", () => {
  test("off ⇒ 不起进程", () => {
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP: "off" })).toEqual({ kind: "off" })
  })

  test("没有 asset-service 目录 ⇒ off（不猜路径）", () => {
    expect(governanceCommand({})).toEqual({ kind: "off" })
  })

  test("给了目录 ⇒ bun run <dir>/src/mcp-http.ts", () => {
    const plan = governanceCommand({ OPENHIVE_ASSET_SERVICE_DIR: "/srv/asset-service" })
    expect(plan.kind).toBe("command")
    if (plan.kind !== "command") throw new Error("unreachable")
    expect(plan.command[0]).toBe("bun")
    expect(plan.command.at(-1)).toBe("/srv/asset-service/src/mcp-http.ts")
  })

  test("显式命令优先；坏 JSON ⇒ invalid（不抛）", () => {
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: '["node","x.js"]' })).toEqual({
      kind: "command",
      command: ["node", "x.js"],
    })
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: "not-json" }).kind).toBe("invalid")
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: '["only"]' }).kind).toBe("invalid")
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function scripted(scripts: ReadonlyArray<{ port?: number }>) {
  const handles: Array<{ ready: ReturnType<typeof deferred<number>>; exited: ReturnType<typeof deferred<void>>; stops: number }> = []
  let index = 0
  const launch = (): Launched => {
    const script = scripts[index++]!
    const ready = deferred<number>()
    const exited = deferred<void>()
    const record = { ready, exited, stops: 0 }
    handles.push(record)
    if (script.port !== undefined) ready.resolve(script.port)
    // 真实 `stop()` 是幂等的（已退出就不动），假的也照此——否则「超时分支 stop 一次 + 收尾再 stop 一次」
    // 会让条数断言变成在数调用次数，而不是在数「有没有收」。
    let stopped = false
    return {
      ready: ready.promise,
      exited: exited.promise,
      stop: () => {
        if (stopped) return
        stopped = true
        record.stops += 1
        ready.reject(new Error("stopped"))
        exited.resolve()
      },
    }
  }
  return { launch, handles }
}

const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等待超时：${label}`)
}

describe("supervise", () => {
  test("就绪 ⇒ onReady；退出 ⇒ 按退避重启（重启前不换端口）", async () => {
    const { launch, handles } = scripted([{ port: 4101 }, { port: 4101 }])
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          supervise({
            launch: () => launch(),
            onReady: (port) => Effect.sync(() => void readyPorts.push(port)),
            onFailure: () => Effect.void,
            sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
            startTimeoutMs: 200,
          }),
        )
        yield* Effect.promise(() => until(() => readyPorts.length === 1, "第一次就绪"))
        handles[0]!.exited.resolve()
        yield* Effect.promise(() => until(() => readyPorts.length === 2, "第二次就绪"))
        yield* Fiber.interrupt(fiber)
      }),
    )

    expect(readyPorts).toEqual([4101, 4101])
    expect(sleeps[0]).toBe(1000)
  })

  test("就绪超时 ⇒ stop 掉子进程，并按退避重试", async () => {
    const { launch, handles } = scripted([{}, { port: 4102 }])
    const failures: string[] = []
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          supervise({
            launch: () => launch(),
            onReady: (port) => Effect.sync(() => void readyPorts.push(port)),
            onFailure: (reason) => Effect.sync(() => void failures.push(reason)),
            sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
            startTimeoutMs: 30,
          }),
        )
        yield* Effect.promise(() => until(() => readyPorts.length === 1, "超时后重试成功"))
        yield* Fiber.interrupt(fiber)
      }),
    )

    expect(handles[0]!.stops).toBe(1)
    expect(failures[0]).toContain("超时")
    expect(readyPorts).toEqual([4102])
    expect(sleeps[0]).toBe(1000)
  })
})
```

- [ ] **Step 2: 跑它，确认红**

Run: `bun test test/server/governance-mcp-supervisor.test.ts`

Expected: FAIL — `Cannot find module '@/server/openhive/governance-mcp-supervisor'`。

- [ ] **Step 3: 写实现**

`packages/opencode/src/server/openhive/governance-mcp-supervisor.ts`：

```ts
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"

/**
 * 【这是要保留的定制】openhive 模块：**治理 MCP 单进程形态**（009 T014 的替代形态，2026-10-26）。
 *
 * ## 为什么内核自己拉起
 *
 * 旧形态是「每用户每项目一份 stdio 子进程 + 一份手写 `opencode.json`」：进程数随人数线性涨
 *（实测单实例 ≈ 90MB），配置要有人逐个铺。改成内核启动时 spawn **一份**本地 HTTP MCP，
 * 把 `mcp.openhive-governance` 写进**全局**配置——容器内恒定 2 进程，运维零额外步骤。
 *
 * ## 身份与目录不靠进程边界
 *
 * 一份进程服务所有人，所以「是谁、在哪个沙箱」只能按调用带：内核注入
 * `_meta{openhive/user, openhive/directory}`（`@/mcp/openhive-identity`），服务端独立校验
 * 目录必须落在 `<workspaceRoot>/<user>/` 内。进程边界不再是安全边界，这是本形态成立的前提。
 *
 * ## 失败语义（见 spec §6）
 *
 * - 起不来 / 反复崩 / 15s 没就绪 ⇒ WARN 日志 + 1s/2s/4s…60s 退避重启；
 *   治理工具对模型**不可见**，会话本身照常可用；
 * - 内核退出 ⇒ 作用域收尾把子进程按进程树收掉（`#010-03`：只杀包装进程会留下占端口的子进程）；
 * - 重启时**沿用上一次的端口**，已下发的配置就不会指向死端口。
 *
 * ⚠️ 已知边界：子进程重启后，**已建立的实例**（`InstanceState` 里缓存的 MCP state）不会重建
 * 客户端——新会话正常，老会话要等下次实例初始化。记在 `docs/superpowers/specs/009-ai-assets/state.md`。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** asset-service 包目录；**没设就不起进程**（dev/测试默认不受影响，路径也不靠猜）。 */
export const ENTRY_DIR_ENV = "OPENHIVE_ASSET_SERVICE_DIR"
/** JSON 数组，覆盖默认命令（镜像里 bun 不在 PATH 时用）。 */
export const COMMAND_ENV = "OPENHIVE_GOVERNANCE_MCP_CMD"
/** `off` ⇒ 显式关掉（`ENTRY_DIR_ENV` 已能关，这个给「设了目录但这次不想起」用）。 */
export const DISABLE_ENV = "OPENHIVE_GOVERNANCE_MCP"
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"
export const START_TIMEOUT_MS = 15_000
export const MAX_BACKOFF_MS = 60_000
/** 稳定跑过这么久再崩 ⇒ 退避计数归零（否则「起—崩—起」永远是 1s）。 */
export const RESET_BACKOFF_AFTER_MS = 60_000

export function parseReadyLine(line: string): number | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(READY_PREFIX)) return undefined
  const rest = trimmed.slice(READY_PREFIX.length).trim()
  try {
    const value: unknown = JSON.parse(rest)
    if (typeof value !== "object" || value === null || !("port" in value)) return undefined
    const port = value.port
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
    return port
  } catch {
    return undefined
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), MAX_BACKOFF_MS)
}

export type CommandPlan =
  | { readonly kind: "off" }
  | { readonly kind: "command"; readonly command: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string }

export function governanceCommand(env: Record<string, string | undefined>): CommandPlan {
  if (env[DISABLE_ENV] === "off") return { kind: "off" }

  const explicit = env[COMMAND_ENV]
  if (explicit !== undefined && explicit.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(explicit)
      if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((item) => typeof item === "string")) {
        return { kind: "invalid", reason: `${COMMAND_ENV} 必须是长度 ≥ 2 的字符串数组` }
      }
      return { kind: "command", command: parsed }
    } catch {
      return { kind: "invalid", reason: `${COMMAND_ENV} 不是合法 JSON` }
    }
  }

  const dir = env[ENTRY_DIR_ENV]
  if (dir === undefined || dir.trim() === "") return { kind: "off" }
  return { kind: "command", command: ["bun", "run", join(dir, "src", "mcp-http.ts")] }
}

export interface Launched {
  readonly ready: Promise<number>
  readonly exited: Promise<void>
  stop(): void
}

export function spawnGovernanceMcp(input: {
  readonly command: readonly string[]
  readonly cwd?: string
  readonly port?: number
}): Launched {
  const child: ChildProcess = spawn(input.command[0]!, input.command.slice(1), {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: {
      ...process.env,
      ...(input.port === undefined ? {} : { [PORT_ENV]: String(input.port) }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let settleReady: ((port: number) => void) | undefined
  let failReady: ((error: Error) => void) | undefined
  const ready = new Promise<number>((resolve, reject) => {
    settleReady = resolve
    failReady = reject
  })
  // 没人 await 时别让它变成 unhandled rejection（supervise 会 await）。
  ready.catch(() => undefined)

  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const port = parseReadyLine(line)
      if (port !== undefined) settleReady?.(port)
    }
  })
  // 子进程的日志直接进内核日志（不带就完全看不见它为什么起不来）。
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => process.stderr.write(chunk))

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      failReady?.(new Error("治理 MCP 在就绪前退出"))
      resolve()
    })
  })

  return {
    ready,
    exited,
    stop: () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
      child.once("exit", () => clearTimeout(timer))
    },
  }
}

async function waitReady(child: Launched, timeoutMs: number): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([child.ready.catch(() => undefined), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface SupervisionDeps {
  readonly launch: (port: number | undefined) => Launched
  readonly onReady: (port: number) => Effect.Effect<void, never, never>
  readonly onFailure: (reason: string) => Effect.Effect<void, never, never>
  readonly sleep: (ms: number) => Effect.Effect<void, never, never>
  readonly startTimeoutMs: number
  readonly now?: () => number
}

/**
 * 主循环：起 → 等就绪 → 通知 → 等退出 → 退避 → 再起。永不返回，靠中断收尾。
 *
 * **每一轮各自 `Effect.scoped`**：子进程的 `acquireRelease` 只活在那一轮里——不这样的话，
 * 每次重启都往同一个长命作用域里挂一份收尾器（本轮已退出的进程也一直挂着）。
 * 定时器（`setTimeout`）与停止（SIGTERM→5s 后 SIGKILL）都在 `stop()`/`exited` 里，不占 Effect 的作用域。
 */
export const supervise = (deps: SupervisionDeps): Effect.Effect<never, never, never> =>
  Effect.gen(function* () {
    const now = deps.now ?? Date.now
    let attempt = 0
    let port: number | undefined

    while (true) {
      const startedAt = now()
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Effect.acquireRelease(
            Effect.sync(() => deps.launch(port)),
            (handle) =>
              Effect.promise(async () => {
                handle.stop()
                await handle.exited
              }),
          )

          const readyPort = yield* Effect.promise(() => waitReady(child, deps.startTimeoutMs))
          if (readyPort === undefined) {
            child.stop()
            yield* Effect.promise(() => child.exited)
            return { kind: "timeout" as const }
          }
          yield* deps.onReady(readyPort)
          yield* Effect.promise(() => child.exited)
          return { kind: "exited" as const, port: readyPort }
        }),
      )

      if (outcome.kind === "timeout") {
        yield* deps.onFailure(`治理 MCP 未在 ${deps.startTimeoutMs}ms 内就绪`)
      } else {
        port = outcome.port
        yield* deps.onFailure(`治理 MCP 退出（端口 ${outcome.port}），准备重启`)
        if (now() - startedAt >= RESET_BACKOFF_AFTER_MS) attempt = 0
      }

      yield* deps.sleep(backoffMs(attempt))
      attempt += 1
    }
  })

/** 生产层：读 env 决定起不起、把就绪端口写进全局配置。 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const plan = governanceCommand(process.env)
    if (plan.kind === "off") return
    if (plan.kind === "invalid") {
      yield* Effect.logWarning(`治理 MCP 未启动：${plan.reason}`)
      return
    }

    const config = yield* Config.Service
    // 先读一次：`updateGlobal` 只写不改目录，首次启动要确保全局配置文件已存在。
    yield* config.get()

    yield* Effect.forkScoped(
      supervise({
        launch: (port) =>
          spawnGovernanceMcp({
            command: plan.command,
            cwd: process.env[ENTRY_DIR_ENV],
            ...(port === undefined ? {} : { port }),
          }),
        onReady: (port) =>
          config
            .updateGlobal({
              mcp: {
                [GOVERNANCE_MCP_SERVER]: { type: "remote", url: `http://127.0.0.1:${port}/mcp` },
              },
            })
            .pipe(
              Effect.tap((result) => Effect.logInfo("治理 MCP 就绪", { port, configChanged: result.changed })),
              Effect.catch((error) => Effect.logError("治理 MCP 配置写入失败", { error: String(error) })),
            ),
        onFailure: (reason) => Effect.logWarning(reason),
        sleep: (ms) => Effect.sleep(ms),
        startTimeoutMs: START_TIMEOUT_MS,
      }),
    )
  }),
)

export const OpenhiveGovernanceMcp = { layer }
```

- [ ] **Step 4: 跑测试到绿**

Run: `bun test test/server/governance-mcp-supervisor.test.ts`

Expected: PASS（8 条）。

- [ ] **Step 5: 变异验证**

把 `waitReady` 的 `child.ready.catch(() => undefined)` 换成 `child.ready`（让退出即拒绝、不再等超时）→ 第二条用例（超时 → stop）应红；恢复。再删 `backoffMs` 的 `Math.min(…, MAX_BACKOFF_MS)` → 退避用例红；恢复。

- [ ] **Step 6: 门禁 + 提交（用户批准后）**

```bash
cd packages/opencode && bun run typecheck && bun test test/server/governance-mcp-supervisor.test.ts
cd ../.. && bun run lint
```

```bash
git commit -m "feat(server): 治理 MCP 监督器（spawn/就绪/退避重启）（单进程形态 4/4）

- 就绪行 GOVERNANCE_MCP_READY {"port":N}；1s/2s/4s…60s 退避；沿用端口
- 作用域收尾 SIGTERM→SIGKILL，按进程树收（#010-03）
命中 LEARNINGS #010-03（只杀包装进程）/ #006-05（运行时）"
```

---

### Task 5: 挂到 `createRoutes`（一行，含 fallback 步骤）

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts:127-136`（导入区）、`:245-250`（`RouteRequirements`）、`:449-460`（合并列表末尾）

**Interfaces:**
- Consumes: `OpenhiveGovernanceMcp.layer`（Task 4）
- Produces: 无新导出（层内副作用）；`RouteRequirements` 可能在 typecheck 后需要追加 `Config.Service`

> **为什么这一任务没有单测**：层本身只做两件事——读 `process.env` 决定起不起、把端口写进全局配置。
> 前半段的判据已在 Task 4 的 `governanceCommand` 用例里（`{}` ⇒ `off`）；「挂上去之后类型与启动路径都对」
> 只有真栈能证明（Task 6 三条判据）。在这里编一个假 `Config` 层只会测到假层，不算覆盖（`#005-38` 哑绿）。

- [ ] **Step 1: 先跑挂载前的基线，确认这层改动只会带来「多一行」的差异**

Run: `cd packages/opencode && bun test test/server/httpapi-cors.test.ts`

Expected: PASS（证明 `createRoutes` 现在能正常构建、能起服务）。

- [ ] **Step 2: 挂载（两行）**

导入区（`import { OpenhiveGovernanceMembers }` 之类同段，按字母序放在 `governance-data-source` 之后）：

```ts
import { OpenhiveGovernanceMcp } from "@/server/openhive/governance-mcp-supervisor"
```

合并列表末尾（`OpenhiveMember.routes.pipe(…)` 这一项之后，`).pipe(` 之前）：

```ts
    // openhive 治理 MCP 监督器（2026-10-26）：内核启动时拉起**一份**本地治理 MCP
    //（127.0.0.1，系统分配端口），把 `mcp.openhive-governance` 写进全局配置。
    // 只在这里挂一次；spawn / 退避重启 / 收尾都在它自己的作用域里。
    // 没设 `OPENHIVE_ASSET_SERVICE_DIR` 就是无操作（dev / 单测默认不起进程）。
    // 【保留的定制 · 同步上游时不要丢】—— 治理 MCP 单进程形态。
    OpenhiveGovernanceMcp.layer,
```

- [ ] **Step 3: typecheck；若报「缺 `Config.Service`」就按下面补一行**

Run: `cd packages/opencode && bun run typecheck`

若报 `Config.Service` 未满足（`RouteRequirements` 不含它）：

```ts
type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>
  // 治理 MCP 监督器要写全局配置（`Config.updateGlobal`）。`Config.node` 在 `app` 组里
  //（本文件 `:258`），由下方 `Layer.provide(AppNodeBuilderV1.build(app))` 供上。
  // 【保留的定制 · 同步上游时不要丢】—— 治理 MCP 单进程形态。
  | Config.Service
```

Expected: typecheck 通过（无论是否用到这行 fallback）。

- [ ] **Step 4: 跑受影响用例 + 门禁**

```bash
cd packages/opencode && bun test test/server/governance-mcp-supervisor.test.ts test/server/httpapi-cors.test.ts
cd packages/opencode && bun run typecheck
cd ../.. && bun run lint
```

- [ ] **Step 5: 提交（用户批准后）**

```bash
git commit -m "feat(server): createRoutes 挂治理 MCP 监督器（一行 + 导入）

- 没设 OPENHIVE_ASSET_SERVICE_DIR 即无操作
命中 LEARNINGS #004-11"
```

---

### Task 6: 真栈验收 + 删手写配置 + 文档

**Files:**
- Modify: `packages/app/e2e/real-stack/stack.ts:63-72`（内核 env）
- Delete: `%TEMP%\openhive-real-stack-state\workspaces\550e8400-…\6333eaf3-….opencode\opencode.json`（手工验证留下的那份）
- Modify: `docs/superpowers/specs/009-ai-assets/state.md`（缺口表 + 本轮结论）
- Modify: `docs/superpowers/specs/009-ai-assets/mcp-downlink.md`（验收清单：形态已变）
- Modify: `docs/superpowers/specs/2026-10-26-governance-mcp-single-process-design.md`（§7/§8 落成实测结论与部署清单）

**Interfaces:**
- Consumes: Task 1–5 全部
- Produces: `XDG_CONFIG_HOME`（真栈隔离的全局配置目录，`<state>/config`）

- [ ] **Step 1: 真栈给内核注入隔离的全局配置目录 + asset-service 目录**

`packages/app/e2e/real-stack/stack.ts`，`startKernel()` 内：

```ts
const stateDir = process.env.REAL_STACK_STATE_DIR ?? path.join(tmpdir(), "openhive-real-stack-state")
/** 全局配置（`Global.Path.config` = `$XDG_CONFIG_HOME/opencode`）必须隔离到栈状态目录里：
 * 监督器会 upsert `mcp.openhive-governance`，写进开发机真实的 `~/.config/opencode/opencode.json` 就是污染。 */
const configHome = path.join(stateDir, "config")
mkdirSync(configHome, { recursive: true })
```

并把 spawn 的 env 改成：

```ts
      env: {
        ...process.env,
        REAL_STACK_KERNEL_PORT: String(KERNEL_PORT),
        XDG_CONFIG_HOME: configHome,
        OPENHIVE_ASSET_SERVICE_DIR: path.join(repoRoot, "packages/asset-service"),
      },
```

（`import { mkdirSync } from "fs"` 补进导入。）

- [ ] **Step 2: 删掉手工那份 per-project 配置（它现在是干扰项）**

```bash
rm "$TEMP/openhive-real-stack-state/workspaces/550e8400-e29b-41d4-a716-446655440000/6333eaf3-2aa8-4c55-945d-db587a4f8946/.opencode/opencode.json"
```

（该目录在 Windows 实际路径 `C:\Users\Administrator\AppData\Local\Temp\openhive-real-stack-state\…`；先确认 `git status` 里本来就没有它——它是落盘态，不进仓库。）

- [ ] **Step 3: 起真栈（不接管道，`#010-03`）**

先确认没有残留栈占端口（有就换 `REAL_STACK_*_PORT`，不杀别人的进程）：

```bash
netstat -ano | findstr ":4711 :3010"
```

然后后台起栈：

```bash
cd packages/app && REAL_STACK_STATE_DIR="$TEMP/openhive-real-stack-state" REAL_STACK_DB=remote bun e2e/real-stack/stack.ts
```

Expected: `STACK_READY {"kernel":4711,"front":3010,"db":"8.136.21.218:35432/openhive_dev"}`，且**只出现一次** `治理 MCP 就绪` WARN/INFO 日志。

- [ ] **Step 4: 三条判据（实测输出要贴进 state.md）**

① 配置落位：

```bash
cat "$TEMP/openhive-real-stack-state/config/opencode/opencode.json"
```

Expected: `mcp.openhive-governance = { "type": "remote", "url": "http://127.0.0.1:<端口>/mcp" }`；**开发机真实 `~/.config/opencode/opencode.json` 未被改动**（`git` 外的文件，用 `ls -l` 时间戳或内容对比证明）。

② 内核认为它 connected（走真身份 cookie，见 memory「真栈 HTTP 探针的坑」）：

```bash
curl -s -c /tmp/oh-cookies -H "content-type: application/json" \
  -d '{"policeNo":"020602","password":"Deploy-Only-9527!"}' \
  http://127.0.0.1:3010/openhive/auth/login
curl -s -b /tmp/oh-cookies "http://127.0.0.1:3010/mcp?directory=$TEMP/openhive-real-stack-state/workspaces/550e8400-e29b-41d4-a716-446655440000/6333eaf3-2aa8-4c55-945d-db587a4f8946"
```

Expected: 第二个请求返回 `{"openhive-governance":{"status":"connected"}}`。

③ 进程数 = 1：

```bash
MSYS_NO_PATHCONV=1 tasklist /FI "IMAGENAME eq bun.exe" | findstr /C:"bun.exe"
```

Expected: 治理 MCP 的 bun 进程**恰好 1 个**（与登录了几个账号无关：换第二个账号再查一次仍是 1 个——这条是形态的核心判据）。

- [ ] **Step 5: 一次真实登记（draft → in_review），证明工具可用**

在页面里由**用户本人**操作：对话里说「把这个 skill 登记成资产草稿并提交审核」——预期模型直接调 `create_skill_draft` → `submit_skill_for_review`，不再读源码自救、不再弹 `external_directory`。

判定：库里出现 `status='in_review'` 的新资产行：

```bash
# 在 packages/opencode 内（连远端库的 .env.local 已配好）
bun -e 'const sql=new Bun.SQL({host:process.env.PG_HOST,port:Number(process.env.PG_PORT),database:process.env.PG_DATABASE,username:process.env.PG_USER,password:process.env.PG_PASSWORD});console.log(await sql`select id,name,status,created_at from auth.asset order by created_at desc limit 3`);await sql.close()'
```

- [ ] **Step 6: 更新文档（三份）**

`docs/superpowers/specs/009-ai-assets/state.md` —— 追加一节（**只用 Step 4/5 的实测输出**，不写「应该有」）：

```markdown
## 治理 MCP 单进程形态（2026-10-26）

形态：内核 spawn 一份 `asset-service/src/mcp-http.ts`（127.0.0.1）＋ `Config.updateGlobal` 写全局配置。
详见 `../../2026-10-26-governance-mcp-single-process-design.md`。

| 判据 | 实测 |
|---|---|
| 全局配置落位（栈隔离的 `$XDG_CONFIG_HOME`） | <贴 Step 4 ① 的实际输出> |
| `/mcp` 状态 | <贴 Step 4 ② 的实际输出> |
| 治理 MCP 进程数（换第二个账号后仍为 1） | <贴 Step 4 ③ 的实际输出> |
| 一次真实登记 draft → in_review | <贴 Step 5 的资产行> |

### 缺口（本机无法覆盖，不算已覆盖）

- **Docker 镜像内实测**：本机没有构建带 `bun` + `packages/asset-service` 的镜像。验收命令（部署机执行）：
  `docker compose exec openhive sh -lc 'ps -ef | grep -c "[m]cp-http.ts"'` ⇒ 期望 `1`；
  `docker compose exec openhive sh -lc 'cat "$XDG_CONFIG_HOME/opencode/opencode.json"'` ⇒ 期望含 `openhive-governance`。
- **子进程重启后老会话的 MCP 客户端不会重建**：新会话正常，老会话要等实例重建。未修（在 spec §9「不做的事」范围外，已知边界）。
```

`docs/superpowers/specs/009-ai-assets/mcp-downlink.md` —— 在验收清单处补一条：

```markdown
- [x] 治理 server 的配置**不再**由 `buildUserMcpConfig()` 下发，改由内核监督器 upsert 全局配置
      （`mcp.openhive-governance` 是保留键；管理员手工改会在下次启动被覆盖）。
      `buildUserMcpConfig()` 仅为**业务 MCP 资产**保留，本次未接调用方（spec §9）。
```

`docs/superpowers/specs/2026-10-26-governance-mcp-single-process-design.md` —— §7「缺口表」那行按实测结果改写（Docker 实测**没跑**就写「没跑」，`#003-04`）；§8 补一行 `XDG_CONFIG_HOME`：容器里必须是可写目录（默认 `/root/.config`），**不需要**挂卷——配置每次启动重建。

- [ ] **Step 7: 拆栈、门禁、提交（用户批准后）**

拆栈按进程树（`#010-03`）：

```bash
MSYS_NO_PATHCONV=1 taskkill /PID <stack-pid> /T /F
```

```bash
cd packages/opencode && bun run typecheck
cd packages/asset-service && bun run typecheck
cd ../.. && bun run lint
```

```bash
git add packages/app/e2e/real-stack/stack.ts docs/superpowers/specs
git commit -m "docs(009): 治理 MCP 单进程形态落地结论与真栈验收（含缺口）

- stack.ts 隔离 XDG_CONFIG_HOME，注入 OPENHIVE_ASSET_SERVICE_DIR
- state.md 记三条判据实测 + Docker 镜像内实测缺口
- mcp-downlink.md 验收清单更新：保留键由监督器管理
命中 LEARNINGS #010-03 / #003-04（实测当场复现）"
```

---

## 收尾对账（`verification-before-completion`）

逐条对照 spec：

| spec 条目 | 落在哪 |
|---|---|
| §4 `mcp-http.ts`（就绪行 / healthz / 绑 127.0.0.1 / 端口 0） | Task 2 |
| §4 `governance.ts` 沙箱改按 `_meta` 解析，`source_outside_sandbox` | Task 1 |
| §4 `mcp-main.ts` 保留、共用同一套 server | Task 1（只换 deps） |
| §4 `openhive-identity.ts` 增补目录键 | Task 3 |
| §4 supervisor（spawn / 解析 / 退避 / 收尾） | Task 4 |
| §4 `createRoutes` 加一行 | Task 5 |
| §5 两键缺任一 ⇒ `identity_required`（消息区分缺哪个） | Task 1（`userIdOf` / `sandboxDirectoryOf` 各一条消息） |
| §6 15s 超时 / 退避 / SIGTERM→SIGKILL / 端口 0 | Task 4 |
| §7 单测 4 类 ＋ 真栈 3 类 ＋ 缺口表 | Task 1/2/3/4/5/6 |
| §8 部署要求（env / 卷 / compose 不新增服务） | Task 6 文档 |

**没在本计划里做的事**（spec §9）：业务 MCP 资产的 per-user 下发器；多副本共享一个 MCP；删 stdio 入口；改上游 `mcp/index.ts`。
