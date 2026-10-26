import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import { createGovernanceServer } from "./governance"
import type { AssetMetadata } from "./metadata"

/**
 * SC-003 的**出口层**验收（T017 补测）：治理 MCP 协议出口上的双身份越权。
 *
 * ## 与 `acceptance-sc003.test.ts` 的分层
 *
 * 那份验的是**判据**（`canReadAsset` / `buildUserMcpConfig` 的纯函数全矩阵）；
 * 本文件验的是**出口**——模型能实际调到的三个治理工具。两者不能互相替代：
 * 判据全绿不代表出口关得住（入口可能忘了取身份、可能先搬文件后鉴权）。
 *
 * 本文件补的正是路由报告里记的「对象级越权**出口层**零覆盖」。今天的出口只有 MCP 一条
 * （HTTP 接口未落，见 `session.md`），所以覆盖的是 MCP 出口；HTTP 出口仍记缺口。
 *
 * ## 独立验收口径（写在用例里，不读实现）
 *
 * 七类身份 × 三个工具，逐格钉住期望。规则来自 design §3.1/§3.3：
 *
 * | 身份 | create_skill_draft | submit（草稿，作者 u1） | publish（待发布，作者 u1） |
 * |---|---|---|---|
 * | 作者 u1 | 放行 | 放行（作者身份） | 拒（作者不派生管理权） |
 * | 同部门他人 u3 | 放行 | 拒（同部门可见 ≠ 可写） | 拒 |
 * | 跨部门 + read u7 | 放行 | 拒（读 ≠ 写） | 拒（读 ≠ 管） |
 * | 跨部门 + write u4 | 放行 | 放行（显式写授权） | 拒 |
 * | 跨部门 + review u5 | 放行 | 拒（审 ≠ 写） | 拒（审 ≠ 管） |
 * | 跨部门 + admin u6 | 放行 | 拒（管 ≠ 写） | 放行 |
 * | 停用账号 u_off | 拒 `user_disabled` | 同左 | 同左 |
 * | 不存在 u404 | 拒 `user_not_found` | 同左 | 同左 |
 * | 不注入身份 | 拒 `identity_required` | 同左 | 同左 |
 *
 * 拒绝格不是只看错误码：**副作用必须一份不动**——资产行、目标目录、站内信三份快照。
 * 这是 `#004-09`（门在副作用之前）在协议出口上的落地。
 */

const databases: ProductionDb[] = []
const closers: Array<() => Promise<void>> = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(databases.splice(0).map((database) => database.stop()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  for (const [id, name, dept, status] of [
    ["u1", "甲民警", "经侦支队", 1],
    ["u3", "丙民警", "经侦支队", 1],
    ["u4", "丁民警", "刑侦支队", 1],
    ["u5", "戊民警", "刑侦支队", 1],
    ["u6", "己民警", "刑侦支队", 1],
    ["u7", "庚民警", "刑侦支队", 1],
    ["u_off", "停用民警", "经侦支队", 0],
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id}`}, ${name}, 'x', 'x', '市局', ${dept}, 'x', ${status}, 'h', 0)
    `)
  }
  return database.db
}

function metadata(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_submit",
    name: "资金流水分析",
    type: "skill",
    description: "按账户汇总流水",
    icon: "skill",
    category: "intelligence",
    tags: ["资金"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: null,
    archivedAt: null,
    ...over,
  }
}

interface 身份 {
  readonly 名: string
  /** `undefined` = 请求里不注入身份（模拟「身份没透传过来」）。 */
  readonly id?: string
  /** 该身份在目标资产上的显式授权（授权组 id 由本文件按身份生成）。 */
  readonly perm?: "read" | "write" | "review" | "admin"
  readonly create: 结果码
  readonly submit: 结果码
  readonly publish: 结果码
}

type 结果码 =
  | "ok"
  | "identity_required"
  | "user_disabled"
  | "user_not_found"
  | "actor_not_allowed"

