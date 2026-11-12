import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { insertFactRows } from "../../src/server/openhive/case-store"
import { 查明细行, 明细入参错误, 读明细行, 行视图 } from "../../src/server/openhive/case-row-query"
import { 建材料 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

/** 建材料并指定 `created_at`：同 path 重传场景要造「旧行 + 新行」，现有夹具写死同一个时间。 */
async function 建材料带时间(input: {
  id: string
  projectId: string
  path: string
  kind?: string
  parseStatus: string
  createdAt: number
}): Promise<void> {
  // 列序与措辞刻意与 `openhive-case-fact-fixture.ts` 的 `建材料` 不同：PGlite 汇进同一个 PG 会话，
  // 同文本会撞语句缓存 42P05（见该夹具文件头）。
  await 库().execute(sql`
    insert into auth.case_material
      (id, project_id, path, file_name, kind, fingerprint, parse_status, created_at)
    values (${input.id}, ${input.projectId}, ${input.path}, ${input.path.split("/").pop() ?? "材料"},
            ${input.kind ?? "资金"}, ${input.id + "#fp"}, ${input.parseStatus}, ${input.createdAt})
  `)
}

const 项目 = "p-明细"
const 别处 = "p-别处"
const 同刻 = "p-同刻"
const 重传 = "p-重传"
const 默认 = "p-默认50"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await 建材料(库(), { id: "m-1", projectId: 项目, path: "资金/微信.xlsx", kind: "资金", parseStatus: "已解析" })
  await 建材料(库(), { id: "m-2", projectId: 项目, path: "资金/支付宝.xlsx", kind: "资金", parseStatus: "未入队" })
  await 建材料(库(), { id: "m-9", projectId: 别处, path: "资金/别处.xlsx", kind: "资金", parseStatus: "已解析" })
  // I1：三行同一个 `started_at` + 两行无时间。现有的 `项目` 夹具里 5 行的时刻互不相同、
  // 无时间的只有 1 行，游标条件的三支只走得到「时间更晚」那一支。
  await 建材料(库(), { id: "m-同", projectId: 同刻, path: "同刻/同刻.xlsx", kind: "资金", parseStatus: "已解析" })
  // I3：同一 path 两行——旧行「未入队」、新行「已解析」（内容变了另建一行，旧行留着）。
  await 建材料带时间({ id: "m-重传旧", projectId: 重传, path: "资金/重传.xlsx", parseStatus: "未入队", createdAt: 1000 })
  await 建材料带时间({ id: "m-重传新", projectId: 重传, path: "资金/重传.xlsx", parseStatus: "已解析", createdAt: 2000 })
  // M3：60 行，钉住「默认 50」是使用点而不是常量。
  await 建材料(库(), { id: "m-默认", projectId: 默认, path: "默认/批量.xlsx", kind: "资金", parseStatus: "已解析" })
  await insertFactRows(库(), [
    // 行号与时间**逆序**配对：按行号遍历与按时间遍历结果不同，排序写错能看出来
    // （与计划 6 的余额走势用例同一手法）。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 4,
      startedAt: 1000,
      amount: "500.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: { 备注: "货款" },
    },
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 3,
      startedAt: 2000,
      amount: "100.00",
      direction: "付",
      ownerAccount: "622200000001",
      counterparty: "李四",
      counterpartyName: "李四",
      extras: { 备注: "货款 加油" },
    },
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 2,
      startedAt: 3000,
      amount: "1000.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: {},
    },
    // 无时间的行：必须排最后，且分页时不能被漏掉（游标两段式条件就是为它写的）。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 5,
      amount: "50.00",
      extras: { 备注: "没有时间的行" },
    },
    // 工作表名合法含 `#`：定位拼错就会在这里红。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet#1",
      rowNo: 2,
      startedAt: 1500,
      amount: "10.00",
      direction: "付",
      ownerAccount: "622200000001",
      extras: {},
    },
    { projectId: 别处, materialId: "m-9", sheet: "Sheet1", rowNo: 2, startedAt: 1000, amount: "999.00" },
  ])
  await insertFactRows(库(), [
    { projectId: 同刻, materialId: "m-同", sheet: "S", rowNo: 1, startedAt: 5000 },
    { projectId: 同刻, materialId: "m-同", sheet: "S", rowNo: 2, startedAt: 5000 },
    { projectId: 同刻, materialId: "m-同", sheet: "S", rowNo: 3, startedAt: 5000 },
    { projectId: 同刻, materialId: "m-同", sheet: "S", rowNo: 4 },
    { projectId: 同刻, materialId: "m-同", sheet: "S", rowNo: 5 },
  ])
  await insertFactRows(库(), [
    { projectId: 重传, materialId: "m-重传新", sheet: "S", rowNo: 1, startedAt: 1000, amount: "7.00" },
  ])
  await insertFactRows(
    库(),
    Array.from({ length: 60 }, (_, i) => ({
      projectId: 默认,
      materialId: "m-默认",
      sheet: "S",
      rowNo: i + 1,
      startedAt: 1000 + i,
      amount: "1.00",
    })),
  )
})

