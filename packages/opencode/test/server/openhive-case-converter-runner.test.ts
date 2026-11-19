import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import { join } from "node:path"
import type { 转换器结果 } from "../../src/server/openhive/case-converter-runner"
import { 跑转换器 } from "../../src/server/openhive/case-converter-runner"

/**
 * 016 T007 · N3 转换器执行器。
 *
 * 钉住六件事（子进程全部是真进程，不起 server、不连库）：
 * 1. 正常：cwd=技能目录、输入两通道（argv / `OPENHIVE_INPUT_PATH`）都送到，输出读完即清残留；
 * 2. 非零退出：detail 带退出码；退出前写了 `{report}` ⇒ 仍交回 `报告`（Ruling X 配套），没写 ⇒ 省略；
 * 3. 超时：到点杀进程树，detail 带「超时」；
 * 4. 输出不合 `converter-output-contract.md`：`direction` 非收/付（第 2 条）、缺 `report`（第 4 条）；
 * 5. 环境：父进程里的 `PG_PASSWORD` **不进**子进程（变异点：去掉环境清理 ⇒ 本条红）；
 * 6. 命令前缀白名单：`python x.py` ⇒ 失败；
 * 7. 契约反向：多出 JSON（第 7 条）、`rowNo` 非数字（第 1 条）、`amount` 非正（第 2 条）；
 * 8. 内核退出兜底钩子运行中挂上、结算后注销（监听数回到原值）；
 * 9. 同一技能目录并发执行互不踩输出文件（进程内按目录串行）。
 *
 * 注意：断言「文件不存在」一律用布尔比较（`#013-12`：`toBeNull()` 在本仓库出现过假绿）。
 */

const 临时目录们: string[] = []

async function 造技能目录(脚本: string): Promise<string> {
  const 目录 = await fs.mkdtemp(join(os.tmpdir(), "openhive-converter-"))
  临时目录们.push(目录)
  await fs.writeFile(join(目录, "convert.ts"), 脚本, "utf8")
  await fs.writeFile(join(目录, "source.xlsx"), "fixture", "utf8")
  return 目录
}

function 适配器(目录: string, 命令 = "bun run convert.ts") {
  return {
    id: "test-converter",
    version: "1.0.0",
    entry: { command: 命令, input: "原件", output: "json" as const },
    output: { file: "out.json" },
    目录,
  }
}

function 原件路径(目录: string): string {
  return join(目录, "source.xlsx")
}

async function 存在(路径: string): Promise<boolean> {
  return fs.access(路径).then(
    () => true,
    () => false,
  )
}

function 第一行金额(结果: 转换器结果): unknown {
  if (!结果.ok) throw new Error(`期望 ok:true，实得：${结果.detail}`)
  const 第一行 = 结果.rows[0]
  if (typeof 第一行 !== "object" || 第一行 === null) throw new Error("rows[0] 必须是对象")
  return Reflect.get(第一行, "amount")
}

afterAll(async () => {
  await Promise.all(临时目录们.map((目录) => fs.rm(目录, { recursive: true, force: true })))
})

