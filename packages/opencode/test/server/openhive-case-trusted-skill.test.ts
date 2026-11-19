import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 自动入队开, 写设置, 读设置 } from "../../src/server/openhive/case-ingest-settings"
import { 列白名单, 加白名单, 撤白名单, 自动启用可信技能 } from "../../src/server/openhive/case-trusted-skill"

/**
 * 016 T014：可信技能白名单 ＋ 项目开关 ＋ 自动启用。
 *
 * 真库（PGlite）＋ `migrate`，harness 与 `openhive-case-ingest.test.ts` 同形：
 * 被测代码、夹具、断言**共用一个客户端**（`PG_POOL_MAX=1`，PGlite 的预编译语句是实例级的，
 * 第二个客户端会撞 42P05——见 `@opencode-ai/auth/test-support` 的文件头）。
 *
 * 每条用例用**独立的 project / asset id**，互不依赖跑序；审计与启用行都按 id 过滤断言。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)

  for (const [id, policeNo, name] of [
    ["u_t014_admin", "020701", "管理员"],
    ["u_t014_owner", "020702", "属主"],
    ["u_t014_member", "020703", "成员"],
  ] as const) {
    await 库.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${policeNo}, ${name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
    `)
  }
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

const 管理员 = "u_t014_admin"
const 属主 = "u_t014_owner"

/** 造资产：列集照 `openhive-access-skill-visible.test.ts` 的 `insertAsset`（最小可发布集）。 */
async function 造资产(输入: { id: string; name: string; type?: string; status?: string }) {
  const type = 输入.type ?? "skill"
  const status = 输入.status ?? "published"
  await db().execute(sql`
    insert into auth.asset
      (id, name, type, description, icon, category, owner_id, owner_name, department,
       visibility, status, created_at, updated_at, published_at)
    values
      (${输入.id}, ${输入.name}, ${type}, '夹具', 'skill', 'intelligence', ${管理员}, '夹具',
       '', 'global', ${status}, 1000, 1000, ${status === "published" ? 1000 : null})
  `)
}

async function 白名单行数(assetId: string) {
  const 结果 = await db().execute(sql`
    select count(*) as n from auth.trusted_skill where asset_id = ${assetId}
  `)
  return Number(rowsOf(结果)[0]?.n ?? 0)
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null
}

