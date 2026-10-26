import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import { createGovernanceServer, GOVERNANCE_TOOL_NAMES } from "./governance"
import type { AssetMetadata } from "./metadata"

/**
 * 009 T012 / T013 · 资产治理 MCP server（提交 / 发布 / 制作入口）。
 *
 * 判据分五块：
 * ① 协议面：`tools/list` 暴露三个治理工具，必填字段各自钉住；
 * ② 身份：`_meta["openhive/user"]` 缺失 / 用户不存在 / 已停用 ⇒ 一律拒，且资产状态不动；
 * ③ capability：没有对应权限就调不动（提交需写、发布需管），且失败发生在文件操作之前；
 * ④ 路径：调用目录必须落在作者沙箱内；源目录必须相对、且仍在调用目录内，越界不复制；
 * ⑤ 制作入口：只有沙箱里真有带 frontmatter 的 SKILL.md 才登记草稿，作者 / 部门取自身份。
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
    ["u2", "乙民警", "法制支队", 1],
    ["u3", "丙民警", "科信支队", 0], // 停用账号：不能借 MCP 继续干活
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', ${status}, 'h', 0)
    `)
  }
  return database.db
}

function metadata(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_1",
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
    ...overrides,
  }
}

async function grant(
  db: ProductionDb["db"],
  userId: string,
  perm: string,
  assetId = "asset_1",
): Promise<void> {
  const roleId = `role_${userId}_${perm}_${assetId}`
  await db.execute(sql`insert into auth.role (id, name, role_type) values (${roleId}, ${roleId}, 'group')`)
  await db.execute(sql`insert into auth.user_role (user_id, role_id) values (${userId}, ${roleId})`)
  await db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values (${roleId}, 'skill', ${assetId}, ${perm})
  `)
}

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

async function statusOf(db: ProductionDb["db"], assetId = "asset_1"): Promise<string> {
  const [row] = rowsOf(await db.execute(sql`select status from auth.asset where id = ${assetId}`))
  return String(row!.status)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function prepareSource(sourceRoot: string, name = "skill-src"): Promise<string> {
  const directory = join(sourceRoot, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "SKILL.md"), "# 资金流水分析\n")
  return name
}

/** 制作入口生成的 skill：带 frontmatter 的 SKILL.md（opencode 只认这种）。 */
async function prepareSkillSource(
  sourceRoot: string,
  name = "fund-analysis",
  frontmatter = `---
name: ${name}
description: 按账户汇总资金流水
---

# 资金流水分析
`,
): Promise<string> {
  const directory = join(sourceRoot, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "SKILL.md"), frontmatter)
  return name
}

async function assetCount(db: ProductionDb["db"]): Promise<number> {
  const [row] = rowsOf(await db.execute(sql`select count(*)::int as count from auth.asset`))
  return Number(row!.count)
}

async function rowOf(db: ProductionDb["db"], assetId: string): Promise<Record<string, unknown>> {
  const [row] = rowsOf(await db.execute(sql`select * from auth.asset where id = ${assetId}`))
  return row!
}

/** 读制作入口的返回；字段缺失就当场抛（不让 `as` 把测试的断言力悄悄拿走）。 */
function createdAsset(text: string): { assetId: string; skillName: string } {
  const value: unknown = JSON.parse(text)
  if (
    typeof value !== "object" ||
    value === null ||
    !("assetId" in value) ||
    typeof value.assetId !== "string" ||
    !("skillName" in value) ||
    typeof value.skillName !== "string"
  ) {
    throw new Error(`create_skill_draft 返回形状不对：${text}`)
  }
  return { assetId: value.assetId, skillName: value.skillName }
}

describe("tools/list", () => {
  test("暴露三个治理工具，名称与出参约定的常量一致", async () => {
    const { client } = await harness()
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual([...GOVERNANCE_TOOL_NAMES])
    expect(GOVERNANCE_TOOL_NAMES).toEqual([
      "submit_skill_for_review",
      "publish_skill",
      "create_skill_draft",
    ])
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(10)
  })

  test("提交 / 发布把 assetId 标成必填；制作入口不收 assetId，收名称与源目录", async () => {
    const { client } = await harness()
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

    for (const name of ["submit_skill_for_review", "publish_skill"]) {
      const schema = byName.get(name)!.inputSchema as { required?: string[] }
      expect(schema.required).toContain("assetId")
    }

    const create = byName.get("create_skill_draft")!.inputSchema as { required?: string[] }
    expect(create.required).toEqual(
      expect.arrayContaining(["name", "description", "category", "sourceDirectory"]),
    )
    expect(create.required).not.toContain("assetId")
  })
})