afterAll(async () => {
  await pg?.stop()
})

describe("读明细行 · 单行按主键取", () => {
  test("金额是 numeric 字符串、备注从 extras[\"备注\"] 回显、定位是主键拼的", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet1", rowNo: 4 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行.amount).toBe("500.00")
    expect(行.counterpartyName).toBe("张三")
    const 视图 = 行视图(行)
    expect(视图.金额).toBe("500.00")
    expect(视图.备注).toBe("货款")
    expect(视图.定位).toBe("m-1#Sheet1#4")
    expect(视图.方向).toBe("收")
  })

  test("工作表名含 `#` 时定位不被拆错（行即主键，不解析 fact_id）", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet#1", rowNo: 2 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行视图(行).定位).toBe("m-1#Sheet#1#2")
  })

  test("没有备注键时是 null，不是空串、不是 undefined", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet1", rowNo: 2 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行视图(行).备注).toBeNull()
  })

  test("别的项目读不到", async () => {
    expect(await 读明细行(库(), 别处, { materialId: "m-1", sheet: "Sheet1", rowNo: 4 })).toBeUndefined()
  })
})

describe("查明细行 · 过滤与排序", () => {
  test("只给项目：时间升序、无时间的排最后（行号与时间逆序配对，排序错了能看出来）", async () => {
    const r = await 查明细行(库(), { projectId: 项目 })
    expect(r.空原因).toBeNull()
    expect(r.数据.行们.map((行) => 行.定位)).toEqual([
      "m-1#Sheet1#4",
      "m-1#Sheet#1#2",
      "m-1#Sheet1#3",
      "m-1#Sheet1#2",
      "m-1#Sheet1#5",
    ])
    expect(r.数据.行们[4]?.时间).toBeNull()
  })

  test("时间窗是闭区间", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 时间起: 1500, 时间止: 2000 })
    expect(r.数据.行们.map((行) => 行.行号)).toEqual([2, 3])
  })

  test("方向精确匹配", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 方向: "付" })
    expect(r.数据.行们.map((行) => 行.定位)).toEqual(["m-1#Sheet#1#2", "m-1#Sheet1#3"])
  })

  test("金额区间是闭区间，按 numeric 比（不是字符串比）", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 金额起: "100", 金额止: "500" })
    expect(r.数据.行们.map((行) => 行.金额)).toEqual(["500.00", "100.00"])
  })

  test("账户命中本方账号或对方账号之一；入参先按去横线归一化", async () => {
    const 本方 = await 查明细行(库(), { projectId: 项目, 账户: "6222-0000-0001" })
    expect(本方.数据.行们).toHaveLength(4)
    const 对方 = await 查明细行(库(), { projectId: 项目, 账户: "13800000001" })
    expect(对方.数据.行们.map((行) => 行.定位)).toEqual(["m-1#Sheet1#4", "m-1#Sheet1#2"])
  })

  test("材料 + 时间窗组合，别项目的行不会混进来", async () => {
    const r = await 查明细行(库(), { projectId: 别处, 材料: "m-9" })
    expect(r.数据.行们.map((行) => 行.金额)).toEqual(["999.00"])
  })
})

