import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"
import { aggregate_money } from "../../src/server/openhive/case-mcp-tools"
import { 建假抽取器 } from "./openhive-case-extract-fixture"
import { 种P3数据集 } from "../fixtures/p3/dataset"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
const 文件 = new Map<string, Uint8Array>()
let 项目 = ""

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  const 数据集 = await 种P3数据集(db(), 文件)
  项目 = 数据集.projectId
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 机器行(值: string, 对手: string) {
  const 行们 = rowsOf(
    await db().execute(sql`
      select r.times, r.times_cny, r.amount::text as amount
        from auth.case_relation r
        join auth.case_entity a on a.project_id = r.project_id and a.id = r.from_id
        join auth.case_entity b on b.project_id = r.project_id and b.id = r.to_id
       where r.project_id = ${项目} and r.source_kind = 'data'
         and a.canonical_value = ${值} and b.canonical_value = ${对手}
    `),
  )[0]
  return 行们 === undefined ? undefined : {
    times: Number(行们.times),
    times_cny: Number(行们.times_cny),
    amount: String(行们.amount),
  }
}

/**
 * `#013-02`：重放换对手后，旧对必须在**删事实之前**取出并重算。
 * 否则 A→B 的机器行会保留「被旧 human 覆盖过」的过期值（1 笔 / 20000），
 * 而它的支持事件其实还在库里——页面上等于凭空少一笔，比多一笔更隐蔽。
 */
test("文本重放换了对手：旧对的机器行按剩余事件重算（不是保留过期排除）", async () => {
  // 种完之后（v1 笔录：A→李四 1万 4/1、A→B 5000 4/2）：A→B 剩 1 笔 20000。
  expect(await 机器行("6222021234567890123", "6222021234567890456")).toEqual({
    times: 1,
    times_cny: 1,
    amount: "20000.00",
  })

  // v2：同一份材料（同 fingerprint + force ⇒ 同一个 materialId）改成只记 A→吴九。
  const v2 = [
    "一、2026年4月1日，张三账户6222021234567890123向吴九转账1万元。",
    "",
  ].join("\n")
  文件.set(`${项目}/P3笔录.txt`, new TextEncoder().encode(v2))
  const 再入队 = await enqueueMaterial(db(), {
    projectId: 项目,
    path: "P3笔录.txt",
    sourcePath: `${项目}/P3笔录.txt`,
    fileName: "P3笔录.txt",
    fingerprint: `fp-${项目}-P3笔录.txt`,
    force: true,
  })
  expect(再入队.enqueued).toBe(true)
  const job = await claimNextJob(db())
  expect(job).toBeDefined()
  const 结果 = await runJob(
    db(),
    {
      readFile: async (p) => 文件.get(p)!,
      建抽取器: async () =>
        建假抽取器(() => ({
          实体: [
            { 类型: "人", 取值: "吴九" },
            { 类型: "账户", 取值: "6222021234567890123" },
          ],
          关系: [
            {
              类型: "转账",
              从: "6222021234567890123",
              到: "吴九",
              金额原文: "1万",
              时间原文: "2026年4月1日",
              原文: "2026年4月1日，张三账户6222021234567890123向吴九转账1万元。",
            },
          ],
          事件: [],
        })),
    },
    job!,
  )
  expect(结果).toBe("完成")

  // 旧对 (A,B) 已无 human 覆盖 ⇒ 两笔事件全部回来。
  expect(await 机器行("6222021234567890123", "6222021234567890456")).toEqual({
    times: 2,
    times_cny: 2,
    amount: "30000.00",
  })
  // 新对 (A,吴九) 没有流水事件 ⇒ 不写机器行。
  expect(await 机器行("6222021234567890123", "吴九")).toBeUndefined()

  // 读端笔数：A 名下两条关系进汇总——机器 A→B（times_cny=2，30000）与 v2 留下的人工
  // A→吴九（1 万，times 为 NULL 按 1 计）；A→C 是 USD（times_cny=0）被过滤。
  // 拆 `sum(coalesce(times_cny, times, 1))` → `count(*)` 时，汇总与对手方都会红。
  const 汇总结果 = await aggregate_money(
    { db: db(), 身份: { userId: "u-p3", projectId: 项目 } },
    { 账户: "6222021234567890123" },
  )
  expect(汇总结果.数据).toMatchObject({
    汇总: [{ 方向: "出", 笔数: 3, 合计: "40000.00" }],
    对手方: [
      { 对手方: "李四", 方向: "出", 笔数: 2, 合计: "30000.00" },
      { 对手方: "吴九", 方向: "出", 笔数: 1, 合计: "10000.00" },
    ],
  })
})
