import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sql, type SQL } from "drizzle-orm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { createCaseMcpServer, 新预算计数, type 调用留痕 } from "../../src/server/openhive/case-mcp-server"
import { createMaterial, getMaterial } from "../../src/server/openhive/case-store"
import {
  move_material,
  工具错误,
  移动文件不覆盖,
  type 工具上下文,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"

/**
 * 017 · Task 12：MCP 工具 `move_material` 的红用例（测试先行）。
 *
 * 契约：`docs/superpowers/specs/017-case-staff/contracts/move-material-tool.md`（§2 门与判定顺序、
 * §3 执行语义、§4 七字段信封、§6 用例 1–14 ＋「按属主拼」探针）。
 *
 * ## 层次划分
 *
 * - **工具层**（用例 1–6、9、10、13、14、探针）：直接 `move_material(ctx, args)` 调实现，
 *   绕开服务入口。`workspaceRoot` 由夹具给——工具实现按**属主**拼项目根（契约 §3.1），
 *   探针因此能钉住「误用调用者拼根」这条错。
 * - **服务级**（用例 7、8、11、12）：照 `openhive-case-mcp-server.test.ts` 用 in-memory transport
 *   走真实握手，钉四道服务门（身份 / 成员 / 必填 / 收参数）与留痕。归档（用例 8）的冻结判据
 *   在工具实现内（契约 §2 ⑥），服务级能注入 `project_archive` 行，故就在服务级覆盖。
 *
 * ## 为什么不写网关成员用例
 *
 * 非属主成员经 MCP 网关今天恒 `identity_required`（`_meta.directory` 被改写成属主目录，
 * 与身份门要求冲突；契约 §1「谁可用」的既有缺口）。「按属主拼项目根」那层由工具层探针覆盖，
 * 写一条网关用例只会红在身份门，属于「把测不了的写成已覆盖」（TR-013）。
 *
 * ## 夹具为什么自己 `connect()`
 *
 * 同 `openhive-case-mcp-tools.test.ts`：`startProductionDb()` 只负责起库；工具与 `校验成员` 都发
 * **带参**查询，PGlite 的多连接共用 PG 会话、`bun-sql` 的语句缓存却是连接级 ⇒ 必须用生产入口
 * `connect({ ...process.env, PG_POOL_MAX: "1" })` 建**一个**客户端跑完全部用例（否则 `42P05`）。
 *
 * ⚠️ 本文件在 T012 提交时**应当整文件红**：`move_material` 尚未实现（T013/T014）。红态类别
 * 见 `task-12-report.md`（`#003-03`：如实记，不改断言、不加本地桩）。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

/** 沙箱根：真实临时目录——本工具要真搬盘上的文件（与只比路径的取数工具不同）。 */
const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-move-"))

const 属主 = "u-移动-属主"
const 成员 = "u-移动-成员"
const 外人 = "u-移动-外人"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目根 = (projectId: string, 归谁 = 属主) => projectDirectory(沙箱根, 归谁, projectId)

/** 建项目目录（材料/00-待归档、材料/01-接报案 恒建；其余按用例补）。 */
function 建项目(projectId: string, 额外目录: string[] = []): string {
  const 根 = 项目根(projectId)
  for (const 相对 of ["材料/00-待归档", "材料/01-接报案", ...额外目录]) mkdirSync(join(根, ...相对.split("/")), { recursive: true })
  return 根
}

function 写文件(根: string, 相对: string, 内容: string): string {
  const 绝对 = join(根, ...相对.split("/"))
  mkdirSync(dirname(绝对), { recursive: true })
  writeFileSync(绝对, 内容)
  return 绝对
}

/** 工具层调用的上下文：库 + 身份 + 沙箱根（真入口必给 workspaceRoot，契约 §3.1）。 */
const 工具ctx = (身份: { userId: string; projectId: string }, db: 工具上下文["db"] = 库()): 工具上下文 => ({
  db,
  身份,
  workspaceRoot: 沙箱根,
})

interface 移动行 {
  旧路径: string
  新路径: string
  材料路径已同步: boolean
}
const 移动行们 = (结果: 工具结果) => 结果.数据 as 移动行[]

/**
 * 取抛出的错误；成功则回 `undefined`。用「先取再用 `toMatchObject` 判」而不是
 * `rejects.toMatchObject`：后者在实现**成功**时只会报「没有 reject」，看不出实际结果。
 */
async function 取错误(动作: () => Promise<unknown>): Promise<unknown> {
  try {
    await 动作()
  } catch (错误) {
    return 错误
  }
  return undefined
}

/** 取错误文案；不是 `Error` 回空串（断言随后会红，且不靠 `as` 断言掩盖形状）。 */
const 错误文案 = (错误: unknown): string => (错误 instanceof Error ? 错误.message : "")

/** 服务级错误体：`失败结果` 是 `{ error, message }` 的 JSON 文本。 */
function 错误体(结果: { content?: unknown }): { error: string; message: string } {
  const 内容 = (结果 as { content: { type: string; text: string }[] }).content
  return JSON.parse(内容[0].text) as { error: string; message: string }
}

const 服务meta = (userId: string, projectId: string) => ({
  "openhive/user": userId,
  "openhive/directory": join(沙箱根, userId, projectId),
})

const 收集: 调用留痕[] = []
let 服务: ReturnType<typeof createCaseMcpServer>
let client: Client

/** 现有服务的身份门 / 成员门夹具（同一套 deps 换身份即可）。 */
beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)

  // `project_member.user_id` 有指向 `auth.user(id)` 的外键，先有用户行才加得进成员表。
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${属主}, '970061', '移动民警属主', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${成员}, '970062', '移动民警成员', 'y', 'y', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)

  // 服务级 case 1–14 各自独立项目（`#005-34`：文件移动会改盘，共享夹具会让通过与否取决于顺序）。
  const 项目们 = [
    "p-移动-成功",
    "p-移动-材料行",
    "p-移动-同名",
    "p-移动-越界",
    "p-移动-无目标",
    "p-移动-登记表",
    "p-移动-非成员",
    "p-移动-归档",
    "p-移动-链接",
    "p-移动-库故障",
    "p-移动-未知键",
    "p-移动-留痕",
    "p-移动-目录源",
    "p-移动-符号源",
    "p-移动-探针",
  ]
  for (const projectId of 项目们) {
    await 客户端.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${属主}, 'owner', 0)
    `)
  }
  // 探针：成员行存在（是真正的成员），但项目目录与文件都在**属主**沙箱里。
  await 客户端.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${"p-移动-探针"}, ${成员}, 'member', 0)
  `)
  // 用例 8：归档项目。`archived = (archived_at IS NOT NULL)` 是迁移里的 CHECK。
  await 客户端.execute(sql`
    insert into auth.project_archive (project_id, archived, archived_at)
    values (${"p-移动-归档"}, true, 0)
  `)

  服务 = createCaseMcpServer({
    db: 库(),
    workspaceRoot: 沙箱根,
    留痕: (行) => 收集.push(行),
    预算: 新预算计数(),
  })
  const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
  await 服务.connect(服务端侧)
  client = new Client({ name: "移动工具客户端", version: "0.0.0" })
  await client.connect(客户端侧)
})