describe("转换器执行器", () => {
  test("正常：输出合法 rows/report，输入两通道都送到，跑完不留输出文件", async () => {
    const 脚本 = `
const 值 = {
  rows: [
    {
      sheet: "Sheet1",
      rowNo: 2,
      startedAt: 1730000000,
      amount: "1234.56",
      direction: "收",
      ownerAccount: "6222",
      counterparty: "6217",
      currency: "CNY",
      extras: { "属性:对方:开户行": "招商银行" },
    },
  ],
  report: {
    adapterId: "test-converter",
    adapterVersion: "1.0.0",
    sourceSha256: "sha",
    gates: [],
    warnings: [],
    skippedRows: [],
    argInput: process.argv[2] ?? null,
    envInput: process.env.OPENHIVE_INPUT_PATH ?? null,
  },
}
await Bun.write("out.json", JSON.stringify(值))
`
    const 目录 = await 造技能目录(脚本)
    const 原件 = 原件路径(目录)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件 })

    expect(结果.ok).toBe(true)
    if (!结果.ok) return
    expect(结果.rows.length).toBe(1)
    expect(typeof 结果.report).toBe("object")
    const 报告 = 结果.report
    if (typeof 报告 !== "object" || 报告 === null) throw new Error("report 必须是对象")
    expect(Reflect.get(报告, "argInput")).toBe(原件)
    expect(Reflect.get(报告, "envInput")).toBe(原件)

    expect(await 存在(join(目录, "out.json"))).toBe(false)
  })

  test("非零退出：detail 带退出码；退出前写了 report ⇒ 交回报告", async () => {
    const 脚本 = `
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [],
    report: { gates: [{ 检查项: "时间可解析", 通过率: 0.5, 阈值: 0.99 }] },
  }),
)
process.exit(3)
`
    const 目录 = await 造技能目录(脚本)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("退出码 3")
    const 报告 = 结果.报告
    expect(typeof 报告).toBe("object")
    if (typeof 报告 !== "object" || 报告 === null) throw new Error("报告必须是对象")
    const 闸们 = Reflect.get(报告, "gates")
    expect(Array.isArray(闸们)).toBe(true)
    const 第一闸 = Array.isArray(闸们) ? 闸们[0] : undefined
    expect(typeof 第一闸 === "object" && 第一闸 !== null).toBe(true)
    expect(Reflect.get(typeof 第一闸 === "object" && 第一闸 !== null ? 第一闸 : {}, "检查项")).toBe("时间可解析")
  })

  test("非零退出且没写文件：报告省略，不报错", async () => {
    const 目录 = await 造技能目录("process.exit(7)\n")
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("退出码 7")
    expect(结果.报告 === undefined).toBe(true)
  })

  test("超时：到点杀进程树，detail 带「超时」", async () => {
    const 目录 = await 造技能目录("await new Promise(() => {})\n")
    const 开始 = Date.now()
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录), 超时ms: 500 })
    const 用时ms = Date.now() - 开始

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("超时")
    expect(用时ms >= 400).toBe(true)
    expect(用时ms < 5_000).toBe(true)
  })

  test("契约第 2 条：direction 不是 收/付 ⇒ 失败并指出条款与字段", async () => {
    const 脚本 = `
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [{ sheet: "Sheet1", rowNo: 2, amount: "1.00", direction: "借" }],
    report: {},
  }),
)
`
    const 目录 = await 造技能目录(脚本)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("契约第 2 条")
    expect(结果.detail).toContain("direction")
  })

  test("契约第 4 条：顶层缺 report ⇒ 失败", async () => {
    const 目录 = await 造技能目录(`await Bun.write("out.json", JSON.stringify({ rows: [] }))\n`)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("契约第 4 条")
    expect(结果.detail).toContain("report")
  })

  test("环境：父进程的 PG_PASSWORD 不进子进程", async () => {
    const 脚本 = `
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [{ sheet: "Sheet1", rowNo: 2, amount: "1.00", direction: "收" }],
    report: { pgPassword: process.env.PG_PASSWORD ?? "无" },
  }),
)
`
    const 目录 = await 造技能目录(脚本)
    const 父进程原值 = process.env.PG_PASSWORD
    process.env.PG_PASSWORD = "不该出现在子进程"
    try {
      const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

      expect(结果.ok).toBe(true)
      if (!结果.ok) return
      const 报告 = 结果.report
      if (typeof 报告 !== "object" || 报告 === null) throw new Error("report 必须是对象")
      expect(Reflect.get(报告, "pgPassword")).toBe("无")
    } finally {
      if (父进程原值 === undefined) delete process.env.PG_PASSWORD
      else process.env.PG_PASSWORD = 父进程原值
    }
  })

  test("命令前缀不在白名单 ⇒ 失败，不起子进程", async () => {
    const 目录 = await 造技能目录("process.exit(0)\n")
    const 结果: 转换器结果 = await 跑转换器({
      适配器: 适配器(目录, "python x.py"),
      原件: 原件路径(目录),
    })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("白名单")
  })

  test("契约第 7 条：多出一个 JSON 文件 ⇒ 失败并指出文件名", async () => {
    const 脚本 = `
await Bun.write("out.json", JSON.stringify({ rows: [], report: {} }))
await Bun.write("extra.json", JSON.stringify({}))
`
    const 目录 = await 造技能目录(脚本)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("契约第 7 条")
    expect(结果.detail).toContain("extra.json")
  })

  test("契约第 1 条：rowNo 不是数字 ⇒ 失败并指出 rowNo", async () => {
    const 脚本 = `
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [{ sheet: "Sheet1", rowNo: "2", amount: "1.00", direction: "收" }],
    report: {},
  }),
)
`
    const 目录 = await 造技能目录(脚本)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("契约第 1 条")
    expect(结果.detail).toContain("rowNo")
  })

  test("契约第 2 条：amount 非正 ⇒ 失败并指出 amount", async () => {
    const 脚本 = `
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [{ sheet: "Sheet1", rowNo: 2, amount: "-1", direction: "收" }],
    report: {},
  }),
)
`
    const 目录 = await 造技能目录(脚本)
    const 结果 = await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })

    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.detail).toContain("契约第 2 条")
    expect(结果.detail).toContain("amount")
  })

  test("内核退出兜底钩子：运行中挂上、结算后注销（监听数回到原值）", async () => {
    const 脚本 = `
await Bun.write("started.marker", "1")
await new Promise((解析) => setTimeout(解析, 400))
await Bun.write("out.json", JSON.stringify({ rows: [], report: {} }))
`
    const 目录 = await 造技能目录(脚本)
    const 标记 = join(目录, "started.marker")
    const 跑前 = process.listenerCount("exit")

    const 第一次 = 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })
    // 子进程开始执行 ⇒ 兜底钩子必须已在父进程挂上（spawn 后同步注册）。
    for (let 次 = 0; 次 < 200; 次++) {
      if (await 存在(标记)) break
      await new Promise((解析) => setTimeout(解析, 10))
    }
    expect(await 存在(标记)).toBe(true)
    expect(process.listenerCount("exit")).toBe(跑前 + 1)

    const 第一次结果 = await 第一次
    expect(第一次结果.ok).toBe(true)
    expect(process.listenerCount("exit")).toBe(跑前)

    // 连续再跑一次：注销必须成对，监听数不随执行次数累积（变异点：删 `process.off` ⇒ 本条红）。
    await 跑转换器({ 适配器: 适配器(目录), 原件: 原件路径(目录) })
    expect(process.listenerCount("exit")).toBe(跑前)
  })

  test("同一技能目录并发：输出文件互不踩（进程内按目录串行）", async () => {
    const 脚本 = `
const 内容 = await Bun.file(process.env.OPENHIVE_INPUT_PATH).text()
await Bun.write(
  "out.json",
  JSON.stringify({
    rows: [{ rowNo: 1, amount: 内容.trim(), direction: "收", startedAt: "2026-01-01 00:00:00" }],
    report: {},
  }),
)
await new Promise((解析) => setTimeout(解析, 400))
`
    const 目录 = await 造技能目录(脚本)
    const 原件甲 = join(目录, "a.csv")
    const 原件乙 = join(目录, "b.csv")
    await fs.writeFile(原件甲, "1.11", "utf8")
    await fs.writeFile(原件乙, "2.22", "utf8")

    const [结果甲, 结果乙] = await Promise.all([
      跑转换器({ 适配器: 适配器(目录), 原件: 原件甲 }),
      跑转换器({ 适配器: 适配器(目录), 原件: 原件乙 }),
    ])

    expect(第一行金额(结果甲)).toBe("1.11")
    expect(第一行金额(结果乙)).toBe("2.22")
  })
})
