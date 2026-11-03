# MCP 上线全流程操作手册（架设 → 发布 → 用户使用）

> 适用版本：`multi-tenant` 分支，批次 4（AI 资产 MCP 全流程）真栈验收通过后（2026-11-03）。
> 依据：`docs/superpowers/specs/2026-11-02-ai资产MCP全流程-design.md`；
> 验收记录：`.superpowers/sdd/2026-11-02-ai资产MCP全流程-批次4/progress.md`。
>
> **本文只写操作**。设计取舍、边界与缺口见设计文档 §3/§5/§9。
> ⚠️ 文中出现的 `<token>`、`<uuid>`、`<host>` 均为占位，不要提交真实凭据。

---

## 0. 全流程总览

一次上线涉及三方：**业务系统方**（架 MCP 服务）、**平台管理员**（登记/审核/发布）、**民警**（使用）。

| 阶段 | 谁做 | 产物 | 验收判据 |
|---|---|---|---|
| 1 架设 MCP 服务 | 业务系统方 | 可用的 MCP 端点（remote）或命令（local） | 服务端自测能列出工具 |
| 2 登记到平台 | 资产治理管理员 | 草稿资产 + 连接规格 | 草稿创建成功、凭据已填 |
| 3 审核发布 | 业务审核人 + 系统管理员 | 已发布资产 + 读者名单 | 发布成功（发布前内核会真连一次） |
| 4 下发配置 | 内核（自动） | `opencode.jsonc` 的 `mcp` 段 | 配置里出现资产键 |
| 5 重载生效 | 运维 | 实例重建 | 新会话里出现工具规则 |
| 6 用户使用 | 民警 | 查询结果 / 产物 | 工具块 + 使用记录 |

---

## 1. 部署前提（每套环境一次）

### 1.1 数据库迁移

远端 PG 必须已应用：

- `0029_asset_mcp_connection`（MCP 连接规格）
- `0030_asset_usage_kind`（使用记录 `kind` / `tool_name`）

迁移文件在 `packages/auth/src/migrations/`，按编号顺序应用。

### 1.2 内核环境变量

内核只认 `packages/opencode/.env` 或内核进程环境（bun **不向上查找** `.env`，仓库根的三份对内核无效）。

| 变量 | 必填 | 作用 |
|---|---|---|
| `OPENHIVE_ASSET_SERVICE_DIR` | 是 | asset-service **包目录**。①治理 MCP 子进程的启动命令（`bun run <dir>/src/mcp-http.ts`）；②**MCP 配置同步总开关**——不设就完全不下发 |
| `OPENHIVE_GOVERNANCE_MCP_CMD` | 镜像里 `bun` 不在 PATH 时 | JSON 字符串数组，绝对路径命令；设了可不需要 `_DIR` |
| `OPENHIVE_ASSETS_ROOT` | 是 | 资产文件存储根（默认 `/assets`），内核与治理子进程都读它 |
| `OPENHIVE_GOVERNANCE_MCP=off` | 可选 | 目录已配但本次不想起治理子进程 |

### 1.3 配置目录

内核把下发的 MCP 配置写到：

```
$XDG_CONFIG_HOME/opencode/opencode.jsonc
```

默认 `XDG_CONFIG_HOME` 为 `~/.config`。

要求：

- 目录对内核用户可写；
- **同目录只保留一份全局配置文件**。`opencode.json` / `config.json` 与 `.jsonc` 共存时，低优先级文件里的旧 `mcp` 键会经深合并残留（设计 §9 已知缺口）。

### 1.4 授权

每个使用者必须 `is_admin = 1`（进后台总开关），再由授权行决定板块能力：

- `asset-governance` + `admin` → 可建 MCP 草稿、可技术发布
- `asset-governance` + `review` → 可过业务审核

两者互不蕴含。建议按制度分开：建的人不审内容、审的人不发布。

### 1.5 重启内核

配置与环境只在启动时读，改完必须重启。

---

## 2. 阶段 1：架设 MCP 服务器（业务系统方）

### 2.1 先定形态：remote 还是 local

| | remote（推荐） | local |
|---|---|---|
| 部署位置 | 独立服务，HTTP 端点 | 与内核**同一台机器**，由内核拉起子进程 |
| 平台连法 | 内核从服务器发起连接（要求**内核所在主机**可访问） | `command` 数组 + 可选 `cwd` |
| 鉴权 | 请求头（`headers`） | 不继承平台凭据，专用变量写 `environment` |
| 适用 | 业务库在业务网、多实例、可独立运维 | 单机小工具、内网只读脚本 |

