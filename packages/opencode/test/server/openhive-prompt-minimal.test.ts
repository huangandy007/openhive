import { afterEach, describe, expect } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { HttpServer } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Session as SessionNs } from "@/session/session"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { httpApiLayer } from "./httpapi-layer"

/**
 * **右栏那种最小 payload 真能让 AI 跑起来**——T010 / FR-007 那条出参里**「AI 执行」的那一半**。
 *
 * ## 为什么这条要单独写（另一半点在 `packages/app`）
 *
 * 2026-10-07 裁定：这一条出参**两侧拆开测**。
 * - app 侧（`packages/app/src/ai-session/submit-prompt.test.ts`）证「**右栏把那句话按正确的形状
 *   交出去了**」——它止步于 `api.session.prompt` 那一下。
 * - 本文件证「**交出去之后真的跑起来了**」——右栏发出的那种 payload 走完整条执行链、
 *   假模型真被调、回复真落库。
 *
 * 两半都在，才是「AI 执行 ＋ 过程展示」。⚠️ 按 `LEARNINGS #002-02`：**「本机做不了」要写成缺口，
 * 不能写成覆盖**——app 侧那条**测不到**执行（`bun test` 里起不了 opencode 服务器），
 * 所以执行那一半的判据只能落在本仓这一侧，**不能拿 app 侧的绿去顶它**。
 *
 * ## 被测的是什么形状（这是本文件存在的全部理由）
 *
 * 右栏**没有** agent / model 选择器，所以它发出去的 payload **不带这两个字段**
 * （`submit-prompt.ts` 里那两处 `as` 的注释写明了）。而 `packages/app` 的 test:unit harness
 * 里**起不了服务器**，于是「服务端对缺省 agent / model 到底怎么办」这件事在本仓**只在这里被证**：
 *
 * - 走的是 **v1 路线**（`session.promptAsync` → `POST /session/{id}/prompt_async`），
 *   因为**本部署是 v1**：`utils/server-protocol.ts` 的 `detectServerProtocol` **第一档**探
 *   `/global/health`，本仓 server 注册了它（`groups/global.ts` 的 `health: "/global/health"`）
 *   ⇒ 第一档就判 v1。
 *   ⚠️ **原注释写「本仓 server 只注册了这条，`/api/health` 零命中」——那一句是假的**
 *   （第二轮审查核出、我复跑确认）：`/api/health` 由 `packages/protocol/src/groups/health.ts` 定义、
 *   经 `api.ts` 的 `.add(HealthGroup)` 进 `Api`、`httpapi/server.ts` 的 `serverRoutes` 真的 materialize。
 *   只是**走到第二档也不改变结论**：它返回 `{healthy:true}`（无 `pid`）⇒ 按第三档**仍然判 v1**。
 *   ⇒ 拿 v2 路线测就测的不是右栏真走的那一条。
 * - payload 逐字是 v1 client 收的那种：`{ parts: [{ type: "text", text }] }`，**只有正文**
 *   （`SessionPromptAsyncData` 的 `agent` / `model` 都是 optional）。
 *
 * ## 判据（四条，缺一条「跑起来了」就不成立）
 *
 * ① 假模型**真的被调用过**（不是「请求被接受就完事」——`prompt_async` 是 204 立即返回的异步形态，
 *    204 只说明**收下了**，说明不了跑没跑）；
 * ② 助手那条**回复落库**了；③ **用户正文落库**了；
 * ④ **用户那条消息上**被写上了**服务端回退出来的** agent / model —— 这一条是「右栏不传也能
 *    work」的直接证据，也是它将来若改成传值时的对照。
 *    ⚠️ 读的是**消息**、不是 `session`（原写「会话上」，与体内的断言不符）：`prompt_async` 的
 *    204 什么都不回，而消息是另一根纤程写进去的 —— 从消息里取，同时也就证了「回退结果真的可见」。
 *
 * ⚠️ `prompt_async` **立刻返回 204**，执行在另一根纤程上 ⇒ 必须 `pollWithTimeout` 等，
 * 不能拿到 204 就断言（那就是把「收下了」读成「跑完了」）。
 *
 * ## harness 从哪来
 *
 * 整段抄 `test/server/httpapi-sdk.test.ts`（`LEARNINGS #004-12`：新出口的第一动作是抄同族
 * harness 只换判据点）——`appLayer` / `httpApiLayer` / `tmpdirScoped ＋ testProviderConfig`
 * / `TestLLMServer` / `disposeAllInstances ＋ resetDatabase`，一处都没自己发明。
 * 只少了鉴权那一套（本文件不设服务器口令，故不需要存还原 `Flag`）。
 *
 * ⚠️ **断言必须写在 effect 里**（`effect` / `live` 里直接 `expect(...)`），**不是** `return` 一个
 * 待比对的对象：`test/lib/effect.ts` 的 `make` 把 `it.live(name, effect)` 实现成
 * `test(name, () => run(value, liveLayer))` —— **返回值被丢掉**，return-object 那种写法
 * 什么都不断言（蓝本里那几处正是这样）。这一点是本次实测发现的，见 `state.md` 的 T010 出参。
 */