afterAll(async () => {
  await client?.close()
  await 客户端?.$client.close()
  await pg?.stop()
  restorePoolMax()
  rmSync(沙箱根, { recursive: true, force: true })
})

// ───────────────────────────── 工具层（1–6、9、10、13、14） ─────────────────────────────

test("用例 1 · 属主移动 材料/00-待归档/a.txt → 材料/01-接报案：文件落到新位置、旧位置空、材料路径已同步", async () => {
  const projectId = "p-移动-成功"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/a.txt", "内容甲")

  const 结果 = await move_material(工具ctx({ userId: 属主, projectId }), {
    路径: "材料/00-待归档/a.txt",
    目标目录: "材料/01-接报案",
  })

  expect(existsSync(join(根, "材料", "01-接报案", "a.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "00-待归档", "a.txt"))).toBe(false)

  // 七字段信封（契约 §4）：成功也要逐项在场。
  for (const 键 of ["摘要", "数据", "口径", "缺口", "空原因", "出处", "下一步"] as const) {
    expect({ 键, 在场: 键 in 结果 }).toEqual({ 键, 在场: true })
  }
  expect(结果.摘要).toContain("已移动 1 份")
  expect(结果.摘要).toContain("材料/00-待归档/a.txt")
  expect(结果.摘要).toContain("材料/01-接报案")

  const 行 = 移动行们(结果)[0]
  expect(行.旧路径).toBe("材料/00-待归档/a.txt")
  expect(行.新路径).toBe("材料/01-接报案/a.txt")
  expect(行.材料路径已同步).toBe(true)
  expect(结果.缺口).toEqual([])
  expect(结果.空原因).toBeNull()
  expect(结果.出处.length).toBeGreaterThan(0)
})

test("用例 2 · 移动后 auth.case_material.path 同步成新相对路径（材料行跟着文件走）", async () => {
  const projectId = "p-移动-材料行"
  const 根 = 建项目(projectId, ["材料/06-话单与资金"])
  写文件(根, "材料/00-待归档/流水.xlsx", "字节")
  await createMaterial(库(), {
    id: "m-移动-流水",
    projectId,
    fileName: "流水.xlsx",
    kind: "资金",
    fingerprint: "fp-移动-流水",
    path: "材料/00-待归档/流水.xlsx",
  })

  const 结果 = await move_material(工具ctx({ userId: 属主, projectId }), {
    路径: "材料/00-待归档/流水.xlsx",
    目标目录: "材料/06-话单与资金",
  })

  expect(existsSync(join(根, "材料", "06-话单与资金", "流水.xlsx"))).toBe(true)
  const 材料 = await getMaterial(库(), projectId, "m-移动-流水")
  expect(材料?.path).toBe("材料/06-话单与资金/流水.xlsx")
  expect(移动行们(结果)[0].材料路径已同步).toBe(true)
})

test("用例 3 · 目标已有同名文件 ⇒ bad_input，两处文件都在、登记表不动", async () => {
  const projectId = "p-移动-同名"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/重名.txt", "源文件")
  写文件(根, "材料/01-接报案/重名.txt", "已有文件")
  const 台账 = 写文件(根, "材料/00-材料登记表.md", "# 台账\n")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-待归档/重名.txt",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  expect(错误文案(错误)).toContain("同名")

  // 不改名、不覆盖（FR-029）：两边正文都原样，台账也不动。
  expect(readFileSync(join(根, "材料", "00-待归档", "重名.txt"), "utf8")).toBe("源文件")
  expect(readFileSync(join(根, "材料", "01-接报案", "重名.txt"), "utf8")).toBe("已有文件")
  expect(readFileSync(台账, "utf8")).toBe("# 台账\n")
})

test("用例 4 · 源不在 材料/ 下 ⇒ bad_input，零副作用", async () => {
  const projectId = "p-移动-越界"
  const 根 = 建项目(projectId, ["资料"])
  写文件(根, "资料/证据.txt", "项目内但不在材料目录")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "资料/证据.txt",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  // 契约 §3.3 未规定文案，只要求「顶层目录必须是 材料」；「材料」二字是**代理断言**
  // （正确的实现不会用一句不提材料的话拒绝），别把它当成契约文案钉死。
  expect(错误文案(错误)).toContain("材料")

  expect(existsSync(join(根, "资料", "证据.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "01-接报案", "证据.txt"))).toBe(false)
})

test("用例 5 · 目标目录不存在 ⇒ bad_input，零副作用", async () => {
  const projectId = "p-移动-无目标"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/x.txt", "内容")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-待归档/x.txt",
      目标目录: "材料/99-不存在",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  expect(错误文案(错误)).toContain("目标目录不存在")

  expect(existsSync(join(根, "材料", "00-待归档", "x.txt"))).toBe(true)
})

test("补 · 台账大小写变体（win32 同一文件）也必须拒，台账留原处", async () => {
  const projectId = "p-移动-台账变体"
  const 根 = 建项目(projectId)
  const 台账 = 写文件(根, "材料/00-材料登记表.md", "# 台账\n")

  // win32/NTFS 大小写不敏感：`00-材料登记表.MD` 与规范名 `00-材料登记表.md` 是**同一个文件**
  // （`#006-23`）。判据必须比文件同一性（dev/ino），不能按字面比路径——`realpath` 在 win32
  // 保留调用方大小写，同样不能当判据。POSIX 上它是不存在的另一个名字，这里会因「源文件不存在」
  // 同样得到 bad_input（不红，但也不会假绿成「搬走了」）。
  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-材料登记表.MD",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  // 原件还在原处；目标目录里两个写法都没有（`#013-12`：布尔比较，不靠假绿的元素断言）。
  expect(readFileSync(台账, "utf8")).toBe("# 台账\n")
  expect(existsSync(join(根, "材料", "01-接报案", "00-材料登记表.MD"))).toBe(false)
  expect(existsSync(join(根, "材料", "01-接报案", "00-材料登记表.md"))).toBe(false)
})

test("补 · 目标目录是 材料/ 根 ⇒ bad_input（schema 要求「材料/」下子目录），零副作用", async () => {
  const projectId = "p-移动-目标根"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/根目标.txt", "内容")

  // schema（契约 §1.1）写的是「已存在的『材料/』下**子目录**」；§3 第 7 步只说「存在且是目录」，
  // 不足以表达「子」。按 schema 口径拒绝，别把文件搬到台账所在的那一层。
  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-待归档/根目标.txt",
      目标目录: "材料",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })

  expect(existsSync(join(根, "材料", "00-待归档", "根目标.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "根目标.txt"))).toBe(false)
})

test("用例 6 · 源是 材料/00-材料登记表.md ⇒ bad_input，台账留在原处", async () => {
  const projectId = "p-移动-登记表"
  const 根 = 建项目(projectId)
  const 台账 = 写文件(根, "材料/00-材料登记表.md", "# 台账\n")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-材料登记表.md",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })

  expect(readFileSync(台账, "utf8")).toBe("# 台账\n")
  expect(existsSync(join(根, "材料", "01-接报案", "00-材料登记表.md"))).toBe(false)
})

test("用例 9 · 目标目录经链接指向项目外 ⇒ bad_input(LINK_ESCAPE)，零副作用", async () => {
  const projectId = "p-移动-链接"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/密件.txt", "不许出去")
  // 项目外的落点：同一属主沙箱下的**兄弟目录**（junction 只需目录已存在）。
  // ⚠️ 目录名按用例区分：用例 14 也用「项目外」夹具，共用会让 `--randomize` 下
  // 先跑 14 时本条 `外部无密件.txt` 假红（`#005-34`）。
  const 项目外 = join(沙箱根, 属主, "移动项目外-链接")
  mkdirSync(项目外, { recursive: true })
  symlinkSync(项目外, join(根, "材料", "逃逸"), "junction")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/00-待归档/密件.txt",
      目标目录: "材料/逃逸",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  // 文案要点：链接逃逸（契约 §3.8 复用 HTTP 的 LINK_ESCAPE）。
  expect(错误文案(错误)).toContain("链接")

  expect(existsSync(join(根, "材料", "00-待归档", "密件.txt"))).toBe(true)
  expect(existsSync(join(项目外, "密件.txt"))).toBe(false)
  expect(lstatSync(join(根, "材料", "逃逸")).isSymbolicLink()).toBe(true)
})

test("用例 10 · 库迁移抛错 ⇒ 移动成功、材料路径已同步=false、缺口非空、仍返回 ok 信封", async () => {
  const projectId = "p-移动-库故障"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/滑.xlsx", "字节")
  await createMaterial(库(), {
    id: "m-移动-库故障",
    projectId,
    fileName: "滑.xlsx",
    kind: "资金",
    fingerprint: "fp-移动-库故障",
    path: "材料/00-待归档/滑.xlsx",
  })

  const 结果 = await move_material(工具ctx({ userId: 属主, projectId }, 迁移故障库()), {
    路径: "材料/00-待归档/滑.xlsx",
    目标目录: "材料/01-接报案",
  })

  // 文件已移动（失败不回滚，契约 §3.11）。
  expect(existsSync(join(根, "材料", "01-接报案", "滑.xlsx"))).toBe(true)
  expect(existsSync(join(根, "材料", "00-待归档", "滑.xlsx"))).toBe(false)
  const 行 = 移动行们(结果)[0]
  expect(行.新路径).toBe("材料/01-接报案/滑.xlsx")
  expect(行.材料路径已同步).toBe(false)
  expect(结果.缺口.length).toBeGreaterThan(0)
  expect(结果.缺口.join("")).toContain("材料路径未同步")
  // 返回的仍是成功信封，不是错误结果。
  expect(结果.摘要).toContain("已移动 1 份")
  // 库确实没迁：path 停在旧值。
  const 材料 = await getMaterial(库(), projectId, "m-移动-库故障")
  expect(材料?.path).toBe("材料/00-待归档/滑.xlsx")
})

test("用例 13 · 源是一个目录 ⇒ bad_input(\"移动只能对普通文件做\")，零副作用", async () => {
  const projectId = "p-移动-目录源"
  const 根 = 建项目(projectId, ["材料/99-其他/包"])
  写文件(根, "材料/99-其他/包/内页.txt", "目录里的文件")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/99-其他/包",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })
  expect(错误文案(错误)).toBe("移动只能对普通文件做")

  expect(existsSync(join(根, "材料", "99-其他", "包", "内页.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "01-接报案", "包"))).toBe(false)
})

test("用例 14 · 源是符号链接（指向材料外）⇒ bad_input，链接与目标都不动", async () => {
  const projectId = "p-移动-符号源"
  const 根 = 建项目(projectId)
  // 外部目录按用例区分（与用例 9 的 `移动项目外-链接` 不共享，`#005-34`）。
  const 项目外 = join(沙箱根, 属主, "移动项目外-符号源")
  mkdirSync(项目外, { recursive: true })
  const 外部文件 = join(项目外, "密件.txt")
  writeFileSync(外部文件, "外部正文")
  symlinkSync(外部文件, join(根, "材料", "外链.txt"), "file")

  const 错误 = await 取错误(() =>
    move_material(工具ctx({ userId: 属主, projectId }), {
      路径: "材料/外链.txt",
      目标目录: "材料/01-接报案",
    }),
  )
  expect(错误).toBeInstanceOf(Error)
  expect(错误).toMatchObject({ code: "bad_input" })

  expect(lstatSync(join(根, "材料", "外链.txt")).isSymbolicLink()).toBe(true)
  expect(readFileSync(外部文件, "utf8")).toBe("外部正文")
  expect(existsSync(join(根, "材料", "01-接报案", "外链.txt"))).toBe(false)
})

test("补 · 缺 workspaceRoot ⇒ 抛普通 Error（折 tool_failed），不拿空根拼路径", async () => {
  const 错误 = await 取错误(() =>
    move_material(
      // 真实入口必给 root；这里刻意不给，钉住 fail-closed（契约 §3.1，同 `case-hgraph-tools.ts`）。
      { db: 库(), 身份: { userId: 属主, projectId: "p-移动-成功" } },
      { 路径: "材料/00-待归档/a.txt", 目标目录: "材料/01-接报案" },
    ),
  )
  expect(错误).toBeInstanceOf(Error)
  // 不是 `工具错误`：分发处据此折成 `tool_failed`，而不是被演成一条 `bad_input`。
  expect(错误 instanceof 工具错误).toBe(false)
  expect(错误文案(错误)).toContain("workspaceRoot")
})

// ─────────────────────── 工具层探针：项目根恒按**属主**拼，不是按调用者 ───────────────────────

test("探针 · 非属主成员经工具层移动：文件与材料行都在属主沙箱/同 project，也必须找得到", async () => {
  const projectId = "p-移动-探针"
  // 目录与文件都建在**属主**沙箱：共享项目的材料就在那里。
  const 属主根 = 建项目(projectId)
  写文件(属主根, "材料/00-待归档/探针.xlsx", "共享项目里的文件")
  // 材料行属**同一 project**：契约 §6 探针要求「文件在属主目录、材料行也属该项目」，
  // 只建盘上文件时 `材料路径已同步=true` 只证「没抛」，证不了「材料行被迁走」。
  await createMaterial(库(), {
    id: "m-移动-探针",
    projectId,
    fileName: "探针.xlsx",
    kind: "资金",
    fingerprint: "fp-移动-探针",
    path: "材料/00-待归档/探针.xlsx",
  })

  const 结果 = await move_material(工具ctx({ userId: 成员, projectId }), {
    路径: "材料/00-待归档/探针.xlsx",
    目标目录: "材料/01-接报案",
  })

  expect(existsSync(join(属主根, "材料", "01-接报案", "探针.xlsx"))).toBe(true)
  expect(existsSync(join(属主根, "材料", "00-待归档", "探针.xlsx"))).toBe(false)
  expect(移动行们(结果)[0].材料路径已同步).toBe(true)
  // 材料行跟着文件走（projectId 来自身份，与「谁的目录」无关）。
  const 材料 = await getMaterial(库(), projectId, "m-移动-探针")
  expect(材料?.path).toBe("材料/01-接报案/探针.xlsx")
  // 调用者自己的沙箱里根本没有这个项目目录：按调用者拼的实现会在这里做不成事。
  expect(existsSync(项目根(projectId, 成员))).toBe(false)
})

// ───────────────────────────── 服务级（7、8、11、12） ─────────────────────────────

test("用例 7 · 非成员 ⇒ not_a_member，零副作用", async () => {
  const projectId = "p-移动-非成员"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/不动.txt", "别动我")

  const 结果 = await client.callTool({
    name: "move_material",
    arguments: { 路径: "材料/00-待归档/不动.txt", 目标目录: "材料/01-接报案" },
    _meta: 服务meta(外人, projectId),
  })

  expect(结果.isError).toBe(true)
  expect(错误体(结果).error).toBe("not_a_member")
  // 零副作用成对断言（源在 + 目标无）：只查源在挡不住「复制过去再留着源」。
  expect(existsSync(join(根, "材料", "00-待归档", "不动.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "01-接报案", "不动.txt"))).toBe(false)
})

test("用例 8 · 已归档项目 ⇒ forbidden，零副作用", async () => {
  const projectId = "p-移动-归档"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/冻结.txt", "冻结项目里的文件")

  const 结果 = await client.callTool({
    name: "move_material",
    arguments: { 路径: "材料/00-待归档/冻结.txt", 目标目录: "材料/01-接报案" },
    _meta: 服务meta(属主, projectId),
  })

  expect(结果.isError).toBe(true)
  expect(错误体(结果).error).toBe("forbidden")
  expect(existsSync(join(根, "材料", "00-待归档", "冻结.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "01-接报案", "冻结.txt"))).toBe(false)
})

test("用例 11 · 参数含白名单外的键 ⇒ bad_input(\"不认识的参数：…\")，零副作用", async () => {
  const projectId = "p-移动-未知键"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/键.txt", "内容")

  const 结果 = await client.callTool({
    name: "move_material",
    arguments: { 路径: "材料/00-待归档/键.txt", 目标目录: "材料/01-接报案", 改名: "新名字.txt" },
    _meta: 服务meta(属主, projectId),
  })

  expect(结果.isError).toBe(true)
  const 体 = 错误体(结果)
  expect(体.error).toBe("bad_input")
  expect(体.message).toContain("不认识的参数：改名")
  expect(existsSync(join(根, "材料", "00-待归档", "键.txt"))).toBe(true)
  expect(existsSync(join(根, "材料", "01-接报案", "键.txt"))).toBe(false)
})

test("用例 12 · 留痕：每次调用一行，成功 / 失败都有", async () => {
  const projectId = "p-移动-留痕"
  const 根 = 建项目(projectId)
  写文件(根, "材料/00-待归档/留痕.txt", "内容")

  const 成功前 = 收集.length
  const 成功 = await client.callTool({
    name: "move_material",
    arguments: { 路径: "材料/00-待归档/留痕.txt", 目标目录: "材料/01-接报案" },
    _meta: 服务meta(属主, projectId),
  })
  expect(成功.isError).toBeFalsy()
  expect(收集.length).toBe(成功前 + 1)
  const 成功行 = 收集[成功前]
  expect(成功行.工具).toBe("move_material")
  expect(成功行.ok).toBe(true)
  expect(成功行.userId).toBe(属主)
  expect(成功行.projectId).toBe(projectId)
  expect(成功行.错误码).toBeUndefined()

  const 失败前 = 收集.length
  const 失败 = await client.callTool({
    name: "move_material",
    arguments: { 路径: "材料/00-待归档/不存在.txt", 目标目录: "材料/01-接报案" },
    _meta: 服务meta(属主, projectId),
  })
  expect(失败.isError).toBe(true)
  expect(错误体(失败).error).toBe("bad_input")
  expect(收集.length).toBe(失败前 + 1)
  const 失败行 = 收集[失败前]
  expect(失败行.工具).toBe("move_material")
  expect(失败行.ok).toBe(false)
  expect(失败行.错误码).toBe("bad_input")
  // 失败那一行同样带身份（身份门之后才失败的调用不该缺 userId/projectId）。
  expect(失败行.userId).toBe(属主)
  expect(失败行.projectId).toBe(projectId)

  expect(existsSync(join(根, "材料", "01-接报案", "留痕.txt"))).toBe(true)
})

// ───────────────────────────── 用例 10 的夹具：让**材料路径迁移**这一步抛错 ─────────────────────────────

/**
 * 把 `update auth.case_material …` 这一句拦下来抛错，其余（`auth.project_member` 属主查询、
 * 事务里的 `set_config`）照常走真库。
 *
 * 不用「回一个没有 `transaction` 的假句柄」：那种失败是夹具自己造的类型错误，实现若改成
 * 直接 `update`（不走事务）就会假绿。这里拦的是**迁移那一条 SQL**，与实现怎么组织无关。
 */
function 迁移故障库(): 工具上下文["db"] {
  return 拦截材料迁移(库())
}

type 事务句柄 = {
  execute: (query: SQL) => PromiseLike<unknown>
  transaction?: (fn: (tx: 事务句柄) => Promise<unknown>) => Promise<unknown>
}

function 拦截材料迁移(句柄: unknown): 工具上下文["db"] {
  const 原 = 句柄 as 事务句柄
  const 事务 = 原.transaction
  if (typeof 事务 !== "function") throw new Error("夹具要求库句柄支持事务")
  return {
    execute: (query: SQL) =>
      查询文本(query).toLowerCase().includes("update auth.case_material")
        ? Promise.reject(new Error("模拟材料路径迁移失败"))
        : 原.execute(query),
    transaction: (fn: (tx: 工具上下文["db"]) => Promise<unknown>) => 事务.call(原, (tx) => fn(拦截材料迁移(tx))),
  } as 工具上下文["db"]
}

/** drizzle 的 `SQL` 没有 `toString()`：递归拼出 `queryChunks` 里的字符串块（只给夹具判句用）。 */
function 查询文本(值: unknown): string {
  if (typeof 值 === "string") return 值
  if (Array.isArray(值)) return 值.map(查询文本).join("")
  if (typeof 值 === "object" && 值 !== null) {
    const 记录 = 值 as { value?: unknown; queryChunks?: unknown[] }
    if (记录.queryChunks !== undefined) return 记录.queryChunks.map(查询文本).join("")
    if (Array.isArray(记录.value)) return 记录.value.map(查询文本).join("")
    if (typeof 记录.value === "string") return 记录.value
  }
  return ""
}

// ─────────────────────── 原子不覆盖移动（helper 级，终审 I-1） ───────────────────────

/**
 * 这两条钉的是 `move_material` 第 ⑩ 步用的原语，不经过数据库与项目树：
 * `rename(2)` 在目标已存在时**静默替换**（POSIX 与 win32 皆然），所以「不覆盖」
 * 不能由它保证；`link` 的 `EEXIST` 才是原子判据。临时目录建在系统 temp 下，
 * 每条用例自建自清（`afterEach`）。
 */
const 原子临时目录们: string[] = []
const 建原子临时目录 = (): string => {
  const 目录 = mkdtempSync(join(tmpdir(), "openhive-move-atomic-"))
  原子临时目录们.push(目录)
  return 目录
}

afterEach(() => {
  for (const 目录 of 原子临时目录们.splice(0)) rmSync(目录, { recursive: true, force: true })
})

test("helper · 移动文件不覆盖：目标已存在 ⇒ bad_input，且源/目标内容都不变", async () => {
  const 目录 = 建原子临时目录()
  const 源 = join(目录, "源.txt")
  const 目标 = join(目录, "目标.txt")
  writeFileSync(源, "源内容")
  writeFileSync(目标, "目标内容")

  const 错误 = await 取错误(() => 移动文件不覆盖(源, 目标))

  expect(错误 instanceof 工具错误).toBe(true)
  expect(错误 instanceof 工具错误 ? 错误.code : undefined).toBe("bad_input")
  expect(错误文案(错误)).toBe("目标位置已经有同名文件，或源已经不在原处")
  expect(existsSync(源)).toBe(true)
  expect(readFileSync(源, "utf8")).toBe("源内容")
  expect(readFileSync(目标, "utf8")).toBe("目标内容")
})

test("helper · 移动文件不覆盖：正常移动 ⇒ 源消失、目标内容等于原源", async () => {
  const 目录 = 建原子临时目录()
  const 源 = join(目录, "源.txt")
  const 目标 = join(目录, "目标.txt")
  writeFileSync(源, "源内容")

  await 移动文件不覆盖(源, 目标)

  expect(existsSync(源)).toBe(false)
  expect(readFileSync(目标, "utf8")).toBe("源内容")
})
