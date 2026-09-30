import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

/**
 * T008：**沙箱内项目 = 唯一隔离边界**（FR-007），复用 opencode 原生 project 解析。
 *
 * 本文件**不改任何生产代码**，钉的是既有的上游行为——所以它**不是 TDD**，
 * 而是一组**特征化测试（characterization）**：把「今天真正成立的东西」写下来，
 * 包括**没能成立**的那两种情形（见后两条）。按 T007 ③ 的口径：这类测试的价值不在
 * 「红过才写」，而在**它红了就说明前提变了**——下面每条的注释都写了它守的是什么。
 *
 * 前提（本文件全部结论都建在它上面）：沙箱是 `createWorkspace`
 * （`packages/auth/src/workspace.ts`）建的，**只有 `mkdir`、没有 `git init`**——
 * 所以 `{沙箱根}` **不是** git 仓库，项目要在它底下自己成库。
 *
 * 项目 id 从哪来（`packages/core/src/project.ts` 的 `resolve`）：
 * `remote() ?? .git/opencode 缓存 ?? 根提交哈希 ?? global`。
 * 三个来源都拿不到时回落 `global`——**这就是后两条的前提条件**。
 *
 * 与本文件**互补、不重复**：`project.test.ts` 已把上面那个优先级链的**原语**逐条钉过了
 * （含「非 git 目录回落 global + 文件系统根」「空仓库回落 global」两条）。这里不重钉原语，
 * 钉的是**沙箱形状的复合**：多个项目**共用一个祖先目录**时，边界还在不在。
 */
const it = testEffect(AppNodeBuilder.build(ProjectV2.node))

/**
 * `seed` 不是装饰：提交是**内容寻址**的，两个空树 + 同身份 + 同 message 的提交
 * 若还落在**同一秒**里，哈希会**完全相同**（实测踩到：`a.id !== b.id` 假红）。
 * 写一个各不相同的文件让树不同——**确定性**地不同，不靠运气等时间跨秒。
 *
 * 顺带这也是个真性质（不是 bug）：opencode 的 id 本就按**仓库身份**算，
 * 同一个仓库克隆两份 = 同一个项目（`remote()` 归一化的用意正在此）。
 */
