import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer } from "effect"
import { jsonSchema, type Tool } from "ai"
import type { Agent } from "../../src/agent/agent"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import type { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider/provider"
import { MessageID, SessionID } from "../../src/session/schema"
import { LLMRequestPrep } from "../../src/session/llm/request"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { testEffect } from "../lib/effect"

/**
 * T005（验收 · FR-003 / SC-003）：**capability 管得住「看不见」这一层**。
 *
 * ## 这条补的是哪个缺口
 *
 * 链 A 的**模型侧工具清单**已经被 capability 管住了——不是 T005 新加的，是 T006 的通道顺带
 * 做的：`SessionTools.resolve` 把 `session.permission` 交给 `registry.tools`，`prompt.ts`
 * 又把它当 `permission` 传进 `process` → `llm.stream` → `LLMRequestPrep.prepare` →
 * `resolveTools`，而 `resolveTools` 读的正是
 * `Permission.disabled(Object.keys(tools), Permission.merge(agent.permission, input.permission ?? []))`。
 *
 * 但**系统提示词里的技能目录**（`SystemPrompt.skills`，`src/session/system.ts`）当时只读
 * `agent.permission` ⇒ 零授权的民警**看不到 `skill` 工具、却照样在提示词里被列出全部技能**：
 * 提示词说「用 skill 工具加载技能」，而那个工具压根不在 tools 里。同一个判断在两处各写一份，
 * 一处跟着 capability 走、一处不跟——`LEARNINGS #003-05` 的假镜像形状。
 *
 * **修法不是「再写一套判据」，是让两处用同一个**：目录这一处改成与工具过滤逐字同款的
 * `Permission.disabled(["skill"], Permission.merge(agent.permission, permission ?? []))`，
 * 与同文件已有的 `mcp(agent, permission?)` 同形。于是有一条可断言的不变式——
 *
 *     **目录可见 ⟺ `skill` 工具可见**（同一个 helper、同一个 orders、同一个 findLast）
 *
 * 下面第 4 条就是这条不变式本身（拿矩阵跑，不是拿一个例子跑）：**两个出口各写一份判据**时，
 * 它们会在某个 ruleset 上分歧，而这条会红——这正是它存在的理由。
 */

const skills: Skill.Info[] = [
  { name: "fund-analysis", description: "资金分析。", location: "/tmp/fund/SKILL.md", content: "# fund" },
  { name: "call-analysis", description: "话单分析。", location: "/tmp/call/SKILL.md", content: "# call" },
]

/** 上游默认的 build agent：`{"*": "allow"}`。**故意宽松**——capability 要能在它之上收紧。 */
const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  LayerNode.compile(SystemPrompt.node, [
    // `SystemPrompt` 的 nodes 里还有 MCP 那条（`mcp()` 用）。本文件只用 `skills()`，
    // 但层要齐——给一个空 instructions 的替身，与本文件断言无关。
    [MCP.node, Layer.mock(MCP.Service, { instructions: () => Effect.succeed([]) })],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => Effect.succeed(skills.find((skill) => skill.name === name)!),
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ],
  ]),
)

/** 零授权用户拿到的能力集（`AccessSession.sessionRuleset([])`）：先整体拒、没有任何 allow。 */
const ZERO_GRANTS: PermissionV1.Ruleset = [{ permission: "skill", pattern: "*", action: "deny" }]

/** 授过一条 `fund-analysis`：整体拒在前、逐条 allow 在后（顺序即语义，链 A 取 findLast）。 */
const GRANTED_FUND_ANALYSIS: PermissionV1.Ruleset = [
  { permission: "skill", pattern: "*", action: "deny" },
  { permission: "skill", pattern: "fund-analysis", action: "allow" },
]

describe("T005 · 技能目录的可见性与 capability 一致", () => {
  /**
   * 🔴 **零授权 ⇒ 目录整段不出现。**
   *
   * 今天这条必红：目录那处只看 `agent.permission`（= `*: allow`）⇒ 照样把全部技能列出来，
   * 而模型这时候连 `skill` 工具都没有。提示词与工具清单互相打架，模型会去调一个不存在的工具。
   */
  it.effect("零授权 ⇒ 技能目录返回 undefined（与 skill 工具不可见一致）", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service

      expect(yield* prompt.skills(build, ZERO_GRANTS)).toBeUndefined()
    }),
  )

  /**
   * **对照：授过一条 ⇒ 目录照旧。**（少了这条，把目录无条件 `return undefined` 也能让上一条绿。）
   *
   * 注意**不是**「只列出被授予的那一条」——目录这一层跟工具过滤用的是同一个
   * `Permission.disabled`，它问的是「这个工具**被整体拒掉**了吗」，不是「这个名字被允许了吗」。
   * 要列「只有 fund-analysis」就得在目录这处**另写一套按名字过滤的判据**，那是
   * `LEARNINGS #003-05` 说的假镜像；逐条授权由**执行期**的 `evaluate` 兜底（T006）。
   */
  it.effect("授过一条 ⇒ 目录照旧出现（并入不是覆盖）", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service

      const output = yield* prompt.skills(build, GRANTED_FUND_ANALYSIS)

      expect(output).toContain("<name>fund-analysis</name>")
    }),
  )

  /**
   * **agent 自己拒掉 skill ⇒ 目录照样隐藏**（capability 没掺和时必须不变）。
   * 钉的是「本改动没有把上游那条判据弄丢」。
   */
  it.effect("agent 自己 deny skill ⇒ 目录返回 undefined（上游行为不变）", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service

      const denied: Agent.Info = { ...build, permission: Permission.fromConfig({ skill: "deny" }) }

      expect(yield* prompt.skills(denied, [])).toBeUndefined()
      expect(yield* prompt.skills(denied)).toBeUndefined()
    }),
  )

  /**
   * **不变式（这一条才是这个文件的主角）：目录可见 ⟺ `skill` 工具可见。**
   *
   * 两个出口拿**同一个** `Permission.disabled` 问**同一个**合并后的 ruleset ⇒ 任何 ruleset 上
   * 都必须同进同退。跑一个小矩阵而不是一个例子：将来有人给目录那处「顺手」加一条自己的判据
   * （比如按名字 allow-list），矩阵上总有一条会红——单例测试挑不出来。
   *
   * `Permission.disabled` 是 `resolveTools` 用的那个**真**函数（`src/permission/index.ts`），
   * 不是这里复刻的镜像（`LEARNINGS #003-05`）。
   */
  it.effect("目录可见性 ≡ skill 工具可见性（矩阵）", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service

      const matrix: PermissionV1.Ruleset[] = [
        ZERO_GRANTS,
        GRANTED_FUND_ANALYSIS,
        [{ permission: "skill", pattern: "fund-analysis", action: "allow" }],
        Permission.fromConfig({ skill: "deny" }),
        Permission.fromConfig({ skill: "ask" }),
        [],
      ]

      for (const capability of matrix) {
        const merged = Permission.merge(build.permission, capability)
        const toolVisible = !Permission.disabled(["skill"], merged).has("skill")
        const catalog = yield* prompt.skills(build, capability)

        expect({ ruleset: capability, visible: catalog !== undefined }).toEqual({
          ruleset: capability,
          visible: toolVisible,
        })
      }
    }),
  )
})

