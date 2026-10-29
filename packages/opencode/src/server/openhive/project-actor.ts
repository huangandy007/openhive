/**
 * 「这个人**在这个项目里**是什么角色」——判据只有这一份（`LEARNINGS #002-06` / `#010-06`）。
 *
 * 2026-10-29 从 `project-assets.ts` 的私有函数**原样搬出来**：备份出口（`backup.ts` 的
 * `authorize()`）当时只问 PG，于是同一批老项目点备份回 403「无权访问该项目的备份」，
 * 前端再把 403 翻译成「备份没能起起来」（真栈实报：13 个项目里 11 个如此）。同一个判断
 * 再抄第二份就是「两处各判一次同一件事」，所以搬到这里，资产与备份各 import 一次。
 *
 * ## 两道来源，顺序即优先级（2026-10-28 修：自己的老项目被判「不是该项目成员」）
 *
 * ① **PG `auth.project_member`**：共享项目的真相。有行就按行，**不再往下问**。
 * ② **老项目**（多租户改造前建的）：PG 的 `project_member` / `project_meta` 一条行都没有，
 *    它只存在于**调用者自己的**每用户 SQLite（`project_ext` 一行）里。此时认那行为**属主**
 *    ——平台对「能不能进这个项目」的全局口径本来就是它：中间件 `project-location.ts` 与
 *    `file.ts` 的 gate 都只查这一份，从不查 PG。不补这一支，用户自己的项目在这里被拒，
 *    而文件树、会话全都正常（真栈实测：13 条项目清单里 11 条如此）。
 *
 * ## ⚠️ PG 认识的项目**一字不放宽**
 *
 * 「认识」= 有**任何人的**成员行，或有 `project_meta` 行。只要 PG 认识它，就只认 `rolesOf`：
 * 否则一条陈旧 / 迁移残留的 `project_ext` 行就能让非成员动**别人项目**的共享态
 * （资产启用记录、备份快照都是项目级共享态，不是个人态）。
 *
 * ⚠️ 放宽只到 `owner`：老项目里没有「成员」这个概念，创建者就是属主。
 */
import { membersOf, projectMetaOf, rolesOf, type ProjectMemberTarget } from "@opencode-ai/auth/project-member"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectExt } from "@opencode-ai/core/project/ext"
import { Effect } from "effect"

/**
 * 判据要的两份库：共享 PG（名册的真相）＋ **调用者自己**的每用户 SQLite（老项目的唯一证据）。
 *
 * ⚠️ `pg` 收的是**已经取出来的客户端**，不是取它的函数——调用方各自的 `Deps` 形状不同
 * （资产那边是 `deps.pg()` getter，备份那边是层构造期取好的常量），本模块不替它们选。
 */
export interface 成员角色依赖 {
  readonly pg: ProjectMemberTarget
  readonly database: Database.Interface
}

/** 角色名（`owner` / `member`）；`undefined` = 不是成员（含项目不存在）。 */
export function 成员角色(
  deps: 成员角色依赖,
  userId: string,
  projectId: string,
): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const roles = yield* Effect.promise(() => rolesOf(deps.pg, { userId, projectIds: [projectId] }))
    const 角色 = roles.get(projectId)
    if (角色 !== undefined) return 角色
    // 查的是**调用者自己那份**库：没有这一行（不是他建的 / 老项目以外的形态）⇒ 不是属主。
    const 自建 = yield* ProjectExt.findByProjectID(deps.database.db, projectId)
    if (自建 === undefined) return undefined
    // PG 认识它吗？认识 ⇒ 用 PG 的话（见上面「一字不放宽」）。
    const 已登记 = yield* Effect.promise(async () => {
      const [成员, 元信息] = await Promise.all([membersOf(deps.pg, projectId), projectMetaOf(deps.pg, [projectId])])
      return 成员.length > 0 || 元信息.has(projectId)
    })
    if (已登记) return undefined
    return "owner"
  })
}
