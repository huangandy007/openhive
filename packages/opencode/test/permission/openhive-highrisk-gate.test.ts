/**
 * T014 / SC-003「高风险动作 **100% 强制人确认**」——**判定之后那一跳**：挂起、等人、拒不执行。
 *
 * ## 这条 task 与 T012 见证的分工（`LEARNINGS #005-09`：先读挂账，别把已占的当新缺口）
 *
 * T012 的 `openhive-highrisk-ask.test.ts` 钉的是「**声明 → 规则集 → 判定**」：配置里的 8 条
 * 删除类 pattern 真的进了每个 agent 的规则集，`evaluate()` 算出来是 `ask`。它**止步于判定**
 * ——文件头自己写明：「不测『民警真的会被弹窗拦住』……本机测到的是它**上游**那一跳」。
 *
 * 本文件接的就是那一跳的**前半段**，且**不需要前端、不需要真模型**：把生产里那个 `ctx.ask`
 * （`session/tools.ts`：`permission.ask({...req, sessionID, tool, ruleset}).pipe(Effect.orDie)`）
 * 原样接上真 `Permission.Service`，于是整条链在测试里跑通：
 *
 * ```
 * 真 shell 工具的 collect() → scan.patterns / scan.always
 *   → ctx.ask（生产形状：merge(agent.permission, session.permission) ＋ orDie）
 *   → Permission.ask()：命中 ask ⇒ 挂 pending ＋ publish Asked ＋ **阻塞在 Deferred 上**
 *   → 测试扮演「民警」调 reply(reject / once)
 *   → 工具：die（退出码非 0，命令一步没跑） / 真的执行
 * ```
 *
 * ## 明确不测的（三条都已在别处占住，重写一遍只会稀释证据）
 *
 * 1. **上游 `ask/reply` 的机制**（once / always / reject / 同会话连坐 / 事件）——
 *    `test/permission/next.test.ts` 有一整组，本文件不再写一遍。
 * 2. **前端那个自动应答开关的默认值**（`packages/app/src/context/permission-auto-respond.ts`）——
 *    既有 `permission-auto-respond.test.ts:34` 的「defaults to requiring approval」已经钉了。
 * 3. **T012 已如实挂账的两条天花板**（黑名单按模式匹配**天生可绕过** / 民警真的被弹窗拦住要靠
 *    前端 ＋ 真会话）——只引用，不重报、不当新发现（`LEARNINGS #005-09`）。
 *
 * ## ⚠️ 两个夹具上的坑（都实测过，不是推断）
 *
 * ① **命令里的路径必须走正斜杠**。实测（2026-10-07，本机 win32 ＋ Git Bash）：
 * `rm -rf C:\Users\…\victim` 退出码是 **0**，而 victim **一个都没删**——bash 把反斜杠当转义吃掉、
 * `-f` 又把不存在的路径静默放过。这正是 `LEARNINGS #004-08` 那句「**没报错 ≠ 执行了**」，
 * 也正是 ③ 组那条**对照**的用处：只断「拒绝后目录还在」的话，一个**根本跑不动**的命令会让它**恒绿**。
 * ② **shell 必须显式 pin**。`shell.ts` 走 `Shell.acceptable(cfg.shell)`，不给就是
 * `select(process.env.SHELL)`，win32 兜底取 `win()[0]`（本机顺序表里 `pwsh` 缺、落在 **powershell**）。
 * 而 `rm -rf` 在 PowerShell 下**参数不合法**（`-rf` 不是它的参数）⇒ 同一份测试会**看谁在跑**而红绿不同。
 * 所以这里把 `shell` 显式钉成 Git Bash（与 `test/tool/shell.test.ts` 取 `Shell.gitbash()` 同一做法）。
 * 钉的是**执行用的 shell**；被测的**规则清单**逐字取自仓库 `.opencode/opencode.jsonc`。
 */
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Shell } from "@opencode-ai/core/shell"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { ConfigParse } from "../../src/config/parse"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShellTool } from "../../src/tool/shell"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * 与 T012 那份见证**同因同注**（`LEARNINGS #004-12`：新出口先把同族 harness 整段抄来）——
 * 这里多挂两个 node：`Permission.node`（真闸门）与 `EventV2Bridge.node`（它 publish
 * `Event.Asked` / `Event.Replied` 要用，见 `permission/index.ts`）。
 */