describe("查明细行 · 游标分页", () => {
  test("限制=2 翻三页，合起来 5 行、不重不漏（含无时间的尾巴）", async () => {
    const 甲 = await 查明细行(库(), { projectId: 项目, 限制: 2 })
    expect(甲.数据.行们).toHaveLength(2)
    expect(甲.数据.下一页游标).not.toBeNull()
    expect(甲.缺口.join("；")).toContain("还有更多")

    const 乙 = await 查明细行(库(), { projectId: 项目, 限制: 2, 游标: 甲.数据.下一页游标 ?? undefined })
    const 丙 = await 查明细行(库(), { projectId: 项目, 限制: 2, 游标: 乙.数据.下一页游标 ?? undefined })

    const 全部 = [...甲.数据.行们, ...乙.数据.行们, ...丙.数据.行们].map((行) => 行.定位)
    expect(全部).toEqual([
      "m-1#Sheet1#4",
      "m-1#Sheet#1#2",
      "m-1#Sheet1#3",
      "m-1#Sheet1#2",
      "m-1#Sheet1#5",
    ])
    expect(new Set(全部).size).toBe(5)
    expect(丙.数据.下一页游标).toBeNull()
  })

  test("恰好取完时不给下一页游标（多取一条才判得出）", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 限制: 5 })
    expect(r.数据.行们).toHaveLength(5)
    expect(r.数据.下一页游标).toBeNull()
  })
})

describe("查明细行 · 游标条件三支（同刻跨页 / 无时间续页）", () => {
  test("限制=1 翻到底：同刻 3 行与无时间 2 行不重不漏", async () => {
    const 收集: string[] = []
    let 游标: string | undefined
    let 页数 = 0
    // 有界循环：游标条件的守卫坏掉时下一页会原地打转；红要红在断言上，不许让用例挂死。
    while (页数 < 20) {
      页数 += 1
      const 页 = await 查明细行(库(), { projectId: 同刻, 限制: 1, 游标 })
      收集.push(...页.数据.行们.map((行) => `${行.材料}/${行.工作表}/${行.行号}`))
      游标 = 页.数据.下一页游标 ?? undefined
      if (游标 === undefined) break
    }
    // 变异①（NULL 段删「键后」）与变异②（同刻 `>` 改 `>=`）都会让游标永远不消失，先红这条。
    expect(游标).toBeUndefined()
    // 变异若只造成重复而没造成死循环，红在长度 / 集合上。
    expect(收集).toHaveLength(5)
    expect(new Set(收集).size).toBe(5)
    // 顺序也钉住：同刻按 (材料, 工作表, 行号) 排，无时间的整段排最后。
    expect(收集).toEqual(["m-同/S/1", "m-同/S/2", "m-同/S/3", "m-同/S/4", "m-同/S/5"])
  })
})

describe("查明细行 · 未解析材料计数口径（与材料视图同一判据）", () => {
  test("同 path 重传：旧行未入队、新行已解析 ⇒ 不得报「份材料未解析」", async () => {
    const r = await 查明细行(库(), { projectId: 重传 })
    expect(r.数据.行们.map((行) => 行.定位)).toEqual(["m-重传新#S#1"])
    expect(r.缺口.join("；")).not.toContain("未解析")
  })

  test("确实有未解析材料时仍提一句（项目里 m-2 未入队）", async () => {
    const r = await 查明细行(库(), { projectId: 项目 })
    expect(r.缺口.join("；")).toContain("还有 1 份材料未解析")
  })
})

describe("查明细行 · 默认限制", () => {
  test("不传限制 ⇒ 取 50 行、给下一页游标、缺口说「已取前 50 行」", async () => {
    const r = await 查明细行(库(), { projectId: 默认 })
    expect(r.数据.行们).toHaveLength(50)
    expect(r.数据.下一页游标).not.toBeNull()
    expect(r.缺口.join("；")).toContain("已取前 50 行")
    expect(r.空原因).toBeNull()
  })
})

