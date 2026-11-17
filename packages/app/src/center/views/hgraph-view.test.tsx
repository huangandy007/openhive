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
import type { 材料视图 } from "@/project/case-materials-api"
import { 建打开出处, 创建HgraphView } from "./hgraph-view"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// 节点/边写全必填字段：T018 的标签几何会读 `名称`/`标签`，缺了就在渲染期崩
//（HEAD 上本文件因此有 3 条既有红）。
const 一份图 = JSON.stringify({
  格式: 1,
  标题: "张三资金流向",
  创建于: "2026-11-15T10:00:00+08:00",
  更新于: "2026-11-15T10:00:00+08:00",
  设置: {},
  节点: [
    { id: "n1", 名称: "甲", 类型: "人", 时间: { 首: "", 末: "" }, x: 100, y: 100 },
    { id: "n2", 名称: "乙", 类型: "人", 时间: { 首: "", 末: "" }, x: 200, y: 100 },
  ],
  边: [{ id: "e1", 从: "n1", 到: "n2", 标签: "转账", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } }],
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
    expect(文案("hgraph-counts")).toContain("节点 2")
    expect(文案("hgraph-counts")).toContain("节点 2")
    expect(文案("hgraph-counts")).toContain("边 1")
    expect(文案("hgraph-counts")).toContain("文字 0")
  })

  test("非空文件 ⇒ 不调 init", async () => {
    const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 一份图, 版本: "v1" } } })

    await 挂上(api)

    expect(调用).toEqual(["读"])
    expect(文案("hgraph-counts")).toContain("节点 2")
  })

  test("顶部不再显示标题 / 文件名一行", async () => {
    const { api } = 假api({ 读: { kind: "ok", value: { 内容: 一份图, 版本: "v1" } } })

    await 挂上(api)

    // 布尔比较，不用 `toBeNull()`（`#013-12`：元素存在时它也通过过）。
    expect(document.body.querySelector("[data-slot='hgraph-title']") === null).toBe(true)
  })

  test("标题为空 ⇒ 也不拿文件名兜底（顶行整行不渲染）", async () => {
    const 无标题 = JSON.stringify({ ...JSON.parse(一份图), 标题: "" })
    const { api } = 假api({ 读: { kind: "ok", value: { 内容: 无标题, 版本: "v1" } } })

    await 挂上(api)

    expect(document.body.querySelector("[data-slot='hgraph-title']") === null).toBe(true)
    // 图本身照常渲染，别把「去掉一行」做成「打不开」。
    expect(文案("hgraph-counts")).toContain("节点 2")
  })

  test("已载入 ⇒ 接上编辑器画布（不是只显示计数）", async () => {
    const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 一份图, 版本: "v1" } } })

    await 挂上(api)

    // 编辑器**不自己再读一遍**：调用序列仍只有视图那一次。
    expect(调用).toEqual(["读"])
    expect(document.body.querySelector("[data-slot='hgraph-canvas']")).not.toBeNull()
    expect(document.body.querySelectorAll("[data-slot='hgraph-node']").length).toBe(2)
    expect(document.body.querySelector("[data-slot='hgraph-save-status']")).not.toBeNull()
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

  test("T019d 非法 JSON ⇒ 「以文本方式打开」；点开显示原文（纯只读，不挂编辑器）", async () => {
    // 带内部换行与缩进：原文必须**一字不改**（不能用会 trim 的文案助手比）。
    const 原文 = '{\n  "格式": 1,\n  "节点": [\n'
    const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 原文, 版本: "v1" } } })

    await 挂上(api)
    expect(文案("hgraph-raw")).toBeUndefined()

    const 钮 = document.body.querySelector<HTMLButtonElement>("[data-slot='hgraph-open-as-text']")
    expect(钮).not.toBeNull()
    expect(钮!.textContent?.trim()).toContain("以文本方式打开")

    钮!.click()
    await flush()

    // 原文一字不改；不挂编辑器（不产生写、不给保存入口）。
    expect(document.body.querySelector("[data-slot='hgraph-raw']")!.textContent).toBe(原文)
    expect(document.body.querySelector("[data-slot='hgraph-canvas']")).toBeNull()
    expect(调用).toEqual(["读"])
  })
})

