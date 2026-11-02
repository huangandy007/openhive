export * as OpenhiveMcpAvailability from "./mcp-availability"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { readableAssetCondition, type AssetViewer } from "@opencode-ai/asset-service/readable-sql"

/**
 * 「这个人**读得到的、已发布（或迭代中）的 MCP 资产**」→ 它们的**配置键**（spec §3.4.1）。
 *
 * ## 判据只有一份
 *
 * 查询里的 `${readableAssetCondition(viewer)}` 与 `authorization.test.ts` 的内存判据、
 * `readable-sql.ts` 的 SQL 投影是同一份语义（`#004-02` / `#010-06`）。**不要**在这里补
 * `visibility <> 'personal'` 之类的第二套判断——MCP 允许 `personal`（spec §3.2.2，2026-11-02 裁定）。
 *
 * ## 为什么键就是资产 id
 *
 * spec §3.3.1：业务 server 写在全局配置里，**键 = 资产 id**；差异在 capability 里。
 * 于是本条产出可以直接与 `sessionRuleset` 的 `naming.server`（= 配置键）对齐，零翻译。
 *
 * ## 通配字符 ⇒ 跳过 + 报告
 *
 * `Permission.evaluate` 把规则那侧按通配解释。一个含 `*` / `?` 的资产 id 被当作 allow 写进
 * 规则集，会**放大成别的键**（与 `skill-availability.ts` 的 `是安全的调用名` 同一条纪律）。
 * 空 id 同理：它会退化成 `_*`，把工具名里带 `_` 前缀的规则一并放大。宁可那一台不放行，
 * 也不能让一份资产改写整条规则集。
 */

/** 能跑 SQL 的句柄（形状同 `SkillAvailabilityTarget`）。 */
export interface McpAvailabilityTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface SkippedMcp {
  readonly id: string
  readonly reason: string
}

export interface UsableMcpScan {
  /** 配置键（= 资产 id），去重后按字典序。 */
  readonly names: readonly string[]
  /** 读得到、但 id 不能当配置键的资产：**不放行**，交回调用方留痕。 */
  readonly skipped: readonly SkippedMcp[]
}

function 是安全的配置键(id: string): boolean {
  return id.length > 0 && !id.includes("*") && !id.includes("?")
}

/**
 * 读者读得到的、已发布 / 迭代中的 MCP 资产 id（**只查库**）。
 *
 * `order by id` 不是修饰：不确定的返回顺序会让同一个人两次建会话落出字节不同的
 * `session.permission`（与 `skill-availability.ts` 同一个理由）。
 *
 * `status in ('published','iterating')` 是**收紧**：`readableAssetCondition` 还认 `offline`
 * （共享状态三档），但下线 / 归档的 MCP 不该进能力清单（spec §3.2.5、§6 失败模式表）。
 */
export async function usableMcpAssets(db: McpAvailabilityTarget, viewer: AssetViewer): Promise<string[]> {
  const result = await db.execute(sql`
    select auth.asset.id
      from auth.asset
     where auth.asset.type = 'mcp'
       and auth.asset.status in ('published', 'iterating')
       and ${readableAssetCondition(viewer)}
     order by auth.asset.id
  `)
  return rowsOf(result).map((row) => String(row.id))
}

/** 资产 id → 内核**能直接当配置键 / 权限 pattern** 的名字。 */
export async function scanUsableMcpServers(
  db: McpAvailabilityTarget,
  viewer: AssetViewer,
): Promise<UsableMcpScan> {
  const ids = await usableMcpAssets(db, viewer)
  const names: string[] = []
  const skipped: SkippedMcp[] = []

  for (const id of ids) {
    if (!是安全的配置键(id)) {
      skipped.push({ id, reason: `资产 id 含通配字符，不能当配置键：${id}` })
      continue
    }
    names.push(id)
  }

  return { names: [...new Set(names)].toSorted(), skipped }
}