> 关键：**不是民警浏览器连 MCP，是内核连**。remote 地址必须是**内核主机**可达的地址；发布时的试连也在内核侧执行，因此这层可达性会被真实验证。

### 2.2 最小可用的 remote MCP（Streamable HTTP）

仓库内的参考实现：`packages/asset-service/src/mcp-http.ts`（治理 MCP，单进程、无状态）。
SDK 版本 `@modelcontextprotocol/sdk@1.29.0`。平台试连**只认 Streamable HTTP**（运行期才会回退 SSE，别依赖）。

```ts
// server.ts —— 话单查询 MCP（只读）
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const TOKEN = process.env.MCP_TOKEN!   // 平台资产 headers 里下发的那把

const TOOLS = [{
  name: "query_calls",
  description: "按手机号与时间范围查询通话记录（只读）",
  inputSchema: {
    type: "object",
    properties: {
      phone: { type: "string" },
      from:  { type: "string", description: "ISO8601" },
      to:    { type: "string", description: "ISO8601" },
    },
    required: ["phone", "from", "to"],
  },
}]

function 建服务() {
  const server = new Server({ name: "cdr-query", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    // 平台在每次调用注入调用者身份（`openhive/user`），据此按人取数／留痕
    const userId = (extra._meta as Record<string, unknown> | undefined)?.["openhive/user"]
    if (typeof userId !== "string") {
      return { isError: true, content: [{ type: "text", text: "缺少调用者身份，拒绝执行" }] }
    }
    const a = (request.params.arguments ?? {}) as Record<string, string>
    const rows = await 查库({ ...a, userId })   // 受限只读账号 + RLS，见 2.4
    return { content: [{ type: "text", text: JSON.stringify(rows) }] }
  })
  return server
}

function 流完再关(response: Response, close: () => void): Response {
  const body = response.body
  if (body === null) { close(); return response }
  const reader = body.getReader()
  return new Response(new ReadableStream({
    async pull(c) {
      const { done, value } = await reader.read()
      if (done) { close(); c.close() } else c.enqueue(value)
    },
    cancel() { close(); void reader.cancel().catch(() => {}) },
  }), { status: response.status, headers: response.headers })
}

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/healthz") return new Response("ok")        // 只给运维探活
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 })
    // 鉴权：错误令牌回 403 而不是 401——平台资产连接没有 oauth:false，
    // 401 会让内核尝试 OAuth 发现流程，排障时看到的是一串 OAuth 错误而不是「令牌不对」。
    if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
      return new Response("forbidden", { status: 403 })
    }
    if (request.method === "GET") return new Response(null, { status: 405, headers: { allow: "POST" } })

    const server = 建服务()
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    return 流完再关(response, () => { void transport.close(); void server.close() })
  },
})
```

要点：

- **无状态**：每请求一套 server/transport，不维护会话表。
- `GET /mcp` 回 405，只接受 `POST`。
- **试连默认 5 秒**（`initialize` + `tools/list` 必须在这个窗口内完成）。启动慢就把连接里的 `timeoutMs` 调到 ≤ 30000。
- 错误文案**不要回显** `Authorization` / 环境变量原文。

### 2.3 local 形态

同一份 `建服务()`，传输换成 stdio：

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
await 建服务().connect(new StdioServerTransport())
```

- **stdout 是协议通道**：日志一律写 stderr，否则协议被日志污染、试连必挂。
- 平台给的 `command` 是数组（如 `["bun","run","D:/mcp/cdr-query/server.ts"]`），`cwd` 可选。
- 子进程环境**已剥离**平台凭据（`PG*`、`OPENHIVE_MINIO*`、`*SECRET*`、`*TOKEN*` 等）。业务库连接串等私有变量**必须**写进资产的 `environment`，继承不到。

### 2.4 数据权限（公安业务必须做的一层）

平台注入了 `_meta["openhive/user"]` 与 `_meta["openhive/directory"]`，但**最终兜底在业务库**（宪法 FR-005）：

1. MCP 服务用**受限只读账号**连业务库；
2. 按 `userId` 做行级过滤（或 PG RLS）；
3. **不要**相信模型传来的任何「我是谁」参数——身份只认 `_meta`。

### 2.5 服务端自测（不经过平台）

```bash
# 1) 健康检查
curl -s http://<host>:8080/healthz

# 2) 初始化 + 列工具（有 MCP Inspector 更好）
curl -s -X POST http://<host>:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer <token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