/**
 * ## 第二段：**模型拿到的 `tools` 清单**——这才是 FR-003 的字面出参
 *
 * 走**真** `LLMRequestPrep.prepare`（`src/session/llm/request.ts`），也就是
 * `src/session/processor.ts` → `llm.stream` → 这里的**那一步**：`resolveTools` 就在它里面。
 * 不拿 `Permission.disabled` 单独验一遍——那是上游的辅助函数，验它只说明上游没坏
 * （`LEARNINGS #002-02`：没执行被测路径的测试不是测试）。
 *
 * ⚠️ **这条今天就绿**（T006 的通道顺带把它做成了），所以它不是 TDD 的红——它是**钉现状**：
 * 把「capability → `session.permission` → `resolveTools`」这条搬运通道**钉住**，
 * 将来有人把那行 `input.permission` 从 `resolveTools` 里拿掉（或改传 `agent.permission`），
 * 它会红。**证据是变异**（M5，实测）：把 `resolveTools` 的 `input.permission` 换成
 * `undefined` ⇒ **恰红 1 条**——只有「零授权 ⇒ skill 不在 tools 里」那条。
 * ⚠️ **不是两条都红**：「授过一条」那条**照样绿**，因为变异只是把 capability 从过滤里抽走，
 * `agent.permission`（`{"*": allow}`）本来就允许 skill 可见，而那条断言期望的正是「可见」。
 * 记实的理由（`LEARNINGS #003-03`）：把「恰红 1 条」写成「两条都红」是**更强的断言**，
 * 凑不出来就是凑不出来——这里恰红的那条正是**区分「读了 capability」与「没读」**的那条。
 *
 * `flags` 从**真服务**取（`RuntimeFlags.layer()`），不手搓一个 20 多个字段的字面量——
 * 字面量会随上游加字段而失效，而它是**假绿的来源**（少一个字段照样编译过、行为却不同）。
 */
const SESSION_ID = SessionID.make("ses_t005_tool_list")

const model: Provider.Model = {
  id: ModelV2.ID.make("test-model"),
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model", url: "https://example.invalid/v1", npm: "@ai-sdk/openai-compatible" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100_000, output: 8_192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const user: SessionV1.User = {
  id: MessageID.ascending(),
  sessionID: SESSION_ID,
  role: "user",
  time: { created: 0 },
  agent: build.name,
  model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
}

/** `skill` 是受 capability 管辖的那个；`bash` 是**对照**——证明过滤不是「把工具全删了」。 */
const TOOLS: Record<string, Tool> = {
  skill: { description: "Load a skill", inputSchema: jsonSchema({ type: "object", properties: {} }) },
  bash: { description: "Run a command", inputSchema: jsonSchema({ type: "object", properties: {} }) },
}

const noopPlugin: Plugin.Interface = {
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
}

const list = testEffect(RuntimeFlags.layer({ outputTokenMax: 32_000, client: "test" }))

const prepareWith = (permission: PermissionV1.Ruleset) =>
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    return yield* LLMRequestPrep.prepare({
      user,
      sessionID: SESSION_ID,
      model,
      agent: build,
      permission,
      system: [],
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      provider: { id: ProviderV2.ID.make("test"), name: "Test", source: "custom", env: [], options: {}, models: {} },
      auth: undefined,
      plugin: noopPlugin,
      flags,
      isWorkflow: false,
    })
  })

describe("T005 · 无权工具不出现在模型拿到的 tools 里", () => {
  list.effect("零授权 ⇒ skill 不在 tools 里，bash 照旧在（不是把工具全删了）", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareWith(ZERO_GRANTS)

      expect(Object.keys(prepared.tools)).not.toContain("skill")
      expect(Object.keys(prepared.tools)).toContain("bash")
    }),
  )

  list.effect("授过一条 ⇒ skill 照旧在 tools 里（并入不是覆盖）", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareWith(GRANTED_FUND_ANALYSIS)

      expect(Object.keys(prepared.tools)).toContain("skill")
      expect(Object.keys(prepared.tools)).toContain("bash")
    }),
  )
})
