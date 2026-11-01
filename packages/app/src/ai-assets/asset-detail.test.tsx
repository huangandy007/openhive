import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { render } from "solid-js/web"
import { CONTENT_LIMITS, type AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { 行数上界, 订阅会话输入, 订阅最近回复 } from "@/ai-session/send-to-session"
import { AssetDetail, 详情Tab列表, type AssetDetailProps } from "./asset-detail"

/**
 * 资产详情（009 T007 / DESIGN §4.10）。
 *
 * 断言纪律（`#005-47` / `#006-22`）：只钉 `textContent` 全等与 `aria-selected` 这类**可区分**的值，
 * 不用 `className.includes(...)` 断 Tailwind 子串；空态与有值态各写一条，避免默认值满足断言。
 */
function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset-1",
    name: "资金流向研判",
    type: "skill",
    description: "按账户汇总资金往来",
    summary: "",
    precautions: "",
    icon: "skill",
    category: "intelligence", // 需求 4 起分类 id 来自服务端，这里只是夹具里的一个字符串
    tags: ["资金", "研判"],
    ownerId: "u1",
    ownerName: "张三",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    // Unix 秒。取 UTC 正午 ⇒ 本机 +8 仍是同一天，日期断言不随运行时时区漂。
    createdAt: Date.UTC(2026, 9, 1, 12) / 1000,
    updatedAt: Date.UTC(2026, 9, 20, 12) / 1000,
    publishedAt: null,
    archivedAt: null,
    iterationNote: "",
    iterationWorkspace: null,
    ...over,
  }
}

function 挂(over: Partial<AssetMetadata> = {}, extra: Partial<AssetDetailProps> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  let 返回次数 = 0
  const dispose = render(
    () => <AssetDetail asset={资产(over)} onBack={() => (返回次数 += 1)} {...extra} />,
    host,
  )
  return {
    host,
    返回次数: () => 返回次数,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 槽 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent ?? ""
const 标签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot="asset-detail-tab"][data-tab="${id}"]`)!
const 面板 = (host: HTMLElement) => 槽(host, "asset-detail-panel")

/** 等一个条件成立（Kobalte 的 Portal 是异步挂上的，同步断言会撞空节点）。 */
async function 等到(条件: () => boolean, 超时ms = 1_000): Promise<void> {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 超时ms) throw new Error("等待超时")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("资产详情头部", () => {
  test("名称、空间/状态徽章、作者、收藏都来自元数据", () => {
    const { host, 卸 } = 挂({
      name: "资金流向研判",
      visibility: "department",
      status: "published",
      ownerName: "张三",
      department: "经侦支队",
      favoriteCount: 5,
      usageCount: 37,
    })
    try {
      expect(文本(host, "asset-detail-name")).toBe("资金流向研判")
      expect(文本(host, "asset-detail-space")).toBe("部门")
      expect(文本(host, "asset-detail-status")).toBe("已发布")
      expect(文本(host, "asset-detail-author")).toBe("张三 · 经侦支队")
      expect(文本(host, "asset-detail-favorites")).toBe("5 人收藏")
      // 使用数换了口径（2026-10-29）：累计列不再显示，改由 `usage` 三态给。
      expect(槽(host, "asset-detail-usage") === null).toBe(true)
      expect(槽(host, "asset-detail-back")?.getAttribute("aria-label")).toBe("返回资产列表")
    } finally {
      卸()
    }
  })

  // 评分收起（2026-10-29，用户裁定「不建议做评分」）：元信息行只剩作者 / 收藏；
  // 使用记录是有条件的第三项（skill 且服务端给了 usageStats），三态见下文。
  // 数据列（rating / ratingCount / feedbackCount）仍在 `AssetMetadata` 里——那是治理后台与
  // 库表的形状，前端不再读它（不在这一层删类型，免得动到别的读者）。
  test("元信息行没有评分 / 评价（评分已收起）", () => {
    const { host, 卸 } = 挂({ rating: 4.56, ratingCount: 12, feedbackCount: 3 })
    try {
      expect(槽(host, "asset-detail-header-rating") === null).toBe(true)
      const 全文字 = host.textContent ?? ""
      expect(
        全文字.includes("评分") || 全文字.includes("评价"),
        `详情里不该再出现评分 / 评价字样，实得：${全文字}`,
      ).toBe(false)
    } finally {
      卸()
    }
  })

  test("头部不随 tab 切换重建（同一个节点）", () => {
    const { host, 卸 } = 挂()
    try {
      const 头部 = 槽(host, "asset-detail-header")
      标签(host, "versions").click()
      expect(槽(host, "asset-detail-header")).toBe(头部)
      expect(文本(host, "asset-detail-name")).toBe("资金流向研判")
    } finally {
      卸()
    }
  })

  test("进入详情焦点落在「返回资产列表」；点它回调 onBack", () => {
    const { host, 返回次数, 卸 } = 挂()
    try {
      const 返回 = host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-back"]')
      expect(返回).not.toBeNull()
      expect(document.activeElement).toBe(返回)
      返回!.click()
      expect(返回次数()).toBe(1)
    } finally {
      卸()
    }
  })

  // 使用记录三态（2026-10-29）：窗口天数由**服务端**给（`usageStats.days`）。这里特意用
  // `days: 7` 而不是 30——组件若把 30 写死，这条当场红（`#002-06`：同一件事别有两份来源）。
  test("有数 ⇒ 「最近 7 天 · 3 人用过 · 共 12 次」", () => {
    const { host, 卸 } = 挂({}, { usage: { days: 7, stats: { "asset-1": { users: 3, calls: 12 } } } })
    try {
      expect(文本(host, "asset-detail-usage")).toBe("最近 7 天 · 3 人用过 · 共 12 次")
    } finally {
      卸()
    }
  })

  test("没有记录 ⇒ 「最近 30 天还没人用过」（不是 0 人 0 次）", () => {
    const { host, 卸 } = 挂({}, { usage: { days: 30, stats: {} } })
    try {
      expect(文本(host, "asset-detail-usage")).toBe("最近 30 天还没人用过")
    } finally {
      卸()
    }
  })

  test("没给 usage（旧内核 / 非 skill）⇒ 这一项不出现", () => {
    const 无内核 = 挂()
    try {
      // 渲染锚点：先证明组件真的画出了头部，否则「槽不存在」在「整块没渲染」时也会绿
      // （`#005-18` 假绿四问第②问：这条路径真的走到了吗）。
      expect(文本(无内核.host, "asset-detail-name")).toBe("资金流向研判")
      expect(槽(无内核.host, "asset-detail-usage") === null).toBe(true)
    } finally {
      无内核.卸()
    }

    // 非 skill 的两类（设计 §7 点名「MCP / 知识库」）：走同一条 `=== "skill"` 分支，
    // 但按 `#002-06` 的落点纪律把两类都钉住，别只测 MCP 就代表知识库。
    for (const type of ["mcp", "knowledge_base"] as const) {
      const 非skill = 挂({ type }, { usage: { days: 30, stats: { "asset-1": { users: 3, calls: 12 } } } })
      try {
        expect(文本(非skill.host, "asset-detail-name")).toBe("资金流向研判")
        expect(槽(非skill.host, "asset-detail-usage") === null).toBe(true)
      } finally {
        非skill.卸()
      }
    }
  })

  // 与上一条互为对照：这条把 days 换成 7，让「还没人用过」分支里的 `用量.days` 也被钉住
  // （否则该分支若把 30 写死，没有任何用例会红）。
  test("没有记录时天数同样取服务端值（days: 7）", () => {
    const { host, 卸 } = 挂({}, { usage: { days: 7, stats: {} } })
    try {
      expect(文本(host, "asset-detail-usage")).toBe("最近 7 天还没人用过")
    } finally {
      卸()
    }
  })
})