describe("create_skill_draft", () => {
  test("把 AI 落盘的 skill 登记成草稿：作者 / 部门取自库，文件不复制进共享根", async () => {
    const { db, root, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const result = await call(
      client,
      "create_skill_draft",
      {
        name: "资金流水分析",
        description: "按账户汇总流水，标出异常进出",
        category: "intelligence",
        tags: ["资金", "流水"],
        sourceDirectory: source,
      },
      "u1",
    )

    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, status: "draft" })
    const payload = createdAsset(result.text)
    expect(payload.skillName).toBe("fund-analysis")
    expect(payload.assetId).toMatch(/^asset_/)

    const row = await rowOf(db, payload.assetId)
    expect(row).toMatchObject({
      name: "资金流水分析",
      type: "skill",
      description: "按账户汇总流水，标出异常进出",
      category: "intelligence",
      owner_id: "u1",
      owner_name: "甲民警",
      department: "经侦支队",
      visibility: "personal",
      status: "draft",
      version: 1,
      favorite_count: 0,
      usage_count: 0,
      published_at: null,
      archived_at: null,
    })
    expect(row.tags).toEqual(["资金", "流水"])

    // 草稿停在作者沙箱：共享根里没有它的目录，源文件也没被动过。
    expect(await exists(join(root, source))).toBe(false)
    expect(await exists(join(sourceRoot, source, "SKILL.md"))).toBe(true)
  })

  test("登记完就能用同一个 assetId 提交审核（制作 → 提交是一条链）", async () => {
    const { db, root, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const created = await call(
      client,
      "create_skill_draft",
      { name: "资金流水分析", description: "按账户汇总流水", category: "intelligence", sourceDirectory: source },
      "u1",
    )
    const { assetId } = createdAsset(created.text)

    const submitted = await call(
      client,
      "submit_skill_for_review",
      { assetId, sourceDirectory: source },
      "u1",
    )

    expect(submitted.isError).toBe(false)
    expect(await statusOf(db, assetId)).toBe("in_review")
    expect(await readFile(join(root, "pending", assetId, "SKILL.md"), "utf8")).toContain("fund-analysis")
  })

  test("department 可见范围：部门取调用者档案，不听参数", async () => {
    const { db, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const result = await call(
      client,
      "create_skill_draft",
      {
        name: "资金流水分析",
        description: "按账户汇总流水",
        category: "intelligence",
        sourceDirectory: source,
        visibility: "department",
        department: "法制支队", // 模型自报的部门必须被忽略
      },
      "u1",
    )

    expect(result.isError).toBe(false)
    const { assetId } = createdAsset(result.text)
    const row = await rowOf(db, assetId)
    expect(row.visibility).toBe("department")
    expect(row.department).toBe("经侦支队")
  })

  test("元数据不合法：拒绝且一行都不写", async () => {
    const { db, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)

    const cases: Array<Record<string, unknown>> = [
      { name: "", description: "x", category: "intelligence", sourceDirectory: source },
      { name: "资金流水分析", description: "", category: "intelligence", sourceDirectory: source },
      { name: "资金流水分析", description: "x", category: "no-such-category", sourceDirectory: source },
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source, visibility: "public" },
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source, tags: ["资金", "资金"] },
      { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source, tags: [""] },
    ]

    for (const args of cases) {
      const result = await call(client, "create_skill_draft", args, "u1")
      expect(result.isError).toBe(true)
      expect(result.text).toContain("invalid_arguments")
    }
    expect(await assetCount(db)).toBe(0)
  })

  test("身份缺失 / 用户不存在 / 已停用：拒绝且一行都不写", async () => {
    const { db, sourceRoot, client } = await harness()
    const source = await prepareSkillSource(sourceRoot)
    const args = { name: "资金流水分析", description: "x", category: "intelligence", sourceDirectory: source }

    const missing = await call(client, "create_skill_draft", args)
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("identity_required")

    const unknown = await call(client, "create_skill_draft", args, "nobody")
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain("user_not_found")

    const disabled = await call(client, "create_skill_draft", args, "u3")
    expect(disabled.isError).toBe(true)
    expect(disabled.text).toContain("user_disabled")

    expect(await assetCount(db)).toBe(0)
  })

  test("源目录越界（绝对路径 / ../）：拒绝且一行都不写", async () => {
    const { db, client } = await harness()
    const base = { name: "资金流水分析", description: "x", category: "intelligence" }

    const absolute = await call(
      client,
      "create_skill_draft",
      { ...base, sourceDirectory: "D:/somewhere/else" },
      "u1",
    )
    expect(absolute.isError).toBe(true)
    expect(absolute.text).toContain("source_outside_workspace")

    const parent = await call(client, "create_skill_draft", { ...base, sourceDirectory: "../outside" }, "u1")
    expect(parent.isError).toBe(true)
    expect(parent.text).toContain("source_outside_workspace")

    expect(await assetCount(db)).toBe(0)
  })

  test("源目录里没有 SKILL.md / frontmatter 没有 name：拒绝且一行都不写", async () => {
    const { db, sourceRoot, client } = await harness()
    const base = { name: "资金流水分析", description: "x", category: "intelligence" }

    const empty = join(sourceRoot, "empty")
    await mkdir(empty, { recursive: true })
    await writeFile(join(empty, "notes.md"), "只有笔记\n")

    const missing = await call(client, "create_skill_draft", { ...base, sourceDirectory: "empty" }, "u1")
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("skill_file_not_found")

    const invalid = await prepareSkillSource(sourceRoot, "no-frontmatter", "# 没有 frontmatter\n")
    const noFrontmatter = await call(
      client,
      "create_skill_draft",
      { ...base, sourceDirectory: invalid },
      "u1",
    )
    expect(noFrontmatter.isError).toBe(true)
    expect(noFrontmatter.text).toContain("skill_frontmatter_invalid")

    expect(await assetCount(db)).toBe(0)
  })
})