const 身份们: readonly 身份[] = [
  { 名: "作者本人", id: "u1", create: "ok", submit: "ok", publish: "actor_not_allowed" },
  { 名: "同部门他人", id: "u3", create: "ok", submit: "actor_not_allowed", publish: "actor_not_allowed" },
  { 名: "跨部门 + read", id: "u7", perm: "read", create: "ok", submit: "actor_not_allowed", publish: "actor_not_allowed" },
  { 名: "跨部门 + write", id: "u4", perm: "write", create: "ok", submit: "ok", publish: "actor_not_allowed" },
  { 名: "跨部门 + review", id: "u5", perm: "review", create: "ok", submit: "actor_not_allowed", publish: "actor_not_allowed" },
  { 名: "跨部门 + admin", id: "u6", perm: "admin", create: "ok", submit: "actor_not_allowed", publish: "ok" },
  { 名: "停用账号", id: "u_off", create: "user_disabled", submit: "user_disabled", publish: "user_disabled" },
  { 名: "不存在的用户", id: "u404", create: "user_not_found", submit: "user_not_found", publish: "user_not_found" },
  { 名: "未注入身份", create: "identity_required", submit: "identity_required", publish: "identity_required" },
]

/** 最近一次 harness 建的工作区根——`call()` 用它给 `_meta` 补默认目录。 */
let currentWorkspaceRoot = ""

interface Harness {
  readonly db: ProductionDb["db"]
  readonly root: string
  readonly workspaceRoot: string
  readonly client: Client
}

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

  await insertAsset(db, metadata({ id: "asset_submit", status: "draft" }))
  await insertAsset(db, metadata({ id: "asset_publish", status: "pending_tech" }))
  // `pending_tech` 的生产形态是「文件就躺在待发布目录里」；夹具要把这一半也造出来，
  // 否则「被拒后文件不搬」的断言会退化成一个恒假的空断言。
  await mkdir(join(root, "pending", "asset_publish"), { recursive: true })
  await writeFile(join(root, "pending", "asset_publish", "SKILL.md"), "# 资金流水分析\n")

  if (who.id !== undefined && who.perm !== undefined) {
    const roleId = `role_${who.id}_${who.perm}`
    await db.execute(sql`insert into auth.role (id, name, role_type) values (${roleId}, ${roleId}, 'group')`)
    await db.execute(sql`insert into auth.user_role (user_id, role_id) values (${who.id}, ${roleId})`)
    // 同一份授权同时覆盖两份资产：矩阵里每个工具只看自己那份资产。
    for (const assetId of ["asset_submit", "asset_publish"]) {
      await db.execute(sql`
        insert into auth.role_resource (role_id, resource_type, resource_id, perm)
        values (${roleId}, 'skill', ${assetId}, ${who.perm})
      `)
    }
  }

  const server = createGovernanceServer({ db, root, workspaceRoot })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "matrix-client", version: "0" }, { capabilities: {} })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  closers.push(async () => {
    await client.close()
    await server.close()
  })
  return { db, root, workspaceRoot, client }
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

/** 运行时收窄：出现没见过的错误码要当场炸，不让它冒充某个已知码。 */
function is结果码(value: string): value is 结果码 {
  return (
    value === "ok" ||
    value === "identity_required" ||
    value === "user_disabled" ||
    value === "user_not_found" ||
    value === "actor_not_allowed"
  )
}

/** 从出参里读结果码：成功 = `ok`，失败取 `错误码：xxx；` 里的 xxx。 */
function 结果码(text: string, isError: boolean): 结果码 {
  if (!isError) return "ok"
  const match = /错误码：([a-z_]+)；/.exec(text)
  if (match === null) throw new Error(`出参里没有错误码：${text}`)
  const code = match[1]!
  if (!is结果码(code)) throw new Error(`出参里出现了未知错误码：${code}`)
  return code
}

async function 状态(db: ProductionDb["db"], assetId: string): Promise<string> {
  const [row] = rowsOf(await db.execute(sql`select status from auth.asset where id = ${assetId}`))
  return String(row!.status)
}

