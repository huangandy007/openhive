export * as OpenhiveAssetUsage from "./asset-usage"

/**
 * 资产使用记录（2026-10-29）：从每用户 SQLite 的 `part` 表增量抽取**已完成的 skill 调用**，
 * 归因到项目里唯一的同名已启用资产，落到 PG 事实表（`0024`）。
 *
 * ## 为什么源是 part 表
 *
 * 初版设计写的是 `session.next.tool.called` durable 事件。真栈实测推翻了：部署中的
 * v1 内核（1.19.3）的 `event` 表里**没有任何 `session.next.*`**，工具调用落在 `part` 表
 * （`data.tool` / `data.state.status` / `data.state.input`）。证据与取舍见设计 §2 的修订段。
 *
 * ## 为什么在数据源里算，不在读接口里算
 *
 * 与 `governance/analytics.ts` 同一条理由：每用户库是事件溯源，按类型过滤就是全表扫；
 * 看板每次打开都扫全部用户库 = 成本随历史线性增长。抽取一次落表，之后按时间水位（秒）增量读。
 *
 * ## 三件守住正确性的事
 *
 * 1. **幂等键是（user_id, part_id）**：回看 60 秒重扫到的行被主键吃掉，不会翻倍。
 * 2. **只认 completed**：技能正文只有成功时才回到模型上下文。「AI 读了」= 真读到，
 *    running / error 不算（设计 §2 的口径）。
 * 3. **归因缺一条就不归因**：0 条同名 / ≥2 条同名都只计 `unattributed`，不入表——
 *    同名 skill 的赢家本身随到达顺序漂（`LEARNINGS #010-05`），猜一个就是把错数写进报表。
 *
 * ## 失败不假装成 0（`LEARNINGS #002-02`）
 *
 * 单个用户库打不开 / 解析失败 ⇒ `console.warn` ＋ **不推进该用户游标** ＋ 继续下一个人。
 */

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import type { connect } from "@opencode-ai/auth/db"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { userDatabasePath } from "@opencode-ai/core/database/router"
import { sql } from "drizzle-orm"

/** 详情页「最近 N 天」的窗口（2026-10-29 用户裁定：30 天更妥）。 */
export const WINDOW_DAYS = 30

/** 触发节流：距上次抽取不足这么久就复用上次结果。 */
export const 节流ms = 60_000

/**
 * 游标回看：`part.time_updated` 水位往前多看这么久。
 *
 * 兜两种事：① 第一次扫到时还是 `running`、完成态晚到的行；② 同一毫秒批量写入时水位推进
 * 边界上的行。重扫的代价被幂等主键吃掉。
 */
export const 回看ms = 60_000

const SKILL_TOOL = "skill"

type Db = ReturnType<typeof connect>

export interface 抽取输入 {
  readonly db: Db
  /** 每用户库的根（`OPENHIVE_DATA_ROOT`，**不是**沙箱根）。 */
  readonly root: string
  /** Unix 秒；测试注入。 */
  readonly now?: number
}

export interface 抽取结果 {
  readonly scanned: number
  readonly inserted: number
  /** 源里有 skill 调用但归不了因的条数（0 条同名 / 多条同名 / 会话缺失 / 名字不是串）。 */
  readonly unattributed: number
  /** 没有源库（或还没有 part 表）的用户 id；跳过不算失败。 */
  readonly missing: readonly string[]
}

interface 使用人 {
  readonly id: string
  readonly org: string
  readonly dept: string
  readonly section: string
}

