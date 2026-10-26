import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { User } from "@opencode-ai/core/user"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceRef } from "@/effect/instance-ref"
import { DIRECTORY_META_KEY, USER_META_KEY, userMeta } from "@/mcp/openhive-identity"
import { testEffect } from "../lib/effect"

/**
 * 治理 MCP 单进程形态：`_meta` 除身份外还要带「当前项目目录」。
 *
 * 服务端靠这一对键做沙箱判定（`packages/asset-service/src/governance.ts` 的
 * `sandboxDirectoryOf`）。少带目录 ⇒ 服务端 `identity_required`；目录越界 ⇒
 * `source_outside_sandbox`。所以这里钉两件事：**带身份时两个键都在**、**没身份时一个键都不带**。
 *
 * ⚠️ `worktree` 故意与 `directory` 取**不同**的值：两者相同时，「取的是 worktree 字段」
 * 这种写错也能绿（变异实测）。
 */
const ALICE: User.Info = { id: "u_alice", policeNo: "0451", name: "甲民警", isAdmin: false }
const DIRECTORY = "/workspaces/u_alice/project-a"
const WORKTREE = "/workspaces/u_alice"
const instance = {
  directory: DIRECTORY,
  worktree: WORKTREE,
  project: { id: ProjectV2.ID.global, worktree: WORKTREE, time: { created: 0, updated: 0 }, sandboxes: [] },
}

const withIdentity = testEffect(Layer.succeed(User.Service, ALICE))

withIdentity.effect("带身份 + 实例目录 ⇒ _meta 里两个键都在", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toEqual({ [USER_META_KEY]: ALICE.id, [DIRECTORY_META_KEY]: DIRECTORY })
  }).pipe(Effect.provideService(InstanceRef, instance)),
)

withIdentity.effect("带身份但没有实例（非 HTTP 入口）⇒ 只带身份，不编目录", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toEqual({ [USER_META_KEY]: ALICE.id })
    // `toEqual` 会忽略值为 `undefined` 的键 ⇒ 再钉一次**键集合**，否则
    // `{ user, directory: undefined }` 也能绿（变异实测：把目录无条件写上，本用例如样绿）。
    expect(Object.keys(meta ?? {})).toEqual([USER_META_KEY])
  }),
)

testEffect(Layer.empty).effect("没有身份 ⇒ 一个键都不带（不是带个空值）", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toBeUndefined()
  }),
)

/**
 * **生产里最常见的那条「无身份」路径**：HTTP 入口按 `anchor-workspace.ts` 的「没有 User
 * 就直通」走，**实例仍由 `project-location` 提供**。所以「无身份」必须**同时**在「有实例」
 * 下成立——只钉「无身份 ∧ 无实例」的话，把实现改成「实例在就带目录、身份不作前置」
 * 也能三条全绿（变异实测）。
 */
testEffect(Layer.empty).effect("没有身份但有实例 ⇒ 仍一个键都不带（身份是前置）", () =>
  Effect.gen(function* () {
    const meta = yield* userMeta()
    expect(meta).toBeUndefined()
  }).pipe(Effect.provideService(InstanceRef, instance)),
)