async function initRepo(dir: string, opts?: { commit?: boolean; seed?: string }) {
  await fs.mkdir(dir, { recursive: true })
  await $`git init`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git config user.email test@openhive.test`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  if (opts?.commit) {
    await Bun.write(path.join(dir, "README.md"), `${opts.seed ?? path.basename(dir)}\n`)
    await $`git add README.md`.cwd(dir).quiet()
    await $`git commit -m root`.cwd(dir).quiet()
  }
}

async function rootCommit(dir: string) {
  return (await $`git rev-list --max-parents=0 HEAD`.cwd(dir).text()).trim()
}

/** 归一化路径再比——断言不该因 Windows 的盘符大小写 / `\` 假红。 */
async function real(value: string) {
  return path.resolve(await fs.realpath(value))
}

/**
 * 造一个沙箱：`{os temp}/{userId}`，形状与 `createWorkspace` 一致（**不 git init**）。
 * 用系统临时目录而不是仓库内——否则 `discover` 的向上查找会撞上本仓库的 `.git`，
 * 整组断言都会变成在测那个仓库。
 */
const withSandbox = (userId: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const tmp = await tmpdir()
      const root = path.join(tmp.path, userId)
      await fs.mkdir(root, { recursive: true })
      return { tmp, root }
    }),
    ({ tmp }) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("沙箱内项目边界（T008）", () => {
  /**
   * 出参正例：「沙箱内项目各自独立 git」。
   *
   * 与 `project.test.ts` 那条「回落根提交」的区别在**共用一个祖先目录**：
   * 两个库都在 `{沙箱根}` 底下，`discover` 从各自的目录向上找到的是**各自的** `.git`
   * （最近优先），因此 id 与 worktree 都分开。这条若不成立，「项目 = 隔离边界」就只是沙箱。
   *
   * **变异敏感性**：把任一方的 `{ commit: true }` 去掉，两个 id 会一起塌回 `global` ⇒ 必红。
   */
  it.live("同一沙箱内两个各自成库的项目：id 互不相同，且各等于自己的根提交", () =>
    Effect.gen(function* () {
      const { root } = yield* withSandbox("alice")
      const alpha = path.join(root, "alpha")
      const beta = path.join(root, "beta")
      yield* Effect.promise(() => initRepo(alpha, { commit: true }))
      yield* Effect.promise(() => initRepo(beta, { commit: true }))
      const project = yield* ProjectV2.Service

      const a = yield* project.resolve(AbsolutePath.make(alpha))
      const b = yield* project.resolve(AbsolutePath.make(beta))

      expect(a.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(alpha))))
      expect(b.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(beta))))
      expect(a.id).not.toBe(b.id)
      // worktree 各是各的库根。若两者都等于沙箱根，「项目」在目录层面就已经合并了。
      expect(yield* Effect.promise(() => real(a.directory))).toBe(yield* Effect.promise(() => real(alpha)))
      expect(yield* Effect.promise(() => real(b.directory))).toBe(yield* Effect.promise(() => real(beta)))
    }),
  )

  /**
   * 「一个项目」的**粒度定义**：离得最近的 `.git`，不是沙箱。
   *
   * 同沙箱内既有 alpha 又有 beta 时，alpha 的子目录**绝不能**解析到 beta
   * （最近优先保证了这点），也**不会**自己成项（没有 `.git`）——它归 alpha。
   * 这条钉的是「项目数 ≠ 目录数」：民警在项目里随手建子目录，不会凭空多出隔离边界。
   */
  it.live("项目粒度 = 最近的 .git：嵌套目录归外层项目，不会自己成项", () =>
    Effect.gen(function* () {
      const { root } = yield* withSandbox("alice")
      const alpha = path.join(root, "alpha")
      const sibling = path.join(root, "beta")
      const nested = path.join(alpha, "sub")
      yield* Effect.promise(() => initRepo(alpha, { commit: true }))
      yield* Effect.promise(() => initRepo(sibling, { commit: true }))
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
      const project = yield* ProjectV2.Service

      const resolved = yield* project.resolve(AbsolutePath.make(nested))

      expect(resolved.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(alpha))))
      expect(yield* Effect.promise(() => real(resolved.directory))).toBe(yield* Effect.promise(() => real(alpha)))
    }),
  )

  /**
   * ⚠️ **条件成立，不是 bug**——「项目各自独立」**有前提**：首次提交之前不算数。
   *
   * `git init`（`packages/opencode/src/project/project.ts` 的 `initGit`）**只建库、不提交**，
   * 而 id 的三个来源（remote / 缓存 / 根提交）此时**全空** ⇒ 一律回落 `global`。
   * 于是在「建了项目但还没提交过」这段时间里，**同沙箱内两个项目同属一个 project id**。
   *
   * 这条是**特征化**（钉今天的事实），所以它断言的是**「两个 id 相等」**——反直觉，但真实。
   * 它红了意味着上游改了这套回落规则，那时该**重新评估**而不是直接改断言。
   * 已按裁定**甲**登记进 `state.md` 的缺口表，不在此处兜底（是否自动补一次提交属产品决定）。
   */
  it.live("【条件成立】未 commit 期间：两个项目同属 global——边界要等首次提交", () =>
    Effect.gen(function* () {
      const { root } = yield* withSandbox("alice")
      const alpha = path.join(root, "alpha")
      const beta = path.join(root, "beta")
      yield* Effect.promise(() => initRepo(alpha))
      yield* Effect.promise(() => initRepo(beta))
      const project = yield* ProjectV2.Service

      const a = yield* project.resolve(AbsolutePath.make(alpha))
      const b = yield* project.resolve(AbsolutePath.make(beta))

      expect(a.id).toBe(ProjectV2.ID.make("global"))
      expect(b.id).toBe(a.id)
      // 缓存是 `Project.commit()` 写的，而它**跳过 global**——所以「下次还认得这个项目」
      // 此时也不成立，是同一个前提的第二个面。
      expect(yield* Effect.promise(() => Bun.file(path.join(alpha, ".git", "opencode")).exists())).toBe(false)
    }),
  )

  /**
   * ⚠️ **条件成立，不是 bug**——未 git 化的目录，其**项目 worktree 指向文件系统根**。
   *
   * `packages/opencode/src/project/project.ts` 里 `worktree` 的取法是
   * 「global 且无 vcs ⇒ `"/"`」，于是沙箱内一个还没 git 化的目录解析出来的
   * `directory` 是**盘根**，**不在沙箱里**。
   *
   * 边界要说清：这**不是** T006 的目录锚定失效——请求目录仍被锚在沙箱内，两回事。
   * 指到沙箱外的是**项目元数据**这一份。已按裁定**乙**测出并登记上报。
   */
  it.live("【条件成立】未 git 化的目录：项目 worktree 是文件系统根，不在沙箱里", () =>
    Effect.gen(function* () {
      const { root } = yield* withSandbox("alice")
      const plain = path.join(root, "plain")
      yield* Effect.promise(() => fs.mkdir(plain, { recursive: true }))
      const project = yield* ProjectV2.Service

      const resolved = yield* project.resolve(AbsolutePath.make(plain))

      expect(resolved.id).toBe(ProjectV2.ID.make("global"))
      expect(resolved.vcs).toBeUndefined()
      // 这一条**不能过 `real()`**：Bun 在 win32 上对盘根 `C:\` 的 `realpath` 返回的是**相对值**，
      // 再经 `path.resolve` 会变成 process.cwd（实测踩到，看着像「落到了仓库里」）。
      // 盘根本身已是规范形式，直接比。
      expect(resolved.directory).toBe(AbsolutePath.make(path.parse(plain).root))
      // 把**隔离含义**也钉一遍：那个值在沙箱根之外。上面那条比的是字符串，这条比的是归属。
      expect(path.resolve(resolved.directory).startsWith(yield* Effect.promise(() => real(root)))).toBe(false)
    }),
  )
})
