/**
 * T012 / FR-009「高风险动作（删除数据）强制人确认」——**配置声明的闸门**。
 *
 * ## 这条 task 的产品码落在哪（2026-10-07 用户裁定）
 *
 * 落在 **`.opencode/opencode.jsonc` 的 `permission` 键**：把删除类命令声明成 `ask`。
 * 不改上游一行源码——闸门机制（工具层 `ctx.ask` → `permission/index.ts` 的 `ask()`）本来就在，
 * 缺的是**规则**：
 *
 * - `agent/agent.ts` 的 `defaults` 是 `Permission.fromConfig({ "*": "allow", … })`
 *   ⇒ **今天在本仓，`rm -rf` 一声不响就跑了**（所以本文件在 RED 阶段是真的红，不是空断言）；
 * - 各 agent 的规则集是 `Permission.merge(defaults, <本 agent 自己的>, user)`，
 *   而 `user = Permission.fromConfig(cfg.permission ?? {})` **排在最后**；
 *   `evaluate()` 用 `findLast` ⇒ **配置里的规则赢过默认的 allow**。
 *
 * ⚠️ 生效的是**单数** `permission`（v1）。核心配置里还有一个**复数** `permissions`，
 * 本仓是 v1 ⇒ 写它会直接抛 `V2 permissions are not supported by OpenCode V1`（`config/v2-compat.ts`）。
 *
 * ## 本文件测什么、不测什么
 *
 * 测：**声明 → 规则集 → 判定**这条链是活的。`Config` **不桩**——把仓库里那份真配置拷进实例的
 * `.opencode/opencode.jsonc`，让 `ConfigPaths.directories` 里的 `afs.up({ targets: [".opencode"] })`
 * 自己找出来（`config/config.ts` 那条 `dir.endsWith(".opencode")` 分支）⇒ 连「这个文件到底会不会被加载」
 * 一起测了（T011 的 `instructions` 走的是同一条发现路径）。
 *
 * 不测：「民警真的会被弹窗拦住」——**once / always / reject 的语义是上游的**，前端还有一个自动应答
 * 开关（`packages/app/src/context/permission-auto-respond.ts`，默认关）。这些都写进了 006 的缺口表，
 * 不在本文件里假装覆盖（`LEARNINGS #002-02`）。
 *
 * ## 为什么样本命令取「单条、无操作符」的写法
 *
 * 判据要锚在**被调方**上（`LEARNINGS #004-07`）：工具真正拿去比的是 `shell.ts` 的 `collect()` 里
 * `scan.patterns.add(source(node))`——**命令节点的源文本**。所以样本一律取单条命令，
 * 此时 `source(node)` 就是命令串本身；② 组用**真 shell 工具**把这条钉住（不是靠注释声称，`#005-15`）。
 */
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect, test, afterEach } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { ConfigParse } from "../../src/config/parse"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { MessageID, SessionID } from "../../src/session/schema"
import { Skill } from "../../src/skill"
import { ShellTool } from "../../src/tool/shell"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { disposeAllInstances, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/** 与 `test/agent/agent.test.ts` ＋ `test/tool/shell.test.ts` 同因同注：两边的服务都要（`#004-12`）。 */
const layer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      Plugin.node,
      Provider.node,
      Auth.node,
      Config.node,
      Skill.node,
      RuntimeFlags.node,
      CrossSpawnSpawner.node,
      FSUtil.node,
      Truncate.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
  testInstanceStoreLayer,
)
const it = testEffect(layer)

afterEach(async () => {
  await disposeAllInstances()
})

Shell.acceptable.reset()

/** 仓库根（本文件在 `packages/opencode/test/permission/`，上溯四级）。 */
const 仓库根 = path.resolve(import.meta.dir, "../../../..")
const 配置路径 = path.join(仓库根, ".opencode", "opencode.jsonc")

