/**
 * `.hgraph` 视图的「打开通道」（012 · T007）。
 *
 * 本视图这一轮只做**打开**：读内容 → 0 字节先 `init` → 解析 → 渲染最小可用信息。
 * 画布/编辑器/撤销栈是 T009/T010，本文件不钉它们。
 *
 * 组件测试没有 `@solidjs/testing-library`（本包未装），用 `solid-js/web` 的 `render` +
 * 自己插一个容器（同 `file-create-dialog.test.tsx`）。
 *
 * projectId 由视图在**挂载时读一次**（`currentProject()?.id`）再传给 api——测试注入那条缝，
 * 并顺手钉住「传下去的是同一个 id」以及「没有项目就一条请求都不发」。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 没项目, type HgraphApi } from "@/project/hgraph-api"
import { 创建HgraphView } from "./hgraph-view"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 一份图 = JSON.stringify({
  格式: 1,
  标题: "张三资金流向",
  创建于: "2026-11-15T10:00:00+08:00",
  更新于: "2026-11-15T10:00:00+08:00",
  设置: {},
  节点: [{ id: "n1" }, { id: "n2" }],
  边: [{ id: "e1" }],
  文字: [],
})

/** 只实现本视图会用的两个方法；`写` / `导出许可` 走到就说明视图越权了。 */
function 假api(剧本: {
  读: Awaited<ReturnType<HgraphApi["读"]>>
  初始化?: Awaited<ReturnType<HgraphApi["初始化"]>>
}) {
  const 调用: string[] = []
  const 收到: Array<{ projectId: string; path: string }> = []
  const api: HgraphApi = {
    读: async (input) => {
      调用.push("读")
      收到.push(input)
      return 剧本.读
    },
    初始化: async (input) => {
      调用.push("初始化")
      收到.push(input)
      if (!剧本.初始化) throw new Error("剧本里没给初始化")
      return 剧本.初始化
    },
    写: async () => {
      throw new Error("打开通道不该写")
    },
    导出许可: async () => {
      throw new Error("打开通道不该导出")
    },
  }
  return { api, 调用, 收到 }
}

async function 挂上(
  api: HgraphApi,
  path = "分析/张三资金流向.hgraph",
  取项目id: () => string | undefined = () => "p 1",
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => {
    const View = 创建HgraphView(api, 取项目id)
    return <View path={path} />
  }, host))
  // createResource 的首次解析在微任务里；给几轮 flush 让它落定。
  await flush()
  await flush()
  await flush()
}

const 文案 = (slot: string) => document.body.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

describe("关系图视图（打开通道）", () => {
  test("0 字节 ⇒ **先 init、再按返回内容渲染**（顺序也钉住）", async () => {
    const { api, 调用, 收到 } = 假api({
      读: { kind: "ok", value: { 内容: "", 版本: "空文件哈希" } },
      初始化: { kind: "ok", value: { 内容: 一份图, 版本: "v1", 写入: true } },
    })

    await 挂上(api)

    // 主判据一：先读、读到 0 字节后才 init（不是反过来，也不是两个都调就算）。
    expect(调用).toEqual(["读", "初始化"])
    // 挂载时读一次项目 id，**两次调用拿到的是同一个值**（不是各自内部再读单例）。
    expect(收到).toEqual([
      { projectId: "p 1", path: "分析/张三资金流向.hgraph" },
      { projectId: "p 1", path: "分析/张三资金流向.hgraph" },
    ])
    // 主判据二：渲染的是 **init 返回的那份内容**，不是空串。
    expect(文案("hgraph-title")).toBe("张三资金流向")
    expect(文案("hgraph-counts")).toContain("节点 2")
    expect(文案("hgraph-counts")).toContain("边 1")
    expect(文案("hgraph-counts")).toContain("文字 0")
  })

  test("非空文件 ⇒ 不调 init", async () => {
    const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 一份图, 版本: "v1" } } })

    await 挂上(api)

    expect(调用).toEqual(["读"])
    expect(文案("hgraph-title")).toBe("张三资金流向")
  })

  test("格式 99（NEWER_VERSION）⇒ 只读提示，且不调 init", async () => {
    const { api, 调用 } = 假api({
      读: {
        kind: "ok",
        value: { 内容: JSON.stringify({ 格式: 99, 节点: [], 边: [], 文字: [] }), 版本: "v9" },
      },
    })

    await 挂上(api)

    expect(调用).toEqual(["读"])
    expect(文案("hgraph-error") ?? "").toContain("99")
    expect(文案("hgraph-readonly") ?? "").toContain("只能查看")
  })

  test("读失败 ⇒ 把服务端那句话显示出来（不假装是一张空图）", async () => {
    const { api } = 假api({ 读: { kind: "error", message: "不是该项目成员", code: "FORBIDDEN" } })

    await 挂上(api)

    expect(文案("hgraph-error")).toBe("不是该项目成员")
    expect(文案("hgraph-counts")).toBeUndefined()
  })

  // 两种空值各起**一条**用例：同一条用例里连挂两次会共用 `document.body`，
  // 第二轮文案可能被第一轮留下的节点满足（假绿）；调用断言虽各自独立，文案就废了。
  for (const [标签, 空] of [
    ["未定义", undefined],
    ["空串", ""],
  ] as const) {
    test(`没有当前项目（${标签}）⇒ **一条请求都不发**，显示「没有打开的项目」`, async () => {
      const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 一份图, 版本: "v1" } } })

      await 挂上(api, undefined, () => 空)

      expect(调用).toEqual([])
      expect(文案("hgraph-error")).toBe(没项目)
      expect(文案("hgraph-error")).toContain("没有打开的项目")
      expect(文案("hgraph-counts")).toBeUndefined()
    })
  }

  test("初始化失败 ⇒ 显示失败话术，不假装载入成功", async () => {
    const { api, 调用 } = 假api({
      读: { kind: "ok", value: { 内容: "", 版本: "空文件哈希" } },
      初始化: { kind: "error", message: "图文件写不进去", code: "INTERNAL" },
    })

    await 挂上(api)

    expect(调用).toEqual(["读", "初始化"])
    expect(文案("hgraph-error")).toBe("图文件写不进去")
    expect(文案("hgraph-counts")).toBeUndefined()
  })

  test("纯空白内容**不 trim** ⇒ BAD_JSON 失败态，也不调 init", async () => {
    const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: "   \n", 版本: "v1" } } })

    await 挂上(api)

    // 带空白的文件不是空文件（契约 hgraph-ops §3）：只有真 0 字节才 init。
    expect(调用).toEqual(["读"])
    expect(文案("hgraph-error") ?? "").toContain("不是合法 JSON")
    expect(文案("hgraph-readonly")).toBeUndefined()
    expect(文案("hgraph-counts")).toBeUndefined()
  })
})