// ---------------------------------------------------------------------------
// T014 · R63 打开档案：工厂注入回调 → 检查器按钮
// ---------------------------------------------------------------------------

/** 一颗已绑库节点（n1 在 100,100），用于选中后点「打开档案」。 */
const 绑定图 = JSON.stringify({
  格式: 1,
  标题: "绑定图",
  创建于: "",
  更新于: "",
  设置: {},
  节点: [
    {
      id: "n1",
      名称: "张三",
      类型: "人",
      来源: { kind: "实体", 实体: "e1", 值: "张三" },
      时间: { 首: "", 末: "" },
      x: 100,
      y: 100,
    },
  ],
  边: [],
  文字: [],
})

async function 挂绑定图(
  依赖: { 打开档案?: (项目id: string, 实体id: string, 标题: string) => void } = {},
  取项目id: () => string | undefined = () => "p 1",
) {
  const { api, 调用 } = 假api({ 读: { kind: "ok", value: { 内容: 绑定图, 版本: "v1" } } })
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(() => {
      const View = 创建HgraphView(api, 取项目id, 依赖)
      return <View path="分析/绑定图.hgraph" />
    }, host),
  )
  await flush()
  await flush()
  await flush()
  return { 调用 }
}

/** happy-dom 无布局：容器矩形为 0 时画布按恒等映射取点，节点 (100,100) 直接命中。 */
function 点选节点(id: string) {
  const 节点 = document.body.querySelector(`[data-slot='hgraph-node'][data-node-id='${id}']`)!
  节点.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      button: 0,
      buttons: 1,
      pointerId: 1,
    }),
  )
  document.body.querySelector("[data-slot='hgraph-canvas']")!.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1 }),
  )
}

