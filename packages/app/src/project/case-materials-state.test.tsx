import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { CaseMaterialsApi, 材料清单结果, 解析结果 } from "./case-materials-api"
import { createCaseMaterials, type 轮询器 } from "./case-materials-state"

const 行 = (path: string, status: "未入队" | "排队中" | "已解析" = "已解析") => ({
  id: `m-${path}`,
  path,
  kind: "话单",
  status,
  detail: null,
  queueAhead: 0,
  factCount: 1,
  numberCount: 1,
  parseable: true,
})

const 好 = (rows: ReturnType<typeof 行>[]): 材料清单结果 => ({
  kind: "ok",
  value: { materials: rows, parseableExtensions: [".xlsx"] },
})

function 假api(队列: 材料清单结果[]) {
  const 记录: string[] = []
  const api: CaseMaterialsApi = {
    read: async (projectId) => {
      记录.push(`read:${projectId}`)
      return 队列.shift() ?? 好([])
    },
    parse: async (input): Promise<解析结果> => {
      记录.push(`parse:${input.projectId}:${input.path}:${input.action}`)
      return { kind: "ok" }
    },
  }
  return { api, 记录 }
}

function 手动轮询() {
  const 任务: Array<{ fn: () => void; 取消: () => void }> = []
  const 轮询器: 轮询器 = {
    安排: (fn) => {
      const 项 = { fn, 取消: () => undefined }
      任务.push(项)
      return () => {
        项.取消()
        const at = 任务.indexOf(项)
        if (at >= 0) 任务.splice(at, 1)
      }
    },
  }
  return { 轮询器, 任务, 跑一拍: async () => 任务.shift()?.fn() }
}

test("bind：绑定项目就拉一次；换项目先清空再拉新项目", async () => {
  const { api, 记录 } = 假api([好([行("a.xlsx")]), 好([行("b.xlsx")])])
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createCaseMaterials(api, { 轮询器: 手动轮询().轮询器 })
    状态.bind(项目)
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.rows().map((row) => row.path)).toEqual(["a.xlsx"])

    设项目("p2")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.rows().map((row) => row.path)).toEqual(["b.xlsx"])
    expect(记录).toEqual(["read:p1", "read:p2"])
    dispose()
  })
})

test("代次：先发的回包晚到，不许盖掉后发的", async () => {
  const 慢 = new Promise<材料清单结果>((resolve) => setTimeout(() => resolve(好([行("旧.xlsx")])), 20))
  const api: CaseMaterialsApi = {
    read: (projectId) => (projectId === "p1" ? 慢 : Promise.resolve(好([行("新.xlsx")]))),
    parse: async () => ({ kind: "ok" }),
  }
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createCaseMaterials(api, { 轮询器: 手动轮询().轮询器 })
    状态.bind(项目)
    // ⚠️ brief 原样没有这一行时，effect 还没跑过一次就切了项目：p1 的慢请求根本没发出去
    // （实得记录只有 `read:p2`），删掉代次守卫也不会红——前提不成立就是假绿（#005-18）。
    // 先让第一拍落地，让 p1 的慢请求真的在飞，才对得上「先发的回包晚到」。
    await new Promise((r) => setTimeout(r, 0))
    设项目("p2")
    await new Promise((r) => setTimeout(r, 40))
    expect(状态.rows().map((row) => row.path)).toEqual(["新.xlsx"])
    dispose()
  })
})

test("卸载：在飞回包既不写信号，也不续起轮询", async () => {
  let 放行!: (结果: 材料清单结果) => void
  const api: CaseMaterialsApi = {
    read: () => new Promise<材料清单结果>((resolve) => (放行 = resolve)),
    parse: async () => ({ kind: "ok" }),
  }
  const 跑 = 手动轮询()
  let 状态!: ReturnType<typeof createCaseMaterials>
  const 拆 = createRoot((dispose) => {
    状态 = createCaseMaterials(api, { 轮询器: 跑.轮询器 })
    状态.bind(() => "p1")
    return dispose
  })
  // 让 effect 起跑：read 在飞、尚未回包；此时组件卸载（首屏加载中切走就是这条路径）。
  await new Promise((r) => setTimeout(r, 0))
  拆()
  放行(好([行("a.xlsx", "排队中")]))
  await new Promise((r) => setTimeout(r, 0))

  expect(状态.rows()).toEqual([])
  expect(状态.loaded()).toBe(false)
  expect(跑.任务).toHaveLength(0)
})

test("失败保留旧行、只置错误（旧状态比白屏有用）", async () => {
  const { api } = 假api([好([行("a.xlsx")]), { kind: "error", message: "断网了" }])
  await createRoot(async (dispose) => {
    const 状态 = createCaseMaterials(api, { 轮询器: 手动轮询().轮询器 })
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.reload()
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.rows().map((row) => row.path)).toEqual(["a.xlsx"])
    expect(状态.error()).toBe("断网了")
    expect(状态.loaded()).toBe(true)
    dispose()
  })
})

test("轮询：有排队中/解析中才安排下一拍；没有就不排", async () => {
  const 跑 = 手动轮询()
  const { api } = 假api([好([行("a.xlsx", "排队中")]), 好([行("a.xlsx", "已解析")])])
  await createRoot(async (dispose) => {
    const 状态 = createCaseMaterials(api, { 轮询器: 跑.轮询器 })
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(跑.任务).toHaveLength(1)

    await 跑.跑一拍()
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.rows()[0]?.status).toBe("已解析")
    expect(跑.任务).toHaveLength(0)
    dispose()
  })
})

test("parse：带当前项目与动作发请求；失败把 code 原样交回；成功不自己重拉", async () => {
  const { api, 记录 } = 假api([好([])])
  await createRoot(async (dispose) => {
    const 状态 = createCaseMaterials(api, { 轮询器: 手动轮询().轮询器 })
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))

    expect(await 状态.parse("资料/a.xlsx", "重新解析")).toEqual({ kind: "ok" })
    expect(记录).toEqual(["read:p1", "parse:p1:资料/a.xlsx:重新解析"])
    dispose()
  })
})