describe("T014 可信技能白名单 / 项目开关 / 自动启用", () => {
  it("1 默认关闭：无设置行 ⇒ 自动入队开、自动启用关、updatedAt=null", async () => {
    const 设置 = await 读设置(db(), "p_t014_default")
    expect(设置.autoEnqueue).toBe(true)
    expect(设置.autoEnableTrusted).toBe(false)
    expect(设置.updatedAt === null).toBe(true)
    // T004 的读口行为保持不变（行缺失 ⇒ true）。
    expect(await 自动入队开(db(), "p_t014_default")).toBe(true)

    // 默认关闭的**行为**：即使资产可信且已发布，开关缺省也不自动启用。
    const 项目 = "p_t014_default"
    const 资产 = "asset_t014_default"
    await 造资产({ id: 资产, name: "默认关闭技能" })
    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    let 启用调用 = 0
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [资产],
      操作人是属主: true,
      启用: async () => {
        启用调用 += 1
        return { ok: true as const, 结果: "enabled" as const }
      },
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.跳过[0]?.原因).toBe("自动启用开关关闭")
    // 更直接：开关关着时注入的启用**一次都不该被调**（不再是「库里没有启用行」——
    // 启用行现在由注入实现自己写，模块根本不碰表）。
    expect(启用调用).toBe(0)
  })

  it("2 白名单内零确认：已发布的可信技能自动启用并落启用行", async () => {
    const 项目 = "p_t014_trusted"
    const 资产 = "asset_t014_trusted"
    await 造资产({ id: 资产, name: "可信技能" })

    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)
    if (!写.ok) return
    expect(写.设置.autoEnableTrusted).toBe(true)

    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })

    const 条目 = (await 列白名单(db())).find((行) => 行.assetId === 资产)
    if (条目 === undefined) throw new Error("白名单里没有刚加入的资产")
    expect(条目.name).toBe("可信技能")
    expect(条目.status).toBe("published")
    expect(条目.addedBy).toBe(管理员)

    let 启用调用 = 0
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [资产],
      操作人是属主: true,
      启用: async () => {
        启用调用 += 1
        return { ok: true as const, 结果: "enabled" as const }
      },
    })
    expect(结果.已启用).toEqual([资产])
    expect(结果.跳过.length).toBe(0)
    expect(结果.失败.length).toBe(0)
    expect(启用调用).toBe(1)

    // FR-063：真启用 ⇒ 一条 `case.trusted_skill.auto_enable` 审计（裸 SQL 读表）。
    const 审计 = rowsOf(
      await db().execute(sql`
        select action, target_id, detail from auth.audit_event
         where action = 'case.trusted_skill.auto_enable' and target_id = ${资产}
      `),
    )
    expect(审计.length).toBe(1)
    expect(String(审计[0]?.detail)).toContain(资产)
  })

  it("3 白名单外仍提示：跳过、不调内核、不建启用行", async () => {
    const 项目 = "p_t014_outside"
    const 资产 = "asset_t014_outside"
    await 造资产({ id: 资产, name: "未入白名单技能" })
    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)

    let 启用调用 = 0
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [资产],
      操作人是属主: true,
      启用: async () => {
        启用调用 += 1
        return { ok: true as const, 结果: "enabled" as const }
      },
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.跳过.length).toBe(1)
    expect(结果.跳过[0]?.原因).toBe("不在白名单（仍需提示）")
    expect(结果.失败.length).toBe(0)
    expect(启用调用).toBe(0)
  })

  it("4 上限由注入实现判定：`!ok` ⇒ 失败（原因取 error）", async () => {
    const 项目 = "p_t014_limit"
    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)

    const 第二十一 = "asset_t014_limit_20"
    await 造资产({ id: 第二十一, name: "第 21 个技能" })
    expect(await 加白名单(db(), { assetId: 第二十一, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })

    // 原用例靠真 `enableAsset` 撞 20 上限；上限已随「一份启用实现」进入注入的 `启用`
    // （`project-assets.ts` 的 `完整启用` 把 `limit_reached` 翻成 `{ok:false, error}`）。
    // 本模块负责的是：`!ok` ⇒ 进 `失败`，原因取注入实现的 `error`。
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [第二十一],
      操作人是属主: true,
      启用: async () => ({ ok: false as const, error: "项目启用数已达上限" }),
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.失败.length).toBe(1)
    expect(结果.失败[0]?.原因).toBe("项目启用数已达上限")
  })

  it("5 非管理员 403：服务端判 + 写入校验三种码", async () => {
    const 已发布 = "asset_t014_guard_published"
    const 草稿 = "asset_t014_guard_draft"
    const 非技能 = "asset_t014_guard_mcp"
    await 造资产({ id: 已发布, name: "守卫技能" })
    await 造资产({ id: 草稿, name: "守卫草稿", status: "draft" })
    await 造资产({ id: 非技能, name: "守卫 MCP", type: "mcp" })

    expect(await 加白名单(db(), { assetId: 已发布, userId: 管理员, 操作人是管理员: false })).toEqual({
      ok: false,
      code: "forbidden",
    })
    expect(await 白名单行数(已发布)).toBe(0)

    expect(await 加白名单(db(), { assetId: "asset_t014_guard_missing", userId: 管理员, 操作人是管理员: true })).toEqual({
      ok: false,
      code: "asset_not_found",
    })
    expect(await 加白名单(db(), { assetId: 草稿, userId: 管理员, 操作人是管理员: true })).toEqual({
      ok: false,
      code: "asset_not_published",
    })
    expect(await 加白名单(db(), { assetId: 非技能, userId: 管理员, 操作人是管理员: true })).toEqual({
      ok: false,
      code: "asset_not_skill",
    })

    expect(await 加白名单(db(), { assetId: 已发布, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    expect(await 白名单行数(已发布)).toBe(1)
    // 幂等：重复加仍是 ok，不新增行。
    expect(await 加白名单(db(), { assetId: 已发布, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    expect(await 白名单行数(已发布)).toBe(1)

    expect(await 撤白名单(db(), { assetId: 已发布, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    expect(await 白名单行数(已发布)).toBe(0)
    // 幂等：撤不存在的条目仍 ok。
    expect(await 撤白名单(db(), { assetId: 已发布, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
  })

  it("6 变更留痕：写设置 / 加白名单 各一行，detail 含改前改后", async () => {
    const 项目 = "p_t014_audit"
    const 资产 = "asset_t014_audit"
    await 造资产({ id: 资产, name: "留痕技能" })

    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)
    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })

    const 设置审计 = rowsOf(
      await db().execute(sql`
        select result, detail from auth.audit_event
         where action = 'case.ingest_settings' and target_id = ${项目}
      `),
    )
    expect(设置审计.length).toBe(1)
    expect(String(设置审计[0]?.result)).toBe("ok")
    const 设置明细: unknown = JSON.parse(String(设置审计[0]?.detail))
    if (!是对象(设置明细)) throw new Error("设置审计 detail 不是对象")
    if (!是对象(设置明细["改前"]) || !是对象(设置明细["改后"])) throw new Error("设置审计缺 改前/改后")
    expect(设置明细["改前"]["autoEnableTrusted"]).toBe(false)
    expect(设置明细["改后"]["autoEnableTrusted"]).toBe(true)

    const 白名单审计 = rowsOf(
      await db().execute(sql`
        select result, detail from auth.audit_event
         where action = 'case.trusted_skill.add' and target_id = ${资产}
      `),
    )
    expect(白名单审计.length).toBe(1)
    expect(String(白名单审计[0]?.result)).toBe("ok")
    const 白名单明细: unknown = JSON.parse(String(白名单审计[0]?.detail))
    if (!是对象(白名单明细)) throw new Error("白名单审计 detail 不是对象")
    expect(白名单明细["assetId"]).toBe(资产)
  })

  it("7 下线后不自动启用：白名单条目失效于 published 复判", async () => {
    const 项目 = "p_t014_draft"
    const 资产 = "asset_t014_draft"
    await 造资产({ id: 资产, name: "会下线的技能" })
    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)
    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    await db().execute(sql`update auth.asset set status = 'draft' where id = ${资产}`)

    let 启用调用 = 0
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [资产],
      操作人是属主: true,
      启用: async () => {
        启用调用 += 1
        return { ok: true as const, 结果: "enabled" as const }
      },
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.失败.length).toBe(1)
    expect(结果.失败[0]?.原因).toBe("资产未发布（白名单条目已失效）")
    expect(启用调用).toBe(0)
  })

  it("8 非属主写设置：forbidden，行不变", async () => {
    const 项目 = "p_t014_owner"
    const 首次 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnqueue: false,
    })
    expect(首次.ok).toBe(true)

    expect(
      await 写设置(db(), {
        projectId: 项目,
        userId: "u_t014_member",
        操作人是属主: false,
        autoEnqueue: true,
      }),
    ).toEqual({ ok: false, code: "forbidden" })

    expect((await 读设置(db(), 项目)).autoEnqueue).toBe(false)
  })

  it("9 未传的键保留原值：只改 autoEnableTrusted 不把 autoEnqueue 写回默认", async () => {
    const 项目 = "p_t014_partial"
    const 首次 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnqueue: false,
    })
    expect(首次.ok).toBe(true)

    const 二次 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(二次.ok).toBe(true)
    if (!二次.ok) return
    expect(二次.设置.autoEnqueue).toBe(false)
    expect(二次.设置.autoEnableTrusted).toBe(true)
  })

  it("10 非属主不自动启用：权限先于一切副作用", async () => {
    const 项目 = "p_t014_not_owner"
    const 资产 = "asset_t014_not_owner"
    await 造资产({ id: 资产, name: "非属主技能" })
    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })
    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)

    let 启用调用 = 0
    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: "u_t014_member",
      资产id们: [资产],
      操作人是属主: false,
      启用: async () => {
        启用调用 += 1
        return { ok: true as const, 结果: "enabled" as const }
      },
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.跳过[0]?.原因).toBe("非项目属主不能自动启用")
    expect(启用调用).toBe(0)
  })

  it("11 已启用：注入实现回 already_enabled ⇒ 进跳过，不推「已启用」、不留审计", async () => {
    const 项目 = "p_t014_already"
    const 资产 = "asset_t014_already"
    await 造资产({ id: 资产, name: "已经装过的技能" })
    const 写 = await 写设置(db(), {
      projectId: 项目,
      userId: 属主,
      操作人是属主: true,
      autoEnableTrusted: true,
    })
    expect(写.ok).toBe(true)
    expect(await 加白名单(db(), { assetId: 资产, userId: 管理员, 操作人是管理员: true })).toEqual({ ok: true })

    const 结果 = await 自动启用可信技能(db(), {
      projectId: 项目,
      userId: 属主,
      资产id们: [资产],
      操作人是属主: true,
      启用: async () => ({ ok: true as const, 结果: "already_enabled" as const }),
    })
    expect(结果.已启用.length).toBe(0)
    expect(结果.失败.length).toBe(0)
    expect(结果.跳过).toEqual([{ assetId: 资产, 原因: "已启用" }])

    // 没有「这次真的启用了」，就不该有那条审计。
    const 审计 = rowsOf(
      await db().execute(sql`
        select 1 from auth.audit_event
         where action = 'case.trusted_skill.auto_enable' and target_id = ${资产}
      `),
    )
    expect(审计.length).toBe(0)
  })
})