const layer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      Plugin.node,
      Provider.node,
      Auth.node,
      Config.node,
      RuntimeFlags.node,
      CrossSpawnSpawner.node,
      FSUtil.node,
      Truncate.node,
      Permission.node,
      EventV2Bridge.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
  testInstanceStoreLayer,
)
const it = testEffect(layer)

Shell.acceptable.reset()

/** 真 `Config` 加载每样东西都要点时间；与 T012 取同一个数，免得直接跑这个文件时红得莫名其妙。 */
const 超时 = 30_000

/** 仓库根（本文件在 `packages/opencode/test/permission/`，上溯四级）。 */
const 仓库根 = path.resolve(import.meta.dir, "../../../..")
const 配置路径 = path.join(仓库根, ".opencode", "opencode.jsonc")

type 动作 = "ask" | "allow" | "deny"

/**
 * 真配置里声明的 `permission.bash` —— **照产品同一个解析器读**（`ConfigParse.jsonc`），
 * 不自己编一份（`LEARNINGS #002-06`：同一个判断别两处各写一份；与 T012 的 `声明的bash规则`
 * 同因同注）。本文件用它**注入**实例配置，所以规则仍逐字来自产品那份文件。
 *
 * 用 `Reflect.get` 而不是断言：`ConfigParse.jsonc` 返回 `unknown`，而本仓开着
 * `typescript/no-unsafe-type-assertion`。读不到就**抛**（不静默返回空对象——空规则集会让
 * 每条命令都落到默认 `allow`，测试会以「一切正常」的样子假绿）。
 */
function 声明的bash规则(): Record<string, 动作> {
  const 数据 = ConfigParse.jsonc(fs.readFileSync(配置路径, "utf8"), 配置路径)
  if (typeof 数据 !== "object" || 数据 === null) throw new Error(`配置不是对象：${配置路径}`)
  const 权限: unknown = Reflect.get(数据, "permission")
  if (typeof 权限 !== "object" || 权限 === null) throw new Error("配置里没有 permission 块")
  const bash: unknown = Reflect.get(权限, "bash")
  if (typeof bash !== "object" || bash === null) throw new Error("配置里没有 permission.bash")
  const 出: Record<string, 动作> = {}
  for (const 键 of Object.keys(bash)) {
    const 值: unknown = Reflect.get(bash, 键)
    if (值 !== "ask" && 值 !== "allow" && 值 !== "deny") throw new Error(`未知动作：${键} = ${String(值)}`)
    出[键] = 值
  }
  return 出
}

/**
 * 夹具配置 ＝ **产品声明的规则清单**（上面那份）＋ 显式 pin 的 shell。
 * ⚠️ 为什么是注入而不是拷真配置文件：配置**发现路径**已由 T012 证过（它把整份
 * `.opencode/opencode.jsonc` 拷进实例，连「这个文件到底会不会被加载」一起测了）；本条要验的是
 * **执行层**，再证一遍发现路径是重复劳动（`LEARNINGS #005-09`）。
 */
const 夹具配置 = {
  config: { shell: Shell.gitbash() ?? Shell.acceptable(), permission: { bash: 声明的bash规则() } },
}

/** 工具真正拿去比的那份请求（与 T012 捕获的同一个形状）。 */
type 捕获的请求 = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

/**
 * 生产形状的 `ctx.ask`：逐字照 `session/tools.ts` 那两行——
 * `merge(agent.permission, session.permission ?? [])` ＋ `Effect.orDie`。
 * ⚠️ `#004-07`：判据清单要照**被调方**逐项打勾，所以这里不省 `ruleset` 那一项
 * （省了它 `ask` 会找不到规则、直接按「未知 permission」兜底 ask，测试看着还绿）。
 *
 * `记录` 是给 ④ 那条对照用的：它要证明**这一次问询真的发生过**（只是答案是 allow），
 * 而「没人被拦」与「压根没问」是两件事。
 */
