import { eq } from "drizzle-orm"
import { hashPassword } from "./password"
import type { UserInsertTarget } from "./register"
import { nowSeconds } from "./time"
import { type UserAccountTarget, user } from "./user"

/**
 * 引导首个管理员（003 T019，002 评审 I1）。
 *
 * **为什么必须有**：`registerUser` 恒定写 `isAdmin: 0`——提权刻意是另一条独立路径，
 * 否则管理员录入界面就成了提权入口。而 F10 治理后台的全部能力（录入 / 重置 / 停用）
 * 都要求 `is_admin = 1`。两句话合起来就是：**全新部署上没有任何路径能产生第一个管理员**，
 * 系统第一天就锁死。本模块是那条唯一的例外。
 *
 * 例外的开关是**表级的那一句判断**——「`auth.user` 里一个 `is_admin = 1` 的行都没有」，
 * 不是「这个警号不是管理员」。差别在于：前者在系统有主之后**恒为假**，于是本模块整体退化成
 * 一次查询；后者则会让「把某个警号提权」变成一个能反复用的常开开关——**能改环境变量的人
 * 就能提权**，那正是 T019 明令不许做成的东西。
 *
 * ⚠️ **本模块只做领域判断，不碰环境变量、不连库、不调迁移**。这三件事是接线，落在
 * `packages/opencode/src/server/openhive/gateway.ts` 的层构造期——那边也才有「启动路径」
 * 这个上下文。分开的另一个理由：本文件因此能被测试直接喂一个真库调，不必起整个应用。
 */

/**
 * 本模块需要的全部数据库能力：**读行 + 改行 + 插行**三样都要。
 *
 * 它是既有两个窄接口的并集，而不是新写一份形状——`user.ts` 的注释解释过为什么接口要按用途
 * 收窄（登录只要「取行改行」，录入只要「插行」），本模块是第一个三样都要的用途：
 * 「先问表里有没有管理员」要读、「提权已有警号」要改、「建不存在的警号」要插。
 *
 * 复用并集而不是手抄一份，是为了让**形状漂移**只有一个来源：drizzle 的实例满足这三个方法，
 * 两种 PG 驱动（PGlite / bun-sql）也都满足，`db.test.ts` 有类型标注钉着生产驱动那一半。
 */
export type BootstrapTarget = UserAccountTarget & UserInsertTarget

/**
 * 引导的结果。三个取值对应三种**互斥**的处置，没有第四条路：
 *
 * - `skipped` —— 表里已经有管理员了，**一个字段都没动**（T019：「该变量完全无效」）
 * - `promoted` —— 表里没有管理员、但该警号已存在 ⇒ 只把这一行置成管理员
 * - `created` —— 表里没有管理员、该警号也不存在 ⇒ 建出账号并置成管理员
 *
 * 调用方拿到它可以判断「这次启动到底改了库没有」；它**不**替代断言——
 * 「提权提对了没有」仍要看行内容（见 `bootstrap.test.ts`）。
 */
export type BootstrapOutcome = "created" | "promoted" | "skipped"

/**
 * 把指定警号置为管理员——**仅当表里一个管理员都没有时**。
 *
 * 三件事按这个顺序做，顺序本身是被测对象：
 * ① 先问**表级**的那一句（理由见文件头）；② 再问该警号是否存在；③ 按存在与否改或建。
 *
 * ⚠️ **「置为管理员」不改密码、不改其他字段**（`promoted` 那一路）。被提权的账号可能已经
 * 改过密码、归属过组织，那些都是真数据，引导没有理由覆盖它们。
 * ⚠️ **停用的账号照样会被提权**（`promoted` 不读 `status`）。这一条如实记在这里而不是假装
 * 拦了：被提权的账号若 `status = 0`，它**登不进去**，系统仍然锁死，而引导会报 `promoted`。
 * 判据是「表里有没有管理员」而不是「有没有能登录的管理员」——后者会让引导在「已有停用管理员」
 * 时反复生效，把一次性开关变回常开。真要处理，应是 F10 的账号管理（启用它），不是这里。
 */
export async function bootstrapAdmin(
  db: BootstrapTarget,
  policeNo: string,
  defaultPassword: string,
): Promise<BootstrapOutcome> {
  if (await hasAdmin(db)) return "skipped"

  const existing = await findByPoliceNo(db, policeNo)
  if (!existing) {
    await createAdmin(db, policeNo, defaultPassword)
    return "created"
  }

  await db.update(user).set({ isAdmin: 1 }).where(eq(user.id, existing.id))
  return "promoted"
}

/**
 * 「表里已经有一个管理员了吗」。查的是**整张表**，与传进来的警号无关。
 *
 * 不写成 `select 1 ... limit 1`：`UserAccountTarget` 窄接口里没有 `limit`，
 * 为一句查询去放宽一个被登录 / 改密 / 僵尸扫描共用的接口，代价比多取几行大——
 * 管理员在真系统里是个位数量级。
 */
async function hasAdmin(db: UserAccountTarget): Promise<boolean> {
  const rows = await db.select().from(user).where(eq(user.isAdmin, 1))
  return rows.length > 0
}

/** 按警号取行。与 `login.ts` 里那份同名同形——**第二处，还没到提上来的时候**（那个文件注明「出现第三处就该提到 `user.ts`」）。 */
async function findByPoliceNo(db: UserAccountTarget, policeNo: string) {
  const [record] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  return record
}

/**
 * 建出这个管理员账号。
 *
 * **8 个 NOT NULL 业务字段里，引导只知道警号**（2026-10-01 用户裁定）：
 * - `name` 用**警号本身**——它不是假姓名，就是登录名，顶栏至少能认出登的是哪个账号；
 * - `idCard` / `phone` / `org` / `dept` / `section` 留**空串**（= 未录入，NOT NULL 允许）。
 *   **不编造身份数据**：公安库里这两列是明文、是研判对象，填任何假值都比空串危险得多。
 *   空串与「真的没填」不可区分，但 NOT NULL 下本来也只能这样；待 F10 的账号管理补录。
 * - `status = 1`：填 0 的话建出来就登不进去，等于白引导（`login()` 认状态）。
 *
 * ⚠️ **不做「警号重复」的容错**（不捕获 23505）。上面的 `findByPoliceNo` 与这次 insert 之间
 * 有 TOCTOU 窗口：两个实例同时对同一台空库引导时，后到的那个会撞 UNIQUE 而**当场起不来**
 * （`Effect.promise` 的语义，见网关）。如实记着而不是假装闭合——它自愈：那个实例重启后
 * 会看到管理员已存在，安静跳过。想消除它要么加锁、要么捕获后重判，两条都超出「一次性引导」
 * 需要的复杂度，留待真有并发引导需求时再谈。
 */
async function createAdmin(db: UserInsertTarget, policeNo: string, defaultPassword: string): Promise<void> {
  const passwordHash = await hashPassword(defaultPassword)

  await db.insert(user).values({
    id: crypto.randomUUID(),
    policeNo,
    name: policeNo,
    idCard: "",
    phone: "",
    org: "",
    dept: "",
    section: "",
    status: 1,
    passwordHash,
    isAdmin: 1,
    // 与 `registerUser` 同一条理由：默认口令是**公开的**（`policy.ts` 里就写着），
    // 所以「首次登录必须改密」不是可选项——不置 1 的话，引导出来的管理员就带着一个
    // 写在仓库里的口令、顶着管理员权限长驻。
    mustChangePw: 1,
    createdAt: nowSeconds(),
  })
}
