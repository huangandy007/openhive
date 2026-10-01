import { mkdir, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { assertSafeUserId } from "./workspace"

/**
 * 沙箱目录的**归档 / 恢复 / 删除**（003 T018，FR-010 的文件系统那半边）。
 *
 * ## 为什么要有
 *
 * FR-010：「账号停用后，其沙箱目录与数据 MUST 保留 30 天再归档/删除，避免误删；保留期内可恢复。」
 * 002 交了**账号侧**那一半（`deactivated_at` 列、`restoreAccount`、逾期清单筛选），
 * 文件系统这一半当时**没有可作用的对象**——沙箱还只是 `createWorkspace` 建的空目录。
 * 003 把目录锚定（T006）与配额（T011）落地后，它才成为一个有真实研判产物的东西。
 *
 * ## 三个动作是一个**单向**的生命周期
 *
 * ```
 *   {root}/{userId}/            ──归档──▶  {root}/.archived/{userId}/  ──删除──▶  （没了）
 *          ▲                                          │
 *          └────────────────恢复───────────────────────┘
 * ```
 *
 * **删除只够得到归档区**（`deleteSandbox` 的活动目录那一侧根本没有参数能指过去）——
 * 这是刻意的：FR-010 的「避免误删」在代码上就成立，而不是靠调用方记得别传错。
 * 002 拒绝自动删空目录的原话是「宁可留一个空目录也不冒误删的风险」，这条把它做实。
 *
 * ## 只做领域动作，不做判定
 *
 * 「哪些账号逾期了」是 `zombie.ts` 的 `findArchivableAccounts` 的事，本模块**不读库、
 * 不读环境变量**：输入就是 `(root, userId)`。那两者之间「谁在什么时候调」这一步
 * **本 feature 做不到**（仓库里没有调度器、没有端点），如实登记在 `tasks.md` 的 T018 段，
 * **不当成已闭合**。
 *
 * ## 归档用 rename，不是复制也不是打包
 *
 * 2026-10-01 用户裁定【甲】：同卷 `rename` 到 `{root}/.archived/{userId}/`。
 * 同卷 rename 是**原子**操作、不复制字节（大沙箱也瞬时完成），且恢复就是 rename 回去。
 * 代价如实记：**省不了盘**——归档物仍占同一卷；真要省盘得打包，那会把归档从瞬时变成
 * 分钟级、并引入「打包到一半」的中间态，不划算。
 *
 * ⚠️ **归档案不受磁盘配额约束**：`disk-quota.ts` 的 `sandboxOf` 按路径首段认沙箱
 * （`{root}/.archived/...` 会被认成名叫 `.archived` 的「沙箱」），而归档动作走的是
 * `rename`、**不经过写漏斗**（`FSUtil.writeWithDirs`），所以配额根本看不到它。
 * 后果：一个被归档的大沙箱不会被拒绝、也不计入任何人的配额。这是可接受的
 * （它已经不被写入），但**要知道**。
 */

/** 归档区在沙箱根下的目录名。 */
export const ARCHIVED_DIRNAME = ".archived"

/** 某人归档后的位置。**内部用**——导出它等于把路径拼法变成公开 API，而它只有一个用法。 */
const archivedPath = (root: string, userId: string) => join(root, ARCHIVED_DIRNAME, userId)

/**
 * 文件 / 目录在不在。`stat` 抛错一律当「不在」。
 *
 * 用 `stat` 而不是 `access`：后者在 win32 上对目录的判定与 Linux 不一致，而本机就是 win32。
 * 落在这里的错都要当「不在」——三个动作都是「存在 ⇒ 动它」，把权限错当成「存在」只会让
 * 后面的 `rename` 抛一个更难懂的错。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 把沙箱从活动位置移进归档区，返回归档后的路径；**没有可归档的东西时返回 `undefined`**。
 *
 * 返回 `undefined` 的两种情形都是**正常的**，不该炸：
 * - ① **从没建过沙箱**——历史账号没有 `/workspaces/{userId}/` 是已知情况
 *   （`isolation-scheme.md` §1 对 `/data` 说过同一件事），批量归档时它不该打断整批；
 * - ② **已经归档过了**——重复调用幂等，这是自动化重试的常见形状。
 *
 * 两者都**不建空的归档区**：留一个空目录会让人以为「这里有东西」。
 *
 * ⚠️ **两个位置同时有东西 ⇒ 抛错**。那不是上面两种可幂等的重复，是真冲突
 * （比如有人手工把目录搬回来过），**不猜、不合并、不丢任何一边**。
 */
export async function archiveSandbox(root: string, userId: string): Promise<string | undefined> {
  assertSafeUserId(userId, "归档沙箱")

  const live = join(root, userId)
  const stored = archivedPath(root, userId)

  if (!(await exists(live))) return undefined
  if (await exists(stored)) {
    throw new Error(
      `沙箱归档冲突：活动位置与归档区同时存在 ${JSON.stringify(userId)}——` +
        `没有动任何一边，请人工确认后再归档`,
    )
  }

  // 与 `createWorkspace` 同款 `mode`（T007 / `isolation-scheme.md` §4）：`recursive` 时
  // mode 只作用于**新建**的目录，所以归档区被建出来时是 0700。按 §5 裁定乙，这个位
  // 不隔用户（单进程 = 一个 OS 主体），挡的是容器外。
  await mkdir(join(root, ARCHIVED_DIRNAME), { recursive: true, mode: 0o700 })
  await rename(live, stored)

  return stored
}

/**
 * 把归档移回活动位置，返回活动路径。
 *
 * ⚠️ **归档区里没有它 ⇒ 抛错**，不安静返回。恢复是管理员的明确动作，
 * 「它不在归档区里」是一个该被说出来的事实——可能已经恢复过、也可能这个 id 根本不是
 * 他以为的那个。做成「目标状态已达成 ⇒ 安静成功」会让这两件事长得一模一样。
 *
 * ⚠️ **活动位置已经有东西 ⇒ 抛错**（2026-10-01 用户裁定：**拒绝**）。场景是账号被恢复后
 * 重新启用、沙箱又被建了出来，此时再点一次「从归档恢复」——自动合并会**静默覆盖活动目录
 * 里的同名文件**，那正是 FR-010 要防的误删。两个目录都原样留着，报错说明冲突。
 */
export async function restoreSandbox(root: string, userId: string): Promise<string> {
  assertSafeUserId(userId, "恢复沙箱")

  const live = join(root, userId)
  const stored = archivedPath(root, userId)

  if (!(await exists(stored))) {
    throw new Error(
      `沙箱恢复失败：归档区里没有 ${JSON.stringify(userId)}` +
        `（若活动目录已存在，可能此前已恢复过）——没有动任何一边`,
    )
  }
  if (await exists(live)) {
    throw new Error(
      `沙箱恢复冲突：活动位置与归档区同时存在 ${JSON.stringify(userId)}——` +
        `没有动任何一边，请人工确认后再恢复`,
    )
  }

  await rename(stored, live)

  return live
}

/**
 * **永久**删除归档区里的沙箱。
 *
 * ⚠️ **只够得到归档区**：活动沙箱没有参数能指过来（要删它得先归档）。这不是便利取舍，
 * 是 FR-010「避免误删」的落点——见文件头那张图。因此「没归档过的沙箱」会**抛错**，
 * 而不是去把活动目录删了。
 *
 * `recursive` ——沙箱是一棵树（项目子目录、产物、`.git`）。
 * `force` ——顶层已不存在时不抛 ENOENT；但**调用前先判存在**，因为「删了个不存在的东西」
 * 与「删成功了」对调用方是两件事（`rm` 的静默成功在这里是错的）。
 */
export async function deleteSandbox(root: string, userId: string): Promise<void> {
  assertSafeUserId(userId, "删除沙箱")

  const stored = archivedPath(root, userId)

  if (!(await exists(stored))) {
    throw new Error(
      `沙箱删除失败：归档区里没有 ${JSON.stringify(userId)}——` +
        `本函数只删归档区（活动沙箱要先归档），没有删任何东西`,
    )
  }

  await rm(stored, { recursive: true, force: true })
}
