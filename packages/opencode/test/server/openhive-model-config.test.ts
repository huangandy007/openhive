import { describe, expect, test } from "bun:test"
import { 槽位视图 } from "../../src/server/openhive/model-config-routes"

describe("设置页的模型槽位视图", () => {
  test("两个槽位都显式配置", () => {
    expect(槽位视图({ model: "gw/chat", task_model: "gw/task" })).toEqual({
      chat: { model: "gw/chat", source: "model" },
      task: { model: "gw/task", source: "task_model" },
    })
  })

  test("task_model 未设 ⇒ 回落 model 并标明来源", () => {
    expect(槽位视图({ model: "gw/chat" })).toEqual({
      chat: { model: "gw/chat", source: "model" },
      task: { model: "gw/chat", source: "model" },
    })
  })

  test("都没配 ⇒ null，不猜", () => {
    expect(槽位视图({})).toEqual({
      chat: { model: null, source: null },
      task: { model: null, source: null },
    })
  })

  test("空串按未设置处理（与解析入口同一口径）", () => {
    expect(槽位视图({ model: "", task_model: "" })).toEqual({
      chat: { model: null, source: null },
      task: { model: null, source: null },
    })
  })

  test("只配 task_model ⇒ chat 未设置、task 显式", () => {
    expect(槽位视图({ task_model: "gw/task" })).toEqual({
      chat: { model: null, source: null },
      task: { model: "gw/task", source: "task_model" },
    })
  })

  test("回包只有 model / source，绝不含 apiKey / baseURL / options", () => {
    const 视图 = 槽位视图({ model: "gw/chat", task_model: "gw/task" })
    expect(Object.keys(视图.chat).sort()).toEqual(["model", "source"])
    expect(Object.keys(视图.task).sort()).toEqual(["model", "source"])
    expect(JSON.stringify(视图)).not.toContain("apiKey")
    expect(JSON.stringify(视图)).not.toContain("baseURL")
  })
})
