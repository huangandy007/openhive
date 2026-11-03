import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { AssetApi, AssetReader } from "./asset-api"
import type { CategoryAdminRow } from "./category-api"
import { McpCreateForm, 解析命令, type CreateMcpDraftInput } from "./mcp-create-form"

/**
 * 新建 MCP 表单（2026-11-02 设计 §5.3）。
 *
 * 本文件只钉表单自己那一半：必填、两种传输方式的字段、交出去的值。
 * 「点了以后发什么请求」在 `asset-api.test.ts`；「工具栏怎么打开它」在
 * `asset-governance.test.tsx`。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 分类: readonly CategoryAdminRow[] = [
  { id: "intelligence", name: "情报研判", sortOrder: 10, enabled: true, builtin: true },
  { id: "other", name: "其他", sortOrder: 20, enabled: true, builtin: true },
]

const 授权组 = [{ id: "g_case", name: "电诈专案组", memberCount: 2 }] as const
const 读者: readonly AssetReader[] = [{ id: "u2", name: "李四", dept: "经侦支队" }]

/**
 * 「指定人员」选择器的网络替身：组清单一次拉齐，人员搜索原样回一份。
 * 表单只依赖这两个方法，不把整个 `AssetApi` 拖进组件测试。
 */
function 读者后端(): Pick<AssetApi, "listGroups" | "searchReaders"> {
  return {
    listGroups: async () => ({ kind: "ok", value: 授权组 }),
    searchReaders: async () => ({ kind: "ok", value: 读者 }),
  }
}

interface 剧本 {
  readonly categories?: readonly CategoryAdminRow[]
  readonly categoriesLoaded?: boolean
  readonly categoriesError?: string
  readonly readerApi?: Pick<AssetApi, "listGroups" | "searchReaders">
  readonly onCreate?: (input: CreateMcpDraftInput) => string | undefined | Promise<string | undefined>
}

async function 打开(剧本: 剧本 = {}) {
  const 收到: CreateMcpDraftInput[] = []
  let 取消次数 = 0
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <McpCreateForm
        categories={剧本.categories ?? 分类}
        categoriesLoaded={剧本.categoriesLoaded}
        categoriesError={剧本.categoriesError}
        readerApi={剧本.readerApi ?? 读者后端()}
        onCancel={() => (取消次数 += 1)}
        onCreate={(input) => {
          收到.push(input)
          return 剧本.onCreate?.(input)
        }}
      />
    ),
    host,
  )
  挂过的.push(() => {
    dispose()
    host.remove()
  })
  await flush()
  return { 收到, 取消次数: () => 取消次数, host }
}

function 框<T extends Element>(selector: string, 构造: new () => T): T {
  const el = document.body.querySelector(selector)
  if (!(el instanceof 构造)) throw new Error(`表单里找不到 ${selector}`)
  return el
}

