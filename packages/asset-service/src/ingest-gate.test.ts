import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { 校验入库包, 校验档案映射 } from "./ingest-gate"

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
      thresholds: { 金额可解析: 1, 其余: 1 },
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

  test("6b. output.file 不得指向包内既有文件（adapter.json / SKILL.md / entry.command 的脚本）", async () => {
    for (const 文件 of ["adapter.json", "SKILL.md", "convert.ts"]) {
      const dir = await 造包({ adapter: { ...合法识别卡(), output: { file: 文件 } } })
      const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
      expect(problems.some((项) => 项.includes("output.file"))).toBe(true)
    }
  })

  test("7a. kind=rowRules 无 rowRules ⇒ 红；7b. 有 rowRules 且无 convert.ts ⇒ 绿", async () => {
    const 无规则 = await 造包({
      adapter: {
        ...合法识别卡(),
        kind: "rowRules",
        rowRules: undefined,
        entry: { input: "xlsx", output: "json" },
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
        entry: { input: "xlsx", output: "json" },
      },
      不写convert: true,
    })
    expect(await 校验入库包({ assetType: "skill", dir: 合法规则, 词汇: 词表, 已占用id: [] })).toEqual({
      ok: true,
    })
  })

  test("7c. kind=rowRules 缺 entry / output.file ⇒ 红（FR-017/FR-019：只有 convert.* 可省）", async () => {
    const 缺entry = await 造包({
      adapter: { ...合法识别卡(), kind: "rowRules", rowRules: ["x = y"], entry: undefined },
      不写convert: true,
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 缺entry, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("entry"))).toBe(true)

    const 缺输出文件 = await 造包({
      adapter: {
        ...合法识别卡(),
        kind: "rowRules",
        rowRules: ["x = y"],
        entry: { input: "xlsx", output: "json" },
        output: undefined,
      },
      不写convert: true,
    })
    const 输出问题 = 是失败(await 校验入库包({ assetType: "skill", dir: 缺输出文件, 词汇: 词表, 已占用id: [] }))
    expect(输出问题.problems.some((项) => 项.includes("output.file"))).toBe(true)
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

  test("F5. attributeKeys 比对不 trim：`对方: 开户行` 必须判词表外键", async () => {
    const dir = await 造包({
      adapter: { ...合法识别卡(), attributeKeys: ["对方: 开户行"] },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("词表外键"))).toBe(true)
    expect(problems.some((项) => 项.includes("对方: 开户行"))).toBe(true)
  })

  test("F6a. version 必须是语义版本；预发布后缀放行", async () => {
    const 短版本 = await 造包({ adapter: { ...合法识别卡(), version: "1.0" } })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 短版本, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("version"))).toBe(true)

    const 预发布 = await 造包({ adapter: { ...合法识别卡(), version: "1.0.0-beta.1" } })
    expect(await 校验入库包({ assetType: "skill", dir: 预发布, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })

  test("F6b. admission.checks 元素必须是字符串、阈值必须是数字", async () => {
    const 坏检查项 = await 造包({
      adapter: {
        ...合法识别卡(),
        admission: { checks: [1], thresholds: { "1": 0.99 } },
      },
    })
    const 检查项问题 = 是失败(
      await 校验入库包({ assetType: "skill", dir: 坏检查项, 词汇: 词表, 已占用id: [] }),
    )
    expect(检查项问题.problems.some((项) => 项.includes("admission.checks"))).toBe(true)

    const 坏阈值 = await 造包({
      adapter: {
        ...合法识别卡(),
        admission: { checks: ["金额可解析"], thresholds: { 金额可解析: "0.99" } },
      },
    })
    const 阈值问题 = 是失败(
      await 校验入库包({ assetType: "skill", dir: 坏阈值, 词汇: 词表, 已占用id: [] }),
    )
    expect(阈值问题.problems.some((项) => 项.includes("admission.thresholds"))).toBe(true)
  })

  test("F6c. `其余` 是兜底键：既有显式键或 `其余` ⇒ 放行；两者都没有才拒（Ruling V）", async () => {
    // 只有「其余」兜底 ⇒ 绿（契约 `admission.thresholds`：`其余` 为兜底键）。
    const 兜底 = await 造包({
      adapter: {
        ...合法识别卡(),
        admission: { checks: ["金额可解析", "时间可解析"], thresholds: { 金额可解析: 0.99, 其余: 1 } },
      },
    })
    expect(await 校验入库包({ assetType: "skill", dir: 兜底, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })

    // 既无显式键、也无「其余」⇒ 红。
    const 无兜底 = await 造包({
      adapter: {
        ...合法识别卡(),
        admission: { checks: ["金额可解析", "时间可解析"], thresholds: { 金额可解析: 0.99 } },
      },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 无兜底, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("时间可解析"))).toBe(true)
  })

  test("F6d. 契约示例原样（7 checks / 2 个显式阈值 + `其余`）⇒ 绿", async () => {
    const dir = await 造包({
      adapter: {
        id: "wechat-wallet-statement",
        name: "微信账户流水预处理",
        version: "1.0.0",
        kind: "converter",
        materialType: "资金",
        attributeKeys: ["对方:开户行", "对方:银行卡号", "对方:证件号"],
        match: {
          requiredHeaders: [
            "查询账号",
            "付款方支付帐号",
            "收款方支付帐号",
            "借贷标志",
            "交易金额",
            "交易余额",
            "交易时间",
          ],
          optionalHeaders: ["收款方的商户号", "收款方的商户名称", "付款方银行卡号", "收款方银行卡号"],
          priority: 100,
        },
        admission: {
          checks: [
            "查询账号非空",
            "借贷标志合法",
            "金额可解析",
            "时间可解析",
            "方向与本方一致",
            "卡行成对",
            "开户人可分类",
          ],
          thresholds: { 时间可解析: 0.99, 方向与本方一致: 0.98, 其余: 1.0 },
        },
        rowRules: ["本方方 = 借贷=='借' ? 付款方 : 收款方", "对方方 = 借贷=='借' ? 收款方 : 付款方"],
        entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
        output: { file: "result.json" },
      },
    })
    expect(await 校验入库包({ assetType: "skill", dir, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })
  })

  test("F7. 包内 `..` 开头的合法文件名不误判为越界；真越界仍拒", async () => {
    const 合法 = await 造包({
      adapter: {
        ...合法识别卡(),
        entry: { command: "bun run ..convert.ts", input: "xlsx", output: "json" },
      },
      其他文件: { "..convert.ts": "// 名字以 .. 开头，但仍在包内\n" },
    })
    expect(await 校验入库包({ assetType: "skill", dir: 合法, 词汇: 词表, 已占用id: [] })).toEqual({ ok: true })

    const 越界 = await 造包({
      adapter: {
        ...合法识别卡(),
        entry: { command: "bun run ../outside.ts", input: "xlsx", output: "json" },
      },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir: 越界, 词汇: 词表, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("必须在包内"))).toBe(true)
  })

  test("F1. 有 attributeKeys 但词表未注入 ⇒ 显式「校验闸未注入词表」，不伪装成词表外键", async () => {
    const dir = await 造包({
      adapter: { ...合法识别卡(), attributeKeys: ["对方:开户行"] },
    })
    const { problems } = 是失败(await 校验入库包({ assetType: "skill", dir, 已占用id: [] }))
    expect(problems.some((项) => 项.includes("校验闸未注入词表"))).toBe(true)
    expect(problems.some((项) => 项.includes("词表外键"))).toBe(false)
  })
})

describe("A 类档案映射校验（M10 / F4）", () => {
  const 是识别字段 = (字段: string) => ["startedAt", "amount", "counterpartyName"].includes(字段)

  test("合法映射 ⇒ 绿", () => {
    expect(
      校验档案映射({
        type: "资金",
        mapping: { 交易时间: "startedAt", 交易金额: "amount" },
        requiredHeaders: ["交易时间", "交易金额"],
        是识别字段,
      }),
    ).toEqual({ ok: true })
  })

  test("mapping 键不是表头原文（含首尾空白）⇒ 红", () => {
    const 结果 = 校验档案映射({
      type: "资金",
      mapping: { " 交易时间 ": "startedAt" },
      requiredHeaders: ["交易时间"],
      是识别字段,
    })
    expect(结果.ok).toBe(false)
    if (结果.ok) throw new Error("预期失败")
    expect(结果.problems.some((项) => 项.includes("交易时间"))).toBe(true)
  })

  test("mapping 值不在字段目录内 ⇒ 红", () => {
    const 结果 = 校验档案映射({
      type: "资金",
      mapping: { 交易时间: "不存在的字段" },
      requiredHeaders: ["交易时间"],
      是识别字段,
    })
    expect(结果.ok).toBe(false)
    if (结果.ok) throw new Error("预期失败")
    expect(结果.problems.some((项) => 项.includes("不存在的字段"))).toBe(true)
  })

  test("requiredHeaders 为空 / type 不在闭集 ⇒ 红", () => {
    const 空必需列 = 校验档案映射({
      type: "资金",
      mapping: { 交易时间: "startedAt" },
      requiredHeaders: [],
      是识别字段,
    })
    expect(空必需列.ok).toBe(false)

    const 坏类型 = 校验档案映射({
      type: "未知",
      mapping: { 交易时间: "startedAt" },
      requiredHeaders: ["交易时间"],
      是识别字段,
    })
    expect(坏类型.ok).toBe(false)
  })
})