/**
 * 真配置里声明的 `permission.bash` —— **照产品同一个解析器读**（`ConfigParse.jsonc`），
 * 不自己编一份（`LEARNINGS #002-06`：同一个判断别两处各写一份）。
 *
 * 用 `Reflect.get` 而不是断言：`ConfigParse.jsonc` 返回 `unknown`，而本仓开着
 * `typescript/no-unsafe-type-assertion`（T011 那份的先例）。
 */
function 声明的bash规则(): Record<string, string> {
  const 数据 = ConfigParse.jsonc(fs.readFileSync(配置路径, "utf8"), 配置路径)
  if (typeof 数据 !== "object" || 数据 === null) return {}
  const 权限: unknown = Reflect.get(数据, "permission")
  if (typeof 权限 !== "object" || 权限 === null) return {}
  const bash: unknown = Reflect.get(权限, "bash")
  if (typeof bash !== "object" || bash === null) return {}
  const 出: Record<string, string> = {}
  for (const 键 of Object.keys(bash)) {
    const 值: unknown = Reflect.get(bash, 键)
    if (typeof 值 === "string") 出[键] = 值
  }
  return 出
}

/**
 * 把**真配置整份**拷进实例的 `.opencode/opencode.jsonc`（不是把对象喂桩）。
 *
 * ⚠️ 拷到 tmpdir 而不是把实例对准仓库根：真 `Config` 每加载一个目录都会跑
 * `ensureGitignore(dir)` ＋ `npmSvc.install(...).forkDetach` 两个副作用（`config/config.ts`），
 * 对准仓库根会**污染工作树**并起一个后台安装。拷进 tmpdir 则连「`.opencode` 目录会不会被发现」
 * 一起测，而副作用落在临时目录里。
 */
const 装入真配置 = (目录: string) =>
  Effect.sync(() => {
    const 目标 = path.join(目录, ".opencode")
    fs.mkdirSync(目标, { recursive: true })
    fs.copyFileSync(配置路径, path.join(目标, "opencode.jsonc"))
  })

/**
 * 高风险动作清单 —— 一条 pattern 配一条**代表性命令**。
 *
 * `pattern` 这一列不是随手写的：它就是 `shell.ts` 的 `collect()` 里
 * `scan.always.add(BashArity.prefix(tokens).join(" ") + " *")` 的产物形态
 * （`rm -rf build` → `rm *`、`git clean -fdx` → `git clean *`）。② 组会把这条相等断言钉死。
 */
const 样本命令: { 命令: string; pattern: string }[] = [
  { 命令: "rm -rf build", pattern: "rm *" }, // POSIX 删（也是 PowerShell 的 rm 别名）
  { 命令: "rmdir out", pattern: "rmdir *" }, // POSIX 删目录
  { 命令: "rd tmp", pattern: "rd *" }, // cmd 删目录
  { 命令: "del data.csv", pattern: "del *" }, // cmd 删文件
  { 命令: "erase log.txt", pattern: "erase *" }, // cmd 删文件（别名）
  { 命令: "Remove-Item secret.txt -Recurse", pattern: "Remove-Item *" }, // PowerShell 删
  { 命令: "shred -u secret.txt", pattern: "shred *" }, // GNU 覆写删除
  { 命令: "git clean -fdx", pattern: "git clean *" }, // 删未跟踪文件
]

/** 普通命令：**对照**。没有它，「把所有 bash 都设成 ask」也会绿。 */
const 对照命令 = ["bun run test", "ls -la", "git status"]

/**
 * 本文件的每条 `it.instance` 都要真装一次实例（真 `Config` 走完目录发现，顺带 fork 一个后台装依赖），
 * 耗时在 2–5s 之间抖——bun 的**默认**单测超时正好是 5s，实测撞到过 **5071ms** 的假红。
 * 包脚本本来就是 `bun test --timeout 30000`，这里显式写死同一个数，免得直接 `bun test <这个文件>`
 * 时红得莫名其妙（`LEARNINGS #003-01`：红之前先怀疑测量）。
 */
const 超时 = 30_000

/**
 * 已知缺口：黑名单是**按模式匹配**的 ⇒ 包一层包装器就不命中。
 * 这不是「待修的 bug」，是这类做法的天花板（真正的兜底在沙箱 / 备份，不是这层）。
 */