function 填(selector: string, value: string) {
  const input = 框(selector, HTMLInputElement)
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function 填文本域(selector: string, value: string) {
  const input = 框(selector, HTMLTextAreaElement)
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function 选(selector: string, value: string) {
  const select = 框(selector, HTMLSelectElement)
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("解析命令", () => {
  test("一行一个参数，去空行，保留参数内的空格", () => {
    expect(解析命令("bun\nrun\n--name=my server\n\n")).toEqual(["bun", "run", "--name=my server"])
  })
})

describe("新建 MCP 表单", () => {
  test("remote：交出去的是 url，不带 command / cwd", async () => {
    const { 收到 } = await 打开()
    填("input[name='mcp-create-name']", "资金查询 MCP")
    填文本域("textarea[name='mcp-create-description']", "按账户查流水")
    选("select[name='mcp-create-category']", "intelligence")
    // 本用例只钉连接规格；可见范围选全局，避开「指定人员」必选对象的门槛。
    选("select[name='mcp-create-visibility']", "global")
    填("input[name='mcp-create-url']", "https://mcp.example/path")
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到).toHaveLength(1)
    expect(收到[0]).toEqual({
      name: "资金查询 MCP",
      description: "按账户查流水",
      category: "intelligence",
      visibility: "global",
      connection: { transport: "remote", url: "https://mcp.example/path" },
    })
  })

  test("remote 请求头：键值随连接交出；空行丢掉", async () => {
    const { 收到 } = await 打开()
    填("input[name='mcp-create-name']", "带鉴权的 MCP")
    填文本域("textarea[name='mcp-create-description']", "服务器要求 Bearer")
    选("select[name='mcp-create-category']", "intelligence")
    选("select[name='mcp-create-visibility']", "global")
    填("input[name='mcp-create-url']", "https://mcp.example/path")
    填("input[name='mcp-create-header-key-0']", "Authorization")
    填("input[name='mcp-create-header-value-0']", "Bearer secret-token")
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到[0]?.connection).toEqual({
      transport: "remote",
      url: "https://mcp.example/path",
      headers: { Authorization: "Bearer secret-token" },
    })
  })

  test("targeted：至少选一个授权对象；组与人都随创建交出", async () => {
    const { 收到 } = await 打开()
    填("input[name='mcp-create-name']", "指定人员 MCP")
    填文本域("textarea[name='mcp-create-description']", "只给专案组")
    选("select[name='mcp-create-category']", "intelligence")
    填("input[name='mcp-create-url']", "https://mcp.example/path")
    await flush()

    // 默认就是「指定人员」：一个都没选时交不出去。
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()
    expect(收到).toHaveLength(0)
    expect(document.body.querySelector("[data-slot='mcp-create-error']")?.textContent).toBe(
      "请选择至少一个授权组或一名人员",
    )

    框("[data-slot='mcp-create-group-g_case']", HTMLInputElement).click()
    await flush()
    框("[data-slot='mcp-create-user-search']", HTMLInputElement).value = "李"
    document.body
      .querySelector("[data-slot='mcp-create-user-search']")!
      .dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
    框("[data-slot='mcp-create-user-u2']", HTMLInputElement).click()
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到[0]).toMatchObject({
      visibility: "targeted",
      groupIds: ["g_case"],
      userIds: ["u2"],
    })
  })

  test("local：命令一行一个参数，工作目录可选", async () => {
    const { 收到 } = await 打开()
    填("input[name='mcp-create-name']", "本地查询 MCP")
    填文本域("textarea[name='mcp-create-description']", "本机脚本")
    选("select[name='mcp-create-category']", "intelligence")
    选("select[name='mcp-create-visibility']", "global")
    选("select[name='mcp-create-transport']", "local")
    await flush()
    填文本域("textarea[name='mcp-create-command']", "bun\nrun\nserver.ts")
    填("input[name='mcp-create-cwd']", "/srv/mcp")
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到[0]?.connection).toEqual({
      transport: "local",
      command: ["bun", "run", "server.ts"],
      cwd: "/srv/mcp",
    })
  })

  test("local 命令为空 ⇒ 交不出去，就地报错", async () => {
    const { 收到 } = await 打开()
    填("input[name='mcp-create-name']", "空命令")
    填文本域("textarea[name='mcp-create-description']", "描述")
    选("select[name='mcp-create-category']", "intelligence")
    选("select[name='mcp-create-visibility']", "global")
    选("select[name='mcp-create-transport']", "local")
    await flush()
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到).toHaveLength(0)
    expect(document.body.querySelector("[data-slot='mcp-create-error']")?.textContent).toBe("请填写启动命令")
  })

  test("服务端拒绝 ⇒ 那句话就地显示，表单不关", async () => {
    const { 收到 } = await 打开({ onCreate: () => "只有资产治理管理员可以新建 MCP 资产" })
    填("input[name='mcp-create-name']", "会被拒")
    填文本域("textarea[name='mcp-create-description']", "描述")
    选("select[name='mcp-create-category']", "intelligence")
    选("select[name='mcp-create-visibility']", "global")
    填("input[name='mcp-create-url']", "https://x")
    框("[data-slot='mcp-create-submit']", HTMLButtonElement).click()
    await flush()

    expect(收到).toHaveLength(1)
    expect(document.body.querySelector("[data-slot='mcp-create-error']")?.textContent).toBe(
      "只有资产治理管理员可以新建 MCP 资产",
    )
  })
})
