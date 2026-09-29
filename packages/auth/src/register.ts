import { hashPassword } from "./password"
import { DEFAULT_PASSWORD } from "./policy"
import { nowSeconds } from "./time"
import { user } from "./user"
import { createWorkspace } from "./workspace"

/**
 * 管理员录入账号（design-v2 §4.1，`2026-09-06-openhive-design-v2.md:147`）。
 *
 * FR-002：系统不提供自助注册入口，账号只能由这条路径建立。
 */

type NewUser = typeof user.$inferInsert

/**
 * 只需要「能往 `user` 表插一行」这一件事的窄接口。
 *
 * 为什么不直接收 drizzle 实例：两种 PG 驱动的数据库类型**互不可赋值**
 * （PGlite 的 `execute` 解析成 `{ rows }`、bun-sql 解析成裸数组，根因与 state.md 裁定 ④ 同源）。
 * 收窄到用得到的那一个方法，两种驱动都满足；`values` 的入参从 `$inferInsert` **推导**而非手抄，
 * 于是列名漂移和漏填 NOT NULL 列都由编译器兜住。
 */
export interface UserInsertTarget {
  insert(table: typeof user): { values(values: NewUser): PromiseLike<unknown> }
}

/** FR-003 的 8 个业务字段。 */
export interface RegisterInput {
  policeNo: string
  name: string
  idCard: string
  phone: string
  org: string
  dept: string
  section: string
  status: number
}

/** 录入成功后返回新账号的 id——T007 用它建沙箱目录 `/workspaces/{id}/`。 */
export async function registerUser(db: UserInsertTarget, input: RegisterInput): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await db.insert(user).values({
    id,
    policeNo: input.policeNo,
    name: input.name,
    idCard: input.idCard,
    phone: input.phone,
    org: input.org,
    dept: input.dept,
    section: input.section,
    status: input.status,
    passwordHash: await hashPassword(DEFAULT_PASSWORD),
    // 下面两个不靠列默认值：它们是**要求**，写在调用点才看得见。
    // `isAdmin: 0` 尤其重要——8 个业务字段里没有「是否管理员」，所以录入出来的账号一律不是管理员，
    // 提权必须是另一条独立路径（否则管理员录入界面就成了提权入口）。
    isAdmin: 0,
    mustChangePw: 1,
    createdAt: nowSeconds(),
  })

  return { id }
}

/** 一次录入的完整产物：账号 id，以及它的沙箱目录路径。 */
export interface ProvisionedUser {
  id: string
  workspace: string
}

/**
 * 管理员录入的**完整**动作：建账号 + 建沙箱目录（FR-003 要求两者一次发生）。
 *
 * 顺序是**先落库、后建目录**：
 * - 重复警号（T008）会在落库这一步就被 PG 的 UNIQUE 挡下，此时还没建目录，**不留垃圾目录**——
 *   这是更常见的失败，值得为它优化。
 * - 反过来若先建目录、落库失败，每次重试都漏一个空目录。
 *
 * 代价说清楚：建目录失败时账号行**已经存在**（PG 事务管不到文件系统，这里也不做补偿删除——
 * 删目录是破坏性操作，用户沙箱里可能有真实研判产物，宁可留一个空目录也不冒误删的风险）。
 * 故障会原样抛出，管理员看得见，不会静默得到一个没有沙箱的账号。
 */
export async function provisionUser(
  db: UserInsertTarget,
  input: RegisterInput,
  workspaceRoot: string,
): Promise<ProvisionedUser> {
  const { id } = await registerUser(db, input)
  const workspace = await createWorkspace(workspaceRoot, id)

  return { id, workspace }
}
