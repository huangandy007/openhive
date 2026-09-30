import { describe, expect, test } from "bun:test"
import { WORKSPACE_ROOT_ENV, workspaceRoot } from "@opencode-ai/auth/workspace"
import { DiskQuota } from "@opencode-ai/core/quota/disk-quota"

/**
 * T011 · 「沙箱根」这个常量被抄成了两份，这条测试钉住它们不许漂。
 *
 * ## 为什么会有两份
 *
 * 沙箱根（`OPENHIVE_WORKSPACE_ROOT`，默认 `/workspaces`）的真身在 **002** 的
 * `packages/auth/src/workspace.ts`；T011 的磁盘配额守卫在 **core** 的 `fs-util.ts` 上。
 * 而 `packages/core` 与 `packages/auth` **互相都不依赖**（core 没有 `@opencode-ai/auth`，
 * auth 也只依赖 drizzle / hono）⇒ core 侧只能**另立一份字面量**。
 *
 * ## 漂了会怎样（这就是这条测试存在的理由）
 *
 * 两份常量各管一头：auth 那份决定**把用户锚到哪个目录**（T006 的 `anchorWorkspaceLayer`
 * 也读它），core 那份决定**配额盯着哪个目录**。一旦漂开，比如 auth 是 `/workspaces`、
 * core 是 `/data/workspaces`：用户照常被锚到 A 目录、写入照常落盘，而配额始终在统计 B 目录
 * ——**它永远显示 0 字节已用，于是永远不拒任何写入**。门看着还在、其实没有
 * （`LEARNINGS #002-02` 说的最坏那一种），而且**不会报错、不会变红**，只有这条测试会红。
 *
 * 同理，`workspaceRoot({})` 的**默认值**也要一致：只对常量名不对默认值，
 * 两边都「读到了环境变量」、却在不设该变量时落到不同的根——同一个洞换了个触发条件。
 */
describe("沙箱根常量防漂移（T011）", () => {
  test("core 的 disk-quota 与 auth 的 workspace 是同名环境变量、同默认根", () => {
    expect(DiskQuota.WORKSPACE_ROOT_ENV).toBe(WORKSPACE_ROOT_ENV)
    expect(DiskQuota.DEFAULT_WORKSPACE_ROOT).toBe(workspaceRoot({}))
    expect(DiskQuota.workspaceRoot({})).toBe(workspaceRoot({}))
    expect(DiskQuota.workspaceRoot({ [WORKSPACE_ROOT_ENV]: "/srv/ws" })).toBe(
      workspaceRoot({ [WORKSPACE_ROOT_ENV]: "/srv/ws" }),
    )
  })
})
