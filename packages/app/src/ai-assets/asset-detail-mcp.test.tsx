import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { McpConnectionView } from "@opencode-ai/asset-service/mcp-connection"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetDetail } from "./asset-detail"

/** 与 `mcp-connection-api.test.ts` 同一个理由：不把服务端的运行时依赖拖进前端测试。 */
const MASKED = "***(已设置)"

/**
 * 详情页 MCP 分支（2026-11-02 设计 §3.1.2）。
 *
 * 钉三件事：只有 mcp 才取数 / 值只显示键名 / 失败与「尚未试连」分开说。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset-mcp-1",
    name: "资金查询 MCP",
    type: "mcp",
    description: "按账户查流水",
    summary: "",
    precautions: "",
    icon: "mcp",
    category: "intelligence",
    tags: [],
    ownerId: "u1",
    ownerName: "张三",
    department: "经侦支队",
    visibility: "targeted",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: null,
    archivedAt: null,
    iterationNote: "",
    iterationWorkspace: null,
    ...over,
  }
}

function 视图(over: Partial<McpConnectionView> = {}): McpConnectionView {
  return {
    assetId: "asset-mcp-1",
    transport: "remote",
    url: "https://mcp.example/path",
    command: null,
    cwd: null,
    headers: { Authorization: MASKED },
    environment: {},
    enabled: true,
    timeoutMs: null,
    checkedAt: null,
    checkOk: null,
    checkError: "",
    toolCount: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

function 挂(
  asset: AssetMetadata,
  loadMcpConnection?: (assetId: string) => Promise<McpConnectionView | string>,
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => <AssetDetail asset={asset} onBack={() => {}} loadMcpConnection={loadMcpConnection} />,
    host,
  )
  挂过的.push(() => {
    dispose()
    host.remove()
  })
  return host
}

describe("详情页 MCP 分支", () => {
  test("remote：显示传输方式、地址、工具数、请求头键名", async () => {
    const host = 挂(资产(), async () => 视图())
    await flush()
    expect(host.querySelector("[data-slot='asset-detail-mcp-transport']")?.textContent).toBe("远程服务")
    expect(host.querySelector("[data-slot='asset-detail-mcp-url']")?.textContent).toBe("https://mcp.example/path")
    expect(host.querySelector("[data-slot='asset-detail-mcp-tool-count']")?.textContent).toBe("尚未试连")
    expect(host.querySelector("[data-slot='asset-detail-mcp-probe']")?.textContent).toBe("尚未试连")
    const 头 = host.querySelector("[data-slot='asset-detail-mcp-headers']")?.textContent
    expect(头).toContain("Authorization")
    expect(头).not.toContain("Bearer s3cret")
  })

  test("local：显示命令与工作目录，字段不混用", async () => {
    const host = 挂(
      资产(),
      async () =>
        视图({
          transport: "local",
          url: null,
          command: ["bun", "run", "server.ts"],
          cwd: "/srv/mcp",
          headers: {},
          environment: { USER_ID: MASKED },
        }),
    )
    await flush()
    expect(host.querySelector("[data-slot='asset-detail-mcp-transport']")?.textContent).toBe("本地命令")
    expect(host.querySelector("[data-slot='asset-detail-mcp-command']")?.textContent).toBe("bun run server.ts")
    expect(host.querySelector("[data-slot='asset-detail-mcp-cwd']")?.textContent).toBe("/srv/mcp")
  })

  test("试连失败：显示失败原因，不显示「尚未试连」", async () => {
    const host = 挂(
      资产(),
      async () => 视图({ checkedAt: 2000, checkOk: false, checkError: "connect ECONNREFUSED" }),
    )
    await flush()
    expect(host.querySelector("[data-slot='asset-detail-mcp-probe']")?.textContent).toBe(
      "失败：connect ECONNREFUSED",
    )
    expect(host.querySelector("[data-slot='asset-detail-mcp-tool-count']")?.textContent).toBe(
      "尚未试连",
    )
  })

  test("读失败：就地报错", async () => {
    const host = 挂(资产(), async () => "无权查看这台 MCP 的连接")
    await flush()
    expect(host.querySelector("[data-slot='asset-detail-mcp-error']")?.textContent).toBe(
      "无权查看这台 MCP 的连接",
    )
  })

  test("skill 资产不取连接（加载器一次都不该被调）", async () => {
    let 次数 = 0
    const host = 挂(资产({ type: "skill" }), async () => {
      次数 += 1
      return 视图()
    })
    await flush()
    expect(次数).toBe(0)
    expect(host.querySelector("[data-slot='asset-detail-mcp']")).toBeNull()
  })
})
