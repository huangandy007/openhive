import { expect, test } from "bun:test"
import { 解析生效模型, 读生效模型 } from "./model-slots-api"

const 好 = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

test("解析：两个槽位齐全 ⇒ ok", async () => {
  const 结果 = await 读生效模型(
    好({
      chat: { model: "gw/chat", source: "model" },
      task: { model: "gw/task", source: "task_model" },
    }),
  )
  expect(结果).toEqual({
    kind: "ok",
    value: {
      chat: { model: "gw/chat", source: "model" },
      task: { model: "gw/task", source: "task_model" },
    },
  })
})

test("解析：null 槽位合法", () => {
  expect(
    解析生效模型({ chat: { model: null, source: null }, task: { model: null, source: null } }),
  ).toEqual({ chat: { model: null, source: null }, task: { model: null, source: null } })
})

test("形状不对 ⇒ undefined（不知道 ≠ 空）", () => {
  expect(解析生效模型({ chat: { model: "gw/chat", source: "model" } })).toBeUndefined()
  expect(解析生效模型({ chat: { model: 1, source: "model" }, task: { model: null, source: null } })).toBeUndefined()
  expect(解析生效模型({ chat: { model: null, source: "fallback" }, task: { model: null, source: null } })).toBeUndefined()
})

test("非 200 ⇒ error", async () => {
  const 结果 = await 读生效模型(async () => new Response("", { status: 500 }))
  expect(结果.kind).toBe("error")
})
