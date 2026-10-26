export * as Governance from "./governance"

/**
 * 治理后台的分权（010 T003 / FR-003 / T002 的 `authorization.md`）。
 *
 * ## 一句话
 *
 * `is_admin` 是**进后台的总开关**（009 D0-4），授权行决定**进门之后各见各的板块**。
 * 这里只回答「谁能做什么」，落地成两样东西：
 *
 * 1. **两张模板角色**（系统管理员 / 业务专家）＋ 它们的 `role_resource` 行 —— 见
 *    `migrations/0013_governance.sql`。判定**只读行**，不读 `role.name`（009 §2.4 明令）。
 * 2. 三个函数：取行（`governanceGrants`）、可见板块（`governanceBoards`）、
 *    单动作判定（`authorizeGovernance`）。
 *
 * ## 三条刻意的不变式
 *
 * - **`is_admin = 0` ⇒ 一无所有**：即便被误挂了模板行，也进不了后台、做不了动作
 *   （§2.3）。前端隐藏入口只是界面收敛，不是这道门（宪法 §IV）。
 * - **进门先有 `read`**：`authorizeGovernance` 对任何动作都先要求该板块的 `read` 行
 *   （§3.1「任何动作都假定调用者对该板块有 `read`」）。`admin` / `review` / `write`
 *   互不蕴含，也没有一个能替代 `read`——漏了 `read` 的授权行是**能做但进不去**，
 *   而它被折成「什么都不能做」（fail-closed），不是「先放进去再说」。
 * - **未知板块 / 未知 perm 不算授权**：`resource_id` 是没有 CHECK 的自由文本，
 *   库里出现拼错的板块 id 时，本模块**静默不认**，而不是把它投影给前端。
 *
 * ## 为什么判定读库、而不是读会话
 *
 * 004 的 R4（capability 在会话创建那一刻焊死）管的是 **AI 工具执行层**；治理后台不是
 * AI 工具路径，它每个请求自己查一次库 ⇒ **改授权对治理动作立即生效**，对已存在的
 * AI 会话里的工具能力仍然要等下一次建会话。两句话别混（`authorization.md §5.3`）。
 *
 * ## 与 capability / 工具规则的关系
 *
 * 治理行经 `grantsFor()` 取到后，core 的 `resolve()` 因为 `TOOL_OF` 里没有 `governance`
 * 而整条跳过（`RESOURCE_TYPES` 里加它只是让闭集镜像对得上），**不会**投影出任何工具规则。
 */

import { eq, sql } from "drizzle-orm"
import { rowsOf } from "./migrate"
import type { GrantTarget } from "./rbac"
import { type UserAccountTarget, user } from "./user"

/**
 * `role_resource.resource_type` 的治理取值。
 *
 * ⚠️ 它与 `skill` / `mcp` / `knowledge_base` 共用一张表、一个 CHECK（`0013_governance.sql`
 * 把 `'governance'` 加进闭集）。别把它塞进 `ASSET_TYPES`——那是**资产类型**，治理板块不是资产。
 */
export const GOVERNANCE_RESOURCE_TYPE = "governance"

/**
 * 八个板块的 id。
 *
 * ⚠️ 与前端注册表 `packages/app/src/governance/sections.ts` **逐字相同**——两处各写一份是
 * `LEARNINGS #002-06` 的形状，所以 `governance.test.ts` 读那份源文件、逐个比对，
 * 改任一侧而另一侧没跟上会当场红（对账命令同 `authorization.md §3.2`）。
 */
export const GOVERNANCE_BOARDS = [
  "account-manage",
  "org-tree",
  "asset-governance",
  "template-lib",
  "data-project-perm",
  "usage-cost",
  "audit-log",
  "data-source",
] as const

export type GovernanceBoard = (typeof GOVERNANCE_BOARDS)[number]

/**
 * 四个权限动作。与 core 的 `PERMS`、DB 的 `role_resource_perm_check` 是同一套四值
 * （`authorization.md §1`：不新造词）。本常量**不进 DB**，只给调用点一个收窄的类型；
 * 闭集真正的守门人是那条 CHECK，`openhive-rbac-closed-set.test.ts` 另有断言把两份值钉在一起。
 */
export const GOVERNANCE_PERMS = ["read", "write", "review", "admin"] as const

export type GovernancePerm = (typeof GOVERNANCE_PERMS)[number]

export interface GovernanceTemplateGrant {
  readonly board: GovernanceBoard
  readonly perm: GovernancePerm
}

/**
 * 一张模板角色 ＝ `auth.role` 一行 ＋ 它的全部授权行。
 *
 * ⚠️ **迁移里的种子必须与这里逐行相等**（`governance.test.ts` 把库读出来双向比）。
 * 这份常量是给「人 / 测试 / 将来的分配接口」看的那一份；判定本身只读库。
 * `name` 只给人看——**不许**据此做任何判断（009 §2.4）。
 */
export interface GovernanceTemplate {
  readonly roleId: string
  readonly name: string
  readonly grants: readonly GovernanceTemplateGrant[]
}