async function 通知数(db: ProductionDb["db"]): Promise<number> {
  const [row] = rowsOf(await db.execute(sql`select count(*)::int as count from auth.asset_notification`))
  return Number(row!.count)
}

async function 存在(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const 提交参数 = { assetId: "asset_submit", sourceDirectory: "fund-analysis" }
const 发布参数 = { assetId: "asset_publish" }
const 草稿参数 = {
  name: "资金流水分析",
  description: "按账户汇总流水",
  category: "intelligence",
  sourceDirectory: "fund-analysis",
}

describe("SC-003 验收 · MCP 出口层双身份越权（T017 补测）", () => {
  for (const 身份 of 身份们) {
    test(`${身份.名}：三个工具逐格判权，拒绝时副作用一份不动`, async () => {
      const { db, root, client } = await harness({ id: 身份.id, perm: 身份.perm })
      const 通知前 = await 通知数(db)
      const 提交前 = await 状态(db, "asset_submit")
      const 发布前 = await 状态(db, "asset_publish")

      // ① create_skill_draft：任何在职用户都能在自己的沙箱里登记草稿，身份只决定作者是谁。
      const 建 = await call(client, "create_skill_draft", 草稿参数, 身份.id)
      expect(结果码(建.text, 建.isError), `create_skill_draft / ${身份.名}`).toBe(身份.create)
      if (身份.create === "ok") {
        const [row] = rowsOf(
          await db.execute(sql`select owner_id from auth.asset where id = ${String(JSON.parse(建.text).assetId)}`),
        )
        expect(String(row?.owner_id), "草稿作者取调用身份，不听参数").toBe(身份.id!)
      } else {
        expect(await 通知数(db), "被拒的 create 不该写通知").toBe(通知前)
      }

      // ② submit_skill_for_review：作者或显式 write；同部门可见 / review / admin 都不等于可写。
      const 提交 = await call(client, "submit_skill_for_review", 提交参数, 身份.id)
      expect(结果码(提交.text, 提交.isError), `submit / ${身份.名}`).toBe(身份.submit)
      if (身份.submit === "ok") {
        expect(await 状态(db, "asset_submit")).toBe("in_review")
        expect(await 存在(join(root, "pending", "asset_submit"))).toBe(true)
      } else {
        expect(await 状态(db, "asset_submit"), "被拒后状态不动").toBe(提交前)
        expect(await 存在(join(root, "pending", "asset_submit")), "被拒后文件不复制").toBe(false)
        expect(await 通知数(db), "被拒后不写通知").toBe(通知前)
      }

      // ③ publish_skill：只有显式 admin；作者身份不派生管理权，review 不等于管。
      const 发布 = await call(client, "publish_skill", 发布参数, 身份.id)
      expect(结果码(发布.text, 发布.isError), `publish / ${身份.名}`).toBe(身份.publish)
      if (身份.publish === "ok") {
        expect(await 状态(db, "asset_publish")).toBe("published")
        expect(await 存在(join(root, "pending", "asset_publish")), "发布后离开待发布目录").toBe(false)
      } else {
        expect(await 状态(db, "asset_publish"), "被拒后状态不动").toBe(发布前)
        expect(await 存在(join(root, "pending", "asset_publish")), "被拒后文件不搬").toBe(true)
      }
    })
  }

  test("身份与权限不可互换：把别人的 id 写进参数不能提权", async () => {
    const { db, client } = await harness({ id: "u3" })

    // 参数里塞 ownerId / department 一律不认（create 的作者取自库，取自调用身份）。
    const 建 = await call(
      client,
      "create_skill_draft",
      { ...草稿参数, ownerId: "u1", department: "经侦支队", userId: "u1" },
      "u3",
    )
    expect(结果码(建.text, 建.isError)).toBe("ok")
    const [row] = rowsOf(
      await db.execute(sql`select owner_id, department from auth.asset where id = ${String(JSON.parse(建.text).assetId)}`),
    )
    expect(String(row?.owner_id)).toBe("u3")
    expect(String(row?.department)).toBe("经侦支队") // 部门取自 u3 档案，不是参数
  })
})
