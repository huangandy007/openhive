export * as OpenhiveAssetUsage from "./asset-usage"

/**
 * 资产使用记录（2026-10-29，口径扩于 2026-10-30）：从每用户 SQLite 的 `part` 表增量抽取
 * **技能被使用的痕迹**，落到 PG 事实表（`0024`）。
 *
 * ## 什么算「用了一次」（2026-10-30 用户裁定）
 *
 * 初版只认 `skill` 工具的调用。真栈实测发现模型常常绕开它：直接 `bash` 跑技能里的脚本、
 * 直接 `read` 读 SKILL.md，两种都会产生真实成果却一条记录都没有。所以口径扩成三条入口
 * （外加斜杠命令展开的**文本 part**，见 `归因工具` 的注释）：
 *
 * - **`skill` 工具**：按名字归因，仍走项目启用台账（同名歧义不猜）。
 * - **`bash`**：命令行里出现 `<资产 id>/scripts/` 才算；`ls` / `cat` 摸一下目录不算。
 * - **`read`**：路径里 `SKILL.md` 落在 `<资产 id>/` 下才算。
 * - **斜杠命令**：展开后的文本带着 `Base directory for this skill: <目录>` 尾巴。
 *
 * 三条路径型入口**按资产 id 归因，不查启用台账**——未启用的资产被跑了脚本也算「用了」
 * （用户原话：「不管用哪一种都记」）。
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
 *    **一次工具调用最多一行**：同一个 part 里连跑十个脚本也只记一次（用户裁定 ①A）。
 * 2. **工具 part 只认 completed**：技能正文只有成功时才回到模型上下文。「AI 读了」= 真读到，
 *    running / error 不算（设计 §2 的口径）。文本 part 没有状态，直接算。
 * 3. **skill 工具的归因缺一条就不归因**：0 条同名 / ≥2 条同名都只计 `unattributed`，不入表——
 *    同名 skill 的赢家本身随到达顺序漂（`LEARNINGS #010-05`），猜一个就是把错数写进报表。
 *    路径型入口反过来：精确命中资产 id 就记，命中不了就是普通命令，不进 `unattributed`。
 *
 * ## 失败不假装成 0（`LEARNINGS #002-02`）
 *
 * 单个用户库打不开 ⇒ `console.warn` ＋ **不推进该用户游标** ＋ 继续下一个人；
 * `data` 不是合法 JSON 的毒行由 SQL 侧 CASE 过滤、**静默丢弃、不计数**（设计 §10 缺口 8）。
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
  /** 2026-10-30 起：工具名（`skill` / `bash` / `read`；文本 part 为 null）。 */
  readonly tool: string | null
  /** bash 的命令行。 */
  readonly command: string | null
  /** read 的文件路径。 */
  readonly file_path: string | null
  /** 文本 part 的正文（斜杠命令展开后就是技能正文 + 目录尾巴）。 */
  readonly text: string | null
}

/**
 * 进入归因判定的工具（2026-10-30 口径）。
 *
 * 只有 `skill` 工具被调用时，「用技能」这件事才在 part 表里留下一个显式的名字。另外两条
 * 常见路径——`bash` 直接跑技能里的脚本、`read` 直接读 SKILL.md——留的只是路径，
 * 而「斜杠命令」展开成一条**普通用户文本**，连工具都没有。三条都要认（用户裁定 2026-10-30）。
 *
 * 内建技能（`customize-opencode`）不在这三条里：它没有资产身份，记了也没处挂。
 */
const 归因工具 = new Set(["skill", "bash", "read"])

/** 斜杠命令模板的固定尾巴（`command/index.ts` 注册技能命令时拼上去的那一行）。 */
export const 技能目录标记 = "Base directory for this skill:"

const 技能目录 = new RegExp(`${技能目录标记}\\s*(\\S+)`)

/**
 * 路径 / 命令行里「整段恰好是某个资产 id」的切分。
 *
 * 不假设 id 长什么样（`asset_<uuid>` 只是当下的形态）：段与资产名册精确比对，
 * 测试里的 `usage-a20` 也照样命中。空格、引号、shell 分隔符一起当边界——
 * `cd .opencode/skill/<id> && python …` 这种写法里 id 段后面粘着 `&&`。
 */