export const GOVERNANCE_TEMPLATES: readonly GovernanceTemplate[] = [
  {
    roleId: "gov-system-admin",
    name: "系统管理员",
    grants: [
      { board: "account-manage", perm: "read" },
      { board: "account-manage", perm: "write" },
      { board: "org-tree", perm: "read" },
      { board: "org-tree", perm: "write" },
      { board: "asset-governance", perm: "read" },
      { board: "asset-governance", perm: "admin" },
      { board: "usage-cost", perm: "read" },
      { board: "audit-log", perm: "read" },
      { board: "data-source", perm: "read" },
      { board: "data-source", perm: "write" },
    ],
  },
  {
    roleId: "gov-business-expert",
    name: "业务专家",
    grants: [
      { board: "asset-governance", perm: "read" },
      { board: "asset-governance", perm: "review" },
      { board: "template-lib", perm: "read" },
      { board: "template-lib", perm: "write" },
      { board: "data-project-perm", perm: "read" },
      { board: "data-project-perm", perm: "admin" },
    ],
  },
]

/** 一条治理授权 ＝ `role_resource` 的一行，只留判定要的两个字段。 */
export interface GovernanceGrant {
  readonly board: string
  readonly perm: string
}

export type GovernanceTarget = UserAccountTarget & GrantTarget

const 是板块 = (value: string): value is GovernanceBoard =>
  (GOVERNANCE_BOARDS as readonly string[]).includes(value)

const 是动作 = (value: string): value is GovernancePerm =>
  (GOVERNANCE_PERMS as readonly string[]).includes(value)

/** 取某个用户名下的**全部治理授权行**（`resource_type = 'governance'`）。 */
export async function governanceGrants(db: GrantTarget, userId: string): Promise<GovernanceGrant[]> {
  // 与 `grantsFor()` 同一条取行形状（join `user_role`）、同样的两个理由：
  // `userId` 走参数化（不拼字符串）、`order by` 让出口确定（`#002-06` 之外，
  // 还有「同一份授权每次取出的字节都一样」这条可读性要求）。
  const result = await db.execute(sql`
    select rr.resource_id, rr.perm
    from auth.role_resource rr
    join auth.user_role ur on ur.role_id = rr.role_id
    where ur.user_id = ${userId}
      and rr.resource_type = ${GOVERNANCE_RESOURCE_TYPE}
    order by rr.resource_id, rr.perm
  `)
  return rowsOf(result).map((row) => ({
    board: String(row.resource_id),
    perm: String(row.perm),
  }))
}

/**
 * 「这个用户能进哪些板块」——判据是**有该板块的 `read` 行**，顺序按 `GOVERNANCE_BOARDS`。
 *
 * `isAdmin` 是**必填参数、没有默认值**：`is_admin` 是进后台的总开关（§2.3），漏传它等于
 * 把门打开，而「漏传一个布尔」恰恰是类型系统拦不住的那种错。写成必填之后，调用点必须
 * 当场回答「这人是不是管理员」，答案从哪儿来一目了然（`sessionIdentity` 传的是库里那一行）。
 *
 * 未知板块 id 静默丢弃（fail-closed，见文件头第三条）。
 */
export function governanceBoards(
  grants: readonly GovernanceGrant[],
  isAdmin: boolean,
): GovernanceBoard[] {
  if (!isAdmin) return []
  const 可进 = new Set(grants.filter((grant) => grant.perm === "read").map((grant) => grant.board))
  return GOVERNANCE_BOARDS.filter((board) => 可进.has(board))
}

/**
 * 单个管理动作的门。
 *
 * 语义（顺序即语义，任何一步不过就 `false`）：
 * ① 用户存在且**启用**；② `is_admin = 1`；③ 该板块有 `read` 行（进门）；④ 有**精确匹配**
 * 的动作行（`read` 自己就走 ③ 这一条）。
 *
 * ⚠️ **调用方必须在副作用之前调用它**，且不得把返回值缓存进会话或闭包——治理授权
 * 每请求查库、改完即生效（文件头「为什么判定读库」）。T005–T012 的写动作都由它守门；
 * 它在 T003 落点时尚无生产消费者，是**接缝**不是已接线的门。
 */
export async function authorizeGovernance(
  db: GovernanceTarget,
  input: { readonly userId: string; readonly board: string; readonly perm: string },
): Promise<boolean> {
  // 未知板块 / 未知动作在**进门之前**就拒：`resource_id` 没有 CHECK 兜着，
  // 库里可能躺着拼错的行；若不先挡，一个拼错的 board 只要行也在，就会被判成「有权」。
  if (!是板块(input.board) || !是动作(input.perm)) return false

  const [record] = await db.select().from(user).where(eq(user.id, input.userId))
  if (!record) return false
  // `status` / `is_admin` 是 integer，`1` 是**取值**不是布尔（与 `sessionIdentity` 同一读法）。
  const isAdmin = record.status === 1 && record.isAdmin === 1
  if (!isAdmin) return false

  const grants = await governanceGrants(db, input.userId)

  // 「进门要 read」：任何动作都先要求该板块的 read 行（authorization.md §3.1）。
  // 借 `governanceBoards` 而不是在这里再写一遍过滤——那条规则只留一处（`#002-06`）。
  if (!governanceBoards(grants, isAdmin).includes(input.board)) return false
  if (input.perm === "read") return true
  // 四值互不蕴含：只要精确匹配的那一行，不从别的动作推。
  return grants.some((grant) => grant.board === input.board && grant.perm === input.perm)
}
