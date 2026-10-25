import { describe, expect, test } from "bun:test"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import type { AssetMetadata } from "./metadata"
import { AssetTransitionError, type SkillAction } from "./lifecycle"
import { TRANSITION_REQUIRED_PERMS, authorizeTransition } from "./review"

/**
 * 009 T009 · 审核两道关（业务审核 / 技术发布分离）。
 *
 * 判据只认「这个人在这份资产上有什么权限」，不认调用方自称的角色：
 * - 业务关（通过 / 驳回）要 `review`；
 * - 技术关（发布 / 下线 / 归档）要 `admin`；
 * - 作者动作（提交 / 发起迭代）要 `write`。
 *
 * 「分离」= `admin` 不蕴含 `review`、`review` 不蕴含 `admin`（design §3.3）。
 */

const 作者 = { userId: "u1", department: "经侦支队" }
const 业务管理员 = { userId: "u2", department: "法制支队" }
const 系统管理员 = { userId: "u3", department: "科信支队" }

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_1",
    name: "资金流向研判",
    type: "skill",
    description: "按账户汇总",
    icon: "skill",
    category: "intelligence",
    tags: [],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "in_review",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: null,
    archivedAt: null,
    ...over,
  }
}

function 授权(perm: string): GrantRow {
  return { resourceType: "skill", resourceId: "asset_1", perm }
}

function 错误码(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof AssetTransitionError) return error.code
    throw error
  }
  return undefined
}

describe("角色 → 所需权限（design §3.3）", () => {
  test("作者动作要写、业务关要审、技术关要管", () => {
    expect(TRANSITION_REQUIRED_PERMS).toEqual({
      author: "write",
      business_reviewer: "review",
      system_admin: "admin",
    })
  })
})

describe("authorizeTransition：由权限派生角色", () => {
  test("作者（本人）可提交审核 / 发起迭代", () => {
    expect(authorizeTransition(作者, 资产({ status: "draft" }), [], "submit_review")).toBe("author")
    expect(authorizeTransition(作者, 资产({ status: "published" }), [], "start_iteration")).toBe(
      "author",
    )
  })

  test("有 review 授权的人过业务关：通过 / 驳回", () => {
    expect(authorizeTransition(业务管理员, 资产(), [授权("review")], "approve_business")).toBe(
      "business_reviewer",
    )
    expect(authorizeTransition(业务管理员, 资产(), [授权("review")], "reject_business")).toBe(
      "business_reviewer",
    )
  })

  test("有 admin 授权的人过技术关：发布 / 下线 / 归档", () => {
    const 待发布 = 资产({ status: "pending_tech" })
    expect(authorizeTransition(系统管理员, 待发布, [授权("admin")], "publish_tech")).toBe(
      "system_admin",
    )
    expect(
      authorizeTransition(系统管理员, 资产({ status: "published" }), [授权("admin")], "take_offline"),
    ).toBe("system_admin")
    expect(
      authorizeTransition(系统管理员, 资产({ status: "published" }), [授权("admin")], "archive"),
    ).toBe("system_admin")
  })

  test("两道关互不蕴含：review 不能发布，admin 不能业务审核", () => {
    expect(
      错误码(() =>
        authorizeTransition(业务管理员, 资产({ status: "pending_tech" }), [授权("review")], "publish_tech"),
      ),
    ).toBe("actor_not_allowed")
    expect(
      错误码(() => authorizeTransition(系统管理员, 资产(), [授权("admin")], "approve_business")),
    ).toBe("actor_not_allowed")
  })

  test("作者不能自审：作者身份只给 write，不给 review / admin", () => {
    expect(错误码(() => authorizeTransition(作者, 资产(), [], "approve_business"))).toBe(
      "actor_not_allowed",
    )
    expect(
      错误码(() => authorizeTransition(作者, 资产({ status: "pending_tech" }), [], "publish_tech")),
    ).toBe("actor_not_allowed")
  })

  test("显式 write 授权的非作者也算「作者动作」的执行人（写权语义）", () => {
    expect(authorizeTransition(业务管理员, 资产({ status: "draft" }), [授权("write")], "submit_review")).toBe(
      "author",
    )
  })

  test("重新上线：作者或管理员任一即可", () => {
    const 下线 = 资产({ status: "offline" })
    expect(authorizeTransition(作者, 下线, [], "bring_online")).toBe("author")
    expect(authorizeTransition(系统管理员, 下线, [授权("admin")], "bring_online")).toBe("system_admin")
    expect(错误码(() => authorizeTransition(业务管理员, 下线, [授权("review")], "bring_online"))).toBe(
      "actor_not_allowed",
    )
  })

  test("没有任何权限 ⇒ actor_not_allowed，消息写明需要什么", () => {
    const 路人 = { userId: "u9", department: "经侦支队" }
    const error = (() => {
      try {
        authorizeTransition(路人, 资产(), [], "approve_business")
      } catch (caught) {
        if (caught instanceof Error) return caught
        throw caught
      }
      throw new Error("期望抛错")
    })()

    expect(错误码(() => authorizeTransition(路人, 资产(), [], "approve_business"))).toBe(
      "actor_not_allowed",
    )
    expect(error.message).toContain("review")
  })

  test("未知动作 ⇒ unknown_action（与状态机的错误码一致）", () => {
    expect(
      错误码(() =>
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 故意传未知动作：HTTP / MCP 边界上它就是个任意字符串
        authorizeTransition(作者, 资产(), [], "not_an_action" as SkillAction),
      ),
    ).toBe("unknown_action")
  })
})