const 路径边界 = /[\s"'`/\\()[\]{};|&<>]+/

/** 在文本里找到第一个资产 id 段，并返回它之后的所有段。 */
function 找资产段(文本: string, 资产: ReadonlyMap<string, string>): { id: string; 后续: string[] } | undefined {
  if (文本.length === 0) return undefined
  const 段 = 文本.split(路径边界)
  for (let i = 0; i < 段.length; i++) {
    const 段文 = 段[i]
    if (段文.length === 0 || !资产.has(段文)) continue
    return { id: 段文, 后续: 段.slice(i + 1) }
  }
  return undefined
}

/**
 * bash（②A：只认真跑了脚本）：命中的资产段**后面必须跟着 `scripts`**。
 * 于是 `ls .opencode/skill/<id>`、`cat .opencode/skill/<id>/SKILL.md` 都不算——
 * 摸一下目录不该让看板上的次数往上涨。
 */
function 命中脚本(文本: string, 资产: ReadonlyMap<string, string>): string | undefined {
  const 中 = 找资产段(文本, 资产)
  return 中 !== undefined && 中.后续.includes("scripts") ? 中.id : undefined
}

/** read：直接读了技能目录里的 SKILL.md。 */
function 命中说明书(文本: string, 资产: ReadonlyMap<string, string>): string | undefined {
  const 中 = 找资产段(文本, 资产)
  return 中 !== undefined && 中.后续.includes("SKILL.md") ? 中.id : undefined
}

/** 文本 part：斜杠命令展开的尾巴带目录，从目录里取资产 id。 */
function 命中命令目录(文本: string, 资产: ReadonlyMap<string, string>): string | undefined {
  const 匹配 = 技能目录.exec(文本)
  if (匹配 === null) return undefined
  return 找资产段(匹配[1], 资产)?.id
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

  // 资产名册（2026-10-30）：bash / read / 斜杠命令这三条路没有「技能名」可查，
  // 只能从路径里的**资产 id 段**归因。整表读一次，段查找是 Map 命中。
  const 资产 = new Map<string, string>()
  for (const row of rowsOf(await input.db.execute(sql`select id, name from auth.asset`))) {
    资产.set(String(row["id"]), String(row["name"]))
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
      // 三条入口一起扫（2026-10-30）：`skill` 工具、`bash`（跑脚本）、`read`（读说明书），
      // 外加**文本 part**——斜杠命令展开后是一条普通用户消息，唯一可识别的痕迹是
      // `command/index.ts` 拼上去的目录尾巴。LIKE 放在 CASE 里，毒行（非 JSON）不会被求值。
      const 行 = 源
        .query<调用行, [number, string]>(
          `select id, session_id, time_created, time_updated,
                  case when json_valid(data) then json_extract(data, '$.state.status') end        as status,
                  case when json_valid(data) then json_extract(data, '$.state.input.name') end    as name,
                  case when json_valid(data) then json_extract(data, '$.state.input.command') end as command,
                  case when json_valid(data) then json_extract(data, '$.state.input.filePath') end as file_path,
                  case when json_valid(data) then json_extract(data, '$.tool') end                as tool,
                  case when json_valid(data) then json_extract(data, '$.text') end                as text,
                  case when json_valid(data) then json_extract(data, '$.callID') end              as call_id
           from part
           where time_updated > ?
             and case when json_valid(data) then
                   case
                     when json_extract(data, '$.tool') in ('skill', 'bash', 'read') then 1
                     when json_extract(data, '$.text') like '%' || ? || '%' then 1
                     else 0
                   end
                 end = 1
           order by time_updated asc, id asc`,
        )
        .all(水位秒 * 1000 - 回看ms, 技能目录标记)

      // 同一会话会被问多次，按会话缓存 project_id（`null` = 走不通）。
      const 项目 = new Map<string, string | null>()
      let 新水位秒 = 水位秒

      for (const row of 行) {
        scanned += 1
        const 行秒 = Math.floor(row.time_updated / 1000)
        if (行秒 > 新水位秒) 新水位秒 = 行秒

        // 工具 part 只认 completed；文本 part 没有 status（已经在消息里了，直接算）。
        const 是工具 = row.tool !== null && 归因工具.has(row.tool)
        if (是工具 && row.status !== "completed") continue

        let 资产id: string | undefined
        let 名字: string | undefined

        if (row.tool === "skill") {
          // 老路径保持不变：名字 → 本项目启用台账，0 条 / ≥2 条同名都不猜（`#010-05`）。
          名字 = 文本(row.name)
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
          资产id = 候选[0]
        } else if (row.tool === "bash") {
          资产id = 命中脚本(文本(row.command) ?? "", 资产)
        } else if (row.tool === "read") {
          资产id = 命中说明书(文本(row.file_path) ?? "", 资产)
        } else {
          资产id = 命中命令目录(文本(row.text) ?? "", 资产)
        }

        // 找不到资产段 = 普通命令 / 普通文件 / 普通消息，不是技能使用，也不计入 `unattributed`
        // （那个计数只回答「明明像 skill 调用、为什么归不了因」）。
        if (资产id === undefined) continue
        名字 ??= 资产.get(资产id) ?? 资产id

        const result = await input.db.execute(sql`
          insert into auth.asset_usage_event
            (user_id, part_id, asset_id, session_id, call_id, skill_name, org, dept, section, occurred_at, extracted_at)
          values (
            ${人.id}, ${row.id}, ${资产id}, ${row.session_id},
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

export interface 抽取时控 {
  /** 现在该不该抽（距上次 ≥ 间隔、且没有在抽）。 */
  该抽(now?: number): boolean
  /**
   * 抽一次：单飞（并发进来只有一个真抽）、吞错（列表不能因为用量统计 500）。
   * 返回 `undefined` = 本轮没跑（已在抽 / 出错）。
   */
  跑一次(input: 抽取输入): Promise<抽取结果 | undefined>
}

/**
 * 时控：进程内节流 ＋ 单飞。一个 HTTP 应用层一份（与 `openhive-pg.ts` 同一条理由：
 * 模块级单例会在多文件一起跑时被另一个文件的服务器串味）。
 *
 * 失败也更新 `上次`：坏掉的数据源不该被每 60 秒之外更频繁地重试。
 */
export function create抽取时控(间隔ms = 节流ms): 抽取时控 {
  let 上次 = 0
  let 在抽 = false

  return {
    该抽(now = Date.now()) {
      return !在抽 && now - 上次 >= 间隔ms
    },
    async 跑一次(input) {
      if (在抽) return undefined
      在抽 = true
      try {
        return await 抽取(input)
      } catch (error) {
        console.warn("[openhive-asset-usage] 本轮抽取失败，沿用已有数据", error)
        return undefined
      } finally {
        在抽 = false
        上次 = Date.now()
      }
    },
  }
}