describe("submit_skill_for_review", () => {
  test("作者提交自己的草稿：复制到 pending、状态进 in_review、源目录保留", async () => {
    const { db, root, sourceRoot, client } = await harness()
    await insertAsset(db, metadata())
    const source = await prepareSource(sourceRoot)

    const result = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: source }, "u1")

    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toMatchObject({
      ok: true,
      assetId: "asset_1",
      action: "submit_review",
      status: "in_review",
    })
    expect(await statusOf(db)).toBe("in_review")
    expect(await readFile(join(root, "pending", "asset_1", "SKILL.md"), "utf8")).toContain("资金流水分析")
    expect(await exists(join(sourceRoot, source, "SKILL.md"))).toBe(true)
  })

  test("没有身份（_meta 缺失）：拒绝，资产状态不动", async () => {
    const { db, client } = await harness()
    await insertAsset(db, metadata())

    const result = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: "." })

    expect(result.isError).toBe(true)
    expect(result.text).toContain("identity_required")
    expect(await statusOf(db)).toBe("draft")
  })

  test("用户不存在：拒绝；已停用账号同样拒绝", async () => {
    const { db, client } = await harness()
    await insertAsset(db, metadata())

    const unknown = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: "." }, "nobody")
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain("user_not_found")

    const disabled = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: "." }, "u3")
    expect(disabled.isError).toBe(true)
    expect(disabled.text).toContain("user_disabled")
    expect(await statusOf(db)).toBe("draft")
  })

  test("不是作者也没有写授权：actor_not_allowed，且文件一个都没复制（门在副作用之前）", async () => {
    const { db, root, sourceRoot, client } = await harness()
    await insertAsset(db, metadata())
    const source = await prepareSource(sourceRoot)

    const result = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: source }, "u2")

    expect(result.isError).toBe(true)
    expect(result.text).toContain("actor_not_allowed")
    expect(result.text).toContain("write")
    expect(await statusOf(db)).toBe("draft")
    expect(await exists(join(root, "pending", "asset_1"))).toBe(false)
  })

  test("源目录越界（绝对路径 / ../）：拒绝，状态不动", async () => {
    const { db, client } = await harness()
    await insertAsset(db, metadata())

    const absolute = await call(
      client,
      "submit_skill_for_review",
      { assetId: "asset_1", sourceDirectory: "D:/somewhere/else" },
      "u1",
    )
    expect(absolute.isError).toBe(true)
    expect(absolute.text).toContain("source_outside_workspace")

    const parent = await call(client, "submit_skill_for_review", { assetId: "asset_1", sourceDirectory: "../outside" }, "u1")
    expect(parent.isError).toBe(true)
    expect(parent.text).toContain("source_outside_workspace")
    expect(await statusOf(db)).toBe("draft")
  })

  test("缺少源目录 / 资产不存在 / 非 skill：各给明确错误码", async () => {
    const { db, client } = await harness()
    await insertAsset(db, metadata())
    await insertAsset(db, metadata({ id: "asset_mcp", type: "mcp", name: "资金 MCP" }))

    const missing = await call(client, "submit_skill_for_review", { assetId: "asset_1" }, "u1")
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("invalid_arguments")

    const unknown = await call(client, "submit_skill_for_review", { assetId: "nope", sourceDirectory: "." }, "u1")
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain("asset_not_found")

    const wrongType = await call(client, "submit_skill_for_review", { assetId: "asset_mcp", sourceDirectory: "." }, "u1")
    expect(wrongType.isError).toBe(true)
    expect(wrongType.text).toContain("unsupported_asset_type")
  })
})

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