function 工具上下文(
  权限: Permission.Interface,
  规则集: PermissionV1.Ruleset,
  会话: string,
  记录?: 捕获的请求[],
): Tool.Context {
  const sessionID = SessionID.make(会话)
  const messageID = MessageID.make(`msg_${会话}`)
  return {
    sessionID,
    messageID,
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) => {
      记录?.push(req)
      return 权限.ask({ ...req, sessionID, tool: { messageID, callID: "" }, ruleset: 规则集 }).pipe(Effect.orDie)
    },
  }
}

/** 造一个「靶子」目录并给出**用正斜杠写**的命令（见文件头坑 ①）。 */
function 摆靶子(目录: string) {
  const 靶子 = path.join(目录, "victim")
  fs.mkdirSync(靶子, { recursive: true })
  return { 靶子, 命令: `rm -rf ${靶子.replaceAll("\\", "/")}` }
}

/**
 * 等一条待人确认的请求挂上来（上限 3s）。
 * 超时用 `Effect.die` 而不是返回空集：返回空集的话，「闸门没生效（命令已经跑掉了）」
 * 会以「待办为空」的样子混进断言，读起来像是另一回事（`LEARNINGS #004-08`）。
 */
const 等挂起 = (权限: Permission.Interface) =>
  Effect.gen(function* () {
    for (let 次 = 0; 次 < 300; 次++) {
      const 待办 = yield* 权限.list()
      if (待办.length > 0) return 待办
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error("3s 内没有任何请求挂起来——闸门没生效？命令是不是直接跑掉了？"))
  })

/** 取 build agent 的真规则集（＝ `merge(defaults, build 自己的, user=配置)`）。 */
const 真规则集 = Agent.Service.use((svc) => svc.get("build")).pipe(
  Effect.map((build) => Permission.merge(build.permission, [])),
)

