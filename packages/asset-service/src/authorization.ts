import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import { assetById } from "./asset"
import type { AssetMetadata } from "./metadata"

/**
 * 资产授权（009 T004，FR-006 / FR-007）：三级空间 + 四类权限 + 授权组。
 *
 * ## 为什么判定在 asset-service，而不是 `core/access/rbac.ts`
 *
 * `AccessRbac.resolve()` 只把 `perm === "read"` 的授权投影成工具规则（D0-4 实测：
 * `core/access/rbac.ts` 的 `resolve()` 只有 read 产 allow）。`write` / `review` / `admin`
 * 是**管理动作**，不是工具调用，内核没有承载它们的出口。所以：
 *
 * - **读 / 用**既可以在内核侧变成工具规则，也可以在这里判（本文件提供判据）；
 * - **写 / 审 / 管**只能在这里判——T009 的两道关直接查本文件的 `effectivePermissions()`。
 *
 * 这不是「重复实现一份权限」：`grantsFor()`（auth）取行、本文件决定「这些行 + 空间归属
 * ⇒ 能做什么」，内核侧只负责把 read 投影成工具规则。**不要**把 review/admin 也塞进
 * `resolve()`：那会让「审」变成一条工具断言，而它根本不是工具。
 *
 * ## 空间与权限是两件事
 *
 * - **三级空间**只授「读」：全局 = 全单位；部门 = 同部门（`auth.user.dept` 与
 *   `asset.department` 的**自由文本精确相等**，已知技术债：部门改名会断，F10 再上组织 ID）；
 *   个人 = 只有作者。
 * - **写**只来自作者身份或显式 `write` 授权——「同部门可见」不等于「同部门可写」。
 * - **审 / 管**只来自显式授权，且**互不蕴含**（design §3.3：业务管理员只有审，
 *   系统管理员只有管）。`admin` 不蕴含 `review`，否则一个人既能审内容又能发布，
 *   T009 的「两道关分离」当场失效。
 *
 * ## 授权组
 *
 * 授权组 = `auth.role.role_type = 'group'` 的自定义 role（design §3.4）。它不新造权限体系：
 * 组员 = `user_role` 的一行，组对资产的授权 = `role_resource` 的一行。本文件的
 * `createAuthorizationGroup` / `addGroupMember` / `grantAssetToGroup` 是这三张表的
 * **第一批生产写入路径**（此前只有测试在写）。
 *
 * ## 知识库
 *
 * `knowledge_base` 的授权**只影响可见性**，不影响工具：009 不做 RAGFlow 执行（D0-10）。
 * 别把「授了知识库」读成「授权了就能检索」——执行入口在 010，且要先接上 `TOOL_OF` 的缺口
 * （`core/access/rbac.ts` 自认的 `knowledge_base` 零映射）。
 */

/**
 * 权限闭集、授权视角、共享状态与「读」的 SQL 投影都在 `readable-sql.ts`：
 * 那里是本文件与 `asset.ts` 的**共同依赖**，把常量放过去才不会造出
 * `asset.ts ↔ authorization.ts` 的运行时循环。这里原样再导出，外部引用不用改。
 */
export {
  ASSET_PERMS,
  isAssetPerm,
  readableAssetCondition,
  type AssetPerm,
  type AssetViewer,
} from "./readable-sql"
import { ASSET_PERMS, SHARED_STATUSES, isAssetPerm, type AssetPerm, type AssetViewer } from "./readable-sql"

/** 能跑 SQL 的句柄（形状同 `asset.ts` 的 `AssetTarget` / `auth/rbac.ts` 的 `GrantTarget`）。 */
export interface AuthorizationTarget {
  execute(query: SQL): PromiseLike<unknown>
}

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === "") throw new Error(`非法${label}：不能为空`)
  return trimmed
}

/**
 * 这个 role 必须存在且是授权组。
 *
 * 为什么不靠外键：外键只保证「角色存在」，不保证「它是组」。给普通角色写一条
 * `resource_type` / `perm` 都合法的授权行，库会照收——然后它就成了一个**看不见的
 * 授权组**（`role_type` 还是 `normal`），排查时只能靠人翻表。
 */
async function assertAuthorizationGroup(db: AuthorizationTarget, groupId: string): Promise<void> {
  const rows = rowsOf(await db.execute(sql`select role_type from auth.role where id = ${groupId}`))
  if (rows.length === 0) throw new Error(`授权组不存在：${groupId}`)

  const roleType = String(rows[0]!.role_type)
  if (roleType !== "group") throw new Error(`${groupId} 不是授权组（role_type=${roleType}）`)
}

/**
 * 建授权组：`role_type = 'group'` 的自定义 role。
 *
 * 不检查重名——`role.name` 在 0004 里是 `UNIQUE`，重名会被库拒（23505）。
 * 这一层再做一次「查了再插」只会多一个 TOCTOU 窗口。
 */
export async function createAuthorizationGroup(
  db: AuthorizationTarget,
  input: { readonly id: string; readonly name: string },
): Promise<void> {
  const id = assertNonBlank(input.id, "组 id")
  const name = assertNonBlank(input.name, "组名称")

  await db.execute(sql`
    insert into auth.role (id, name, role_type)
    values (${id}, ${name}, 'group')
  `)
}

