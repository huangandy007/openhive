import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { DiskQuota } from "@opencode-ai/core/quota/disk-quota"
import * as NFS from "node:fs/promises"
import os from "node:os"
import path from "path"
import { testEffect } from "./lib/effect"

/**
 * T011 · 沙箱磁盘配额（FR-009）。D4-3 裁定的形状见 `docs/workspace/dev_tdd.003.md` 的 D4 段
 * （**丙**：应用层先做、OS 级登记为部署缺口）。
 *
 * ⚠️ **本模块挡得住什么、挡不住什么**（照 D4-3 的原话，别把话说大）：
 * - 挡得住：**经 opencode 工具**（`write` / `edit` / `apply_patch`）往沙箱里写、把沙箱撑爆。
 * - **挡不住**：不走这条漏斗的写入（`shell` 工具里 `cat > bigfile`、沙箱内进程自己落盘）。
 *   OS 级强制（Linux quota / docker volume）才是这道底线，**本机 win32 + 无 Docker 做不了**，
 *   已按 `LEARNINGS #002-02` 记成**未覆盖**的缺口，不是已覆盖。
 */

const GIB = 1024 ** 3

const tmpRoot = async () => await NFS.mkdtemp(path.join(os.tmpdir(), "openhive-disk-quota-"))

/** 在指定环境变量下跑一段 Effect，跑完还原（含抛错的那条路）。 */
const withEnv = <A, E, R>(vars: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) =>
  Effect.sync(() => {
    const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]] as const))
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return saved
  }).pipe(
    Effect.flatMap((saved) =>
      effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const [key, value] of saved) {
              if (value === undefined) delete process.env[key]
              else process.env[key] = value
            }
          }),
        ),
      ),
    ),
  )

describe("阈值读取（T011）", () => {
  /**
   * 照 `dataRoot(env)` / `maxConcurrentSessions(env)` 先例：**读传入的 env 记录，不直接读
   * `process.env`**，让调用方与测试能注入。
   *
   * 回落到默认值的四种情况与 T010 同源（那边是「并发数」、这里是「字节数」，**理由逐条相同**）：
   * - **没设 / 空串**：空串按「没设」处理——`OPENHIVE_MAX_SANDBOX_BYTES=` 不该被读成 0。
   *   0 在这里意味着**任何人一个字节都写不进去**，比不设更糟：配置里多打一个等号就全员停摆。
   * - **非数字**：`Number("abc")` 是 `NaN`，而**与 `NaN` 的比较永远为假** ⇒ 若放它过去，
   *   `used + incoming > NaN` 恒 false，**配额会静默失效**——门看着还在、实际没有。
   * - **非正数 / 非整数**：同上，按无效处理。
   *
   * 注：这里**不修剪任何单位后缀**（`10GB` 不是合法值）。刻意不做「10G/10GiB/10GB」这类解析
   * ——三种写法对应的字节数不同，猜错一个就是十倍百倍的偏差（简单优先）。
   */
  test("从 env 读；缺失 / 空串 / 非数字 / 非正数 / 非整数一律回落到默认值", () => {
    const KEY = DiskQuota.MAX_SANDBOX_BYTES_ENV
    const cases: Array<[string | undefined, number]> = [
      [undefined, 10 * GIB],
      ["", 10 * GIB],
      ["abc", 10 * GIB],
      ["0", 10 * GIB],
      ["-1", 10 * GIB],
      ["2.5", 10 * GIB],
      ["10GB", 10 * GIB], // 不解析单位后缀
      ["1024", 1024],
      ["1", 1],
    ]
    for (const [raw, expected] of cases) {
      expect(DiskQuota.maxSandboxBytes(raw === undefined ? {} : { [KEY]: raw })).toBe(expected)
    }
  })

  test("默认值就是 10 GiB（D4-3 裁定）", () => {
    // 写死字面量而不是引用常量：引用常量的话这条断言恒成立，测不出任何东西。
    expect(DiskQuota.DEFAULT_MAX_SANDBOX_BYTES).toBe(10737418240)
  })

  test("沙箱根从 env 读；缺失 / 空串回落到 /workspaces", () => {
    const KEY = DiskQuota.WORKSPACE_ROOT_ENV
    expect(DiskQuota.workspaceRoot({})).toBe("/workspaces")
    expect(DiskQuota.workspaceRoot({ [KEY]: "" })).toBe("/workspaces")
    expect(DiskQuota.workspaceRoot({ [KEY]: "/srv/ws" })).toBe("/srv/ws")
  })
})

