import { afterEach, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 模型槽位面板 } from "./settings-model-slots"

const 挂过的: Array<() => void> = []
afterEach(() => 挂过的.splice(0).forEach((卸载) => 卸载()))

function 渲染(数据: Parameters<typeof 模型槽位面板>[0]["数据"]) {
  const 根 = document.createElement("div")
  document.body.appendChild(根)
  const 卸载 = render(() => 模型槽位面板({ 数据 }), 根)
  挂过的.push(() => {
    卸载()
    根.remove()
  })
  return 根.textContent ?? ""
}

test("两个槽位都显式配置", () => {
  const 文案 = 渲染({
    chat: { model: "gw/chat", source: "model" },
    task: { model: "gw/task", source: "task_model" },
  })
  expect(文案).toContain("当前生效")
  expect(文案).toContain("聊天默认")
  expect(文案).toContain("gw/chat")
  expect(文案).toContain("后台任务")
  expect(文案).toContain("gw/task（显式配置）")
})

test("task 未设 ⇒ 说清回落目标", () => {
  const 文案 = 渲染({
    chat: { model: "gw/chat", source: "model" },
    task: { model: "gw/chat", source: "model" },
  })
  expect(文案).toContain("未设置，回落到 gw/chat")
})

test("都没配 ⇒ 未设置", () => {
  const 文案 = 渲染({
    chat: { model: null, source: null },
    task: { model: null, source: null },
  })
  expect(文案).toContain("未设置")
})
