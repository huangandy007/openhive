import { describe, expect, test } from "bun:test"
import { ProjectMembership } from "@opencode-ai/core/project/membership"

/**
 * T004 · 微信群模型判定（FR-004 / FR-010）。
 *
 * 这一组测的是**「谁、在这条链上是什么身份 ⇒ 能不能做这件事」这一步**，不是表
 * （那半在 `packages/auth/src/project-member.test.ts`），也不是接线（T010/T013/T015）。
 *
 * ⚠️ 为什么判定是**纯函数**：表建在 auth 的 PG（走 auth 的迁移体系），而判定落 core
 * （U5 裁定：`project_member` 自成一条线、**不接** `core/access` capability）。
 * core **不依赖 auth**（`packages/auth/package.json` 的 deps 只有 drizzle-orm / hono），
 * 所以 core 侧碰不到库——它只认「已经取出来的身份」。取行那一步归 T010/T013/T015：
 * 那几处住在 `packages/opencode`，**只有它同时依赖 auth 与 core**。
 *
 * ## 判据为什么长这样（而不是「这些写法各自都对」）
 *
 * 每一条规则都写成**两个方向**：能做的必须能（否则功能坏了），不能做的**必须不能**
 * （否则是越权）。只测一侧会把「把所有人拦死」与「完全没判」分别当成通过
 * （004 的 `rls.ts` 不变式 3 是同一条：过松＝越权、过紧＝自己用不了）。
 *
 * ## 归档态（FR-010）的读法，是**一次明确的裁定**，不是顺手写的
 *
 * FR-010 的字面只说「归档后**成员**失权，owner 保留**找回**权」。本模块把它读成
 * 「**归档 = 冻结**」：归档后**除 owner 的找回与删除之外，任何动作都不成立**（含 owner 自己的
 * 邀请 / 移除 / 再来一次归档）。理由：归档的动作里沙箱文件已上传、本地已删，此时
 * 「邀请谁进来」「成员退群」都没有可作用的实体；有意义的出口是**找回**与**删除**（删除是
 * 2026-10-16 spec §7 追加的第二个出口）。
 * 方向是**收紧**（fail-closed）——比字面更严，不会放走任何一次越权。
 * 若本意是「owner 归档后仍可邀请」，那是一次**放宽**，要有据（`LEARNINGS #002-02`
 * 的同款取向：没测到的要写成缺口，放宽要有据）。
 */

/** 判定入参的简写——每个用例都写全字段，好读且不会漏 */
const ask = (
  actor: ProjectMembership.MemberRole | null,
  action: ProjectMembership.ProjectAction,
  options: { target?: ProjectMembership.MemberRole | null; archived?: boolean } = {},
) =>
  ProjectMembership.decide({
    actor,
    action,
    target: options.target ?? null,
    archived: options.archived ?? false,
  })

describe("微信群模型 · 邀请（FR-004：owner 与 member 均可邀请，被邀者 role=member）", () => {
  test("owner 可邀请、member 可邀请、非成员不能", () => {
    expect(ask("owner", "invite")).toBe(true)
    expect(ask("member", "invite")).toBe(true)
    // 非成员不能——邀请是**组内**动作，「谁都能拉人进别人的项目」是最重的一类洞
    expect(ask(null, "invite")).toBe(false)
  })
})

describe("微信群模型 · 移除（FR-004：仅 owner 能移除成员）", () => {
  test("owner 移除一个 member ⇒ 放行", () => {
    expect(ask("owner", "remove", { target: "member" })).toBe(true)
  })

  test("member 想移除别人 ⇒ 拒（AC3 的逐字判据）", () => {
    expect(ask("member", "remove", { target: "member" })).toBe(false)
  })

  test("非成员想移除别人 ⇒ 拒", () => {
    expect(ask(null, "remove", { target: "member" })).toBe(false)
  })

  /**
   * **owner 不可被移除**——即使是 owner 自己发起、即使目标是另一个 owner 身份。
   *
   * 少了这条，一个共享项目可以变成**没有 owner 的项目**：没人能归档、没人能找回，
   * 而库里那行 `project_member` 看起来完全正常。这与 FR-004「owner 不能退群」是同一条
   * 不变量的两面（那条管「自己走」，这条管「被别人弄走」）。
   */
  test("移除的目标是 owner ⇒ 拒（项目不能变成无主）", () => {
    expect(ask("owner", "remove", { target: "owner" })).toBe(false)
  })

  test("移除的目标不是成员 ⇒ 拒（fail-closed：调用方传错身份不放行）", () => {
    expect(ask("owner", "remove", { target: null })).toBe(false)
  })
})

describe("微信群模型 · 退群（FR-004：member 可退群、owner 不能退群）", () => {
  test("member 可退群", () => {
    expect(ask("member", "leave")).toBe(true)
  })

  test("owner 不能退群（AC4 后半句的逐字判据）", () => {
    expect(ask("owner", "leave")).toBe(false)
  })

  test("非成员谈不上退群 ⇒ 拒", () => {
    expect(ask(null, "leave")).toBe(false)
  })
})

