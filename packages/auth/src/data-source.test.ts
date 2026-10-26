/**
 * 数据源配置存储（010 T012 / FR-011）。
 *
 * 判据只钉**这张表与这几个函数答应的事**：
 * ① 新建即 active、`lastSyncedAt` 为 null（connector 未实现，没人写它）；
 * ② 名称全局唯一（**停用的行也占着名字**——本表没有删除，停用行仍在列表里）；
 * ③ 字段长度上限由 TS 先拦（闭集由 DB CHECK 兜底，路由测里钉）；
 * ④ 编辑是部分更新：没给的字段不动，`created_*` 不动；
 * ⑤ 血缘：注册 / 编辑时登记**上游**，下游由「谁把我当上游」反向推出；
 *    自引用、上游不存在、**成环**三条门在服务端，且成环时整笔事务回滚；
 * ⑥ 给了 `upstreamIds` = 整体替换，没给 = 边一动不动。
 *
 * 秘密字段：本表**没有**连接串 / 密码列（用户 2026-10-26 裁定：connector 未实现，
 * 在库里落明文口令是净风险）。这里连「不存」都钉一条，防止后来者顺手加列。
 *
 * 夹具用**每个用例一个内存 PGlite**（同 `org-tree.test.ts`）：本模块的写入全在事务里，
 * 而 `startProductionDb` 的 socket 夹具把多条连接汇进同一会话，事务后再准备同一句带参
 * SQL 会撞 `42P05`（`db.ts` 的 `PG_POOL_MAX` 注记）——那是夹具残差，不是被测代码的病。
 *
 * 「谁有权限动它」与「写动作有没有落审计」在 opencode 的治理路由测里钉（本文件只测存储）。
 */

