import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect } from "effect"
import {
  resolveModelFromConfig,
  resolveModelWith,
  解析启动模型,
  type ModelUnavailable,
  type Purpose,
} from "../../src/server/openhive/model-resolve"

type 配置 = Parameters<typeof resolveModelFromConfig>[0]

const 跑 = (config: 配置, purpose: Purpose, explicit?: { providerID: string; modelID: string }) =>
  Effect.runSync(Effect.result(resolveModelFromConfig(config, purpose, explicit)))

const 取错 = (结果: ReturnType<typeof 跑>): ModelUnavailable => {
  if (结果._tag === "Success") throw new Error("期望失败，实际成功")
  return 结果.failure
}

describe("task 槽位", () => {
  test("有 task_model ⇒ 用它，source=task_model", () => {
    const 结果 = 跑({ model: "gw/chat", task_model: "gw/task" }, "task")
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "task", source: "task_model" })
  })

  test("只有 model ⇒ 回落，source=model", () => {
    const 结果 = 跑({ model: "gw/chat" }, "task")
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "chat", source: "model" })
  })

  test("task_model 为空串 ⇒ 视为未设置，回落 model", () => {
    const 结果 = 跑({ task_model: "", model: "gw/chat" }, "task")
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "chat", source: "model" })
  })

  test("两者都没有 ⇒ no_config，文案点名 task_model", () => {
    const 错误 = 取错(跑({}, "task"))
    expect(错误.reason).toBe("no_config")
    expect(错误.detail).toContain("task_model")
  })

  test("没有斜杠 / 空段 ⇒ bad_format", () => {
    expect(取错(跑({ task_model: "abc" }, "task")).reason).toBe("bad_format")
    expect(取错(跑({ task_model: "gw/" }, "task")).reason).toBe("bad_format")
    expect(取错(跑({ task_model: "/task" }, "task")).reason).toBe("bad_format")
  })

  test("provider 在配置里声明了 models、但模型名不在其中 ⇒ unknown_model", () => {
    const 错误 = 取错(
      跑({ task_model: "gw/nope", provider: { gw: { models: { chat: { name: "Chat" } } } } }, "task"),
    )
    expect(错误.reason).toBe("unknown_model")
    expect(错误.detail).toContain("gw/nope")
  })

  test("provider 声明了且模型名在 ⇒ 通过", () => {
    const 结果 = 跑(
      { task_model: "gw/task", provider: { gw: { models: { task: { name: "Task" } } } } },
      "task",
    )
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "task" })
  })

  test("provider 不在配置文件里（来自授权/模型目录）⇒ 启动期放行，留给作业期 getModel 判定", () => {
    const 结果 = 跑({ task_model: "deepseek/deepseek-v4-pro" }, "task")
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "deepseek", modelID: "deepseek-v4-pro" })
  })

  test("task 从不兜底到「第一个可用 provider」：没有任何配置就是 no_config", () => {
    const 错误 = 取错(跑({ provider: { a: { models: { m: { name: "M" } } } } }, "task"))
    expect(错误.reason).toBe("no_config")
  })

  test("task 绝不调用兜底：注入一个「一调用就炸」的 fallback，结果仍是 no_config", () => {
    const 结果 = Effect.runSync(
      Effect.result(resolveModelWith({}, "task", undefined, Effect.die(new Error("兜底被调用")))),
    )
    if (结果._tag === "Success") throw new Error("期望失败，实际成功")
    expect(结果.failure.reason).toBe("no_config")
  })
})

describe("chat 槽位", () => {
  test("显式传入 ⇒ source=session，配置里的 model 不参与", () => {
    const 结果 = 跑({ model: "gw/chat" }, "chat", { providerID: "other", modelID: "x" })
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "other", modelID: "x", source: "session" })
  })

  test("没有显式、配置有 model ⇒ source=model", () => {
    const 结果 = 跑({ model: "gw/chat" }, "chat")
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "chat", source: "model" })
  })

  test("model 为空串 ⇒ 视为未配置", () => {
    expect(取错(跑({ model: "" }, "chat")).reason).toBe("no_config")
  })

  test("没有显式、配置也没有 model ⇒ 才走 fallback，source=fallback", () => {
    const 结果 = Effect.runSync(
      Effect.result(
        resolveModelWith(
          {},
          "chat",
          undefined,
          Effect.succeed({ providerID: ProviderV2.ID.make("a"), modelID: ModelV2.ID.make("b") }),
        ),
      ),
    )
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "a", modelID: "b", source: "fallback" })
  })
})

describe("启动期解析", () => {
  test("旧环境变量被忽略，只打 WARN，不影响解析结果", () => {
    const 结果 = Effect.runSync(
      Effect.result(解析启动模型({ model: "gw/chat" }, { OPENHIVE_CASE_EXTRACT_MODEL: "old/model" })),
    )
    if (结果._tag === "Failure") throw new Error("不该失败")
    expect(结果.success).toMatchObject({ providerID: "gw", modelID: "chat", source: "model" })
  })

  test("没有模型配置 ⇒ 抛 ModelUnavailable（启动自检据此拒绝启动）", () => {
    const 结果 = Effect.runSync(Effect.result(解析启动模型({}, {})))
    if (结果._tag === "Success") throw new Error("期望失败，实际成功")
    expect(结果.failure.reason).toBe("no_config")
  })
})