describe("T014 / SC-003 · 高风险动作强制人确认（判定之后那一跳）", () => {
  it.instance(
    "① 声明的 pattern 走到真 ask ⇒ 真的挂起一条待人确认的请求，且命令一步没跑",
    () =>
      Effect.gen(function* () {
        const inst = yield* TestInstance
        const 权限 = yield* Permission.Service
        const 规则集 = yield* 真规则集
        const bash = yield* (yield* ShellTool).init()
        const { 靶子, 命令 } = 摆靶子(inst.directory)

        const 执行 = yield* bash
          .execute({ command: 命令 }, 工具上下文(权限, 规则集, "ses_t014a"))
          .pipe(Effect.forkChild)

        const 待办 = yield* 等挂起(权限)
        // 待办清单逐字比：谁（bash）、拿什么去问（patterns）、以及「记住别再问」的那条（always）。
        // `always[0] === "rm *"` 同时钉住了本次样本**真的落在清单上**。
        expect(待办.length).toBe(1)
        expect({
          permission: 待办[0].permission,
          patterns: [...待办[0].patterns],
          always: [...待办[0].always],
        }).toEqual({ permission: "bash", patterns: [命令], always: ["rm *"] })

        // **被测属性**：闸门真的拦住了执行——挂起期间靶子一个都没少（命令一步没跑）。
        expect(fs.existsSync(靶子)).toBe(true)

        // 交叉核对（带警报语义，`LEARNINGS #004-02`）：工具扫出来的那条 `always` 就是**产品声明
        // 成 ask 的那一条**。少了它，样本命令哪天漂出黑名单（把 `rm -rf` 改成别的写法）这条会
        // 「照样绿」——待办里会多一条**没人认领**的请求，而上面那条相等断言仍成立。
        expect(声明的bash规则()[待办[0].always[0]]).toBe("ask")

        // 收尾：把这一条拒掉，让被 fork 的那一轮正常结束（不留悬挂纤程）。
        yield* 权限.reply({ requestID: 待办[0].id, reply: "reject" })
        yield* Fiber.await(执行)
      }),
    { config: 夹具配置.config },
    超时,
  )

  it.instance(
    "② 民警拒绝 ⇒ 零副作用（靶子仍在），且工具以 RejectedError 收场",
    () =>
      Effect.gen(function* () {
        const inst = yield* TestInstance
        const 权限 = yield* Permission.Service
        const 规则集 = yield* 真规则集
        const bash = yield* (yield* ShellTool).init()
        const { 靶子, 命令 } = 摆靶子(inst.directory)

        const 执行 = yield* bash
          .execute({ command: 命令 }, 工具上下文(权限, 规则集, "ses_t014b"))
          .pipe(Effect.forkChild)
        const 待办 = yield* 等挂起(权限)

        // 前置（`LEARNINGS #004-08`：副作用类判据先证机制是活的）——动手之前靶子确实在。
        expect(fs.existsSync(靶子)).toBe(true)

        yield* 权限.reply({ requestID: 待办[0].id, reply: "reject" })
        const 结局 = yield* Fiber.await(执行)

        // **被测属性**排在伴随信号（失败类型）前面（`LEARNINGS #004-14`：一失败即中止，
        // 书写顺序决定你拿到哪条证据）——先看「有没有留下副作用」，再看「它是怎么结束的」。
        expect(fs.existsSync(靶子)).toBe(true)
        expect(Exit.isFailure(结局)).toBe(true)
        expect(Exit.isFailure(结局) ? Cause.squash(结局.cause) : undefined).toBeInstanceOf(
          PermissionV1.RejectedError,
        )
      }),
    { config: 夹具配置.config },
    超时,
  )

  it.instance(
    "③ 对照：允许（once）⇒ 同一条命令真的跑掉（证明 ② 的「还在」不是因为命令跑不动）",
    () =>
      Effect.gen(function* () {
        const inst = yield* TestInstance
        const 权限 = yield* Permission.Service
        const 规则集 = yield* 真规则集
        const bash = yield* (yield* ShellTool).init()
        const { 靶子, 命令 } = 摆靶子(inst.directory)

        const 执行 = yield* bash
          .execute({ command: 命令 }, 工具上下文(权限, 规则集, "ses_t014c"))
          .pipe(Effect.forkChild)
        const 待办 = yield* 等挂起(权限)
        expect(fs.existsSync(靶子)).toBe(true)

        yield* 权限.reply({ requestID: 待办[0].id, reply: "once" })
        const 结局 = yield* Fiber.await(执行)

        // 副作用（靶子没了）在前：它是「这条命令对本机真有牙」的直接证据——没有它，
        // ② 组的「零副作用」可能只是「这条路根本删不掉东西」（文件头坑 ① 那个反斜杠就是这个形状）。
        expect(fs.existsSync(靶子)).toBe(false)
        expect(Exit.isSuccess(结局)).toBe(true)
      }),
    { config: 夹具配置.config },
    超时,
  )

  it.instance(
    "④ 对照：不在清单里的命令 ⇒ 问了、答的是 allow、没人被拦，命令照跑",
    () =>
      Effect.gen(function* () {
        const inst = yield* TestInstance
        const 权限 = yield* Permission.Service
        const 规则集 = yield* 真规则集
        const bash = yield* (yield* ShellTool).init()
        const 去了 = path.join(inst.directory, "made")
        const 记录: 捕获的请求[] = []

        // 用 `Effect.timeoutOrElse` 兜底：万一哪天清单被写成「什么都问」，这条会**在 10s 内红**，
        // 而不是把整轮 `bun test` 挂住（`LEARNINGS #005-01`：挂死比红更坏，一条结果都取不到）。
        const 结局 = yield* bash
          .execute(
            { command: `mkdir ${去了.replaceAll("\\", "/")}` },
            工具上下文(权限, 规则集, "ses_t014d", 记录),
          )
          .pipe(
            Effect.timeoutOrElse({
              duration: "10 seconds",
              orElse: () => Effect.die(new Error("10s 没跑完——不在清单里的命令被拦住了？")),
            }),
            Effect.exit,
          )

        // 前半条：这次问询**真的发生过**（`ctx.ask` 被调到），且它问的**不是**删除类那几条——
        // 否则「没挂起」可能只是「压根没问」。
        expect(记录.length).toBeGreaterThan(0)
        expect(记录.every((项) => 声明的bash规则()[项.patterns[0]] === undefined)).toBe(true)
        // 被测属性：没人被拦（一条待人确认都没有），命令照跑（副作用生效）。
        expect(Exit.isSuccess(结局)).toBe(true)
        expect(yield* 权限.list()).toEqual([])
        expect(fs.existsSync(去了)).toBe(true)
      }),
    { config: 夹具配置.config },
    超时,
  )
})
