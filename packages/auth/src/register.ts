import { hashPassword } from "./password"
import { DEFAULT_PASSWORD } from "./policy"
import { nowSeconds } from "./time"
import { user } from "./user"

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
