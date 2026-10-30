export * as OpenhiveSkillAvailability from "./skill-availability"

import { join } from "node:path"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { skillLinkTarget } from "@opencode-ai/asset-service/project-skill-link"
import { readableAssetCondition, type AssetViewer } from "@opencode-ai/asset-service/readable-sql"
import { ConfigMarkdown } from "@/config/markdown"

/**
 * 「这个人**读得到的、已发布的 skill 资产**」→ 它们的 **SKILL.md 名字**（2026-10-30）。
 *
 * ## 它补的是哪一段
 *
 * capability（`capabilityFor`）只会从 `auth.role_resource` 取 allow，而产品主路径
 * ——「审核通过 ⇒ 自动送达」——**一份授权行都不写**（`auto-delivery.ts` 只查可见性；
 * `grantAssetToGroup()` 只在「指定人员」档写行，且写的是**资产 id**）。于是：
 *
 * 1. 零授权 ⇒ 会话规则集只剩一条 `skill * deny` ⇒ `skill` 工具对所有人生效地被关掉
 *    （真栈实测：三个用户的库、5468 个 part、`tool: "skill"` **零个**）；
 * 2. 即便有授权，`resource_id = asset_<uuid>` 也永远匹配不上 `ask` 的 pattern
 *    （`tool/skill.ts` 传的是 frontmatter 的 `name`）。
 *
 * 本模块把「可见性」这一份判据（`readableAssetCondition()`，`#004-02`）接到工具授权上：
 * 读得到 + 已发布 ⇒ 内核**必须**能调；判据不另写一套。
 *
 * ## 为什么是「读得到」而不是「是否启用」
 *
 * 自动送达把读者读得到的 skill **自动**链进他的项目目录 ⇒ 文件已经在沙箱里、内核已经能扫到。
 * 工具再关着，就是「看得见、调不动」。手动启用只决定**项目里多链一份**，不改变可见性。
 *
 * ## 第三层过滤（`status='published'` / 非 personal）为什么在这里
 *
 * - `status`：只有审核通过的 skill 算「可用」；草稿在作者沙箱里，不经过这条出口；
 * - `visibility = 'personal'`：**没有共享发布目录**（`publishDirectory` 对 personal 抛错），
 *   本函数按 `skillLinkTarget()` 拼路径时根本拼不出落点。⚠️ 已知残差：作者自己保存草稿时
 *   链接指向 `<root>/draft/<id>`（`service.ts`），那条不经这里 ⇒ 自己的草稿 skill 目前
 *   **调不到**（工具被 deny）。改这一档要先定「personal 的落点算谁」，别在这里顺手放开。
 *
 * ## 拿不到名字 ⇒ 跳过 + 报告，**绝不拿目录名顶替**
 *
 * 目录名是资产 id（`asset_<uuid>`），它与 frontmatter 的 `name` 是两个东西；用它兜底等于
 * 把「看不见」变成「调得到」，而且模型永远不知道要按 id 去调（目录里列的是 name）。
 * 所以读不到就**不放行**，并把 skipped 交回调用方留痕（`#002-02`：测不了 / 读不到都要说出来）。
 */

/** 能跑 SQL 的句柄（形状同 `GrantTarget` / `EnablementTarget`）。 */
export interface SkillAvailabilityTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/** `skillLinkTarget()` 认的三档（personal 在它那里是「没有落点」）。 */
type 共享可见范围 = "global" | "department" | "targeted"

export interface UsableSkill {
  readonly id: string
  readonly visibility: 共享可见范围
  /** `department` 档拼发布目录要用它。 */
  readonly department: string
}

export interface SkippedSkill {
  readonly id: string
  readonly reason: string
}

export interface UsableSkillScan {
  /** SKILL.md 的 frontmatter `name`，去重后按字典序。 */
  readonly names: readonly string[]
  /** 读得到行、但拿不到名字的资产：**不放行**，交回调用方留痕。 */
  readonly skipped: readonly SkippedSkill[]
}