describe("查明细行 · 入参 fail-closed", () => {
  test("限制非正整数 ⇒ 明细入参错误", async () => {
    for (const 值 of [0, -1, 1.5]) {
      await expect(查明细行(库(), { projectId: 项目, 限制: 值 })).rejects.toThrow(明细入参错误)
    }
  })

  test("请求超上限 ⇒ 按 200 截断并写缺口，不报错", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 限制: 999 })
    expect(r.缺口.join("；")).toContain("请求的 999 行超过上限，已按 200 行取")
  })

  test("金额串不是 numeric 形状 ⇒ 明细入参错误（不让 PG 抛 22P02 变 500）", async () => {
    await expect(查明细行(库(), { projectId: 项目, 金额起: "1,000" })).rejects.toThrow(明细入参错误)
  })

  test("反向区间 ⇒ 明细入参错误（静默返回 0 行会被读成「确实没有」）", async () => {
    await expect(查明细行(库(), { projectId: 项目, 金额起: "500", 金额止: "100" })).rejects.toThrow(明细入参错误)
    await expect(查明细行(库(), { projectId: 项目, 时间起: 3000, 时间止: 1000 })).rejects.toThrow(明细入参错误)
  })

  test("自造游标 ⇒ 明细入参错误", async () => {
    await expect(查明细行(库(), { projectId: 项目, 游标: "not-a-cursor" })).rejects.toThrow(明细入参错误)
  })

  test("游标整数字段越 integer 范围 ⇒ 明细入参错误（不是 PG 22003 / DrizzleQueryError）", async () => {
    const 造 = (载荷: object) => Buffer.from(JSON.stringify(载荷), "utf8").toString("base64url")
    for (const 载荷 of [
      // row_no 与 started_at 都是 integer(4 字节)
      { t: null, m: "m-1", s: "Sheet1", r: 2147483648 },
      { t: null, m: "m-1", s: "Sheet1", r: 1e21 },
      { t: 2147483648, m: "m-1", s: "Sheet1", r: 1 },
      { t: 1e21, m: "m-1", s: "Sheet1", r: 1 },
    ]) {
      await expect(查明细行(库(), { projectId: 项目, 游标: 造(载荷) })).rejects.toThrow(明细入参错误)
    }
  })

  test("时间入参超出 Date 可表示范围 ⇒ 明细入参错误（不是拼口径时抛 RangeError）", async () => {
    await expect(查明细行(库(), { projectId: 项目, 时间起: 1e13 })).rejects.toThrow(明细入参错误)
    await expect(查明细行(库(), { projectId: 项目, 时间止: -1e13 })).rejects.toThrow(明细入参错误)
  })

  test("方向坏值 ⇒ 明细入参错误（不静默过滤成「无匹配行」）", async () => {
    await expect(
      查明细行(库(), { projectId: 项目, 方向: "进" as unknown as "收" }),
    ).rejects.toThrow(明细入参错误)
  })

  test("材料闸早退不吞掉截断缺口：超过上限与材料未入库同时出现", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 材料: "m-没这号", 限制: 999 })
    const 句 = r.缺口.join("；")
    expect(句).toContain("请求的 999 行超过上限")
    expect(句).toContain("本项目没有这份材料")
    expect(r.空原因).toBe("材料未入库")
  })
})

describe("查明细行 · 口径与出处", () => {
  test("口径写清过滤条件与取值范围", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 材料: "m-1", 方向: "收" })
    expect(r.口径).toContain("材料=m-1")
    expect(r.口径).toContain("方向=收")
    expect(r.口径).toContain("只取已入库明细行")
  })

  test("出处给本页首行的定位，可下钻 get_citation", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 材料: "m-1", 方向: "收" })
    expect(r.出处).toHaveLength(1)
    expect(r.出处[0]?.代表).toBe("m-1#Sheet1#4")
    expect(r.出处[0]?.可下钻).toBe("get_citation")
  })
})