describe("微信群模型 · 归档 / 找回（FR-008 / FR-009 / FR-010）", () => {
  test("未归档时：owner 可归档、member 与非成员不可", () => {
    expect(ask("owner", "archive")).toBe(true)
    expect(ask("member", "archive")).toBe(false)
    expect(ask(null, "archive")).toBe(false)
  })

  test("未归档的项目没有可找回的东西 ⇒ 找回被拒", () => {
    expect(ask("owner", "restore")).toBe(false)
  })

  /**
   * **FR-010 的两半，一次钉住**：归档后 owner 保留找回权。
   * 前半（成员失权）在下面那条「归档 = 冻结」里按闭集整组测。
   */
  test("已归档时：owner 可找回、member 不可", () => {
    expect(ask("owner", "restore", { archived: true })).toBe(true)
    expect(ask("member", "restore", { archived: true })).toBe(false)
  })

  /**
   * **「归档 = 冻结」按闭集整组测**，不是一个动作一个用例地挑。
   *
   * 逐动作各写一条的话，**新加一个动作时没人会回来补**——那条新动作会在归档态下
   * 悄悄放行，而全部用例照样绿（`LEARNINGS #002-06` 的形状：同一个判断两处各写一份，
   * 漏掉的那份不会红）。这里遍历 `PROJECT_ACTIONS`，新动作一加进来就自动进入本组。
   * 唯一的例外是 `restore`（它在上面那条「已归档时 owner 可找回、member 不可」单独钉）；
   * `delete` **不跳过**——member 在归档态下也不能删，正好被本循环的闭集断言钉住。
   */
  test("归档后 member 全失权（FR-010 前半）", () => {
    for (const action of ProjectMembership.PROJECT_ACTIONS) {
      if (action === "restore") continue
      expect(ask("member", action, { target: "member", archived: true })).toBe(false)
    }
  })

  test("归档后 owner 只留「找回」与「删除」（归档 = 冻结，见文件头）", () => {
    for (const action of ProjectMembership.PROJECT_ACTIONS) {
      // 归档态下**成立**的两个例外跳过（它们是同一条不变量的两个出口：找回把东西拉回来、
      // 删除把项目整个拿掉——都不产生活儿，见 `frozen` 那条注释）。
      if (action === "restore" || action === "delete") continue
      expect(ask("owner", action, { target: "member", archived: true })).toBe(false)
    }
    // 跳过的两个要有**正面**断言——跳过本身不证明它们成立（`LEARNINGS #005-36`：借前提的绿不是守护）。
    expect(ask("owner", "restore", { archived: true })).toBe(true)
    expect(ask("owner", "delete", { archived: true })).toBe(true)
  })
})

describe("T015 · 冻结（FR-010 的另一个出口：在项目里干活）", () => {
  /**
   * **两个投影必须一起动**（`LEARNINGS #004-02`）。`decide` 里那句「归档态下除 owner 的
   * `restore` 与 `delete` 之外没有动作成立」与 `frozen` 是**同一条规则的两个出口**：前者管
   * 「邀请 / 移除 / 退群 / 归档 / 找回 / 改名 / 删除」这个动作闭集，后者管**动作闭集之外**的那个出口——
   * 建会话、读写文件（`x-openhive-project` 那条链，判据落在
   * `middleware/project-location.ts`）。
   *
   * ⚠️ **这条断言是故意写成警报的**：谁将来**放宽** `decide` 的归档分支（例如让 owner
   * 在归档项目上还能 invite），它立刻红，逼人回来回答「那 `frozen` 还该不该为真」——
   * 而不是让两个投影各自长（`LEARNINGS #002-06` 的形状）。
   *
   * 写**取值断言**（`frozen(x) === !还有动作成立`）而不是比字符串/比常量：
   * 两个值由两条独立的路径算出来，**相等才是那条不变量本身**。
   */
  test("冻结 ⟺ 归档态下除「找回」与「删除」之外没有动作成立", () => {
    // 归档态下的两个例外（见上面那条）：它们都**不是**「在项目里干活」——
    // 一个把文件拉回沙箱、一个把项目整份拿掉，两者都不依赖项目目录存在。
    const 归档态例外 = new Set<ProjectMembership.ProjectAction>(["restore", "delete"])
    for (const archived of [true, false]) {
      const 还有别的动作成立 = ProjectMembership.PROJECT_ACTIONS.filter((action) => !归档态例外.has(action)).some(
        (action) =>
          [null, ...ProjectMembership.MEMBER_ROLES].some((actor) => ask(actor, action, { target: "member", archived })),
      )
      expect({ archived, 冻结: ProjectMembership.frozen(archived) }).toEqual({
        archived,
        冻结: !还有别的动作成立,
      })
    }
  })
})