返回里有 `serverInfo` 即通。**这一步不通就不要去平台登记**——平台试连失败只给你一句脱敏错误。

---

## 3. 阶段 2：登记到平台（资产治理管理员）

前提：`asset-governance` 的 `admin` 能力。

### 3.1 建草稿

治理后台 →「内容与授权」→「AI 资产治理」→ 新建 MCP。填：名称、功能描述、分类、可见范围、传输方式、地址/命令。

接口等价物：

```http
POST /openhive/assets/draft
{
  "type": "mcp",
  "name": "话单查询",
  "description": "按号码+时间查通话记录，只读",
  "category": "intelligence",
  "visibility": "targeted",
  "connection": { "transport": "remote", "url": "https://mcp.internal.example.com/mcp" }
}
→ { "assetId": "asset_<uuid>", "status": "draft" }
```

### 3.2 填凭据（当前 UI 没有编辑入口，用接口）

```http
PATCH /openhive/assets/asset_<uuid>/connection
{
  "connection": {
    "transport": "remote",
    "url": "https://mcp.internal.example.com/mcp",
    "headers": { "Authorization": "Bearer <token>" },
    "enabled": true,
    "timeoutMs": 15000
  }
}
```

四条硬规则：

- **整行替换**：`headers` 漏传会被清空；先 `GET /openhive/assets/:id/connection` 看全貌再改。
- 读接口只回 `***(已设置)`，**不能**把占位值 PATCH 回来。
- `remote` 不能带 `environment` / `command` / `cwd`；`local` 不能带 `url` / `headers`。
- 只有 `draft` / `iterating` 能改连接。

---

## 4. 阶段 3：审核与发布

### 4.1 提交审核（作者）

```http
POST /openhive/assets/asset_<uuid>/submit   → in_review
```

### 4.2 业务审核（需要 `review`）

```http
POST /openhive/governance/assets/asset_<uuid>/transition
{ "action": "approve_business" }
→ pending_tech
```

> 系统**不强制**审核人与创建人分开。建议按制度分开。

### 4.3 技术发布（需要 `admin`）

```http
POST /openhive/governance/assets/asset_<uuid>/transition
{
  "action": "publish_tech",
  "visibility": "targeted",
  "userIds": ["<张三 id>", "..."],
  "groupIds": ["<授权组 id>", "..."]
}
```

- `targeted` **至少给一个**人/组，否则 400。
- `department` / `global` 同理可选。
- 发布前内核会**真连一次** MCP（`initialize` + `tools/list`）。失败 ⇒ 400 `mcp_probe_failed`，**状态不变**，错误写进连接的 `check_error`。这一步通了，说明阶段 1 的网络、TLS、鉴权、工具清单都成立。

---

## 5. 阶段 4：下发配置（自动）

发布动作**即时触发**同步；另有 60 秒兜底。内核把「已发布 / 迭代中」的 MCP 资产写进：

```
$XDG_CONFIG_HOME/opencode/opencode.jsonc
```

```jsonc
{
  "mcp": {
    "asset_<uuid>": {
      "type": "remote",
      "url": "https://mcp.internal.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" },   // 明文，见下方注意
      "enabled": true,
      "timeout": 15000
    },
    "openhive-governance": { "type": "remote", "url": "http://127.0.0.1:<port>/mcp" }
  }
}
```

注意：

- **配置键 = 资产 id**，工具名 = `<资产id>_<工具名>`。
- 凭据**明文**落在这份文件里（同步器与连接要用真值）⇒ 文件权限收紧到只有内核用户可读；机器边界就是凭据边界。
- 同目录**只保留一份**全局配置文件，否则低优先级文件里的旧 `mcp` 键会残留。

---

## 6. 阶段 5：重载生效（最容易漏的一步）

配置落盘 ≠ 运行中的内核生效。`Config` / MCP 状态按目录缓存，**已起的实例不会自动重建**。

```http
POST /global/dispose
```

（或重启内核）

不做这一步，民警新建会话也看不到工具。这是当前已知的生效窗口缺口；建议把 dispose 接进发布后自动动作（尚未接）。

验证（发布后 1 分钟内）：

```bash
# 1) 配置里有键
grep asset_<uuid> "$XDG_CONFIG_HOME/opencode/opencode.jsonc"

# 2) 新建会话，看 permission 规则里有 asset_<uuid>_* 的 allow

# 3) 真发一条消息触发工具调用，服务端日志里能看到 _meta["openhive/user"]

# 4) 触发用量抽取后查 auth.asset_usage_event：
#    kind='mcp'、tool_name='asset_<uuid>_query_calls'
```