describe("该不该拒（T011）", () => {
  /**
   * 判据是**净增**：`used - replacing + incoming > limit`。
   *
   * 边界钉在「**恰好到上限放行**」——配额是「最多能放多少字节」，写满到上限本身不算超。
   * ⚠️ 这与 T010 的 `exceeds`（会话数，`active >= limit` 就拒）**方向不同、不是笔误**：
   * 那边数的是「已占用的名额、再要一个就超出」，这边量的是「字节总量、写满为止」。
   */
  test("写满到上限放行；超出一字节才拒", () => {
    expect(DiskQuota.exceeds({ used: 9, incoming: 1, replacing: 0, limit: 10 })).toBe(false)
    expect(DiskQuota.exceeds({ used: 9, incoming: 2, replacing: 0, limit: 10 })).toBe(true)
    expect(DiskQuota.exceeds({ used: 0, incoming: 0, replacing: 0, limit: 0 })).toBe(false)
    expect(DiskQuota.exceeds({ used: 0, incoming: 1, replacing: 0, limit: 0 })).toBe(true)
  })

  /**
   * **`replacing` 不是优化，是主路径必需的**：`write` / `edit` / `apply_patch` 三个工具
   * **都是整文件重写**（改一个字符也重发全文）。若不抵扣目标文件的现有大小，
   * 沙箱一旦接近上限，**连把文件改小都会被拒**——「磁盘满了，所以你不能删内容」。
   * 这比配额本身更伤：民警会卡在「改不动、也删不掉」上。
   */
  test("整文件重写要抵扣旧内容，否则连改小都会被拒", () => {
    // 已在限额上、原样重写：净增 0 ⇒ 放行。
    expect(DiskQuota.exceeds({ used: 10, incoming: 6, replacing: 6, limit: 10 })).toBe(false)
    // 改小：净减 ⇒ 放行。
    expect(DiskQuota.exceeds({ used: 10, incoming: 1, replacing: 6, limit: 10 })).toBe(false)
    // 改大：净增 2，超出 1 字节 ⇒ 拒。
    expect(DiskQuota.exceeds({ used: 10, incoming: 7, replacing: 6, limit: 10 })).toBe(true)
  })
})

describe("路径 ↔ 沙箱（T011）", () => {
  const ROOT = path.join(os.tmpdir(), "openhive-root")

  test("沙箱内的文件归到该用户的沙箱；根外路径不管", () => {
    expect(DiskQuota.sandboxOf(path.join(ROOT, "alice", "proj", "src", "a.ts"), ROOT)).toBe(
      path.join(ROOT, "alice"),
    )
    // 沙箱根自身、以及直接摊在根下的散文件：**没有「属于哪个用户」可言** ⇒ 不管辖。
    // （散文件若被当成沙箱目录去扫，`readdir` 得 ENOTDIR ⇒ 那个文件的每次写入都会被判成
    //   「量不出来」而拒掉。这条断言就是钉住这枚雷的。）
    expect(DiskQuota.sandboxOf(ROOT, ROOT)).toBeUndefined()
    expect(DiskQuota.sandboxOf(path.join(ROOT, "alice"), ROOT)).toBeUndefined()
    expect(DiskQuota.sandboxOf(path.join(ROOT, "stray.txt"), ROOT)).toBeUndefined()
    // 根之外：`/data/{userId}/` 那些库文件、临时目录都在这里 ⇒ 不管。
    expect(DiskQuota.sandboxOf(path.join(os.tmpdir(), "elsewhere", "a.ts"), ROOT)).toBeUndefined()
  })

  /**
   * **前缀相似 ≠ 子目录**。用字符串前缀比较实现的话，根 `/w/ali` 会把 `/w/alice/f`
   * 误判成自己的子路径（`"/w/alice/f".startsWith("/w/ali")` 为真）。这不是假想的：
   * 用户 id 是 UUID / 工号这类**长度不一**的串，`alice` 与 `ali` 完全可能同时存在。
   * 用 `path.relative` 判定就不会有这个洞。
   */
  test("前缀相似但不是子目录的，不算沙箱内", () => {
    expect(DiskQuota.sandboxOf(path.join(ROOT, "alice", "f"), path.join(ROOT, "ali"))).toBeUndefined()
    expect(DiskQuota.sandboxOf(path.join(ROOT, "ali"), path.join(ROOT, "ali"))).toBeUndefined()
    expect(DiskQuota.sandboxOf(path.join(ROOT, "alice"), path.join(ROOT, "ali"))).toBeUndefined()
    // 名字**以两个点开头**的目录是合法的：不能把它当成 `..` 一并排除掉（那会留一条不管辖的缝）。
    expect(DiskQuota.sandboxOf(path.join(ROOT, "..foo", "f"), ROOT)).toBe(path.join(ROOT, "..foo"))
  })

  /**
   * 判的是**最终落点**，不是路径这串字符：`{root}/alice/../bob/x` 落盘落在 bob 家，
   * 按字面串判定会认成 alice 的沙箱（于是拿 alice 的用量去管 bob 的写入）。
   */
  test("相对段按落点算：alice 里的 ../bob 归 bob", () => {
    const escaping = path.join(ROOT, "alice", "..", "bob", "f")
    expect(DiskQuota.sandboxOf(escaping, ROOT)).toBe(path.join(ROOT, "bob"))
    // 穿出沙箱根的，不管辖。
    expect(DiskQuota.sandboxOf(path.join(ROOT, "alice", "..", "..", "f"), ROOT)).toBeUndefined()
  })
})

