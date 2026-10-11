import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { 从键, 模型键, 模型选项, 当前模型键 } from "./model-selection"

/**
 * 右栏底栏模型选择器的**判断**那一半（纯函数；接线在 `ai-session-slot.tsx`，那层挂不起来测）。
 *
 * ## 三个来源的优先级不是随手排的
 *
 * `本栏选的 → 这场会话记的 → 应用默认`：
 * - **本栏选的**优先，因为用户的最后一次点击是最终意愿；
 * - 其次是**会话记的**（服务端 `session.model`）——它由服务端在每次发消息时写
 *   （`packages/opencode/src/session/prompt.ts` 的 `createUserMessage`：模型与库里那条不一致就
 *   `sessions.setAgentModel`）⇒ 切回一场旧会话时，底栏显示的就是那场会话自己的模型；
 * - 最后是**应用默认**——`useProviders().defaultModel()`，服务端归一化后的那一份
 *   （**不**自己跑 `local.tsx` 那套 `configuredModel ?? recent ?? default`：那是同一件事的
 *   第二处写法，`LEARNINGS #002-06`）。
 *
 * ## 为什么恒要有值
 *
 * 上游 `submit.ts` 那两条出口都假设 `draft.model` 必有值：命令分支直接读 `.modelID`（F3，
 * 当场抛），normal 分支 `{...undefined, variant}` 得 `{}`（F4，在服务端是**真值** ⇒ 把
 * `input.model ?? ag.model ?? currentModel()` 的回退链顶掉 ⇒ 报错）。⇒ 本栏恒给一个具体模型，
 * 是 F3/F4 一起收口的**前提**。
 */

const 供应商 = (id: string, 模型: Array<{ id: string; name: string }>): Provider =>
  ({
    id,
    name: id,
    models: Object.fromEntries(模型.map((m) => [m.id, { ...m, providerID: id }])),
  }) as unknown as Provider

describe("模型键：两截拼一个字符串（`PromptInputV2SelectControl.current` 只收一个字符串）", () => {
  test("拼出来是 `providerID/modelID`", () => {
    expect(模型键("anthropic", "claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5")
  })

  test("拆得回来（往返）", () => {
    expect(从键(模型键("anthropic", "claude-sonnet-5-5"))).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-5-5",
    })
  })

  test("模型名自己带斜杠也拆得对（按**第一个**斜杠切：providerID 不含斜杠，modelID 可能含）", () => {
    expect(从键("openrouter/meta-llama/llama-3-70b")).toEqual({
      providerID: "openrouter",
      modelID: "meta-llama/llama-3-70b",
    })
  })

  test("没有斜杠 / 斜杠在头上 / 斜杠在尾上 ⇒ `undefined`（不是一个合法的键）", () => {
    expect(从键("没有斜杠")).toBeUndefined()
    expect(从键("/gpt")).toBeUndefined()
    expect(从键("openai/")).toBeUndefined()
  })
})

describe("候选：已接入的 provider × 它的模型", () => {
  test("每个模型一项，`id` 是键、`label` 是显示名、`providerID` 带上（原生画图标用）", () => {
    expect(模型选项([供应商("openai", [{ id: "gpt", name: "GPT" }])])).toEqual([
      { id: "openai/gpt", label: "GPT", providerID: "openai" },
    ])
  })

  test("两个 provider 的模型全在（不筛 popular、不截断）", () => {
    const 选项 = 模型选项([
      供应商("openai", [{ id: "gpt", name: "GPT" }]),
      供应商("anthropic", [{ id: "sonnet", name: "Sonnet" }]),
    ])

    expect(选项.map((项) => 项.id)).toEqual(["openai/gpt", "anthropic/sonnet"])
  })

  test("显示名是空串时退回模型 id（按钮上就会写「空」）", () => {
    expect(模型选项([供应商("openai", [{ id: "gpt", name: "" }])])[0].label).toBe("gpt")
  })
})

describe("当前模型：本栏选的 → 会话记的 → 应用默认", () => {
  test("三样都有 ⇒ 取**本栏选的**", () => {
    expect(
      当前模型键({
        本栏选的: "openai/gpt",
        会话记的: { providerID: "anthropic", id: "sonnet" },
        应用默认: { providerID: "google", modelID: "gemini" },
      }),
    ).toBe("openai/gpt")
  })

  test("本栏没选过 ⇒ 取**会话记的**（切回旧会话时显示它自己的模型）", () => {
    expect(
      当前模型键({
        会话记的: { providerID: "anthropic", id: "sonnet" },
        应用默认: { providerID: "google", modelID: "gemini" },
      }),
    ).toBe("anthropic/sonnet")
  })

  test("会话也没记过（新建即提交）⇒ 取**应用默认**", () => {
    expect(当前模型键({ 应用默认: { providerID: "google", modelID: "gemini" } })).toBe("google/gemini")
  })

  test("三样都没有 ⇒ `undefined`（此时提交会被守卫挡下，不发出去）", () => {
    expect(当前模型键({})).toBeUndefined()
  })
})
