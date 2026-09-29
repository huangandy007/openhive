import { hashPassword } from "./password"
import { AccountWriteError, pgErrorCode } from "./pg-errors"
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

/** 警号已存在（FR-001：警号唯一）。供后台把拒绝转成「该警号已录入」这类提示。 */
export class DuplicatePoliceNoError extends Error {
  constructor(policeNo: string, options?: ErrorOptions) {
    super(`警号已存在：${policeNo}`, options)
    this.name = "DuplicatePoliceNoError"
  }
}

/**
 * 录入时某个必填字段没填（**纯空白也算没填**）。
 *
 * FR-003 写的是「MUST 填写 8 个业务字段」——8 列全是 NOT NULL，所以「填了个空白」
 * 是唯一能绕开 NOT NULL、造出一个「有行但没有姓名」的账号的路径。
 * `field` 带出来，后台好把提示落到对应输入框上。
 */
export class MissingFieldError extends Error {
  /** 出问题的字段名（`RegisterInput` 的键）。 */
  readonly field: string

  constructor(field: string) {
    super(`必填字段为空：${field}`)
    this.name = "MissingFieldError"
    this.field = field
  }
}

/**
 * `status` 越界。
 *
 * 定义就在 design-v2 §4.1 的列注释里：`status INTEGER NOT NULL -- 状态（1 启用 / 0 停用）`。
 * 越界的值不会「表现成某种状态」——僵尸扫描按 `= 1`、归档按 `= 0`，两个都匹配不上，
 * 账号于是**从两边视野里同时消失**：既不提醒也不归档，还不报错。
 */
export class InvalidStatusError extends Error {
  constructor(status: number) {
    super(`状态取值非法：${status}（只允许 1 启用 / 0 停用）`)
    this.name = "InvalidStatusError"
  }
}

/** PG 的 unique_violation 错误码。 */
const UNIQUE_VIOLATION = "23505"

/** 8 个业务字段里除 `status` 之外的 7 个文本字段。 */
const TEXT_FIELDS = ["policeNo", "name", "idCard", "phone", "org", "dept", "section"] as const

/**
 * 录入前校验（FR-003「MUST 填写 8 个业务字段」）。
 *
 * **刻意只拦「填了等于没填」，不trim后入库**：`" 000123 "` 里的空格是管理员真敲进去的，
 * 悄悄改掉比报错更难排查（他复制粘贴带了个尾随空格，此后按 `000123` 永远登不进来，
 * 而库里那一行看起来完全正常）。要不要归一化是另一个决定，spec 没写，不擅自定。
 */
function validate(input: RegisterInput): void {
  for (const field of TEXT_FIELDS) {
    // `typeof` 那一半不是多余的：交进来的是网关解析出的 JSON，`null` / 缺键在类型上不存在、
    // 运行时会到——`.trim()` 撞上 undefined 是 TypeError，会把「少填一个字段」变成 500。
    const value: unknown = input[field]
    if (typeof value !== "string" || value.trim().length === 0) throw new MissingFieldError(field)
  }

  if (input.status !== 0 && input.status !== 1) throw new InvalidStatusError(input.status)
}

/** 录入成功后返回新账号的 id——T007 用它建沙箱目录 `/workspaces/{id}/`。 */
export async function registerUser(db: UserInsertTarget, input: RegisterInput): Promise<{ id: string }> {
  validate(input)

  const id = crypto.randomUUID()

  await insertUser(db, input, id)

  return { id }
}

/**
 * 落库，并把「警号重复」翻译成领域错误。
 *
 * **靠捕获 23505，不做前置 SELECT 预检**：预检有 TOCTOU 竞态——两个管理员同时录同一个警号，
 * 双方都通过预检，仍会有一个撞上 UNIQUE。既然省不掉捕获，预检就只是多一次查询。
 *
 * 非 23505 的错误一律换成**不带参数**的 `AccountWriteError`（带出 SQLSTATE），
 * **绝不原样抛、也绝不误判成「警号重复」**——原样抛会把这条 insert 的参数
 * （含 `password_hash` / `id_card` / `phone`）随 drizzle 错误的 message 一起带出去。
 */
async function insertUser(db: UserInsertTarget, input: RegisterInput, id: string): Promise<void> {
  // 哈希在 try **之外**算（同 `password.ts` 的两处）：否则 `Bun.password.hash` 自己抛的错
  // 也会被下面的 catch 收走、包成 `AccountWriteError(undefined)`——没有 SQLSTATE，
  // 看不出「是哈希失败」还是「是库失败」。
  const passwordHash = await hashPassword(DEFAULT_PASSWORD)

  try {
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
      passwordHash,
      // 下面两个不靠列默认值：它们是**要求**，写在调用点才看得见。
      // `isAdmin: 0` 尤其重要——8 个业务字段里没有「是否管理员」，所以录入出来的账号一律不是管理员，
      // 提权必须是另一条独立路径（否则管理员录入界面就成了提权入口）。
      isAdmin: 0,
      mustChangePw: 1,
      createdAt: nowSeconds(),
    })
  } catch (cause) {
    const sqlState = pgErrorCode(cause)
    if (sqlState === UNIQUE_VIOLATION) {
      // ⚠️ **不要把 `cause` 原样挂上去**：`DrizzleQueryError.message` 内联了查询参数，
      // 而这条 insert 的参数里同时有 `password_hash` / `id_card` / `phone`。
      // 只带 SQLSTATE 出门——它仍让 `pgErrorCode(本错误)` 取到 `23505`，排查线索没丢。
      throw new DuplicatePoliceNoError(input.policeNo, { cause: { code: sqlState } })
    }
    // 同理：其余 PG 错误（42P01 之类）也**不能原样抛出**（这条 insert 的参数里有同样的东西）。
    // 换成不带参数的 `AccountWriteError`，SQLSTATE 单独带出去。
    throw new AccountWriteError(sqlState)
  }
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