function 文本(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** 列值到字符串：非字符串一律空串（`String(unknown)` 会把对象串成 `[object Object]`）。 */
function 字符串(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * 源库里一次 skill 调用的可读面。
 *
 * 只取需要的三列、不取整份 `data`：工具 output 全文可能很大，`.all()` 是同步的，
 * 把整段 JSON 读进内存既抬峰值又阻塞事件循环。`json_extract` 让 SQLite 侧就削掉。
 */
interface 调用行 {
  readonly id: string
  readonly session_id: string
  readonly time_created: number
  readonly time_updated: number
  readonly status: string | null
  readonly name: string | null
  readonly call_id: string | null
}

/**
 * 抽取一轮（全部用户）。返回统计，不抛业务错——单用户失败只跳过他自己。
 */
export async function 抽取(input: 抽取输入): Promise<抽取结果> {
  const now = input.now ?? Math.floor(Date.now() / 1000)

  const 名册: 使用人[] = rowsOf(
    await input.db.execute(sql`select id, org, dept, section from auth.user`),
  ).map((row) => ({
    id: String(row["id"]),
    org: 字符串(row["org"]),
    dept: 字符串(row["dept"]),
    section: 字符串(row["section"]),
  }))

  // 全量启用台账一次读进来：抽取里同一个项目会被问上百次，逐行查库是白给。
  // 形状：projectId → 资产名 → assetId[]（长度 > 1 = 不可归因，见文件头第 3 条）。
  const 台账 = new Map<string, Map<string, string[]>>()
  for (const row of rowsOf(
    await input.db.execute(sql`
      select e.project_id as project_id, a.id as asset_id, a.name as name
      from auth.project_asset_enablement e
      join auth.asset a on a.id = e.asset_id
    `),
  )) {
    const projectId = String(row["project_id"])
    const name = String(row["name"])
    const 按名 = 台账.get(projectId) ?? new Map<string, string[]>()
    const ids = 按名.get(name) ?? []
    ids.push(String(row["asset_id"]))
    按名.set(name, ids)
    台账.set(projectId, 按名)
  }

  let scanned = 0
  let inserted = 0
  let unattributed = 0
  const missing: string[] = []

  for (const 人 of 名册) {
    let 源: Database | undefined
    try {
      // `userDatabasePath` 会校验路径段（可能会抛）——放进 try 里，一个坏 id 不能打断其他人。
      const 路径 = userDatabasePath(input.root, 人.id)
      if (!existsSync(路径)) {
        missing.push(人.id)
        continue
      }

      源 = new Database(路径)
      const 有表 = 源.query("select name from sqlite_master where type = 'table' and name = 'part'").get()
      if (有表 === null) {
        missing.push(人.id)
        continue
      }

      // 水位存**秒**（int4 装不下毫秒，见 0024 的注释）；源库那边一律乘回毫秒再比。
      const 水位秒 = Number(
        rowsOf(
          await input.db.execute(
            sql`select last_updated_sec from auth.asset_usage_cursor where user_id = ${人.id}`,
          ),
        )[0]?.["last_updated_sec"] ?? 0,
      )

      // 毒行兜底用 `case when json_valid(data) then … end`，**不能**用 `where … and json_valid(data)`：
      // SQLite 会重排 AND 里的项，裸的 `json_extract` 仍可能先被求值、在非 JSON 行上抛
      // `malformed JSON`（本机实测：加了 `and json_valid(data)` 依旧整轮失败）⇒ 该用户每轮
      // 都死在同一行、游标永不推进。CASE 保证只对合法 JSON 求值；一条毒行不该拖死整个用户。
      const 行 = 源
        .query<调用行, [number, string]>(
          `select id, session_id, time_created, time_updated,
                  case when json_valid(data) then json_extract(data, '$.state.status') end     as status,
                  case when json_valid(data) then json_extract(data, '$.state.input.name') end as name,
                  case when json_valid(data) then json_extract(data, '$.callID') end           as call_id
           from part
           where time_updated > ?
             and case when json_valid(data) then json_extract(data, '$.tool') end = ?
           order by time_updated asc, id asc`,
        )
        .all(水位秒 * 1000 - 回看ms, SKILL_TOOL)

      // 同一会话会被问多次，按会话缓存 project_id（`null` = 走不通）。
      const 项目 = new Map<string, string | null>()
      let 新水位秒 = 水位秒

      for (const row of 行) {
        scanned += 1
        const 行秒 = Math.floor(row.time_updated / 1000)
        if (行秒 > 新水位秒) 新水位秒 = 行秒

        if (row.status !== "completed") continue

        const 名字 = 文本(row.name)
        if (名字 === undefined) {
          unattributed += 1
          continue
        }

        let projectId = 项目.get(row.session_id)
        if (projectId === undefined) {
          const 会话 = 源
            .query<{ project_id: string }, [string]>("select project_id from session where id = ?")
            .get(row.session_id)
          projectId = 会话?.project_id ?? null
          项目.set(row.session_id, projectId)
        }
        if (projectId === null) {
          unattributed += 1
          continue
        }

        const 候选 = 台账.get(projectId)?.get(名字) ?? []
        if (候选.length !== 1) {
          unattributed += 1
          continue
        }

        const result = await input.db.execute(sql`
          insert into auth.asset_usage_event
            (user_id, part_id, asset_id, session_id, call_id, skill_name, org, dept, section, occurred_at, extracted_at)
          values (
            ${人.id}, ${row.id}, ${候选[0]}, ${row.session_id},
            ${row.call_id ?? ""}, ${名字},
            ${人.org}, ${人.dept}, ${人.section},
            ${Math.floor(row.time_created / 1000)}, ${now}
          )
          on conflict (user_id, part_id) do nothing
          returning part_id
        `)
        if (rowsOf(result).length > 0) inserted += 1
      }

      // 游标最后写：中途抛错时下一次重扫，幂等主键兜住重复。
      if (新水位秒 > 水位秒) {
        await input.db.execute(sql`
          insert into auth.asset_usage_cursor (user_id, last_updated_sec, updated_at)
          values (${人.id}, ${新水位秒}, ${now})
          on conflict (user_id) do update
            set last_updated_sec = excluded.last_updated_sec, updated_at = excluded.updated_at
        `)
      }
    } catch (error) {
      // 不推进游标：这一轮没读完，下一轮从头补。也不把失败写成「0 次」（#002-02）。
      console.warn(`[openhive-asset-usage] 用户 ${人.id} 抽取失败，本轮跳过`, error)
    } finally {
      源?.close()
    }
  }

  return { scanned, inserted, unattributed, missing }
}

/** 本页资产的最近 30 天聚合；没记录的资产**不出现**在 `stats` 里。 */
export async function 用量统计(
  db: Db,
  assetIds: readonly string[],
  now: number,
): Promise<{ days: number; stats: Record<string, { users: number; calls: number }> }> {
  const stats: Record<string, { users: number; calls: number }> = {}
  if (assetIds.length > 0) {
    const 占位 = sql.join(
      assetIds.map((id) => sql`${id}`),
      sql`, `,
    )
    const 起点 = now - WINDOW_DAYS * 24 * 60 * 60
    // `::int`：count 是 bigint，真驱动读成字符串（0015 的教训）。
    const rows = rowsOf(
      await db.execute(sql`
        select asset_id,
               count(distinct user_id)::int as users,
               count(*)::int as calls
        from auth.asset_usage_event
        where occurred_at > ${起点} and asset_id in (${占位})
        group by asset_id
      `),
    )
    for (const row of rows) {
      stats[String(row["asset_id"])] = {
        users: Number(row["users"]),
        calls: Number(row["calls"]),
      }
    }
  }
  return { days: WINDOW_DAYS, stats }
}
