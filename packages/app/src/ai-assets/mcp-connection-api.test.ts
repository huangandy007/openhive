import { describe, expect, test } from "bun:test"
import { createMcpConnectionApi } from "./mcp-connection-api"

/**
 * 遮罩文案在这里写死：前端只负责「键名保留、值不显示」，并不需要服务端的常量。
 * 从 `asset-service/mcp-connection` 做**运行时**导入会把 drizzle / migrate 那串依赖
 * 拖进前端 bundle——生产代码因此只 `import type`。
 */
const MASKED = "***(已设置)"

const 视图 = {
  assetId: "asset_mcp_1",
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
}

function 发送(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status })
}

describe("MCP 连接客户端", () => {
  test("合法回包 ⇒ ok，字段齐全", async () => {
    const api = createMcpConnectionApi(发送(视图))
    const out = await api.get("asset_mcp_1")
    expect(out.kind).toBe("ok")
    if (out.kind !== "ok") return
    expect(out.value.transport).toBe("remote")
    expect(out.value.headers).toEqual({ Authorization: MASKED })
  })

  test("缺字段 ⇒ failed（不猜默认值）", async () => {
    const { url: _url, ...缺 } = 视图
    const api = createMcpConnectionApi(发送(缺))
    const out = await api.get("asset_mcp_1")
    expect(out.kind).toBe("failed")
  })

  test("403 ⇒ rejected，带服务端那句话", async () => {
    const api = createMcpConnectionApi(发送({ error: "无权查看这台 MCP 的连接" }, 403))
    const out = await api.get("asset_mcp_1")
    expect(out).toEqual({ kind: "rejected", message: "无权查看这台 MCP 的连接" })
  })
})