describe("非成员在未归档的项目上（fail-closed 基线）", () => {
  /**
   * **没有身份 ⇒ 一条也放不过**。006 的会话创建是「取不到授权 ⇒ 不建会话」
   * （fail-closed），本模块要的是同一条取向：身份缺失的后果是**什么都不能做**，
   * 不是「按最强的身份处理」。按闭集遍历，理由同上一条。
   */
  test("非成员（actor = null）对任何动作都不成立", () => {
    for (const action of ProjectMembership.PROJECT_ACTIONS) {
      expect(ask(null, action, { target: "member" })).toBe(false)
    }
  })
})

describe("闭集（守卫型：多一项就红，不是「已知项都在就绿」）", () => {
  /**
   * 这两个数组**有第二处写法**：`MEMBER_ROLES` 与迁移里 `project_member.role` 的 CHECK 是
   * 同一份值的两处写法，由 `packages/opencode/test/server/openhive-project-member-closed-set.test.ts`
   * **逐值双向**比对（`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。
   * 本组只钉这两组值**本身**没被悄悄改宽——那是本包看得见的那半边。
   */
  test("MEMBER_ROLES / PROJECT_ACTIONS 逐值相等", () => {
    expect([...ProjectMembership.MEMBER_ROLES]).toEqual(["owner", "member"])
    expect([...ProjectMembership.PROJECT_ACTIONS]).toEqual([
      "invite",
      "remove",
      "leave",
      "archive",
      "restore",
      "rename",
      "delete",
    ])
  })
})

describe("项目级动作：改名 / 删除（2026-10-16 spec §7：两项都只有创建人能做）", () => {
  test("未归档时：owner 可改名、可删除；member / 非成员 都不可", () => {
    expect(ask("owner", "rename")).toBe(true)
    expect(ask("member", "rename")).toBe(false)
    expect(ask(null, "rename")).toBe(false)

    expect(ask("owner", "delete")).toBe(true)
    expect(ask("member", "delete")).toBe(false)
    expect(ask(null, "delete")).toBe(false)
  })

  /**
   * **已归档的项目也能删除**（spec §7）——但对 **member 仍然不行**。
   *
   * 只测 owner 那一侧会把「归档态下 delete 谁都放行」当成通过；只测 member 那一侧
   * 又会把「归档态下 delete 谁都不行」当成通过。两侧一起测才是 spec §7 的整句话。
   */
  test("已归档时：owner 仍可删除；member 仍不可（归档态只对 owner 的 delete 开口）", () => {
    expect(ask("owner", "delete", { archived: true })).toBe(true)
    expect(ask("member", "delete", { archived: true })).toBe(false)
    expect(ask(null, "delete", { archived: true })).toBe(false)
  })

  /**
   * **改名在归档态下被拒**（方向是**收紧**，同文件头那段「归档 = 冻结」的读法）。
   * spec §7 只给「已归档也能删」，没给「已归档也能改名」——归档项目的名字没有可作用的实体
   * （要改就先找回）。谁将来放宽它，这条会红，逼人回来补理由。
   */
  test("已归档时：owner 也不可改名（归档 = 冻结，理由见文件头）", () => {
    expect(ask("owner", "rename", { archived: true })).toBe(false)
  })
})

describe("角色的闭集解码（`asRole` / `actorIn`——2026-10-16 从三份副本收口到这里）", () => {
  /**
   * 这两条钉的是**「库里的字符串 ⇒ 闭集成员」这一步不许放宽**：`project_member.role`
   * 的 CHECK 与 `MEMBER_ROLES` 是同一份值的两处写法（文件头「镜像」），而这一层是
   * 从**库里取出来的字符串**走到判定之前的唯一一道门。认不出必须是 `null`（= 视作非成员），
   * **不是**「退化成 member / owner」——那是一次静默的越权（`LEARNINGS #003-05` 的取向）。
   */
  test("asRole：闭集内的取值认得，别的一律 null（含 undefined / 空串 / 大小写不同）", () => {
    expect(ProjectMembership.asRole("owner")).toBe("owner")
    expect(ProjectMembership.asRole("member")).toBe("member")
    expect(ProjectMembership.asRole("admin")).toBe(null)
    expect(ProjectMembership.asRole("Owner")).toBe(null)
    expect(ProjectMembership.asRole("")).toBe(null)
    expect(ProjectMembership.asRole(undefined)).toBe(null)
  })

  test("actorIn：在名单里 ⇒ 那个角色；不在名单里 / 认不出 ⇒ null", () => {
    const 名单 = [
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "member" },
      { userId: "u3", role: "退休" },
    ]
    expect(ProjectMembership.actorIn(名单, "u1")).toBe("owner")
    expect(ProjectMembership.actorIn(名单, "u2")).toBe("member")
    // 角色认不出 ⇒ 视作非成员，**不是**当成 member
    expect(ProjectMembership.actorIn(名单, "u3")).toBe(null)
    expect(ProjectMembership.actorIn(名单, "u9")).toBe(null)
    expect(ProjectMembership.actorIn([], "u1")).toBe(null)
  })
})