const 绕过样本 = "sudo rm -rf build"

/**
 * 用**真 shell 工具**扫描一条命令，取回它要问的那次 `bash` 请求；**不执行**。
 *
 * 判据来源必须是「工具真正产出的东西」而不是我们猜的（`#004-07`）。做法：`execute` 的流程是
 * `parse → collect → ask → run`（`shell.ts`），`ask` 在 spawn **之前**；把 `ctx.ask` 换成
 * 「记下 + die」⇒ 拿得到真 patterns，而命令一步都不会跑（这一步很要紧，样本里有 `rm -rf`）。
 */
const 扫描出的bash请求 = Effect.fn("T012.扫描出的bash请求")(function* (命令: string) {
  const info = yield* ShellTool
  const bash = yield* info.init()
  const 收到: Omit<PermissionV1.Request, "id" | "sessionID" | "tool">[] = []
  const 上下文: Tool.Context = {
    sessionID: SessionID.make("ses_t012"),
    messageID: MessageID.make("msg_t012"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (input) => {
      收到.push(input)
      return Effect.die(new Error("T012：只取扫描出的 patterns，不执行命令"))
    },
  }
  yield* bash.execute({ command: 命令 }, 上下文).pipe(Effect.exit)
  const 请求 = 收到.find((项) => 项.permission === "bash")
  if (!请求) throw new Error(`扫描没有产出 bash 请求：${命令}`)
  return 请求
})

const 判定 = (规则集: PermissionV1.Ruleset, pattern: string) =>
  Permission.evaluate("bash", pattern, 规则集).action

describe("T012 / FR-009 · 高风险动作（删除数据）强制人确认", () => {
  test("① 本仓配置声明的 bash 高风险 pattern 集合 == 清单（多一条少一条都红）", () => {
    const 声明 = 声明的bash规则()
    // 带警报语义：谁多加一条 pattern（比如哪天想起 `ri *`）就得回来回答「它算不算高风险」、
    // 并补一条样本；少一条则说明闸门被悄悄拆了（`LEARNINGS #004-02`）。
    expect(Object.keys(声明).sort()).toEqual(样本命令.map((项) => 项.pattern).sort())
    for (const 项 of 样本命令) expect([项.pattern, 声明[项.pattern]]).toEqual([项.pattern, "ask"])
  })

  it.instance(
    "② 真 shell 扫描出的 pattern / always 就是命令串与清单里的那份（钉住样本来源）",
    () =>
      Effect.gen(function* () {
        const 实得: Record<string, { patterns: string[]; always: string[] }> = {}
        for (const 项 of 样本命令) {
          const 请求 = yield* 扫描出的bash请求(项.命令)
          实得[项.命令] = { patterns: [...请求.patterns], always: [...请求.always] }
        }
        // 一次比完、差集会点名是哪条命令 —— 不写成「先 rm 再 del」的合并用例
        // （`LEARNINGS #005-12`：N 个落点要各自留证据）。
        expect(实得).toEqual(
          Object.fromEntries(
            样本命令.map((项) => [项.命令, { patterns: [项.命令], always: [项.pattern] }]),
          ),
        )
      }),
    { init: 装入真配置 },
    超时,
  )

  it.instance(
    "③ 清单里每一条都真的落到 ask（在 build agent 的真规则集上算）",
    () =>
      Effect.gen(function* () {
        const build = yield* Agent.Service.use((svc) => svc.get("build"))
        const 实得: Record<string, string[]> = {}
        for (const 项 of 样本命令) {
          const 请求 = yield* 扫描出的bash请求(项.命令)
          // 前半条：注入点之前确实发生了——扫描真的产出了 pattern。否则下面的空数组会 0 == 0 假绿
          // （`LEARNINGS #005-13`）。
          expect(请求.patterns.length).toBeGreaterThan(0)
          实得[项.命令] = 请求.patterns.map((pattern) => 判定(build.permission, pattern))
        }
        expect(实得).toEqual(Object.fromEntries(样本命令.map((项) => [项.命令, ["ask"]])))
      }),
    { init: 装入真配置 },
    超时,
  )

  it.instance(
    "④ 对照：普通命令仍落到 allow（否则「全都 ask」也会过）",
    () =>
      Effect.gen(function* () {
        const build = yield* Agent.Service.use((svc) => svc.get("build"))
        const 实得: Record<string, string[]> = {}
        for (const 命令 of 对照命令) {
          const 请求 = yield* 扫描出的bash请求(命令)
          expect(请求.patterns.length).toBeGreaterThan(0)
          实得[命令] = 请求.patterns.map((pattern) => 判定(build.permission, pattern))
        }
        expect(实得).toEqual(Object.fromEntries(对照命令.map((命令) => [命令, ["allow"]])))
      }),
    { init: 装入真配置 },
    超时,
  )

  it.instance(
    "⑤ 配置是**全局**的：全部 native agent 逐个打勾（含 `\"*\":\"deny\"` 那三个，被放宽成 ask）",
    () =>
      Effect.gen(function* () {
        // 被改方是「每一个 agent」（`agent/agent.ts` 里每个都 `merge(defaults, …, user)`），
        // 所以落点要逐个打勾、不能只验 build 一个（`LEARNINGS #005-04`）。
        // 这里直接用样本**命令串**当 pattern：② 已钉住 `patterns == [命令串]`，且扫描器不认识 agent，
        // 所以两者等价——逐个 agent 再跑一遍 wasm 解析纯属浪费。
        const 名单 = ["build", "plan", "general", "explore", "compaction", "title", "summary"]
        const 实得: Record<string, Record<string, string>> = {}
        for (const 名 of 名单) {
          const agent = yield* Agent.Service.use((svc) => svc.get(名))
          实得[名] = Object.fromEntries(样本命令.map((项) => [项.命令, 判定(agent.permission, 项.命令)]))
        }
        expect(实得).toEqual(
          Object.fromEntries(名单.map((名) => [名, Object.fromEntries(样本命令.map((项) => [项.命令, "ask"]))])),
        )

        // ⚠️ 如实钉住其中一处**放宽**：`title` / `summary` / `compaction` 自己的规则集是
        // `merge(defaults, {"*":"deny"}, user)`，user 在最后 ＋ `findLast` ⇒ 我们声明的 pattern
        // 把它们自己的 deny 放宽成了 ask（未声明的命令照旧 deny，见下一条）。
        // 方向是「更爱问」不是「更放行」，可它确实改了这三个隐藏 agent 的行为（它们若真去跑删数据的
        // 命令，现在是弹窗而不再是当场拒绝）——这条既是记账，也是**警报**：哪天 user 被排到 per-agent
        // deny 之前，它会红，请回来回答「要不要保留这个放宽」。
        const title = yield* Agent.Service.use((svc) => svc.get("title"))
        expect(判定(title.permission, "bun run test")).toBe("deny")
      }),
    { init: 装入真配置 },
    超时,
  )

  it.instance(
    "⑥ 如实钉住一处天花板：包一层包装器就不命中黑名单（缺口，不是待修 bug）",
    () =>
      Effect.gen(function* () {
        const build = yield* Agent.Service.use((svc) => svc.get("build"))
        const 请求 = yield* 扫描出的bash请求(绕过样本)
        // 前半条：扫出来的是**整条命令的源文本**（`sudo rm -rf build`）——它不以 `rm ` 开头。
        expect(请求.patterns).toEqual([绕过样本])
        // 后半条：于是不匹配 `rm *` ⇒ 兜底 allow。这条断言的作用是**哨兵**：哪天这层加了
        // 「拆包装器」的解析，它会红，逼人回来看这条缺口还在不在
        // （`LEARNINGS #005-15`：让断言说的和它真能拦的是一回事）。
        expect(请求.patterns.map((pattern) => 判定(build.permission, pattern))).toEqual(["allow"])
      }),
    { init: 装入真配置 },
    超时,
  )
})