describe("详情三 tab", () => {
  test("tab 栏是介绍/功能描述/注意事项/版本（评价已收起），默认选中介绍", () => {
    const { host, 卸 } = 挂()
    try {
      const tablist = host.querySelector('[role="tablist"]')
      expect(tablist).not.toBeNull()
      const 按钮 = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="asset-detail-tab"]')]
      expect(按钮.map((el) => el.textContent)).toEqual(详情Tab列表.map((项) => 项.label))
      expect(按钮.map((el) => el.dataset.tab)).toEqual(["intro", "summary", "precautions", "versions"])
      expect(按钮.every((el) => el.getAttribute("role") === "tab")).toBe(true)

      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")
      for (const id of ["summary", "precautions", "versions"]) {
        expect(标签(host, id).getAttribute("aria-selected")).toBe("false")
      }
      expect(面板(host)?.dataset.tab).toBe("intro")
      expect(面板(host)?.getAttribute("role")).toBe("tabpanel")
      expect(文本(host, "asset-detail-description")).toBe("按账户汇总资金往来")
      expect([...host.querySelectorAll('[data-slot="asset-detail-tag"]')].map((el) => el.textContent)).toEqual([
        "#资金",
        "#研判",
      ])
    } finally {
      卸()
    }
  })

  test("点 tab 只显示当前面板", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "precautions").click()
      expect(面板(host)?.dataset.tab).toBe("precautions")
      expect(槽(host, "asset-detail-description")).toBeNull()
      expect(文本(host, "asset-detail-uncertainty")).toContain("必须经过人工复核")

      标签(host, "versions").click()
      expect(面板(host)?.dataset.tab).toBe("versions")
      expect(文本(host, "asset-detail-version")).toBe("v1")
    } finally {
      卸()
    }
  })

  test("键盘左右 / Home / End 切换，焦点跟着走", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "intro").focus()
      标签(host, "intro").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      // 功能描述 Tab 插在介绍之后（2026-10-31）：右移一格落在它上面，不是注意事项。
      expect(标签(host, "summary").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "summary"))

      标签(host, "summary").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")

      标签(host, "intro").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      expect(标签(host, "versions").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "versions"))

      标签(host, "versions").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "intro"))
    } finally {
      卸()
    }
  })
})

describe("详情各 tab 内容", () => {
  test("注意事项：显式不确定性标注 + 未填写专属注意事项的空态", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "precautions").click()
      const 标注 = 文本(host, "asset-detail-uncertainty")
      expect(标注).toContain("AI 生成的结论可能存在偏差")
      expect(标注).toContain("必须经过人工复核")
      expect(文本(host, "asset-detail-precautions-empty")).toBe("该资产尚未填写专属注意事项。")
    } finally {
      卸()
    }
  })

  // 终审 M-6：空态判定要与悬停侧同口径（`trim()`）。作者存进 `"   "` 时服务端允许，
  // 前端若按 `=== ""` 判，会把一片空白当正文显示。
  test("注意事项只有空白字符 ⇒ 显示空态，不把空白当正文", () => {
    const { host, 卸 } = 挂({ precautions: "   " })
    try {
      标签(host, "precautions").click()
      expect(文本(host, "asset-detail-precautions-empty")).toBe("该资产尚未填写专属注意事项。")
      expect(槽(host, "asset-detail-precautions-text") === null).toBe(true)
    } finally {
      卸()
    }
  })

  // 评价分区收起（2026-10-29，用户裁定）：库里没有一条评价正文，写一个永远空着的 tab
  // 等于把「不可达」装成「可达」（`#008-04`）。等真有写入口再单独立 feature 加回来。
  test("评价分区不再存在：没有评价 tab，也没有评价面板", () => {
    const { host, 卸 } = 挂({ rating: 4.56, ratingCount: 12, feedbackCount: 3 })
    try {
      expect(标签(host, "reviews") === null).toBe(true)
      for (const id of ["intro", "summary", "precautions", "versions"] as const) {
        标签(host, id).click()
        expect(
          槽(host, "asset-detail-review-summary") === null,
          `${id} 面板里不该出现评价汇总`,
        ).toBe(true)
      }
    } finally {
      卸()
    }
  })

  test("版本：版本号 + 更新日期；未发布不写发布日期；变更说明缺失时显式说明", () => {
    const { host, 卸 } = 挂({ version: 3, publishedAt: null })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-version")).toBe("v3")
      expect(文本(host, "asset-detail-updated")).toBe("更新于 2026-10-20")
      expect(槽(host, "asset-detail-published")).toBeNull()
      expect(文本(host, "asset-detail-changelog-empty")).toBe("暂无变更说明。")
    } finally {
      卸()
    }
  })

  test("已发布资产在版本 tab 显示发布日期", () => {
    const { host, 卸 } = 挂({ version: 2, publishedAt: Date.UTC(2026, 9, 18, 12) / 1000 })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-published")).toBe("发布于 2026-10-18")
    } finally {
      卸()
    }
  })
})

