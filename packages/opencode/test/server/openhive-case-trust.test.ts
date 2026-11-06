import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 变更历史 } from "../../src/server/openhive/case-fact-change"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 裁决 } from "../../src/server/openhive/case-trust"
import { 建关系, 建实体, 建事件, 读一列 } from "./openhive-case-fact-fixture"

/**
 * 裁决的库级用例（计划 5 Task 3）。
 *
 * `裁决` 走 `inTransaction` ⇒ 按 R-预2 把池留 1 条：PGlite 把多条连接汇进同一个 PG
 * 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05（`db.ts` 的 `PG_POOL_MAX` 注记）。
 *
 * ⚠️ **不能用夹具自带的 `pg.db`**：`startProductionDb()` 给它自己那个客户端传的是固定
 * env（不含 `PG_POOL_MAX`），在 `process.env` 里配不进去（`case-ingest.test.ts:19-22`）。
 * 所以走生产入口 `connect()` 自建一份，形状仍是「一个进程、一条连接」。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目 = "p-裁决"
const 甲 = "u-裁决-甲"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲}, '970021', '甲民警', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

async function 新关系(id: string): Promise<void> {
  await 建实体(库(), { id: `${id}-a`, projectId: 项目, value: `${id}-甲` })
  await 建实体(库(), { id: `${id}-b`, projectId: 项目, value: `${id}-乙` })
  await 建关系(库(), { id, projectId: 项目, fromId: `${id}-a`, toId: `${id}-b`, amount: 100 })
}

describe("裁决：三态", () => {
  test("确认 ⇒ 已确认，留痕记了前态与操作人", async () => {
    await 新关系("r-确认")
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-确认",
      action: "确认",
      by: 甲,
    })
    expect(结果.trustState).toBe("已确认")
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-确认" })
    expect(详情?.trustState).toBe("已确认")
    expect(详情?.changes).toHaveLength(1)
    expect(详情?.changes[0]?.before).toEqual({ trustState: "自动抽取" })
    expect(详情?.changes[0]?.actorName).toBe("甲民警")
  })

  test("排除必须带原因与一句话；缺一样都 409 bad_changes", async () => {
    await 新关系("r-排除-缺")
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-排除-缺", action: "排除", by: 甲 }),
    ).rejects.toMatchObject({ code: "bad_changes" })
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-排除-缺",
        action: "排除",
        reasonKind: "抽取错",
        reasonText: "   ",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("排除带上原因 ⇒ 已排除，且默认读不到了", async () => {
    await 新关系("r-排除-好")
    await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-排除-好",
      action: "排除",
      reasonKind: "识别错",
      reasonText: "这笔不是转账，是取现",
      by: 甲,
    })
    expect(await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-排除-好" })).toBeUndefined()
    const 带上 = await 事实详情(库(), {
      projectId: 项目,
      type: "relation",
      id: "r-排除-好",
      includeExcluded: true,
    })
    expect(带上?.trustState).toBe("已排除")
    expect(带上?.changes[0]?.reasonKind).toBe("识别错")
  })

  test("存疑 ⇒ 存疑；「存疑」不需要原因", async () => {
    await 新关系("r-存疑")
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-存疑",
      action: "存疑",
      by: 甲,
    })
    expect(结果.trustState).toBe("存疑")
  })

  test("事件也能裁决：存疑 落在 case_event 上，留痕动作与快照齐全", async () => {
    // 单测此前只走 relation、出口只走 entity：event 分支的列名（summary / occurred_at /
    // precision）写错会全绿。这条走 裁决 把 event 的「读当前值」与「改」都真跑一遍。
    await 建事件(库(), {
      id: "e-存疑",
      projectId: 项目,
      type: "通话",
      participants: ["张三", "李四"],
    })
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "event",
      factId: "e-存疑",
      action: "存疑",
      by: 甲,
    })
    expect(结果.trustState).toBe("存疑")
    // 直接查库：结果对象里的 trustState 是目标值直传，钉不住 UPDATE 真落了 case_event。
    const 行 = rowsOf(
      await 库().execute(
        sql`select trust_state from auth.case_event where id = ${"e-存疑"} and project_id = ${项目}`,
      ),
    )
    expect(行.map((一条) => String(一条.trust_state))).toEqual(["存疑"])
    const 历史 = await 变更历史(库(), 项目, "event", "e-存疑")
    expect(历史.at(-1)?.action).toBe("存疑")
    expect(历史.at(-1)?.before).toEqual({ trustState: "自动抽取" })
    expect(历史.at(-1)?.after).toEqual({ trustState: "存疑" })
  })

  test("任意状态都能直接改（人优先于系统判定）", async () => {
    await 新关系("r-来回")
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-来回", action: "确认", by: 甲 })
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-来回", action: "存疑", by: 甲 })
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-来回",
      action: "确认",
      by: 甲,
    })
    expect(结果.trustState).toBe("已确认")
    expect(await 变更历史(库(), 项目, "relation", "r-来回")).toHaveLength(3)
  })

  test("事实不存在 ⇒ 409 fact_not_found，且不留半条留痕", async () => {
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-无", action: "确认", by: 甲 }),
    ).rejects.toMatchObject({ code: "fact_not_found" })
    expect(await 变更历史(库(), 项目, "relation", "r-无")).toEqual([])
  })

  test("项目隔离：别的项目改不到", async () => {
    await 新关系("r-隔离")
    await expect(
      裁决(库(), { projectId: "p-别处", factType: "relation", factId: "r-隔离", action: "确认", by: 甲 }),
    ).rejects.toMatchObject({ code: "fact_not_found" })
  })
})

describe("修正：白名单字段", () => {
  test("改金额 ⇒ 已修正，留痕的前值是旧值", async () => {
    await 新关系("r-改额")
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-改额",
      action: "修正",
      changes: { amount: 1000 },
      reasonKind: "抽取错",
      reasonText: "少看了一个零",
      by: 甲,
    })
    expect(结果.trustState).toBe("已修正")
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-改额" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.amount).toBe(1000)
    expect(详情.trustState).toBe("已修正")
    expect(详情.changes[0]?.before).toEqual({
      trustState: "自动抽取",
      amount: 100,
      basis: null,
      relationType: "转账",
    })
  })

  test("不认识的字段 ⇒ 409 bad_changes，一个字都不改", async () => {
    await 新关系("r-瞎改")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-瞎改",
        action: "修正",
        changes: { 金额: 999 },
        reasonKind: "抽取错",
        reasonText: "手滑",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
    // 「一个字都不改」要断到值，不能只看状态：`amount` 被写回成别的值、或留痕偷记一条
    // 都会被状态断言漏掉。
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-瞎改" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.trustState).toBe("自动抽取")
    expect(详情.amount).toBe(100)
    expect(await 变更历史(库(), 项目, "relation", "r-瞎改")).toHaveLength(0)
  })

  test("修正也必须带原因", async () => {
    await 新关系("r-改无因")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-改无因",
        action: "修正",
        changes: { amount: 1 },
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("原因：有 kind 但 text 只有空白 ⇒ 409 bad_changes", async () => {
    await 新关系("r-空白因")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-空白因",
        action: "修正",
        changes: { amount: 200 },
        reasonKind: "抽取错",
        reasonText: "   ",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("原因：有 text 但缺 kind ⇒ 409 bad_changes", async () => {
    await 新关系("r-缺kind")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-缺kind",
        action: "修正",
        changes: { amount: 200 },
        reasonText: "写了话但没选原因",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("完全不传 changes 键 ⇒ 409 bad_changes（不是 500）", async () => {
    await 新关系("r-没键")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-没键",
        action: "修正",
        reasonKind: "抽取错",
        reasonText: "漏了 changes",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-没键" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.amount).toBe(100)
  })

  test("changes 里的 undefined 不静默清列", async () => {
    // JSON 表达不出 undefined，只有内部直调用者会传；若它进了 `新值`，`写回` 会按 null
    // 把金额清掉。这里直接调 DAO（不经路由）钉住这条路径。
    await 新关系("r-undefined")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-undefined",
        action: "修正",
        changes: { amount: undefined },
        reasonKind: "抽取错",
        reasonText: "漏填金额",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-undefined" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.amount).toBe(100)
    expect(详情.trustState).toBe("自动抽取")
  })

  test("金额为负或不是有限数 ⇒ 409 bad_changes", async () => {
    await 新关系("r-负数")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-负数",
        action: "修正",
        changes: { amount: -1 },
        reasonKind: "抽取错",
        reasonText: "试一下",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("改成「实际使用」却没给依据 ⇒ 409 basis_required", async () => {
    await 新关系("r-缺依据")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-缺依据",
        action: "修正",
        changes: { relationType: "实际使用" },
        reasonKind: "抽取错",
        reasonText: "其实是他在用",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "basis_required" })
  })

  test("改成「实际使用」并同时给依据 ⇒ 成", async () => {
    await 新关系("r-有依据")
    await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-有依据",
      action: "修正",
      changes: { relationType: "实际使用", basis: "登录或使用日志" },
      reasonKind: "抽取错",
      reasonText: "补上认定依据",
      by: 甲,
    })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-有依据" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.relationType).toBe("实际使用")
    expect(详情.basis).toBe("登录或使用日志")
  })

  test("实体改名撞上已存在的同名实体 ⇒ 409 merge_required（不自动合并）", async () => {
    await 建实体(库(), { id: "e-撞-1", projectId: 项目, value: "重名甲" })
    await 建实体(库(), { id: "e-撞-2", projectId: 项目, value: "重名乙" })
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "entity",
        factId: "e-撞-2",
        action: "修正",
        changes: { canonicalValue: "重名甲" },
        reasonKind: "抽取错",
        reasonText: "其实是同一个人",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "merge_required" })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-撞-2" })
    if (详情?.type !== "entity") throw new Error("形状不对")
    expect(详情.canonicalValue).toBe("重名乙")
  })

  test("实体改类型：号码改账户 ⇒ 成", async () => {
    await 建实体(库(), { id: "e-改型", projectId: 项目, type: "号码", value: "6222..." })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-改型",
      action: "修正",
      changes: { entityType: "账户" },
      reasonKind: "识别错",
      reasonText: "这是银行卡号不是手机号",
      by: 甲,
    })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-改型" })
    if (详情?.type !== "entity") throw new Error("形状不对")
    expect(详情.entityType).toBe("账户")
  })

  test("事件改摘要与规范时间 ⇒ 成，原始值不让改", async () => {
    await 建事件(库(), { id: "ev-改", projectId: 项目, summary: "旧摘要", occurredAt: 100 })
    await 裁决(库(), {
      projectId: 项目,
      factType: "event",
      factId: "ev-改",
      action: "修正",
      changes: { summary: "新摘要", occurredAt: 200 },
      reasonKind: "抽取错",
      reasonText: "时间认错了",
      by: 甲,
    })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "event", id: "ev-改" })
    if (详情?.type !== "event") throw new Error("形状不对")
    expect(详情.summary).toBe("新摘要")
    expect(详情.occurredAt).toBe(200)
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "event",
        factId: "ev-改",
        action: "修正",
        changes: { occurredRaw: "改原文" },
        reasonKind: "抽取错",
        reasonText: "试试",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("changes 为空 ⇒ 409 bad_changes", async () => {
    await 新关系("r-空改")
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-空改",
        action: "修正",
        changes: {},
        reasonKind: "抽取错",
        reasonText: "空",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })
})

describe("撤销", () => {
  test("撤销一次确认 ⇒ 回到自动抽取，并留下「撤销」这一条", async () => {
    await 新关系("r-撤确认")
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤确认", action: "确认", by: 甲 })
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-撤确认",
      action: "撤销",
      by: 甲,
    })
    expect(结果.trustState).toBe("自动抽取")
    const 历史 = await 变更历史(库(), 项目, "relation", "r-撤确认")
    expect(历史.map((条) => 条.action)).toEqual(["确认", "撤销"])
  })

  test("撤销一次修正 ⇒ 值与状态都回到修正前", async () => {
    await 新关系("r-撤修正")
    await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-撤修正",
      action: "修正",
      changes: { amount: 5000 },
      reasonKind: "抽取错",
      reasonText: "多打了一个零",
      by: 甲,
    })
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤修正", action: "撤销", by: 甲 })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-撤修正" })
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.amount).toBe(100)
    expect(详情.trustState).toBe("自动抽取")
  })

  test("撤销一次实体修正 ⇒ 规范值与类型都恢复（直接查库）", async () => {
    await 建实体(库(), { id: "e-撤恢复", projectId: 项目, type: "号码", value: "原号" })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-撤恢复",
      action: "修正",
      changes: { canonicalValue: "改后号", entityType: "账户" },
      reasonKind: "识别错",
      reasonText: "先改成账户",
      by: 甲,
    })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-撤恢复", action: "撤销", by: 甲 })
    // 直接查库：只看 trustState 的话，`写回` 漏写 canonical_value / type 也照样绿。
    const 行 = rowsOf(
      await 库().execute(
        sql`select canonical_value, type, trust_state from auth.case_entity where project_id = ${项目} and id = ${"e-撤恢复"}`,
      ),
    )[0]
    expect(String(行?.canonical_value)).toBe("原号")
    expect(String(行?.type)).toBe("号码")
    expect(String(行?.trust_state)).toBe("自动抽取")
  })

  test("撤销一次事件修正 ⇒ 摘要 / 规范时间 / 精度都恢复（直接查库）", async () => {
    await 建事件(库(), { id: "ev-撤恢复", projectId: 项目, summary: "旧摘要", occurredAt: 100 })
    await 库().execute(
      sql`update auth.case_event set precision = ${"到分"} where project_id = ${项目} and id = ${"ev-撤恢复"}`,
    )
    await 裁决(库(), {
      projectId: 项目,
      factType: "event",
      factId: "ev-撤恢复",
      action: "修正",
      changes: { summary: "新摘要", occurredAt: 200, precision: "到秒" },
      reasonKind: "抽取错",
      reasonText: "三个字段一起改",
      by: 甲,
    })
    await 裁决(库(), { projectId: 项目, factType: "event", factId: "ev-撤恢复", action: "撤销", by: 甲 })
    const 行 = rowsOf(
      await 库().execute(
        sql`select summary, occurred_at, precision, trust_state from auth.case_event where project_id = ${项目} and id = ${"ev-撤恢复"}`,
      ),
    )[0]
    expect(String(行?.summary)).toBe("旧摘要")
    expect(Number(行?.occurred_at)).toBe(100)
    expect(String(行?.precision)).toBe("到分")
    expect(String(行?.trust_state)).toBe("自动抽取")
  })

  test("撤销时恢复的名字已被占用 ⇒ 409 merge_required，且写回失败不半改", async () => {
    // 确定性可达，不需要并发：把实体改走旧名、再把旧名让给另一个实体，撤销就必然撞
    // `case_entity_canonical` 唯一索引（23505）。这条同时实测 `pgErrorCode` 能在事务内
    // 钻穿 drizzle 的 `cause`。
    await 建实体(库(), { id: "e-撤撞", projectId: 项目, value: "原件名" })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-撤撞",
      action: "修正",
      changes: { canonicalValue: "新件名" },
      reasonKind: "抽取错",
      reasonText: "先改名让出旧名",
      by: 甲,
    })
    await 建实体(库(), { id: "e-占名", projectId: 项目, value: "原件名" })
    await expect(
      裁决(库(), { projectId: 项目, factType: "entity", factId: "e-撤撞", action: "撤销", by: 甲 }),
    ).rejects.toMatchObject({ code: "merge_required" })

    const 行 = rowsOf(
      await 库().execute(
        sql`select canonical_value, trust_state from auth.case_entity where project_id = ${项目} and id = ${"e-撤撞"}`,
      ),
    )[0]
    expect(String(行?.canonical_value)).toBe("新件名")
    expect(String(行?.trust_state)).toBe("已修正")
    // 失败的撤销不能留下一条「撤销」留痕（写回在记变更之前）。
    expect(await 变更历史(库(), 项目, "entity", "e-撤撞")).toHaveLength(1)
  })

  test("第二次撤销 ⇒ 409 nothing_to_undo（同一条不能撤销两次）", async () => {
    await 新关系("r-撤两次")
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤两次", action: "确认", by: 甲 })
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤两次", action: "撤销", by: 甲 })
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤两次", action: "撤销", by: 甲 }),
    ).rejects.toMatchObject({ code: "nothing_to_undo" })
  })

  test("从没被人动过 ⇒ 409 nothing_to_undo", async () => {
    await 新关系("r-没动过")
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-没动过", action: "撤销", by: 甲 }),
    ).rejects.toMatchObject({ code: "nothing_to_undo" })
  })
})

/**
 * 夹具自检：`读一列` 若恒返回空数组，「查不到」的断言（`toEqual([])` /
 * `toHaveLength(0)`）就会永远绿——这正是后续 Task 4–7 最容易踩的假绿。
 */
describe("夹具自检", () => {
  test("读一列 真能读到值（防止恒空导致的假绿）", async () => {
    const 值 = await 读一列(库(), sql`select count(*) from auth.user where id = ${甲}`)
    expect(值.map((一个) => Number(一个))).toEqual([1])
  })
})
