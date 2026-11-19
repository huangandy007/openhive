import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { 校验入库包 } from "./ingest-gate"

/**
 * T002 · M10 识别卡校验（纯函数级，临时目录造包，**不连库**）。
 *
 * 判据来自 `docs/superpowers/specs/016-adaptive-format-ingest/contracts/adapter-json-contract.md`
 * 与 `task-002-brief.md` 的 9 条必测。
 */

const 词表 = {
  归属: ["对方", "本方"],
  键: ["开户行", "银行卡号", "证件号"],
} as const

const 临时目录: string[] = []

afterAll(async () => {
  for (const dir of 临时目录) await rm(dir, { recursive: true, force: true })
})

interface 造包选项 {
  readonly adapter?: Record<string, unknown>
  /** 原样写进去的 adapter.json 文本（覆盖 `adapter`）。 */
  readonly adapter文本?: string
  readonly 不写adapter?: boolean
  readonly 不写skill?: boolean
  readonly 不写test?: boolean
  readonly 不写convert?: boolean
  readonly 其他文件?: Record<string, string>
}

function 合法识别卡(): Record<string, unknown> {
  return {
    id: "demo-converter",
    name: "演示转换器",
    version: "1.0.0",
    kind: "converter",
    materialType: "资金",
    attributeKeys: ["对方:开户行"],
    match: {
      requiredHeaders: ["交易时间"],
      optionalHeaders: [],
      priority: 100,
    },
    admission: {
      checks: ["金额可解析"],
      thresholds: { 其余: 1 },
    },
    entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
    output: { file: "result.json" },
  }
}

async function 造包(选项: 造包选项 = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openhive-ingest-gate-"))
  临时目录.push(dir)
  if (选项.不写skill !== true) {
    await writeFile(join(dir, "SKILL.md"), "---\nname: 演示\ndescription: 测试用\n---\n", "utf8")
  }
  if (选项.不写adapter !== true) {
    await writeFile(
      join(dir, "adapter.json"),
      选项.adapter文本 ?? JSON.stringify(选项.adapter ?? 合法识别卡(), null, 2),
      "utf8",
    )
  }
  if (选项.不写test !== true) await mkdir(join(dir, "test"), { recursive: true })
  if (选项.不写convert !== true) await writeFile(join(dir, "convert.ts"), "// 转换器\n", "utf8")
  for (const [名字, 内容] of Object.entries(选项.其他文件 ?? {})) {
    await writeFile(join(dir, 名字), 内容, "utf8")
  }
  return dir
}

function 是失败(结果: Awaited<ReturnType<typeof 校验入库包>>): { problems: string[] } {
  expect(结果.ok).toBe(false)
  if (结果.ok) throw new Error("预期校验失败，实际通过")
  return { problems: [...结果.problems] }
}

describe("识别卡校验（M10）", () => {
  test("1. 完整合法 converter 包 ⇒ {ok:true}", async () => {
    const dir = await 造包()
    expect(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })

  test("2. converter 缺 convert.* ⇒ 红，problems 含 convert", async () => {
    const dir = await 造包({ 不写convert: true })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("convert"))).toBe(true)
  })

  test("2b. converter 的 entry 指向别的脚本、但包内没有 convert.* ⇒ 仍红（四件套只认 convert.*）", async () => {
    const dir = await 造包({
      不写convert: true,
      其他文件: { "main.ts": "// 换成别的入口\n" },
      adapter: {
        ...合法识别卡(),
        entry: { command: "bun run main.ts", input: "xlsx", output: "json" },
      },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("convert.*"))).toBe(true)
  })

  test("3. 缺 test/ ⇒ 红", async () => {
    const dir = await 造包({ 不写test: true })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("test/"))).toBe(true)
  })

  test("3b. 缺 SKILL.md ⇒ 红", async () => {
    const dir = await 造包({ 不写skill: true })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("SKILL.md"))).toBe(true)
  })

  test("4. adapter.json 不是合法 JSON ⇒ problems 含解析失败", async () => {
    const dir = await 造包({ adapter文本: '{ "id": "坏包", ' })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("解析"))).toBe(true)
  })

  test("5. attributeKeys 含词表外键 ⇒ 红且指出该键", async () => {
    const dir = await 造包({
      adapter: { ...合法识别卡(), attributeKeys: ["对方:开户行"] },
    })
    const { problems } = 是失败(
      await 校验入库包({ assetType: "skill", dir, 词汇: { 归属: ["对方", "本方"], 键: ["银行卡号"] }, 已占用id: [] }),
    )
    expect(problems.some((项) => 项.includes("对方:开户行"))).toBe(true)
  })

  test("6. entry.command 前缀不在白名单 ⇒ 红", async () => {
    const dir = await 造包({
      adapter: { ...合法识别卡(), entry: { command: "python x.py", input: "xlsx", output: "json" } },
      其他文件: { "x.py": "print(1)" },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("entry.command"))).toBe(true)
  })

  test("7a. kind=rowRules 无 rowRules ⇒ 红；7b. 有 rowRules 且无 convert.ts ⇒ 绿", async () => {
    const 无规则 = await 造包({
      adapter: {
        ...合法识别卡(),
        kind: "rowRules",
        rowRules: undefined,
        entry: undefined,
        output: undefined,
      },
      不写convert: true,
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 无规则, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("rowRules"))).toBe(true)

    const 合法规则 = await 造包({
      adapter: {
        ...合法识别卡(),
        kind: "rowRules",
        rowRules: ["本方方 = 借贷=='借' ? 付款方 : 收款方"],
        entry: undefined,
        output: undefined,
      },
      不写convert: true,
    })
    expect(await 校验入库包({ assetType: "skill", dir: 合法规则, 词汇: 词表, 已占用id: [] })).toEqual({
      ok: true,
    })
  })

  test("8. 已占用id 含同 id ⇒ 红（唯一性）", async () => {
    const dir = await 造包()
    const { problems } = 是失败(
      await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: ["demo-converter"] }),
    )
    expect(problems.some((项) => 项.includes("demo-converter"))).toBe(true)
  })

  test("9. assetType=mcp ⇒ 恒 {ok:true}（不误伤别的资产）", async () => {
    const dir = await 造包({ 不写skill: true, 不写adapter: true, 不写test: true, 不写convert: true })
    expect(await 校验入库包({ assetType: "mcp", dir, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })

  test("10. 没有 adapter.json 的普通 skill ⇒ {ok:true}（不是入库包，不按四件套要求）", async () => {
    const dir = await 造包({ 不写adapter: true, 不写test: true, 不写convert: true })
    expect(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })

  test("11. entry.command 引用的脚本不在包内 ⇒ 红", async () => {
    const dir = await 造包({
      adapter: {
        ...合法识别卡(),
        entry: { command: "bun run missing.ts", input: "xlsx", output: "json" },
      },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("missing.ts"))).toBe(true)
  })

  test("12. A 类：mapping 键含首尾空白 ⇒ 红；键为表头原文 ⇒ 绿", async () => {
    const 坏 = await 造包({
      adapter: { ...合法识别卡(), mapping: { " 交易时间 ": "交易时间" } },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 坏, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("mapping"))).toBe(true)

    const 好 = await 造包({
      adapter: { ...合法识别卡(), mapping: { 交易时间: "交易时间", 交易金额: "金额" } },
    })
    expect(await 校验入库包({ assetType: "skill", dir: 好, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })
})
