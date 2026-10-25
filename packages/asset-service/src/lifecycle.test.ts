import { describe, expect, test } from "bun:test"
import {
  AssetTransitionError,
  SKILL_TRANSITIONS,
  allowedSkillActions,
  applySkillTransition,
  isAssetUsable,
  isTerminalStatus,
} from "./lifecycle"
import { ASSET_STATUSES, type AssetStatus } from "./metadata"

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    if (error instanceof AssetTransitionError) return error.code
    throw error
  }
}

describe("Skill 7 状态机（FR-004 / D0-7）", () => {
  test("每个状态都有一条从草稿出发的正向可达路径（#008-04）", () => {
    const reachable = new Set<AssetStatus>(["draft"])
    const queue: AssetStatus[] = ["draft"]

    while (queue.length > 0) {
      const from = queue.shift()
      if (from === undefined) break
      for (const transition of SKILL_TRANSITIONS) {
        if (!(transition.from as readonly AssetStatus[]).includes(from)) continue
        if (reachable.has(transition.to)) continue
        reachable.add(transition.to)
        queue.push(transition.to)
      }
    }

    expect([...reachable].sort()).toEqual([...ASSET_STATUSES].sort())
  })

  test("提交 → 业务通过 → 技术发布 的完整路径", () => {
    const submitted = applySkillTransition("draft", "submit_review", { actor: "author" })
    expect(submitted.to).toBe("in_review")

    const approved = applySkillTransition(submitted.to, "approve_business", {
      actor: "business_reviewer",
    })
    expect(approved.to).toBe("pending_tech")

    const published = applySkillTransition(approved.to, "publish_tech", { actor: "system_admin" })
    expect(published.to).toBe("published")
  })

  test("业务审核通过只能到待技术发布，不能直接发布", () => {
    expect(errorCode(() => applySkillTransition("in_review", "publish_tech", { actor: "system_admin" }))).toBe(
      "invalid_source",
    )
    expect(
      SKILL_TRANSITIONS.find((transition) => transition.action === "approve_business")?.to,
    ).toBe("pending_tech")
  })

  test("驳回回到草稿，且必须带非空理由", () => {
    const rejected = applySkillTransition("in_review", "reject_business", {
      actor: "business_reviewer",
      reason: "规则只适用于本专案，不可泛化",
    })
    expect(rejected.to).toBe("draft")
    expect(rejected.reason).toBe("规则只适用于本专案，不可泛化")

    expect(
      errorCode(() =>
        applySkillTransition("in_review", "reject_business", {
          actor: "business_reviewer",
          reason: "   ",
        }),
      ),
    ).toBe("reason_required")
  })

  test("发起迭代后旧版仍可用，新版本发布回到已发布", () => {
    const iterating = applySkillTransition("published", "start_iteration", { actor: "author" })
    expect(iterating.to).toBe("iterating")
    expect(isAssetUsable("iterating")).toBe(true)

    const republished = applySkillTransition("iterating", "publish_iteration", {
      actor: "system_admin",
    })
    expect(republished.to).toBe("published")
  })

  test("迭代发布同时要求业务复审与技术发布两道关", () => {
    const transition = SKILL_TRANSITIONS.find((item) => item.action === "publish_iteration")
    expect(transition?.gates).toEqual(["business_review", "technical_publish"])
  })

  test("下线与重新上线", () => {
    expect(applySkillTransition("published", "take_offline", { actor: "system_admin" }).to).toBe("offline")
    expect(applySkillTransition("offline", "bring_online", { actor: "author" }).to).toBe("published")
    expect(applySkillTransition("offline", "bring_online", { actor: "system_admin" }).to).toBe(
      "published",
    )
  })

  test("已发布或已下线可归档，归档是终态", () => {
    expect(applySkillTransition("published", "archive", { actor: "system_admin" }).to).toBe("archived")
    expect(applySkillTransition("offline", "archive", { actor: "system_admin" }).to).toBe("archived")
    expect(isTerminalStatus("archived")).toBe(true)
    expect(allowedSkillActions("archived")).toEqual([])
  })

  test("越权触发会被拒：作者不能自己业务审核，业务管理员不能技术发布", () => {
    expect(
      errorCode(() => applySkillTransition("in_review", "approve_business", { actor: "author" })),
    ).toBe("actor_not_allowed")
    expect(
      errorCode(() =>
        applySkillTransition("pending_tech", "publish_tech", { actor: "business_reviewer" }),
      ),
    ).toBe("actor_not_allowed")
  })

  test("未知动作会被拒", () => {
    expect(
      errorCode(() =>
        applySkillTransition("draft", "not_an_action" as never, { actor: "business_reviewer" }),
      ),
    ).toBe("unknown_action")
  })

  test("每个状态的可用动作来自转移表，不靠散落的 if", () => {
    expect(allowedSkillActions("draft")).toEqual(["submit_review"])
    expect(allowedSkillActions("in_review").sort()).toEqual(["approve_business", "reject_business"])
    expect(allowedSkillActions("published").sort()).toEqual([
      "archive",
      "start_iteration",
      "take_offline",
    ])
  })

  test("只有已发布与迭代中可用于执行", () => {
    expect(isAssetUsable("published")).toBe(true)
    expect(isAssetUsable("iterating")).toBe(true)
    for (const status of ["draft", "in_review", "pending_tech", "offline", "archived"] as const) {
      expect(isAssetUsable(status)).toBe(false)
    }
  })
})