describe("publish_skill", () => {
  test("系统管理员发布待发布资产：pending 移到发布目录、状态进 published", async () => {
    const { db, root, client } = await harness()
    await insertAsset(db, metadata({ status: "pending_tech" }))
    await mkdir(join(root, "pending", "asset_1"), { recursive: true })
    await writeFile(join(root, "pending", "asset_1", "SKILL.md"), "# 资金流水分析\n")
    await grant(db, "u2", "admin")

    const result = await call(client, "publish_skill", { assetId: "asset_1" }, "u2")

    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, action: "publish_tech", status: "published" })
    expect(await statusOf(db)).toBe("published")
    expect(await readFile(join(root, "dept", "经侦支队", "skills", "asset_1", "SKILL.md"), "utf8")).toContain(
      "资金流水分析",
    )
    expect(await exists(join(root, "pending", "asset_1"))).toBe(false)
  })

  test("只有 review 权限：发布被拒（审 ≠ 管），状态与文件都不动", async () => {
    const { db, root, client } = await harness()
    await insertAsset(db, metadata({ status: "pending_tech" }))
    await mkdir(join(root, "pending", "asset_1"), { recursive: true })
    await grant(db, "u2", "review")

    const result = await call(client, "publish_skill", { assetId: "asset_1" }, "u2")

    expect(result.isError).toBe(true)
    expect(result.text).toContain("actor_not_allowed")
    expect(result.text).toContain("admin")
    expect(await statusOf(db)).toBe("pending_tech")
    expect(await exists(join(root, "pending", "asset_1"))).toBe(true)
  })

  test("个人可见范围：发布被拒且给出可操作错误码（不是 tool_failed），文件与状态都不动", async () => {
    const { db, root, client } = await harness()
    await insertAsset(db, metadata({ status: "pending_tech", visibility: "personal" }))
    await mkdir(join(root, "pending", "asset_1"), { recursive: true })
    await grant(db, "u2", "admin")

    const result = await call(client, "publish_skill", { assetId: "asset_1" }, "u2")

    expect(result.isError).toBe(true)
    expect(result.text).toContain("personal_asset_not_shared")
    expect(await statusOf(db)).toBe("pending_tech")
    expect(await exists(join(root, "pending", "asset_1"))).toBe(true)
  })

  test("作者本人没有 admin：同样不能发布（作者身份不派生管理权）", async () => {
    const { db, client } = await harness()
    await insertAsset(db, metadata({ status: "pending_tech" }))

    const result = await call(client, "publish_skill", { assetId: "asset_1" }, "u1")

    expect(result.isError).toBe(true)
    expect(result.text).toContain("actor_not_allowed")
    expect(await statusOf(db)).toBe("pending_tech")
  })
})