/**
 * 读者读得到的、已发布的 skill 资产（**只查库，不碰文件系统**）。
 *
 * `order by id` 不是修饰：这批 id 决定解析顺序，进而决定 `skipped` 的顺序与规则集的候选集合，
 * 不确定的返回顺序会让同一个人两次建会话落出字节不同的 `session.permission`。
 */
export async function usableSkillAssets(
  db: SkillAvailabilityTarget,
  viewer: AssetViewer,
): Promise<UsableSkill[]> {
  const result = await db.execute(sql`
    select auth.asset.id, auth.asset.visibility, auth.asset.department
      from auth.asset
     where ${readableAssetCondition(viewer)}
       and auth.asset.type = 'skill'
       and auth.asset.status = 'published'
       and auth.asset.visibility <> 'personal'
     order by auth.asset.id
  `)

  // 库列是 text，`<> 'personal'` 只挡住 personal；闭集校验仍走显式判定而不是断言
  // （同 `readable-sql.ts` 的 `isAssetPerm`：断言在类型层免费、在运行期什么也没挡）。
  return rowsOf(result).flatMap((row) => {
    const visibility = row.visibility
    if (visibility !== "global" && visibility !== "department" && visibility !== "targeted") return []
    return [
      {
        id: String(row.id),
        visibility,
        department: typeof row.department === "string" ? row.department : "",
      },
    ]
  })
}

/**
 * 名字能不能直接当**权限 pattern** 用。
 *
 * 🔴 `Permission.evaluate` 把**规则**那一侧按通配解释（`Wildcard.match(input, pattern)`：
 * 规则里的 `*` → `.*`、`?` → `.`）。而这个名字是**作者自填的 SKILL.md frontmatter**——
 * 一份叫 `*` 的 skill 会被 `sessionRuleset()` 照抄成 `allow skill:*`，**把这个人所有
 * deny 的 skill 一起打开**（授权随一份资产的名字漂移，不报错、不变红）。
 *
 * 所以含通配字符的名字**不放行**（fail-closed）：它仍然可以被内核按名字加载，但**不经过**
 * capability 这条出口。宁可那一份调不到，也不能让一份资产改写整条规则集。
 */
function 是安全的调用名(name: string): boolean {
  return !name.includes("*") && !name.includes("?")
}

/**
 * 读一份资产的 SKILL.md 名字。读不到 ⇒ `{ name }` 缺失 + `reason`（不抛：一份坏资产
 * 不该让整次建会话失败——它只意味着**这一份**不放行）。
 */
async function 读名字(
  root: string,
  asset: UsableSkill,
): Promise<{ readonly name?: string; readonly reason?: string }> {
  let target: string
  try {
    target = skillLinkTarget(root, asset)
  } catch (error) {
    // 未知可见范围 / 部门为空等：`skillLinkTarget` 会抛。同样只影响这一份。
    return { reason: `发布路径拼不出来：${error instanceof Error ? error.message : String(error)}` }
  }
  try {
    const md = await ConfigMarkdown.parse(join(target, "SKILL.md"))
    const name: unknown = md.data["name"]
    if (typeof name !== "string" || name.trim() === "") return { reason: `SKILL.md 没有 name（${target}）` }
    if (!是安全的调用名(name)) return { reason: `name 含通配字符，不能当权限 pattern：${name}` }
    return { name }
  } catch (error) {
    return { reason: `读不到 ${join(target, "SKILL.md")}：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 上面那份资产 → 内核**真正认得的名字**。`root` 传 `assetsRoot(process.env)`
 * （调用方传，本模块不读环境——与 `project-assets.ts` 同款：根从哪来归调用方）。
 */
export async function scanUsableSkills(
  db: SkillAvailabilityTarget,
  viewer: AssetViewer,
  root: string,
): Promise<UsableSkillScan> {
  const assets = await usableSkillAssets(db, viewer)
  const names = new Set<string>()
  const skipped: SkippedSkill[] = []

  for (const asset of assets) {
    const 结果 = await 读名字(root, asset)
    if (结果.name === undefined) {
      skipped.push({ id: asset.id, reason: 结果.reason ?? "未知原因" })
      continue
    }
    names.add(结果.name)
  }

  return { names: [...names].toSorted(), skipped }
}