const noopBootstrapLayer = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const appLayer = AppNodeBuilder.build(
  LayerNode.group([FSUtil.node, CrossSpawnSpawner.node, InstanceStore.node, Database.node, SessionNs.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

type TestServices =
  | FSUtil.Service
  | ChildProcessSpawner.ChildProcessSpawner
  | InstanceStore.Service
  | SessionNs.Service
  | HttpServer.HttpServer
type TestScope = Scope.Scope | TestServices

type Sdk = ReturnType<typeof createOpencodeClient>

/** 挂到真 HTTP 服务器上的 v1 SDK 客户端（照 `httpapi-sdk.test.ts` 的 `serverFetch`，去掉鉴权）。 */
function 客户端(directory: string) {
  return HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      const baseUrl = HttpServer.formatAddress(server.address)
      const fetch = Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          const url = new URL(source.url)
          return globalThis.fetch(new Request(new URL(`${url.pathname}${url.search}`, baseUrl), source))
        },
        { preconnect: globalThis.fetch.preconnect },
      ) satisfies typeof globalThis.fetch
      return createOpencodeClient({ baseUrl: "http://localhost", directory, fetch })
    }),
  )
}

/** 一个带假模型的临时工程（照 `withFakeLlm`）。 */
function 带假模型<A, E>(run: (input: { sdk: Sdk; llm: TestLLMServer["Service"] }) => Effect.Effect<A, E, TestScope>) {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const directory = yield* tmpdirScoped({ git: false, config: testProviderConfig(llm.url) })
    return yield* run({ sdk: yield* 客户端(directory), llm })
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function 跑<A, E>(name: string, effect: Effect.Effect<A, E, TestScope>) {
  // ⚠️ bun 默认单用例 5 秒，而本用例要**真的**起一个工程实例（PGlite ＋ 实例引导 ＋ 真 HTTP）
  // 再跑完一轮模型调用 —— 实测冷启动那一下就已经越过 5 秒。放宽到 60 秒不是为了让判据变松：
  // 「等不到就红」由 `pollWithTimeout` 自己那份 5 秒预算负责（它红时会把下面那句话打出来），
  // bun 这道只是**兜底**，别让它抢先掐断、把「跑得慢」说成「没跑起来」。
  it.live(name, effect, { timeout: 60_000 })
}

/** 「那个会话现在有哪些消息」——SDK 的 `[{ info, parts }]`，取不到就空数组。 */
const 拉消息 = (sdk: Sdk, sessionID: string) =>
  Effect.promise(async () => {
    const result = await sdk.session.messages({ path: { id: sessionID }, throwOnError: true })
    return Array.isArray(result.data) ? result.data : []
  })

const 是记录 = (值: unknown): 值 is Record<string, unknown> =>
  值 !== null && typeof 值 === "object" && !Array.isArray(值)

/**
 * 等到「整个会话的 JSON 里出现 `标记`」为止，把那批消息交出来。
 *
 * 判据刻意是**整份消息的 JSON**（与 `httpapi-sdk.test.ts` 那条同法）：这样无论那条文字最终落在
 * part 的哪个字段里都算数——否则断的是「part 的 text 字段叫什么」，上游换个字段名就假红。
 */
const 等到出现 = (sdk: Sdk, sessionID: string, 标记: string) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const 消息 = yield* 拉消息(sdk, sessionID)
      return JSON.stringify(消息).includes(标记) ? 消息 : undefined
    }),
    `等了 5 秒，会话里仍没出现「${标记}」（prompt_async 是异步形态，执行在另一根纤程上）`,
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("右栏那种最小 payload（不带 agent / model）真的会把 AI 跑起来", () => {
  /**
   * ⚠️ 这一条**只**在 v1 路线上跑（`session.promptAsync`）。这不是省事：本部署协议就是 v1
   * （`detectServerProtocol` 探 `/global/health`），v2 路线是 app 今天**不走**的那一条。
   */
  跑(
    "只有正文、没有 agent / model ⇒ 假模型被真的调了，回复与正文都落库，**用户那条消息**被写上回退出来的 agent / model",
    带假模型(({ sdk, llm }) =>
      Effect.gen(function* () {
        const 建 = yield* Effect.promise(() =>
          sdk.session.create({ body: { title: "右栏最小 payload" }, throwOnError: true }),
        )
        // ⚠️ 不加 `String(...)`：`throwOnError: true` 时 `data` 的类型已经带着 `id: string`
        // ⇒ 那层包装是 no-op，会被根配置的 `no-unnecessary-type-conversion` 记一条警告
        // （2026-10-07 实测：加着它时本文件 1 warning / 去掉后 0）。
        const sessionID = (建.data as { id: string }).id

        yield* llm.text("右栏这边真的跑通了")

        // ⚠️ 逐字是右栏会发的那种 body：**只有 `parts`**。`agent` / `model` 一个字都不带。
        // 写了这两个字段这条测试就没意义了——它要证的恰恰是「右栏不自选、服务端自己回退」走得通。
        // ⚠️ part 上那个 `id` **不是多余的**：右栏发出的 part 是 `buildRequestParts` 造的，
        // 每一件都带 `id`（`packages/app/src/components/prompt-input/build-request-parts.ts`，
        // app 侧有一条断言专门钉它）。少了它，这条测试证的形状就比右栏真发的**小一号**。
        // ⚠️ 但**取值形状不复现**：真值是 `prt_` ＋ 26 位（`packages/app/src/utils/id.ts` 的
        //    `Identifier.ascending("part")`），这里手写一个短的。本条要的是「**字段在**」，
        //    不是「格式对」—— 若哪天服务端开始校验 id 格式，这条**不会红**（第二轮审查 F-4
        //    记下的已知限度）。
        yield* Effect.promise(() =>
          sdk.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", id: "prt_rightpane_1", text: "查一下这个账户的资金流向" }] },
            throwOnError: true,
          }),
        )

        // ① 假模型真的被调用过。204 只说明「收下了」，说明不了「跑了」——所以这一条独立成判据。
        // ⚠️ 原来写的是 `yield* llm.wait(1)` ＋ `expect((yield* llm.calls) >= 1).toBe(true)`：
        // 后者**恒真**（`wait(1)` 已经把「≥1」等到了，等于把同一个事实断言两遍），而真没跑起来时
        // 红的是 bun 那 60 秒兜底超时、信息只说「超时」，不说「假模型一次都没被调」。
        // 换成轮询之后，等不到时打出来的就是下面这句话本身。
        yield* pollWithTimeout(
          Effect.gen(function* () {
            return (yield* llm.calls) >= 1 ? true : undefined
          }),
          "等了 5 秒，假模型一次都没被调用（`prompt_async` 收下了，但执行那根纤程没走到模型）",
        )

        // ② 助手那条回复落库了（`等到出现` 找的就是它）。`prompt_async` 立刻回 204、
        //    执行在另一根纤程上 ⇒ 只能轮询等，不能拿 204 当「跑完了」。
        const 消息 = yield* 等到出现(sdk, sessionID, "右栏这边真的跑通了")

        // ③ 用户正文落库了。
        expect(JSON.stringify(消息).includes("查一下这个账户的资金流向")).toBe(true)

        // ④ 服务端把我们**没传**的 agent / model 回退出来了，并且写在用户那条消息上。
        //    从**消息**里取而不是从 session 里取：`prompt_async` 的 204 什么都不回，
        //    而消息是另一根纤程写进去的 —— 同时也就证了「回退结果真的可见」。
        const 用户条 = 消息.map((条) => (是记录(条) ? 条.info : undefined)).find((条) => 是记录(条) && 条.role === "user")
        expect(是记录(用户条)).toBe(true)
        // ⚠️ 标注不能省：`expect(...)` **不做类型收窄**，所以 `是记录(用户条) ? 用户条 : {}` 推出来是
        // `Record<string, unknown> | {}` 的联合，下面 `信息.agent` 会 TS2339（实测红过）。
        const 信息: Record<string, unknown> = 是记录(用户条) ? 用户条 : {}
        // agent 只断「非空」，不断具体名字：取哪个默认 agent 是上游的事，
        // 名字变了不该红在这条（本条要证的是「回退发生了」）。
        // ⚠️ 写成两条比较断言、不用 `as string` 取长度：`as` 会被 oxlint 的
        // `no-unsafe-type-assertion` 命中（仓里既有先例一律走收窄 / 换写法），
        // 而这里根本不需要那个收窄后的值 —— 只要「是个串」＋「不是空串」两条事实。
        const 代理 = 信息.agent
        expect(typeof 代理).toBe("string")
        expect(代理).not.toBe("")
        // 模型断**具体值**：假模型只有一个 ID（`test-provider.ts`）⇒ 非空还可能是「随便挑了一个」，
        // 具体值才说明回退链最后一档（`provider.defaultModel()`：无 `cfg.model`、无 recent 记录时
        // 取第一个 provider 的第一个模型）真的落到了它头上。
        expect(信息.model).toEqual({ providerID: "test", modelID: "test-model" })
      }),
    ),
  )
})