describe("沙箱占用统计（T011）", () => {
  test("递归求和：子目录里的文件也算进去", async () => {
    const root = await tmpRoot()
    await NFS.mkdir(path.join(root, "alice", "proj", "src"), { recursive: true })
    await NFS.writeFile(path.join(root, "alice", "a.txt"), "0123456789") // 10
    await NFS.writeFile(path.join(root, "alice", "proj", "b.txt"), "01234") // 5
    await NFS.writeFile(path.join(root, "alice", "proj", "src", "c.txt"), "012") // 3
    // 兄弟用户的目录**不**计入 alice。
    await NFS.mkdir(path.join(root, "bob"), { recursive: true })
    await NFS.writeFile(path.join(root, "bob", "d.txt"), "0123456789")

    const used = await Effect.runPromise(DiskQuota.usedBytes(path.join(root, "alice")))
    expect(used).toBe(18)
  })

  test("目录还不存在 ⇒ 0（沙箱是懒建的，第一次写入前它不在）", async () => {
    const root = await tmpRoot()
    expect(await Effect.runPromise(DiskQuota.usedBytes(path.join(root, "nobody")))).toBe(0)
  })
})

describe("写入守卫（T011）", () => {
  const setup = async (limit: number) => {
    const root = await tmpRoot()
    const alice = path.join(root, "alice")
    await NFS.mkdir(alice, { recursive: true })
    const env = { [DiskQuota.WORKSPACE_ROOT_ENV]: root, [DiskQuota.MAX_SANDBOX_BYTES_ENV]: String(limit) }
    return { root, alice, env }
  }

  test("沙箱内净增超限 ⇒ 拒，错误里带着账目（used / incoming / limit）", async () => {
    const { alice, env } = await setup(10)
    await NFS.writeFile(path.join(alice, "a.txt"), "0123456789") // 已用 10

    const error = await Effect.runPromise(
      Effect.flip(DiskQuota.enforce(path.join(alice, "b.txt"), 1, env)),
    )
    expect(error._tag).toBe("SandboxWriteRejected")
    expect(error.reason).toBe("quota-exceeded")
    expect(error.sandbox).toBe(alice)
    expect(error.used).toBe(10)
    expect(error.incoming).toBe(1)
    expect(error.limit).toBe(10)
    expect(error.message).toContain(DiskQuota.MAX_SANDBOX_BYTES_ENV)
  })

  test("没到限 ⇒ 放行（恰好写满到上限也放行）", async () => {
    const { alice, env } = await setup(10)
    await Effect.runPromise(DiskQuota.enforce(path.join(alice, "a.txt"), 10, env)) // 0 + 10 = 10
    await Effect.runPromise(DiskQuota.enforce(path.join(alice, "b.txt"), 1, env)) // 仍是空沙箱
  })

  /**
   * **同一个超小配额，沙箱外照写不误**：`/data/{userId}/` 的库、临时目录、`~/.config` 都不在
   * 沙箱根下。判据错一点点（比如「只要超限就拒」而不先问「在不在沙箱里」）就会把整个进程写死。
   */
  test("沙箱外的路径不受配额管辖", async () => {
    const { root, env } = await setup(1)
    const outside = path.join(root, "not-a-user-file.txt")
    await Effect.runPromise(DiskQuota.enforce(outside, 999, env))
    await Effect.runPromise(DiskQuota.enforce(path.join(await tmpRoot(), "x.txt"), 999, env))
  })

  test("覆盖自身：原样重写已存在的文件不被拒", async () => {
    const { alice, env } = await setup(10)
    await NFS.writeFile(path.join(alice, "a.txt"), "0123456789") // 已用 10（满）
    await Effect.runPromise(DiskQuota.enforce(path.join(alice, "a.txt"), 10, env)) // 10 - 10 + 10 = 10
  })

  /**
   * **量不出来时拒绝，不静默放行。**
   *
   * 这条规则值得说清楚，因为它可以反着定：像 `du` 那样「读不到的目录跳过、继续算」也能跑。
   * 选了拒绝，理由是**这道配额本来就绕得过**（D4-3 已认：不走 opencode 工具的写入不受管），
   * 若再对「量不出来」静默放行，就等于把配额做成一句声明——`LEARNINGS #002-02` 说的正是
   * 「门看着还在、其实没有」这种最坏的情况。扫描失败是异常态（沙箱内文件本就由本进程以
   * 0700 写入），宁可让管理员看到一条明确的错误。
   *
   * 构造办法：把沙箱目录的位置**建成一个文件**——`readdir` 会 ENOTDIR。
   */
  test("沙箱量不出来 ⇒ 拒（reason = unmeasurable，带 detail），不静默放行", async () => {
    const root = await tmpRoot()
    const alice = path.join(root, "alice")
    await NFS.writeFile(alice, "我不是目录") // 占位成文件
    const env = { [DiskQuota.WORKSPACE_ROOT_ENV]: root, [DiskQuota.MAX_SANDBOX_BYTES_ENV]: "1000" }

    const error = await Effect.runPromise(Effect.flip(DiskQuota.enforce(path.join(alice, "a.txt"), 1, env)))
    expect(error._tag).toBe("SandboxWriteRejected")
    expect(error.reason).toBe("unmeasurable")
    expect(error.sandbox).toBe(alice)
    expect(error.detail).toBeDefined()
  })
})