/** 把用户加进授权组（跨部门拉人 = 这一行）。未知用户由外键拒。 */
export async function addGroupMember(
  db: AuthorizationTarget,
  input: { readonly groupId: string; readonly userId: string },
): Promise<void> {
  const groupId = assertNonBlank(input.groupId, "组 id")
  const userId = assertNonBlank(input.userId, "成员用户 id")

  await assertAuthorizationGroup(db, groupId)
  await db.execute(sql`insert into auth.user_role (user_id, role_id) values (${userId}, ${groupId})`)
}

/**
 * 把一份资产定向授权给授权组。
 *
 * 三个刻意的形状选择：
 * ① **`perm` 收 `string` 并在运行时校验**，不收窄成 `AssetPerm`：这是从 HTTP / MCP 工具
 *    进来的边界值，收窄只会在调用处逼出一次假 cast；未知值在这里当场拒绝，**在碰库之前**。
 * ② **`resource_type` 由资产的真实类型决定**，不由调用方传：让调用方填就有「把 skill
 *    资产授成 mcp」的口子，而那种授权行看起来完全合法、判定时永远匹配不上。
 * ③ **资产必须存在**：`role_resource.resource_id` 没有外键（它同时承载三类资源），
 *    不查就能给一个不存在的 id 授权——那是一条永远匹配不上的「幽灵权限」。
 */
export async function grantAssetToGroup(
  db: AuthorizationTarget,
  input: { readonly groupId: string; readonly assetId: string; readonly perm: string },
): Promise<void> {
  const groupId = assertNonBlank(input.groupId, "组 id")
  const assetId = assertNonBlank(input.assetId, "资产 id")

  if (!isAssetPerm(input.perm)) {
    throw new Error(`未知资产权限：${input.perm}（可用：${ASSET_PERMS.join(" / ")}）`)
  }

  await assertAuthorizationGroup(db, groupId)

  const asset = await assetById(db, assetId)
  if (!asset) throw new Error(`资产不存在：${assetId}`)

  await db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values (${groupId}, ${asset.type}, ${asset.id}, ${input.perm})
  `)
}

/**
 * 三级空间是否允许「读」。只回答空间那半边，授权组那半边在 `effectivePermissions()` 里并。
 *
 * 非共享状态对谁都返回 false（作者 / 被授权者由调用方另外加分）。
 */
function spaceAllowsRead(viewer: AssetViewer, asset: AssetMetadata): boolean {
  if (!SHARED_STATUSES.has(asset.status)) return false

  switch (asset.visibility) {
    case "global":
      return true
    case "department":
      // 两个空串不能互相匹配：部门是自由文本，空值代表「未归属」而不是「同一个部门」。
      return asset.department !== "" && viewer.department !== "" && asset.department === viewer.department
    case "personal":
      // 个人资产的空间只有作者本人；作者那一份由 `effectivePermissions()` 直接给。
      return false
    default: {
      const visibility: never = asset.visibility
      throw new Error(`未知可见范围：${String(visibility)}`)
    }
  }
}

/** 命中的授权行 → 权限值。资源类型与资源 id 必须**同时**匹配。 */
function matchedGrantPerms(grants: readonly GrantRow[], asset: AssetMetadata): AssetPerm[] {
  const perms: AssetPerm[] = []
  for (const grant of grants) {
    if (grant.resourceType !== asset.type) continue
    if (grant.resourceId !== asset.id) continue
    // 未知值跳过（fail-closed）：坏数据不能静默变成一次放行。
    if (!isAssetPerm(grant.perm)) continue
    perms.push(grant.perm)
  }
  return perms
}

/**
 * 某人在某份资产上的**全部**权限。
 *
 * 叠加顺序（集合，无优先级冲突）：
 * 1. 作者 ⇒ `read` + `write`（不改内容就谈不上「作者的写」）；
 * 2. 命中的授权行 ⇒ `read` + 该行自己的 perm。**任何**授权都附带 `read`：
 *    审的人得先看得见，管的人也一样；但 `write` / `review` / `admin` **互不蕴含**；
 * 3. 三级空间 ⇒ `read`（仅共享状态）。
 *
 * 授权行不受状态门限制：给一份 `in_review` 资产授 `review` 就是让审核人看见它的方式。
 */
export function effectivePermissions(
  viewer: AssetViewer,
  asset: AssetMetadata,
  grants: readonly GrantRow[] = [],
): ReadonlySet<AssetPerm> {
  const perms = new Set<AssetPerm>()

  if (asset.ownerId === viewer.userId) {
    perms.add("read")
    perms.add("write")
  }

  for (const perm of matchedGrantPerms(grants, asset)) {
    perms.add("read")
    perms.add(perm)
  }

  if (spaceAllowsRead(viewer, asset)) perms.add("read")

  return perms
}

/**
 * 「看得见 / 用得了」的判据（FR-007 的「读」= 浏览、收藏、调用）。
 *
 * ⚠️ 收藏**不是**这里的输入：FR-007 要求授权与收藏彻底分离，收藏只影响右栏抽屉排序。
 * 别图省事把「收藏过」当成可见——那会把无权资产从收藏入口漏出来（T017 的判据）。
 */
export function canReadAsset(
  viewer: AssetViewer,
  asset: AssetMetadata,
  grants: readonly GrantRow[] = [],
): boolean {
  return effectivePermissions(viewer, asset, grants).has("read")
}