describe("关系图视图 · T014 打开档案接线（R63）", () => {
  test("工厂带回调 ⇒ 透传到检查器按钮；点一次收到 (挂载时项目id, 实体id, 标题)", async () => {
    const 收到: Array<[string, string, string]> = []
    await 挂绑定图({ 打开档案: (项目id, id, 标题) => 收到.push([项目id, id, 标题]) })

    点选节点("n1")
    await flush()

    const 钮 = document.body.querySelector<HTMLButtonElement>("[data-slot='hgraph-open-archive']")
    expect(钮).not.toBeNull()
    expect(钮!.disabled).toBe(false)
    钮!.click()

    expect(收到).toEqual([["p 1", "e1", "张三 · 人"]])
  })

  test("T019a 打开档案用**挂载时**的项目 id：之后切项目也不挪到新项目", async () => {
    let 项目 = "p 1"
    const 收到: Array<[string, string, string]> = []
    await 挂绑定图({ 打开档案: (项目id, id, 标题) => 收到.push([项目id, id, 标题]) }, () => 项目)

    点选节点("n1")
    await flush()

    // 视图还开着，用户切了项目；此时点「打开档案」仍应开到这张图所属的项目。
    项目 = "p 2"
    document.body.querySelector<HTMLButtonElement>("[data-slot='hgraph-open-archive']")!.click()

    expect(收到).toEqual([["p 1", "e1", "张三 · 人"]])
  })

  test("工厂不带回调 ⇒ 视图照常渲染，但没有「打开档案」按钮", async () => {
    const { 调用 } = await 挂绑定图()

    点选节点("n1")
    await flush()

    expect(调用).toEqual(["读"])
    expect(document.body.querySelector("[data-slot='hgraph-canvas']")).not.toBeNull()
    expect(document.body.querySelector("[data-slot='hgraph-open-archive']")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T6b · R-F23 出处材料段 id → 路径
//
// 出处串的材料段是**材料 id**（`mat_x`），材料页却按**路径**取数。这一组不经 DOM，
// 直接钉解析函数：期望值写死字面量（不从被测实现里取），每条正向都配一条负向对照。
// ---------------------------------------------------------------------------

/** 材料视图夹具：字段写全，`status` 取闭集里的合法值（`解析状态们` 之一）。 */
function 一份材料(值: { id: string; path: string }): 材料视图 {
  return {
    id: 值.id,
    path: 值.path,
    kind: "表格",
    status: "已解析",
    detail: null,
    queueAhead: 0,
    factCount: 0,
    numberCount: 0,
    parseable: true,
  }
}

const 清单含 = (...材料们: 材料视图[]) => ({
  kind: "ok" as const,
  value: { materials: 材料们, parseableExtensions: [".xlsx"] },
})

describe("出处材料段 id → 路径（R-F23）", () => {
  test("命中：`mat_x` 换成清单里的 `材料/话单.xlsx`（不把 id 原样交出去）", async () => {
    const 收到: Array<[string, string, number]> = []
    const api = { read: async () => 清单含(一份材料({ id: "mat_x", path: "材料/话单.xlsx" })) }

    建打开出处("p 1", (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]), api)(
      "mat_x",
      12,
    )
    await flush()

    expect(收到).toEqual([["p 1", "材料/话单.xlsx", 12]])
    // 负向对照：拿到的是路径，不是 id。
    expect(收到[0]?.[1]).not.toBe("mat_x")
  })

  test("未命中：材料不在清单里 ⇒ **原样降级**交通道（材料页自己会说取不到）", async () => {
    const 收到: Array<[string, string, number]> = []
    const api = { read: async () => 清单含(一份材料({ id: "mat-别的", path: "材料/别的.xlsx" })) }

    建打开出处("p 1", (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]), api)(
      "mat_x",
      3,
    )
    await flush()

    expect(收到).toEqual([["p 1", "mat_x", 3]])
    // 负向对照：没把清单里**另一条**材料的路径安上去。
    expect(收到[0]?.[1]).not.toBe("材料/别的.xlsx")
  })

  test("read 返回 error ⇒ 原样降级交通道，且不抛到调用方", async () => {
    const 收到: Array<[string, string, number]> = []
    const api = { read: async () => ({ kind: "error" as const, message: "清单挂了" }) }

    建打开出处("p 1", (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]), api)(
      "mat_x",
      5,
    )
    await flush()

    expect(收到).toEqual([["p 1", "mat_x", 5]])
    expect(收到[0]?.[1]).not.toBe("材料/话单.xlsx")
  })

  test("read 抛错 / 拒绝 ⇒ 吞掉，原样降级交通道", async () => {
    const 收到: Array<[string, string, number]> = []
    const api = {
      read: async (): Promise<never> => {
        throw new Error("网络断了")
      },
    }

    建打开出处("p 1", (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]), api)(
      "mat_x",
      8,
    )
    await flush()

    expect(收到).toEqual([["p 1", "mat_x", 8]])
  })

  test("未注入材料api ⇒ 旧壳兼容：原样交出去，一条请求都不发", async () => {
    const 收到: Array<[string, string, number]> = []

    建打开出处("p 1", (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]))(
      "mat_x",
      9,
    )
    await flush()

    expect(收到).toEqual([["p 1", "mat_x", 9]])
  })

  test("项目 id 为空（未定义 / 空串）⇒ 什么也不做：不发请求、不调打开材料", async () => {
    let 读次数 = 0
    const api = {
      read: async () => {
        读次数 += 1
        return 清单含(一份材料({ id: "mat_x", path: "材料/话单.xlsx" }))
      },
    }

    for (const 空 of [undefined, ""] as const) {
      const 收到: Array<[string, string, number]> = []
      const 打开 = 建打开出处(空, (项目id, 材料路径, 行号) => 收到.push([项目id, 材料路径, 行号]), api)
      打开("mat_x", 12)
      await flush()
      expect(收到).toEqual([])
    }
    expect(读次数).toBe(0)
  })
})