import { afterAll, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import {
  createDataSource,
  DataSourceCycleError,
  DataSourceFieldTooLongError,
  DataSourceNameRequiredError,
  DataSourceNameTakenError,
  DataSourceNotFoundError,
  DataSourceSelfLineageError,
  DataSourceUpstreamNotFoundError,
  getDataSourceLineage,
  listDataSources,
  updateDataSource,
} from "./data-source"
import { migrate } from "./migrate"

const NOW = 1_700_000_000

/** 夹具：**一个**内存 PGlite（迁移只跑一次），每个用例开头把它清空——按用例隔离，但不按用例重建库。 */
let client: PGlite | undefined
let shared: ReturnType<typeof drizzle> | undefined

async function freshDb() {
  client ??= new PGlite()
  shared ??= drizzle({ client })
  await migrate(shared)
  await shared.execute(sql`truncate auth.data_source_lineage, auth.data_source`)
  return shared
}

afterAll(async () => {
  await client?.close()
})

type Db = Awaited<ReturnType<typeof freshDb>>

const 建 = (db: Db, overrides: Partial<Parameters<typeof createDataSource>[1]> = {}) =>
  createDataSource(db, {
    name: "话单库",
    kind: "database",
    frequency: "daily",
    endpoint: "pg://10.0.0.8:5432/cdr",
    owner: "科信支队 张三",
    actorId: "u-甲",
    at: NOW,
    ...overrides,
  })

describe("注册", () => {
  test("默认 active；lastSyncedAt 为 null；created/updated 各自写对", async () => {
    const db = await freshDb()
    const row = await 建(db)
    expect(row).toMatchObject({
      name: "话单库",
      kind: "database",
      endpoint: "pg://10.0.0.8:5432/cdr",
      frequency: "daily",
      owner: "科信支队 张三",
      status: "active",
      lastSyncedAt: null,
      createdBy: "u-甲",
      createdAt: NOW,
      updatedBy: "u-甲",
      updatedAt: NOW,
    })
    expect(row.id.length).toBeGreaterThan(0)
  })

  test("名称 / 连接地址 / 负责人首尾空白都被修剪", async () => {
    const db = await freshDb()
    const row = await 建(db, { name: "  社保库  ", endpoint: "  pg://x/sb  ", owner: "  科信 李四  " })
    expect(row.name).toBe("社保库")
    expect(row.endpoint).toBe("pg://x/sb")
    expect(row.owner).toBe("科信 李四")
  })

  test("名称为空 ⇒ DataSourceNameRequiredError", async () => {
    const db = await freshDb()
    await expect(建(db, { name: "   " })).rejects.toBeInstanceOf(DataSourceNameRequiredError)
  })

  test("超长字段 ⇒ DataSourceFieldTooLongError 且点名是哪个字段", async () => {
    const db = await freshDb()
    const name = await 建(db, { name: "名".repeat(101) }).catch((error: unknown) => error)
    expect(name).toBeInstanceOf(DataSourceFieldTooLongError)
    expect((name as DataSourceFieldTooLongError).field).toBe("name")

    const endpoint = await 建(db, { name: "端点超长", endpoint: "x".repeat(501) }).catch((error: unknown) => error)
    expect((endpoint as DataSourceFieldTooLongError).field).toBe("endpoint")

    const owner = await 建(db, { name: "负责人超长", owner: "x".repeat(51) }).catch((error: unknown) => error)
    expect((owner as DataSourceFieldTooLongError).field).toBe("owner")
  })

  test("名称全局唯一；带空格的同名也算撞名", async () => {
    const db = await freshDb()
    await 建(db, { name: "唯一库" })
    await expect(建(db, { name: "唯一库" })).rejects.toBeInstanceOf(DataSourceNameTakenError)
    await expect(建(db, { name: "  唯一库  " })).rejects.toBeInstanceOf(DataSourceNameTakenError)
  })

  test("**停用行也占着名字**（本表没有删除，停用行仍在列表里）", async () => {
    const db = await freshDb()
    const row = await 建(db, { name: "停用也占名", status: "disabled" })
    expect(row.status).toBe("disabled")
    await expect(建(db, { name: "停用也占名" })).rejects.toBeInstanceOf(DataSourceNameTakenError)
  })
})

describe("列表", () => {
  test("按名称升序，停用行也在里面", async () => {
    const db = await freshDb()
    await 建(db, { name: "丁库", status: "disabled" })
    await 建(db, { name: "乙库" })
    await 建(db, { name: "丙库" })
    await 建(db, { name: "甲库" })

    const rows = await listDataSources(db)
    expect(rows.map((row) => row.name)).toEqual(["丁库", "丙库", "乙库", "甲库"].sort())
    expect(rows.find((row) => row.name === "丁库")?.status).toBe("disabled")
  })
})

describe("编辑", () => {
  test("部分更新：只改给了的字段，created_* 不动、updated_* 刷新", async () => {
    const db = await freshDb()
    const row = await 建(db, { name: "待改库" })
    const 改后 = await updateDataSource(db, row.id, {
      owner: "科信 王五",
      status: "disabled",
      actorId: "u-乙",
      at: NOW + 400,
    })
    expect(改后).toMatchObject({
      name: "待改库",
      kind: "database",
      endpoint: "pg://10.0.0.8:5432/cdr",
      frequency: "daily",
      owner: "科信 王五",
      status: "disabled",
      createdBy: "u-甲",
      createdAt: NOW,
      updatedBy: "u-乙",
      updatedAt: NOW + 400,
    })
  })

  test("改回自己的名字不算撞名；改成别人的名字 ⇒ DataSourceNameTakenError", async () => {
    const db = await freshDb()
    const row = await 建(db, { name: "自改库" })
    await 建(db, { name: "别人占的库" })

    expect((await updateDataSource(db, row.id, { name: "自改库", actorId: "u-甲" })).name).toBe("自改库")
    await expect(updateDataSource(db, row.id, { name: "别人占的库", actorId: "u-甲" })).rejects.toBeInstanceOf(
      DataSourceNameTakenError,
    )
  })

  test("不存在的 id ⇒ DataSourceNotFoundError", async () => {
    const db = await freshDb()
    await expect(
      updateDataSource(db, "00000000-0000-4000-8000-000000000000", { owner: "x", actorId: "u-甲" }),
    ).rejects.toBeInstanceOf(DataSourceNotFoundError)
  })
})

describe("血缘", () => {
  test("注册时带上游：上游 / 下游两个方向都推得出来", async () => {
    const db = await freshDb()
    const 银行 = await 建(db, { name: "血缘·银行流水", kind: "file", frequency: "manual" })
    const 清洗 = await 建(db, { name: "血缘·清洗中间库", upstreamIds: [银行.id] })
    const 报告 = await 建(db, { name: "血缘·研判报告库", kind: "api", frequency: "weekly", upstreamIds: [清洗.id] })

    const 清洗线 = await getDataSourceLineage(db, 清洗.id)
    expect(清洗线.upstream.map((node) => node.id)).toEqual([银行.id])
    expect(清洗线.downstream.map((node) => node.id)).toEqual([报告.id])
    expect(清洗线.upstream[0]).toMatchObject({ name: "血缘·银行流水", kind: "file", status: "active" })
    expect(清洗线.source.name).toBe("血缘·清洗中间库")

    const 银行线 = await getDataSourceLineage(db, 银行.id)
    expect(银行线.upstream).toEqual([])
    expect(银行线.downstream.map((node) => node.id)).toEqual([清洗.id])
  })

  test("上游不存在 ⇒ DataSourceUpstreamNotFoundError，且点名那个 id", async () => {
    const db = await freshDb()
    const 孤儿 = await 建(db, { name: "血缘·孤儿" })
    const error = await 建(db, { name: "血缘·挂空", upstreamIds: ["no-such-id"] }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DataSourceUpstreamNotFoundError)
    expect((error as DataSourceUpstreamNotFoundError).upstreamId).toBe("no-such-id")
    expect((await getDataSourceLineage(db, 孤儿.id)).downstream).toEqual([])
  })

  test("上游不存在时，新建的那行也一起回滚（不留半截）", async () => {
    const db = await freshDb()
    await 建(db, { name: "血缘·挂空的兄弟", upstreamIds: ["no-such-id"] }).catch(() => undefined)
    expect(await listDataSources(db)).toEqual([])
  })

  test("把自己登记成上游 ⇒ DataSourceSelfLineageError", async () => {
    const db = await freshDb()
    const row = await 建(db, { name: "血缘·自指" })
    await expect(updateDataSource(db, row.id, { upstreamIds: [row.id], actorId: "u-甲" })).rejects.toBeInstanceOf(
      DataSourceSelfLineageError,
    )
  })

  test("成环 ⇒ DataSourceCycleError（A→B→C，再把 C 登记成 A 的上游）", async () => {
    const db = await freshDb()
    const a = await 建(db, { name: "血缘·环 A" })
    const b = await 建(db, { name: "血缘·环 B", upstreamIds: [a.id] })
    const c = await 建(db, { name: "血缘·环 C", upstreamIds: [b.id] })

    await expect(
      updateDataSource(db, a.id, { name: "血缘·环 A 改名", upstreamIds: [c.id], actorId: "u-甲" }),
    ).rejects.toBeInstanceOf(DataSourceCycleError)
    // 整笔事务回滚：名字没改、边也没留下半截。
    const 线 = await getDataSourceLineage(db, a.id)
    expect(线.source.name).toBe("血缘·环 A")
    expect(线.upstream).toEqual([])
  })

  test("给了 upstreamIds = 整体替换；没给 = 边一动不动；空数组 = 清空", async () => {
    const db = await freshDb()
    const x = await 建(db, { name: "血缘·替换 X" })
    const y = await 建(db, { name: "血缘·替换 Y" })
    const z = await 建(db, { name: "血缘·替换 Z", upstreamIds: [x.id, y.id] })

    const 改成X = await updateDataSource(db, z.id, { upstreamIds: [x.id], actorId: "u-甲" })
    expect(改成X.name).toBe("血缘·替换 Z")
    expect((await getDataSourceLineage(db, z.id)).upstream.map((node) => node.id)).toEqual([x.id])

    await updateDataSource(db, z.id, { owner: "科信", actorId: "u-甲" })
    expect((await getDataSourceLineage(db, z.id)).upstream.map((node) => node.id)).toEqual([x.id])

    await updateDataSource(db, z.id, { upstreamIds: [], actorId: "u-甲" })
    expect((await getDataSourceLineage(db, z.id)).upstream).toEqual([])
  })

  test("重复上游只存一条（主键压重）", async () => {
    const db = await freshDb()
    const x = await 建(db, { name: "血缘·重复 X" })
    const z = await 建(db, { name: "血缘·重复 Z", upstreamIds: [x.id, x.id] })
    expect((await getDataSourceLineage(db, z.id)).upstream.map((node) => node.id)).toEqual([x.id])
  })

  test("停用的数据源仍能查血缘，节点上带着 status", async () => {
    const db = await freshDb()
    const 老库 = await 建(db, { name: "血缘·老库", status: "disabled" })
    const 新库 = await 建(db, { name: "血缘·新库", upstreamIds: [老库.id] })
    const 线 = await getDataSourceLineage(db, 新库.id)
    expect(线.upstream[0]).toMatchObject({ id: 老库.id, status: "disabled" })
  })

  test("坏 id ⇒ DataSourceNotFoundError", async () => {
    const db = await freshDb()
    await expect(getDataSourceLineage(db, "nope")).rejects.toBeInstanceOf(DataSourceNotFoundError)
  })
})

describe("秘密字段", () => {
  test("表里没有连接串 / 密码列（秘密不落库，用户 2026-10-26 裁定）", async () => {
    const db = await freshDb()
    const rows = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = 'data_source'
    `)
    const 列 = (Array.isArray(rows) ? rows : (rows as { rows: Record<string, unknown>[] }).rows).map((row) =>
      String(row.column_name),
    )
    expect(列).not.toContain("secret")
    expect(列).not.toContain("password")
    expect(列).not.toContain("connection_string")
  })
})
