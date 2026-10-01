import { rmdir } from "node:fs/promises"
import { hashPassword } from "./password"
import { AccountWriteError, pgErrorCode } from "./pg-errors"
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

/**
 * 录入成功后返回新账号的 id——T007 用它建沙箱目录 `/workspaces/{id}/`。
 *
 * `defaultPassword` 是**调用方解析好的值**（`policy.ts` 的 `defaultPassword(env)`），
 * 本函数不读 env——照 `createWorkspace(root, userId)` 的形状：**解析归解析、动作归动作**。
 * 它是**必填**的：默认密码没有兜底（兜底 = 生产忘了配时静默使用公开示例口令，
 * 正是 003 T020 要治的病），所以「忘了传」在编译期就该拦住，而不是运行期降级。
 */
export async function registerUser(
  db: UserInsertTarget,
  input: RegisterInput,
  defaultPassword: string,
): Promise<{ id: string }> {
  validate(input)

  const id = crypto.randomUUID()

  await insertUser(db, input, id, defaultPassword)

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
async function insertUser(
  db: UserInsertTarget,
  input: RegisterInput,
  id: string,
  defaultPassword: string,
): Promise<void> {
  // 哈希在 try **之外**算（同 `password.ts` 的两处）：否则 `Bun.password.hash` 自己抛的错
  // 也会被下面的 catch 收走、包成 `AccountWriteError(undefined)`——没有 SQLSTATE，
  // 看不出「是哈希失败」还是「是库失败」。
  const passwordHash = await hashPassword(defaultPassword)

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
 * ## 顺序是**先建目录、后落库**（T022 反转，理由见下）
 *
 * 反转前是「先落库、后建目录」，代价写在当时的注释里：「建目录失败时账号行已经存在……
 * 故障会原样抛出，管理员看得见，不会静默得到一个没有沙箱的账号」。**那句只对了一半**：
 * 错误确实抛出去了，但**库里那行没人管**，而它有后果——
 *
 * - 它带着**默认口令的 hash**、`status` 取自录入表单（正常录入新民警就是 1），
 *   而 `login` 的判据只卡 `status !== 1` 与密码 ⇒ **它能登录**。
 *   一次管理员看到的「失败」，实际留下了一个**能过认证、却没有沙箱**的账号。
 * - 它还**挡住重试**：同警号再录一次撞 UNIQUE，管理员只会看到「该警号已录入」，
 *   而那个账号用不了——他没有第二条路，只能进库。
 *
 * ⇒ 出参要的是「**不再留下有账号没沙箱的半成品**」。反转顺序让它**结构性做不到**：
 * 目录建不出来时，账号行**根本还没被插**。这比「落库成功后再补一次删除」强在崩溃窗口上——
 * 后者的窗口里半成品照样留在库里（两者都满足测试里的断言，差别在这里，见 `register.test.ts`）。
 *
 * ## 反转之后，原来那条理由还在吗
 *
 * 在。原注释说「重复警号会先被 UNIQUE 挡下，**不留垃圾目录**，这是更常见的失败，
 * 值得为它优化」——那个**结果**靠下面的清理保住了，代价是常见失败多一次 `mkdir` + `rmdir`。
 *
 * ## 两处刻意的取舍
 *
 * 1. **清理用 `rmdir` 而不是 `rm -r`**：`rmdir` **拒绝删除非空目录**，这个安全性是内建的。
 *    我们建的目录里不可能有东西（`id` 是本次新生成的 UUID，必然是新目录），但只要有人
 *    改了上面那行 `crypto.randomUUID()`、让它复用已有目录，`rmdir` 就会**拒绝**而不是
 *    连同用户真实的研判产物一起删掉。原注释担心的「误删风险」就是靠这条挡住的。
 * 2. **清理自己失败时吞掉，绝不覆盖原始错误**：管理员要知道的是「警号重复」，
 *    不是「删目录失败」。吞掉是可接受的——留下的只是一个空目录，而它不挡任何人的路
 *    （下次录入用的是新 UUID）。`register.test.ts` 有一条钉着抛出的仍是领域错误。
 *
 * ## 与 `registerUser` 的关系
 *
 * 本函数**不再调 `registerUser`**：反转顺序需要**先拿到 id 再落库**，而 `registerUser`
 * 自己生成 id、拿到就插。代价是两者共用 `validate` / `insertUser`，但插入的**时机**各写一遍；
 * 改动其中一个时记得看另一个。
 */
export async function provisionUser(
  db: UserInsertTarget,
  input: RegisterInput,
  workspaceRoot: string,
  defaultPassword: string,
): Promise<ProvisionedUser> {
  // 校验**必须**排在建目录之前：反转到「先建目录」之后，非法输入若走到文件系统，
  // 就会留下一个垃圾目录——而这是本次改动自己引入的风险（改前是「先落库」，走不到这里）。
  validate(input)

  const id = crypto.randomUUID()
  const workspace = await createWorkspace(workspaceRoot, id)

  try {
    await insertUser(db, input, id, defaultPassword)
  } catch (cause) {
    try {
      await rmdir(workspace)
    } catch {
      // 见上面取舍 ① ②：目录非空（有人改过 id 的生成方式）或文件系统不配合，都放过。
      // **不能**在这里抛——那会把「警号重复」盖成「删目录失败」。
    }
    throw cause
  }

  return { id, workspace }
}