---

## 7. 阶段 6：民警使用

1. 登录 → 左侧「项目管理」选/建项目；
2. 右栏「AI 会话」→ **新建会话**；
3. 用自然语言交代任务（查什么、什么条件、要什么结果）；
4. 工具自动调用，**不弹权限确认**（授权已下发为 allow）；
5. 看工具块 → 让 AI 整理成 Word / Excel 等产物。

使用注意：

- 旧会话看不到后来授权的工具（会话权限是创建时快照），**新建会话**；
- MCP 卡片上的「启用」按钮是给 skill 用的，别点（会提示「只有 skill 能装进项目」）；
- 未授权时工具是**不可见**，不是报「无权限」；
- 让 AI「列出你有哪些工具」不可靠，自检方式是跑一次已知能通的小查询。

---

## 8. 阶段 7：变更、下线、排障

| 场景 | 操作 | 生效 |
|---|---|---|
| 换地址 / 换密钥 | 作者 `POST /openhive/assets/:id/iteration`（带 `projectId`）→ `PATCH …/connection` → `…/iteration/submit` → admin `publish_iteration` | 重新下发，读者名单**替换** |
| 放弃改版 | `POST …/iteration/abort` | 连接回写线上快照 |
| 临时停用 | `{"action":"take_offline"}` | 约 3 秒摘键；工具对新会话消失（同样需 dispose 才在运行实例消失） |
| 彻底下架 | `{"action":"archive"}` | 同上 |
| 重新上线 | `{"action":"take_online"}` | 再走发布门槛（仍会试连） |

**试连失败排障顺序**：

1. 服务是否在跑（`/healthz`）；
2. 内核主机能否访问该地址；
3. 令牌是否对（用 curl 复现）；
4. `tools/list` 是否在 5 秒内返回；
5. 看资产连接的 `check_error`（错误里不会有凭据原文）。

---

## 9. 上线前检查清单

- [ ] MCP 端点从**内核主机**可达（不是从你的电脑）
- [ ] Streamable HTTP、`POST /mcp`、`GET /mcp` 回 405
- [ ] 鉴权头校验；错误令牌回 **403**
- [ ] `tools/list` 在 5 秒内返回；慢就设 `timeoutMs`
- [ ] 每个工具都有清晰 `description` 和 `inputSchema`（模型靠它选工具）
- [ ] 读到 `_meta["openhive/user"]` 后按人取数；业务库用受限账号 + RLS
- [ ] 日志写 stderr（local 形态）/ 不打印凭据（remote）
- [ ] 平台侧：草稿 → 凭据 → 提交 → 审核 → 发布（targeted 至少一人）
- [ ] 发布后执行 `POST /global/dispose`（或重启）
- [ ] 用一个真实读者账号新建会话，跑通一次真实查询并确认使用记录落库

---

## 10. 已知限制（上线前必须知道）

| 限制 | 影响 | 处置 |
|---|---|---|
| 生效窗口 | 授权/配置变更对**已存在会话与实例**不生效（会话权限是创建时快照） | 发布后 `POST /global/dispose` 或重启；建议后续接成自动动作 |
| 凭据明文入库 | `auth.asset_mcp_connection` 里存明文（同步器与试连要用真值），仅 API 出口遮罩 | 收紧 DB 访问权限；配置目录仅内核用户可读 |
| 多份全局配置文件共存 | 低优先级文件里的旧 `mcp` 键会残留 | 部署只保留一份全局配置文件 |
| local 子进程环境 | 平台凭据被剥离 | 专用变量写进资产 `environment` |
| 真实模型调用 | 需要可达且支持工具调用的 provider | 上线前确认模型出口；不支持 function calling 的模型不会调工具 |
| 停用/下线生效 | 配置键即时摘除，但运行实例需重载 | 同「生效窗口」 |

---

## 附：本文依据的实测记录

批次 4 真栈 7 步验收（2026-11-03）实际跑通：

1. 建 → 审 → 发（targeted）
2. 全局配置出现资产键
3. 新会话工具规则 allow / deny 正确
4. 真实工具调用带 `_meta` 身份，使用记录 `kind='mcp'` 落库
5. 迭代换授权后规则反转
6. 下线约 3 秒摘键、工具消失
7. 变异验证 `已启用()` 开关

细节与实得输出见 `.superpowers/sdd/2026-11-02-ai资产MCP全流程-批次4/progress.md`。
