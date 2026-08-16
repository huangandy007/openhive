# 05 · 子系统 · MCP 与 LSP 集成

> 这两个子系统都是「把外部能力接进 AI 会话」，但方向不同：MCP 接「外部工具」，LSP 接「代码智能」。

---

## 一、MCP（Model Context Protocol）

### 是干什么的

让 opencode 能连接**外部的 MCP 服务器**，把外部提供的「工具（tools）/提示词（prompts）/资源（resources）」接入会话，供模型调用。

**通俗类比**：MCP 就像「AI 的 USB 接口」。你在配置文件里告诉 opencode 怎么启动某个 MCP 服务器（本地命令或远程 URL），opencode 就把它暴露的工具变成模型可调用的函数，把它的说明文字塞进系统提示词。

### 核心文件

| 文件 | 作用 |
|---|---|
| `mcp/index.ts` | 核心服务：连接、状态管理、OAuth、工具/资源/提示词导出 |
| `mcp/catalog.ts` | MCP 工具定义 → AI SDK 的 `Tool`，翻页拉取 |
| `mcp/auth.ts` | OAuth token 持久化 |
| `mcp/oauth-provider.ts` | 实现 MCP SDK 的 OAuth 客户端 |
| `mcp/oauth-callback.ts` | 本地 127.0.0.1 回调服务器，接收授权码 |
| `core/src/v1/config/mcp.ts` | MCP 配置 Schema |

### 如何配置

```jsonc
// 本地（stdio 进程）
{ "mcp": { "my-server": {
    "type": "local",
    "command": ["npx", "-y", "some-mcp-server"],
    "environment": { "TOKEN": "xxx" },
    "enabled": true
}}}

// 远程（HTTP/SSE）
{ "mcp": { "remote-server": {
    "type": "remote",
    "url": "https://...",
    "oauth": { "clientId": "...", "scope": "..." }
}}}
```

### 工作机制

1. 服务启动时读 `cfg.mcp`，逐个 `connectLocal`（stdio）或 `connectRemote`（StreamableHTTP/SSE 双协议回退）
2. 连接后拉取 `tools/list`，存入 state，监听断线和 `ToolListChanged` 通知
3. 会话组装工具时，`session/tools.ts:390` 遍历 `mcp.tools()`，逐个转成模型工具注入
4. MCP 服务器的 `instructions` 注入系统提示词（`session/system.ts:119` 的 `<mcp_instructions>` 块）
5. OAuth token 落盘到 `Global.Path.data/mcp-auth.json`

---

## 二、LSP（Language Server Protocol）

### 是干什么的

在后台为打开的文件拉起**语言服务器**（TypeScript、Go、Rust、Python…），提供代码智能：诊断/报错、跳转定义、查找引用、悬浮提示、符号检索，并把这些能力暴露给模型。

**通俗类比**：LSP 是「给 AI 配的语法高亮 + 静态分析器」。你编辑代码时，opencode 针对该文件类型启动对应的语言服务器，实时拿到编译错误和代码结构，让 AI 写完后能发现错误、跳转定义。

### 核心文件

| 文件 | 作用 |
|---|---|
| `lsp/lsp.ts` | 核心服务：按文件类型调度、启动/复用 client |
| `lsp/server.ts` | 内置约 **50 个**语言服务器定义 |
| `lsp/client.ts` | 单个 LSP client，JSON-RPC 握手、didOpen/didChange、诊断推/拉 |
| `lsp/language.ts` | 文件扩展名 → languageId 映射 |
| `lsp/diagnostic.ts` | 诊断结果格式化 |
| `core/src/v1/config/lsp.ts` | LSP 配置 Schema |

### 如何配置

```jsonc
{ "lsp": true }   // 启用全部内置服务器
// 或精细控制
{ "lsp": {
    "typescript": { "disabled": false },
    "pyright": { "disabled": true },
    "my-custom": {
      "command": ["my-lsp", "--stdio"],
      "extensions": [".foo"]   // 自定义服务器必须声明 extensions
    }
}}
```

### 工作机制

1. 首次处理某文件时，`getClients` 用扩展名匹配 `server.extensions`，再找项目根，spawn 进程并握手，client 按 `root+serverID` 缓存复用
2. 读/编辑文件时 `touchFile` 发 `didOpen`/`didChange`，通过 push/pull 两种模式等诊断
3. 诊断结果被写文件/编辑/打补丁工具消费，把编译错误反馈给模型（`tool/edit.ts:197`、`tool/write.ts:75`）
4. 通过 `lsp` 工具（需 `experimentalLspTool`）把 9 种操作暴露给模型

---

## 三、MCP 与 LSP 的区别（一张表记住）

| | MCP | LSP |
|---|---|---|
| 接什么 | 外部工具/服务能力 | 代码语言智能 |
| 协议来源 | Anthropic 主导的开放协议 | 编辑器生态通用协议 |
| 典型用途 | 接数据库、浏览器、第三方 API | 语法检查、跳转定义、补全 |
| 对你的意义 | 扩展 AI 能做的事 | 提高 AI 写代码的质量 |