describe("内容编辑（2026-10-31）", () => {
  const 保存成功 = async (): Promise<true> => true
  const 保存抛错 = async () => {
    throw new Error("网络断了")
  }

  test("没有 canWrite ⇒ 三个 Tab 都不渲染编辑按钮", () => {
    const { host, 卸 } = 挂()
    try {
      for (const id of ["intro", "summary", "precautions"]) {
        标签(host, id).click()
        // 布尔式而不是 `toBeNull()`：变异时 bun 会去序列化 happy-dom 节点、环形引用把进程挂死（`#009-01`）。
        expect(槽(host, "asset-detail-edit") === null, `${id} 面板无权也渲染了编辑按钮`).toBe(true)
      }
    } finally {
      卸()
    }
  })

  test("canWrite ⇒ 当前 Tab 有编辑按钮；点开出现 textarea，取消回到只读", () => {
    const { host, 卸 } = 挂({}, { canWrite: true, onSaveContent: 保存成功 })
    try {
      expect(槽(host, "asset-detail-edit")).not.toBeNull()
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      expect(槽(host, "asset-detail-editor")).not.toBeNull()
      ;(槽(host, "asset-detail-cancel") as HTMLElement).click()
      // 布尔式避开的同样是 happy-dom 节点序列化（`#009-01`）。
      expect(槽(host, "asset-detail-editor") === null).toBe(true)
      expect(文本(host, "asset-detail-description")).toBe("按账户汇总资金往来")
    } finally {
      卸()
    }
  })

  // 终审 M-4：编辑框必须有可访问名称（读屏才报得出「在编辑哪个字段」），
  // 且打开编辑后焦点要落进框里（键盘用户不必再 Tab 找）。
  test("编辑框带可访问名称；打开编辑后焦点移进编辑框", () => {
    const { host, 卸 } = 挂({}, { canWrite: true, onSaveContent: 保存成功 })
    try {
      for (const [id, 标题] of [
        ["intro", "功能与用法"],
        ["summary", "功能描述"],
        ["precautions", "专属注意事项"],
      ] as const) {
        标签(host, id).click()
        ;(槽(host, "asset-detail-edit") as HTMLElement).click()
        const 框 = 槽(host, "asset-detail-editor") as HTMLTextAreaElement
        expect(框.getAttribute("aria-label")).toBe(标题)
        expect(document.activeElement).toBe(框)
      }
    } finally {
      卸()
    }
  })

  test("保存失败 ⇒ 保留用户输入并就地显示错误", async () => {
    const { host, 卸 } = 挂({}, { canWrite: true, onSaveContent: 保存抛错 })
    try {
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      const 框 = 槽(host, "asset-detail-editor") as HTMLTextAreaElement
      框.value = "我写的字"
      框.dispatchEvent(new Event("input", { bubbles: true }))
      ;(槽(host, "asset-detail-save") as HTMLElement).click()
      await Promise.resolve()
      await Promise.resolve()
      expect((槽(host, "asset-detail-editor") as HTMLTextAreaElement).value).toBe("我写的字")
      expect(文本(host, "asset-detail-edit-error")).toBe("网络断了")
      // 读屏要在保存失败时被叫醒，不是只画一行红字。
      expect(槽(host, "asset-detail-edit-error")?.getAttribute("role")).toBe("alert")
    } finally {
      卸()
    }
  })

  test("功能描述 Tab 保存时只送 summary", async () => {
    const 收到的: unknown[] = []
    const { host, 卸 } = 挂({ summary: "旧的一句话" }, {
      canWrite: true,
      onSaveContent: async (patch) => {
        收到的.push(patch)
        return true
      },
    })
    try {
      标签(host, "summary").click()
      expect(文本(host, "asset-detail-summary-text")).toBe("旧的一句话")
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      const 框 = 槽(host, "asset-detail-editor") as HTMLTextAreaElement
      框.value = "新的一句话"
      框.dispatchEvent(new Event("input", { bubbles: true }))
      ;(槽(host, "asset-detail-save") as HTMLElement).click()
      await Promise.resolve()
      await Promise.resolve()
      expect(收到的).toEqual([{ summary: "新的一句话" }])
      expect(槽(host, "asset-detail-editor") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("canWrite={false} ⇒ 与省略一样不渲染编辑按钮", () => {
    const { host, 卸 } = 挂({}, { canWrite: false })
    try {
      for (const id of ["intro", "summary", "precautions"]) {
        标签(host, id).click()
        expect(槽(host, "asset-detail-edit") === null, `${id} 面板 canWrite=false 也渲染了编辑按钮`).toBe(true)
      }
    } finally {
      卸()
    }
  })

  // 终审 M-5：失败文案由调用方给。详情页不能一律写「保存失败」——「写入已成功、只是回包读不懂」
  // 那种情况让用户看到「失败」会诱导他再点一次。
  test("onSaveContent 返回文案 ⇒ 保留输入并原样显示那句话", async () => {
    const { host, 卸 } = 挂({}, {
      canWrite: true,
      onSaveContent: async () => "服务返回的数据格式不对，请刷新后确认",
    })
    try {
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      const 框 = 槽(host, "asset-detail-editor") as HTMLTextAreaElement
      框.value = "没存上的字"
      框.dispatchEvent(new Event("input", { bubbles: true }))
      ;(槽(host, "asset-detail-save") as HTMLElement).click()
      await Promise.resolve()
      await Promise.resolve()
      expect((槽(host, "asset-detail-editor") as HTMLTextAreaElement).value).toBe("没存上的字")
      expect(文本(host, "asset-detail-edit-error")).toBe("服务返回的数据格式不对，请刷新后确认")
    } finally {
      卸()
    }
  })

  // 注意事项的「有正文」路径：所有其他夹具里 `precautions` 都是空串，只测空态会让
  // `值={props.asset.precautions}` 写成 `值=""`、或保存键名写错，整片用例照绿。
  test("注意事项有正文 ⇒ 显示正文、不显示空态，产品级黄框仍在", () => {
    const { host, 卸 } = 挂({ precautions: "必须双人复核" })
    try {
      标签(host, "precautions").click()
      expect(文本(host, "asset-detail-precautions-text")).toBe("必须双人复核")
      expect(槽(host, "asset-detail-precautions-empty") === null).toBe(true)
      expect(文本(host, "asset-detail-uncertainty")).toContain("必须经过人工复核")
    } finally {
      卸()
    }
  })

  test("注意事项 Tab 保存时只送 precautions（键名正确）", async () => {
    const 收到的: unknown[] = []
    const { host, 卸 } = 挂({ precautions: "旧注意事项" }, {
      canWrite: true,
      onSaveContent: async (patch) => {
        收到的.push(patch)
        return true
      },
    })
    try {
      标签(host, "precautions").click()
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      const 框 = 槽(host, "asset-detail-editor") as HTMLTextAreaElement
      框.value = "新注意事项"
      框.dispatchEvent(new Event("input", { bubbles: true }))
      ;(槽(host, "asset-detail-save") as HTMLElement).click()
      await Promise.resolve()
      await Promise.resolve()
      expect(收到的).toEqual([{ precautions: "新注意事项" }])
    } finally {
      卸()
    }
  })
})

/**
 * Markdown 渲染（2026-10-31，用户要求作者能写 Markdown、读者看到排版）。
 *
 * 三个决定：① 详情页渲染、「功能描述」不渲染（它是悬停浮层的一句话）；② 编辑态给
 * 提示 + 「预览」切换，切回来草稿还在；③ 长度上限不变（服务端零改动）。
 *
 * 断言的是**结构**（`h2` / `strong` / `li`）而不仅是文字：文字在纯文本态也相同，
 * 只断文字会让「没渲染」假绿。
 */
describe("Markdown 渲染（2026-10-31）", () => {
  const 渲染容器 = (host: HTMLElement, slot: string) => 槽(host, slot)

  test("介绍 Tab 只读态把 Markdown 渲染成元素（h2 / strong）", () => {
    const { host, 卸 } = 挂({ description: "## 小标题\n\n正文有 **重点**" })
    try {
      const 容器 = 渲染容器(host, "asset-detail-description")
      // 这个属性是 `index.css` 里元素级样式的唯一钩子，两处任一改名样式就全丢。
      expect(容器?.getAttribute("data-format")).toBe("markdown")
      expect(容器?.querySelector("h2")?.textContent).toBe("小标题")
      expect(容器?.querySelector("strong")?.textContent).toBe("重点")
    } finally {
      卸()
    }
  })

  test("注意事项 Tab 只读态同样渲染（h3 / li）", () => {
    const { host, 卸 } = 挂({ precautions: "### 复核\n\n- 双人" })
    try {
      标签(host, "precautions").click()
      const 容器 = 渲染容器(host, "asset-detail-precautions-text")
      expect(容器?.querySelector("h3")?.textContent).toBe("复核")
      expect(容器?.querySelector("li")?.textContent).toBe("双人")
    } finally {
      卸()
    }
  })

  test("功能描述不渲染：**粗** 原样显示，没有 <strong>", () => {
    const { host, 卸 } = 挂({ summary: "**粗**" })
    try {
      标签(host, "summary").click()
      const 容器 = 渲染容器(host, "asset-detail-summary-text")
      expect(容器?.textContent).toBe("**粗**")
      expect(容器?.querySelector("strong") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("编辑态：有 Markdown 提示与「预览」；切预览看到渲染结果，切回草稿还在", () => {
    const { host, 卸 } = 挂({ description: "## 小标题\n\n正文" }, { canWrite: true, onSaveContent: async () => true })
    try {
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      expect((槽(host, "asset-detail-editor") as HTMLTextAreaElement).value).toBe("## 小标题\n\n正文")
      expect(文本(host, "asset-detail-markdown-hint")).toBe("支持 Markdown：标题 / 粗体 / 列表 / 代码块")

      const 预览钮 = 槽(host, "asset-detail-preview") as HTMLElement
      expect(预览钮.textContent?.trim()).toBe("预览")
      预览钮.click()

      // 输入框消失、渲染结果出现；保存 / 取消按钮仍在。
      expect(槽(host, "asset-detail-editor") === null).toBe(true)
      expect(槽(host, "asset-detail-description")?.querySelector("h2")?.textContent).toBe("小标题")
      expect(槽(host, "asset-detail-save") !== null).toBe(true)
      expect(槽(host, "asset-detail-cancel") !== null).toBe(true)
      expect((槽(host, "asset-detail-preview") as HTMLElement).textContent?.trim()).toBe("编辑")

      // 切回编辑：草稿一个字不丢。
      ;(槽(host, "asset-detail-preview") as HTMLElement).click()
      expect((槽(host, "asset-detail-editor") as HTMLTextAreaElement).value).toBe("## 小标题\n\n正文")
    } finally {
      卸()
    }
  })

  /**
   * 退出编辑态后预览必须复位（规格原话「下次打开默认写」）。没有这条，
   * 把 `开()` / `退()` 里那两行 `set预览(false)` 删掉也全绿（复审 Important-2）。
   */
  test("取消退出后重开编辑：回到写态，不是停在预览", () => {
    const { host, 卸 } = 挂({ description: "## 小标题" }, { canWrite: true, onSaveContent: async () => true })
    try {
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      ;(槽(host, "asset-detail-preview") as HTMLElement).click()
      expect(槽(host, "asset-detail-editor") === null).toBe(true)

      ;(槽(host, "asset-detail-cancel") as HTMLElement).click()
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()

      expect((槽(host, "asset-detail-editor") as HTMLTextAreaElement).value).toBe("## 小标题")
      expect((槽(host, "asset-detail-preview") as HTMLElement).textContent?.trim()).toBe("预览")
    } finally {
      卸()
    }
  })

  test("功能描述的编辑态没有「预览」（它不渲染 Markdown）", () => {
    const { host, 卸 } = 挂({ summary: "一句话" }, { canWrite: true, onSaveContent: async () => true })
    try {
      标签(host, "summary").click()
      ;(槽(host, "asset-detail-edit") as HTMLElement).click()
      expect(槽(host, "asset-detail-preview") === null).toBe(true)
    } finally {
      卸()
    }
  })
})

/**
 * 头部操作（2026-10-29，用户实报设计不妥）。
 *
 * ## 为什么删掉「▶ 让 AI 助手执行此 skill」
 *
 * 用户原话：AI 助手执行 skill 需要上下文，才知道「怎么执行」——一句「请使用 X」送进输入框，
 * 模型没有输入数据，点了也干不成事。留着一个点了做不成事的按钮，就是把不可达状态装成可达
 * （`#008-04`）。
 *
 * ## 为什么把「启用」搬进详情
 *
 * 用户在详情里读完介绍才决定「用不用得上」，此时要他退回卡片点启用，违背心智。判断只有一份
 * （`enable-button.ts`），卡片与详情共用（`#002-06`）。
 *
 * ⚠️ 断言纪律：元素不存在一律布尔式 `node === null`（`#009-01`：happy-dom 节点直断会让 bun
 * 序列化环形引用）。文案用全等不用 `toContain`（`#006-22`：「已启用」含「启用」）。
 */
describe("头部操作：启用（2026-10-29）", () => {
  const 启用按钮 = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-enable"]')

  test("不给 onToggleEnabled ⇒ 不渲染启用按钮（storybook / 旧用法逐字不变）", () => {
    const { host, 卸 } = 挂()
    try {
      expect(启用按钮(host) === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("给了 ⇒ 文案「启用」、aria-pressed=false，点它把该资产交回去", () => {
    const 收到: AssetMetadata[] = []
    const { host, 卸 } = 挂({}, { onToggleEnabled: (asset) => 收到.push(asset) })
    try {
      const 按钮 = 启用按钮(host)
      if (!按钮) throw new Error("给了 onToggleEnabled 却没有启用按钮")
      expect(按钮.textContent?.trim()).toBe("启用")
      expect(按钮.getAttribute("aria-pressed")).toBe("false")

      按钮.click()

      expect(收到.map((asset) => asset.id)).toEqual(["asset-1"])
    } finally {
      卸()
    }
  })

  test("已启用 ⇒ 文案「已启用」、aria-pressed=true", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enabled: true })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.textContent?.trim()).toBe("已启用")
      expect(按钮.getAttribute("aria-pressed")).toBe("true")
    } finally {
      卸()
    }
  })

  test("自动送达装进来的 ⇒ 文案「固定安装」（与卡片同一档说法）", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, auto: true })
    try {
      expect(启用按钮(host)?.textContent?.trim()).toBe("固定安装")
    } finally {
      卸()
    }
  })

  test("没选项目 ⇒ 禁用，title 写原因（禁用却不写原因是最糟的）", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enableHint: "请先在左侧选择项目" })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(true)
      expect(按钮.getAttribute("title")).toBe("请先在左侧选择项目")
    } finally {
      卸()
    }
  })

  test("enableHint 是空串 ⇒ 不算禁用理由", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enableHint: "" })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(false)
      expect(按钮.getAttribute("title") === null || 按钮.getAttribute("title") === "").toBe(true)
    } finally {
      卸()
    }
  })

  test("正在切换 ⇒ 禁用，title 是「正在切换…」，aria-busy=true", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, busy: true })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(true)
      expect(按钮.getAttribute("title")).toBe("正在切换…")
      expect(按钮.getAttribute("aria-busy")).toBe("true")
    } finally {
      卸()
    }
  })

  test("收藏与启用并排：两个按钮都在头部第一行右侧", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, onToggleFavorite: () => {} })
    try {
      // 布尔比较而不是把节点交给 `toBe`：断言失败时 happy-dom 的循环引用会把 run 挂死（`#009-01`）。
      const 行 = 槽(host, "asset-detail-back")?.parentElement
      const 启用 = 启用按钮(host)?.parentElement
      const 收藏 = host.querySelector<HTMLElement>('[data-slot="asset-detail-favorite"]')?.parentElement
      // 同一组容器、且都在头部那一行里：两个动作并列在右侧，不是散在页面上。
      expect(启用 !== undefined && 启用 === 收藏 && 行?.contains(启用) === true).toBe(true)
    } finally {
      卸()
    }
  })

  test("「让 AI 助手执行此 skill」不再存在——三类资产都没有", () => {
    for (const type of ["skill", "mcp", "knowledge_base"] as const) {
      const { host, 卸 } = 挂({ type })
      try {
        expect(
          host.querySelector('[data-slot="asset-detail-execute"]') === null,
          `${type} 资产上不该再出现执行按钮`,
        ).toBe(true)
      } finally {
        卸()
      }
    }
  })
})