describe("字节数（T011）", () => {
  /**
   * ⚠️ **不能拿 `content.length` 当字节数**：它是 UTF-16 码元数。中文一个字 1 个码元、
   * 落盘却是 3 字节（UTF-8）——用 `length` 会让**中文内容的配额少算三分之二**，
   * 而民警的产物（研判报告、话单分析）恰恰全是中文。
   */
  test("按落盘字节数算，不是码元数", () => {
    expect(DiskQuota.bytesOf("abc")).toBe(3)
    expect(DiskQuota.bytesOf("民警")).toBe(6)
    expect(DiskQuota.bytesOf(new Uint8Array([1, 2, 3, 4]))).toBe(4)
    expect(DiskQuota.bytesOf(new Uint8Array(0))).toBe(0)
  })
})

const live = LayerNode.compile(LayerNode.group([FSUtil.node, LayerNodePlatform.filesystem]))
const { effect: it } = testEffect(live)

describe("接进 FSUtil.writeWithDirs（T011 · 三个工具共用的那道漏斗）", () => {
  /**
   * `write` / `edit` / `apply_patch` 三个工具**全部**收敛到 `FSUtil.writeWithDirs`
   * （`tool/write.ts`、`tool/edit.ts`、`patch/index.ts`、`core/file-mutation.ts`），
   * 所以守卫加在这一处，覆盖面就是三个工具——不是三处接线、不会漏一个。
   */
  it(
    "沙箱内超配额 ⇒ writeWithDirs 失败，且**一个字节都没落盘**",
    withEnv({ [DiskQuota.MAX_SANDBOX_BYTES_ENV]: "1" }, Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = yield* Effect.promise(() => tmpRoot())
      yield* Effect.promise(() => NFS.mkdir(path.join(root, "alice"), { recursive: true }))
      const target = path.join(root, "alice", "deep", "a.txt")

      const error = yield* Effect.flip(
        withEnv({ [DiskQuota.WORKSPACE_ROOT_ENV]: root }, fs.writeWithDirs(target, "0123456789")),
      )
      expect(error._tag).toBe("SandboxWriteRejected")
      // 守卫必须在**建目录之前**：失败之后连 `deep/` 都不该存在。
      expect(yield* fs.exists(path.join(root, "alice", "deep"))).toBe(false)
      expect(yield* fs.exists(target)).toBe(false)
    })),
  )

  it(
    "沙箱外照常写（配额再小也不管）——storage / config / ripgrep 那些写入都走这里",
    withEnv({ [DiskQuota.MAX_SANDBOX_BYTES_ENV]: "1" }, Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* Effect.promise(() => tmpRoot())
      const target = path.join(dir, "outside", "a.txt")
      yield* withEnv({ [DiskQuota.WORKSPACE_ROOT_ENV]: path.join(dir, "workspaces") }, fs.writeWithDirs(target, "0123456789"))
      expect(yield* fs.readFileString(target)).toBe("0123456789")
    })),
  )

  it(
    "配额够就照常写（守卫不是在无差别拦写入）",
    withEnv({ [DiskQuota.MAX_SANDBOX_BYTES_ENV]: String(GIB) }, Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = yield* Effect.promise(() => tmpRoot())
      const target = path.join(root, "alice", "deep", "a.txt")
      yield* withEnv({ [DiskQuota.WORKSPACE_ROOT_ENV]: root }, fs.writeWithDirs(target, "民警"))
      expect(yield* fs.readFileString(target)).toBe("民警")
    })),
  )
})