describe("头部操作：收藏（2026-10-29）", () => {
  const 收藏按钮 = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-favorite"]')
  const 图标 = (host: HTMLElement) =>
    收藏按钮(host)?.querySelector("use")?.getAttribute("href") ?? ""

  test("不给 onToggleFavorite ⇒ 不渲染收藏按钮", () => {
    const { host, 卸 } = 挂()
    try {
      expect(收藏按钮(host) === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("给了 ⇒ 文案「收藏」、空心星、aria-pressed=false，点它把该资产交回去", () => {
    const 收到: AssetMetadata[] = []
    const { host, 卸 } = 挂({ name: "话单分析" }, { onToggleFavorite: (asset) => 收到.push(asset) })
    try {
      const 按钮 = 收藏按钮(host)
      if (!按钮) throw new Error("给了 onToggleFavorite 却没有收藏按钮")
      expect(按钮.textContent?.trim()).toBe("收藏")
      expect(按钮.getAttribute("aria-pressed")).toBe("false")
      expect(按钮.getAttribute("aria-label")).toBe("收藏：话单分析")
      expect(图标(host)).toBe("#opencode-v2-icon-star")

      按钮.click()

      expect(收到.map((asset) => asset.id)).toEqual(["asset-1"])
    } finally {
      卸()
    }
  })

  test("已收藏 ⇒ 文案「已收藏」、实心星、aria-pressed=true", () => {
    const { host, 卸 } = 挂({}, { onToggleFavorite: () => {}, favorited: true })
    try {
      const 按钮 = 收藏按钮(host)
      if (!按钮) throw new Error("给了 onToggleFavorite 却没有收藏按钮")
      expect(按钮.textContent?.trim()).toBe("已收藏")
      expect(按钮.getAttribute("aria-pressed")).toBe("true")
      expect(图标(host)).toBe("#opencode-v2-icon-star-filled")
    } finally {
      卸()
    }
  })

  test("正在写 ⇒ 禁用、aria-busy=true、title 写「正在处理…」", () => {
    const { host, 卸 } = 挂({}, { onToggleFavorite: () => {}, favoriteBusy: true })
    try {
      const 按钮 = 收藏按钮(host)
      if (!按钮) throw new Error("给了 onToggleFavorite 却没有收藏按钮")
      expect(按钮.disabled).toBe(true)
      expect(按钮.getAttribute("aria-busy")).toBe("true")
      expect(按钮.getAttribute("title")).toBe("正在处理…")
    } finally {
      卸()
    }
  })
})

/**
 * 选中态（2026-10-29，用户实报「点了收藏像没反应，看不出已收藏 / 已启用」）。
 *
 * 分两层钉，缺一层就等于没钉住：
 * 1. **组件把状态写成属性**（`data-favorited` / `data-enabled`）——样式表唯一的挂钩；
 * 2. **样式表里有按这两个属性出的规则**，且底色 / 图标走的是同一对变量。
 *
 * 为什么不用 Tailwind 的 class：`button-v2.css` 的变体规则特异度 (0,2,0)、图标那条 (0,3,0)，
 * 而工具类是 (0,1,0)——永远输。选中态只能落在 app 自己的样式表里，用更高特异度压过去。
 *
 * 文字色用 `--v2-text-text-base` 而不是金色：金色文字在深色主题下对比度只有 1.07–1.99:1
 * （已知缺陷），选中态不再扩大它；金色只落在图标上。
 */
describe("头部操作：选中态（2026-10-29）", () => {
  const 按钮 = (host: HTMLElement, slot: string) =>
    host.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)
  const 样式表 = () => readFileSync(new URL("./asset-action-active.css", import.meta.url), "utf8")

  test("已收藏 ⇒ data-favorited=true；未收藏 ⇒ 不是 true", () => {
    const 已 = 挂({}, { onToggleFavorite: () => {}, favorited: true })
    try {
      expect(按钮(已.host, "asset-detail-favorite")?.getAttribute("data-favorited")).toBe("true")
    } finally {
      已.卸()
    }

    const 未 = 挂({}, { onToggleFavorite: () => {} })
    try {
      expect(按钮(未.host, "asset-detail-favorite")?.getAttribute("data-favorited")).not.toBe("true")
    } finally {
      未.卸()
    }
  })

  test("已启用 ⇒ data-enabled=true；未启用 ⇒ 不是 true", () => {
    const 已 = 挂({}, { onToggleEnabled: () => {}, enabled: true })
    try {
      expect(按钮(已.host, "asset-detail-enable")?.getAttribute("data-enabled")).toBe("true")
    } finally {
      已.卸()
    }

    const 未 = 挂({}, { onToggleEnabled: () => {} })
    try {
      expect(按钮(未.host, "asset-detail-enable")?.getAttribute("data-enabled")).not.toBe("true")
    } finally {
      未.卸()
    }
  })

  test("样式表按这两个属性出规则，底色 / 图标取同一对变量（淡金底 + 金色图标）", () => {
    const css = 样式表()
    // 选择器与组件渲染出来的属性**逐字对得上**——两处任一改名，这条当场红。
    expect(css.includes('[data-slot="asset-detail-favorite"][data-favorited="true"]')).toBe(true)
    expect(css.includes('[data-slot="asset-detail-enable"][data-enabled="true"]')).toBe(true)
    expect(css.includes("--v2-background-bg-accent-soft")).toBe(true)
    expect(css.includes("--v2-icon-icon-accent")).toBe(true)
    // 文字不能是金色（`--v2-text-text-accent`）：深色主题下那是对比度缺陷。
    expect(css.includes("--v2-text-text-accent")).toBe(false)
  })
})

/**
 * 详情里的失败要能看见（2026-10-29，用户实报「点收藏没反应」）。
 *
 * 根因是**失败被盖住了**：收藏 / 启用的错误写回 `catalog.error()` / `enablement.error()`，
 * 而那两个横幅挂在浏览区里，详情一打开浏览区就 `hidden` —— 用户点了按钮，界面一个字都不变。
 * 详情自己也要有一条 `role="alert"`（`#008-04`：不可达状态不能装成可达，失败更不能装成没发生）。
 */
describe("详情里的失败要能看见（2026-10-29）", () => {
  const 提示 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="asset-detail-error"]')

  test("给了 error ⇒ 头部出现 role=alert 的提示，且不在浏览区那侧", () => {
    const { host, 卸 } = 挂({}, { error: "收藏失败，请检查网络后重试" })
    try {
      const 节点 = 提示(host)
      if (!节点) throw new Error("给了 error 却没有提示")
      expect(节点.getAttribute("role")).toBe("alert")
      expect(节点.textContent?.trim()).toBe("收藏失败，请检查网络后重试")
      const 头部 = 槽(host, "asset-detail-header")
      expect(头部?.contains(节点) === true).toBe(true)
    } finally {
      卸()
    }
  })

  test("没有 error（含空串）⇒ 不渲染提示", () => {
    const 无 = 挂()
    try {
      expect(提示(无.host) === null).toBe(true)
    } finally {
      无.卸()
    }

    const 空 = 挂({}, { error: "" })
    try {
      expect(提示(空.host) === null).toBe(true)
    } finally {
      空.卸()
    }
  })
})

/**
 * AI 起草与填入（2026-10-31）。
 *
 * 设计边界：**AI 没有写库能力**。两个按钮只做「把指令送进右栏」与「把回复填进草稿」，
 * 保存仍是用户自己点。这里钉的正是这条线：右栏收到的是指令、编辑框变了、但 `onSaveContent`
 * 一次都没被调用。
 *
 * ⚠️ 两个口都是**模块级状态**（`send-to-session.ts`）⇒ 用例结束必须收回，否则下一条
 * 站在上一条的替身上。
 */
describe("AI 起草与填入（2026-10-31）", () => {
  const 可写的 = (over: Partial<AssetMetadata> = {}, 保存: () => Promise<true | string> = async () => true) =>
    挂(over, { canWrite: true, onSaveContent: 保存 })
  const 开编辑 = (host: HTMLElement) => 槽(host, "asset-detail-edit")?.click()
  const 点 = (host: HTMLElement, slot: string) => 槽(host, slot)?.click()
  const 编辑框 = (host: HTMLElement) =>
    host.querySelector<HTMLTextAreaElement>('[data-slot="asset-detail-editor"]')!

  afterEach(() => {
    订阅会话输入(undefined)
    订阅最近回复(undefined)
  })

  test("点「让 AI 起草」⇒ 右栏收到含资产名的起草指令，方式是「替换」", () => {
    const 收到: Array<{ 文本: string; 方式: string }> = []
    订阅会话输入((文本, 方式) => 收到.push({ 文本, 方式 }))
    const { host, 卸 } = 可写的({ description: "旧介绍" })
    try {
      开编辑(host)
      点(host, "asset-detail-draft")
      expect(收到.length).toBe(1)
      expect(收到[0].文本).toContain("资金流向研判")
      expect(收到[0].文本).toContain("旧介绍")
      expect(收到[0].方式).toBe("替换")
      // 成功时不显示错误（输入框里已经出现指令，用户看得见）。
      expect(槽(host, "asset-detail-edit-error") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("右栏没开 ⇒ 显示「右栏还没有打开的会话，先打开再试」", () => {
    订阅会话输入(undefined)
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-draft")
      expect(文本(host, "asset-detail-edit-error")).toBe("右栏还没有打开的会话，先打开再试")
    } finally {
      卸()
    }
  })

  /**
   * 现有内容很长时，指令要按行数上限**截断后再发**，而不是撞上「一次最多发 50 行，请少选点」
   * ——这个按钮上没有「选」这个动作，且「介绍」（列表式 Markdown）很容易超过 43 行
   * （2026-10-31 复审 I-2）。
   */
  test("现有内容很长 ⇒ 截断后照常发出，不再撞行数上限", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 六十行 = Array.from({ length: 60 }, (_, i) => `第${i}行`).join("\n")
    const { host, 卸 } = 可写的({ description: 六十行 })
    try {
      开编辑(host)
      点(host, "asset-detail-draft")
      expect(收到.length, "截断之后应该发得出去").toBe(1)
      expect(收到[0].split("\n").length <= 行数上界).toBe(true)
      expect(收到[0]).toContain("第0行")
      expect(收到[0]).toContain("其余已省略")
      expect(收到[0].includes("第59行")).toBe(false)
      expect(槽(host, "asset-detail-edit-error") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("点「从 AI 回复填入」⇒ 编辑框变成提取正文的结果（围栏内容）", () => {
    订阅最近回复(() => "说明文字\n```markdown\n# 新介绍\n正文\n```\n尾巴")
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(编辑框(host).value).toBe("# 新介绍\n正文")
    } finally {
      卸()
    }
  })

  test("还没等到回复 ⇒ 显示「还没等到 AI 的回复」", () => {
    订阅最近回复(() => undefined)
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(文本(host, "asset-detail-edit-error")).toBe("还没等到 AI 的回复")
    } finally {
      卸()
    }
  })

  test("回复里没有可用内容 ⇒ 显示「AI 的回复里没有可用内容」", () => {
    订阅最近回复(() => "  \n```\n\n```")
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(文本(host, "asset-detail-edit-error")).toBe("AI 的回复里没有可用内容")
    } finally {
      卸()
    }
  })

  test("在预览态点填入 ⇒ 填完切回写态（否则屏幕上什么都没变）", () => {
    订阅最近回复(() => "```\n新正文\n```")
    const { host, 卸 } = 可写的({ description: "旧介绍" })
    try {
      开编辑(host)
      点(host, "asset-detail-preview")
      expect(槽(host, "asset-detail-editor") === null).toBe(true)

      点(host, "asset-detail-fill")

      expect(槽(host, "asset-detail-editor") === null).toBe(false)
      expect(编辑框(host).value).toBe("新正文")
    } finally {
      卸()
    }
  })

  test("填入成功清掉旧错误，且不退出编辑态", () => {
    订阅最近回复(() => undefined)
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(文本(host, "asset-detail-edit-error")).toBe("还没等到 AI 的回复")

      订阅最近回复(() => "```\n新正文\n```")
      点(host, "asset-detail-fill")

      expect(槽(host, "asset-detail-edit-error") === null).toBe(true)
      expect(槽(host, "asset-detail-editor") === null).toBe(false)
      expect(编辑框(host).value).toBe("新正文")
    } finally {
      卸()
    }
  })

  /**
   * `maxlength` 只约束用户输入；程序写信号不截断。超了不说，用户会在点保存时才被服务端拒一次，
   * 还得自己数哪里超了。
   */
  test("填入的正文超过字段上限 ⇒ 填进去并明说超了多少", () => {
    const 超长 = "字".repeat(CONTENT_LIMITS.description + 1)
    订阅最近回复(() => "```\n" + 超长 + "\n```")
    const { host, 卸 } = 可写的()
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(编辑框(host).value.length).toBe(CONTENT_LIMITS.description + 1)
      expect(文本(host, "asset-detail-edit-error")).toBe(
        `AI 起草的正文有 ${CONTENT_LIMITS.description + 1} 字，超过上限 ${CONTENT_LIMITS.description} 字，请删减后再保存`,
      )
    } finally {
      卸()
    }
  })

  test("保存请求在途时两个 AI 按钮禁用（否则保存成功会把刚填的内容一起关掉）", async () => {
    let 放行: (值: true | string) => void = () => {}
    const 挂起 = () => new Promise<true | string>((落) => (放行 = 落))
    const { host, 卸 } = 可写的({}, 挂起)
    try {
      开编辑(host)
      槽(host, "asset-detail-save")?.click()
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-draft"]')?.disabled).toBe(true)
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-fill"]')?.disabled).toBe(true)
      放行(true)
      await Promise.resolve()
    } finally {
      卸()
    }
  })

  test("填入不写库：onSaveContent 一次都没被调用，保存仍要用户点", () => {
    let 保存次数 = 0
    订阅最近回复(() => "```\n新正文\n```")
    const { host, 卸 } = 可写的({}, async () => {
      保存次数 += 1
      return true
    })
    try {
      开编辑(host)
      点(host, "asset-detail-fill")
      expect(保存次数).toBe(0)
      // 不点保存就还在编辑态。
      expect(槽(host, "asset-detail-editor") === null).toBe(false)
    } finally {
      卸()
    }
  })
})

/**
 * 版本迭代（2026-11-01，设计 §7 / §10 风险 1）。
 *
 * 三态按 `status` + `canWrite` 分，判据不是「我是不是作者」——作者身份只有服务端知道，
 * 前端有的是 `canWrite`（服务端逐行给）。多画的按钮由服务端 `actor_not_allowed` 挡住。
 *
 * ⚠️ 弹窗在 Kobalte 的 Portal 里：它挂在 `document.body`，**不在 `host`**。
 * 所以框里的节点一律用 `document.querySelector` 找；「关没关」读 `data-expanded` 而不是
 * 「节点在不在」（`#005-29`：happy-dom 里退场动画不跑，节点会一直留着）。
 */
describe("版本迭代（2026-11-01）", () => {
  const 弹窗 = () => document.querySelector<HTMLElement>("[data-slot='asset-iteration-dialog']")
  const 弹窗开着 = () => 弹窗()?.hasAttribute("data-expanded") === true
  // `TextareaV2` 把自己的 `data-slot` 写在 props 之后，会盖掉调用方传的那个；按 `name` 找
  // （同 `governance/asset-governance.test.tsx` 的写法）。
  const 说明框 = () => document.querySelector<HTMLTextAreaElement>("textarea[name='asset-iteration-note']")
  const 开弹窗 = async (host: HTMLElement) => {
    槽(host, "asset-detail-start-iteration")!.click()
    await 等到(弹窗开着)
  }
  const 填说明 = (值: string) => {
    const 框 = 说明框()!
    框.value = 值
    框.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const 点确认 = () => document.querySelector<HTMLButtonElement>("[data-slot='asset-iteration-confirm']")!.click()
  const 点取消 = () => document.querySelector<HTMLButtonElement>("[data-slot='asset-iteration-cancel']")!.click()

  afterEach(() => {
    订阅会话输入(undefined)
  })

  test("published + canWrite ⇒ 出现「发起新版本」，还没发起时没有迭代提示", () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      { canWrite: true, onStartIteration: async () => ({ ok: true as const }) },
    )
    try {
      标签(host, "versions").click()
      expect(槽(host, "asset-detail-start-iteration")?.textContent).toBe("发起新版本")
      expect(槽(host, "asset-detail-iteration-hint") === null).toBe(true)
      // 没发起过 ⇒ 还是空态，不是空白。
      expect(文本(host, "asset-detail-changelog-empty")).toBe("暂无变更说明。")
    } finally {
      卸()
    }
  })

  test("published 但不可写 ⇒ 没有「发起新版本」（没接线就不渲染）", () => {
    const { host, 卸 } = 挂({ status: "published", version: 2 })
    try {
      标签(host, "versions").click()
      expect(槽(host, "asset-detail-start-iteration") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("published 且接线齐全、但服务端说不可写 ⇒ 没有「发起新版本」", () => {
    // 判据是 `canWrite`（服务端授权），不是「有没有接线」：只按 `onStart` 是否存在画按钮，
    // 等于把权限判断交给前端——点了才 403，用户白填一遍说明。
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      { canWrite: false, onStartIteration: async () => ({ ok: true as const }) },
    )
    try {
      标签(host, "versions").click()
      expect(槽(host, "asset-detail-start-iteration") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("iterating + 可写 ⇒ 两个按钮，文案写明线上仍是上一版，并显示变更说明", () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3, iterationNote: "补一条统计口径" },
      { canWrite: true, onSubmitIteration: async () => true, onAbortIteration: async () => true },
    )
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-iteration-hint")).toBe("v3 迭代中（线上仍是 v2）")
      expect(文本(host, "asset-detail-iteration-note")).toBe("补一条统计口径")
      expect(槽(host, "asset-detail-submit-iteration")?.textContent).toBe("提交新版本")
      expect(槽(host, "asset-detail-abort-iteration")?.textContent).toBe("放弃迭代")
      expect(槽(host, "asset-detail-start-iteration") === null).toBe(true)
      // 没有在飞的操作 ⇒ 两个按钮都不该禁用（别让默认值满足断言）。
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')?.disabled).toBe(false)
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-abort-iteration"]')?.disabled).toBe(false)
    } finally {
      卸()
    }
  })

  test("iterating 但不可写 ⇒ 只读提示，一个按钮都没有", () => {
    const { host, 卸 } = 挂({ status: "iterating", version: 3, iterationNote: "补一条统计口径" })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-iteration-hint")).toBe("v3 迭代中（作者正在修订，线上仍是 v2）")
      expect(槽(host, "asset-detail-submit-iteration") === null).toBe(true)
      expect(槽(host, "asset-detail-abort-iteration") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("发起成功后把工作副本路径经跨栏传送带替换进右栏", async () => {
    const 收到: Array<{ 文本: string; 方式: string }> = []
    订阅会话输入((文本, 方式) => 收到.push({ 文本, 方式 }))

    const 发起 = async () => ({ ok: true as const, workspace: "D:/ws/u1/p1/.openhive/iterations/asset-1" })
    const { host, 卸 } = 挂(
      { status: "published", version: 2, name: "资金流向研判" },
      {
        canWrite: true,
        onStartIteration: 发起,
        projects: [{ id: "p1", name: "8·17专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      填说明("补一条统计口径")
      点确认()

      await 等到(() => 收到.length === 1)
      expect(收到[0]?.方式).toBe("替换")
      expect(收到[0]?.文本).toContain("资金流向研判")
      // 工作副本是**发起时线上那一版**（version 2）。写成 `asset.version - 1` 会在这里说 v1。
      expect(收到[0]?.文本).toContain("v2")
      expect(收到[0]?.文本).toContain("D:/ws/u1/p1/.openhive/iterations/asset-1")
    } finally {
      卸()
    }
  })

  test("变更说明为空时确认按钮禁用（服务端也会 400，但不该让用户先撞一次）", async () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      const 确认 = document.querySelector<HTMLButtonElement>("[data-slot='asset-iteration-confirm']")!
      expect(确认.disabled).toBe(true)
    } finally {
      卸()
    }
  })

  test("没给项目清单也没给当前项目 ⇒ 下拉写明要先去左侧选项目，确认始终禁用", async () => {
    // 发起迭代必须落到某个项目里；`项目()` 为 undefined 时确认按钮一律禁用——没有这条守卫，
    // 点下去只会拿 `undefined` 当 projectId 发请求。
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      { canWrite: true, onStartIteration: async () => ({ ok: true as const }) },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      expect(document.querySelector('[data-slot="asset-iteration-project"]')?.textContent).toContain(
        "请先在左侧选择项目",
      )
      填说明("补一条口径")
      const 确认 = document.querySelector<HTMLButtonElement>("[data-slot='asset-iteration-confirm']")!
      expect(确认.disabled).toBe(true)
    } finally {
      卸()
    }
  })

  test("发起失败 ⇒ 弹窗不关，错误留在框里", async () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: false as const, message: "资产不在可迭代状态" }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      填说明("补一条口径")
      点确认()
      await 等到(() => document.querySelector("[data-slot='asset-iteration-error']") !== null)
      expect(document.querySelector("[data-slot='asset-iteration-error']")?.textContent).toBe(
        "资产不在可迭代状态",
      )
      // 节点在不在不足以说明「还开着」（`#005-29`）——要读状态属性。
      expect(弹窗开着()).toBe(true)
      // 失败之后**不再是提交中**：按钮要能再点一次（说明与项目都还在）。
      // 少了 `finally { set忙(false) }`，这里会停在 disabled + 「处理中…」，用户只能关框重来。
      const 确认 = document.querySelector<HTMLButtonElement>("[data-slot='asset-iteration-confirm']")!
      expect(确认.disabled).toBe(false)
      expect(确认.textContent).toBe("发起")
      // 页面级那条错误是另一个信号，失败时不该沾上。
      expect(槽(host, "asset-detail-iteration-error") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("published 且带变更说明 ⇒ 显示这段说明（发布后它仍当本版说明），不显示空态", () => {
    // 设计 §3：`iteration_note` 发布后保留当本版说明。只按 `迭代中()` 画的话，
    // 「提交 → 发布」走完一次，这一块就整段空白——分不清「没写」和「界面坏了」（`#008-04`）。
    const { host, 卸 } = 挂({ status: "published", version: 3, iterationNote: "补一条统计口径" })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-iteration-note")).toBe("补一条统计口径")
      expect(槽(host, "asset-detail-changelog-empty") === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("提交失败（返回一句话）⇒ 面板原样显示那句，按钮回到可点", async () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3 },
      {
        canWrite: true,
        onSubmitIteration: async () => "版本号已变，请刷新后再试",
        onAbortIteration: async () => true,
      },
    )
    try {
      标签(host, "versions").click()
      host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')!.click()
      await 等到(() => 槽(host, "asset-detail-iteration-error") !== null)
      expect(文本(host, "asset-detail-iteration-error")).toBe("版本号已变，请刷新后再试")
      const 提交 = host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')!
      expect(提交.disabled).toBe(false)
    } finally {
      卸()
    }
  })

  test("放弃失败（返回一句话）⇒ 面板原样显示那句", async () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3 },
      {
        canWrite: true,
        onSubmitIteration: async () => true,
        onAbortIteration: async () => "已提交的版本不能放弃，请联系管理员",
      },
    )
    try {
      标签(host, "versions").click()
      host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-abort-iteration"]')!.click()
      await 等到(() => 槽(host, "asset-detail-iteration-error") !== null)
      expect(文本(host, "asset-detail-iteration-error")).toBe("已提交的版本不能放弃，请联系管理员")
    } finally {
      卸()
    }
  })

  test("提交时调用直接抛 ⇒ 面板说「操作失败，请重试」，不把异常当空白吞掉", async () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3 },
      {
        canWrite: true,
        onSubmitIteration: async () => {
          throw new Error("网络断了")
        },
        onAbortIteration: async () => true,
      },
    )
    try {
      标签(host, "versions").click()
      host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')!.click()
      await 等到(() => 槽(host, "asset-detail-iteration-error") !== null)
      expect(文本(host, "asset-detail-iteration-error")).toBe("操作失败，请重试")
    } finally {
      卸()
    }
  })

  test("发起成功但右栏没开会话 ⇒ 提示里带上这次的工作副本路径", async () => {
    const 路径 = "D:/ws/u/p/.openhive/iterations/a1"
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const, workspace: 路径 }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      填说明("补一条口径")
      点确认()
      await 等到(() => 槽(host, "asset-detail-iteration-error") !== null)
      const 提示 = 文本(host, "asset-detail-iteration-error")
      // 弹窗已经关了，路径在界面上再没有第二处——提示里必须给全。
      expect(提示).toContain("先在右栏开一个会话")
      expect(提示).toContain(路径)
    } finally {
      卸()
    }
  })

  test("发起成功但服务端没给 workspace ⇒ 右栏一条都没收到，页面上明确说没返回路径", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const }),
        projects: [{ id: "p1", name: "8·17专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      填说明("补一条口径")
      点确认()

      // ⚠️ 不编路径、也不往右栏塞半句：右栏凭空多一句「去 .openhive/iterations 找」是误导。
      await 等到(() => 槽(host, "asset-detail-iteration-error") !== null)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(收到.length).toBe(0)
      const 提示 = 文本(host, "asset-detail-iteration-error")
      expect(提示).toContain("已在你的项目里创建副本")
      expect(提示).toContain("没有返回路径")
      // 弹窗照常关掉（发起本身是成功的）。
      expect(弹窗开着()).toBe(false)
    } finally {
      卸()
    }
  })

  test("iterating 且服务端说这个资产正在跑 ⇒ 两个按钮禁用，且 id 没被当文案渲染", () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3, iterationNote: "补一条口径", iterationWorkspace: null },
      {
        canWrite: true,
        onSubmitIteration: async () => true,
        onAbortIteration: async () => true,
        iterationBusy: true,
      },
    )
    try {
      标签(host, "versions").click()
      // `iterationBusy` 是「正在跑的是不是这个资产」，只用来禁用；界面文案自己按状态拼。
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')?.disabled).toBe(true)
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-abort-iteration"]')?.disabled).toBe(true)
      expect(host.textContent?.includes("asset-1")).toBe(false)
    } finally {
      卸()
    }
  })

  test("iterating 且工作副本路径为空、没有在飞 ⇒ 提交 / 放弃照常可点（不拿 workspace 当门）", () => {
    const { host, 卸 } = 挂(
      { status: "iterating", version: 3, iterationNote: "补一条口径", iterationWorkspace: null },
      { canWrite: true, onSubmitIteration: async () => true, onAbortIteration: async () => true },
    )
    try {
      标签(host, "versions").click()
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-submit-iteration"]')?.disabled).toBe(false)
      expect(host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-abort-iteration"]')?.disabled).toBe(false)
    } finally {
      卸()
    }
  })

  test("弹窗明写再次发起会覆盖项目里的副本（设计 §10 风险 1）", async () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      const 正文 = 弹窗()?.textContent ?? ""
      expect(正文).toContain("副本若已存在，会被线上版本覆盖")
    } finally {
      卸()
    }
  })

  /**
   * 浮层关不掉 / 第二次打不开，是这一套里踩过的坑（`#005-29` / `#005-30`）。
   * 只断言初始渲染看不出来：必须真跑「打开 → 取消 → 再打开」。
   */
  test("打开 → 取消 → 再打开：第二次照样打得开，说明已清空", async () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      await 开弹窗(host)
      填说明("上一次填的")
      点取消()
      await 等到(() => !弹窗开着())

      槽(host, "asset-detail-start-iteration")!.click()
      await 等到(弹窗开着)
      expect(说明框()?.value).toBe("")
    } finally {
      卸()
    }
  })

  /**
   * 触发器是外置的 `ButtonV2`，不是 `Kobalte.Trigger` —— Kobalte 关框时 `triggerRef()` 是空的，
   * 焦点不会自己回来（`#005-17`：焦点时间线断在这里，键盘用户被扔回页面顶部）。
   */
  test("关闭弹窗后焦点回到「发起新版本」", async () => {
    const { host, 卸 } = 挂(
      { status: "published", version: 2 },
      {
        canWrite: true,
        onStartIteration: async () => ({ ok: true as const }),
        projects: [{ id: "p1", name: "专案" }],
        currentProjectId: "p1",
      },
    )
    try {
      标签(host, "versions").click()
      // 用带泛型的 `querySelector`，不写 `as HTMLButtonElement`（`槽` 回的是 `HTMLElement`）。
      const 触发 = host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-start-iteration"]')!
      触发.focus()
      await 开弹窗(host)
      // 先把焦点**真的放进框里**：happy-dom 没有布局引擎，Kobalte 的 firstTabbable 找不到候选，
      // 开框时不会自己移焦点。不补这一步，焦点从头到尾都在触发器上——那条断言恒绿（`#005-18`）。
      说明框()!.focus()
      expect(document.activeElement).toBe(说明框())
      点取消()
      await 等到(() => document.activeElement === 触发)
      // 用布尔比、不直接对节点做 `toBe`：断言失败时 Bun 序列化 DOM 节点会挂死（`#009-01`）。
      expect(document.activeElement === 触发).toBe(true)
    } finally {
      卸()
    }
  })
})
