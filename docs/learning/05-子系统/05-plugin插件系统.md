# 05 · 子系统 · plugin 插件系统

> 插件系统是 opencode 的「扩展机制」，让第三方代码能介入会话的各个阶段。它是 MCP / LSP 之外最灵活、覆盖面最广的扩展点。

---

## 一、是干什么的

通过 **hook（钩子）** 和**自定义工具**，让第三方（或内置）代码能介入会话生命周期——模型请求参数、工具执行前后、消息流、权限决策等，还能注册自定义工具和 TUI 主题。

**通俗类比**：Plugin 是「opencode 的插件化扩展点」，像浏览器插件。它既承载一批内置的**身份认证插件**（Codex、Copilot、GitLab、Azure 等登录集成），也允许用户在配置里声明 npm 包或本地路径，注入自定义 hook 与工具。

---

## 二、核心文件

| 文件 | 作用 |
|---|---|
| `plugin/index.ts` | 核心服务：加载内置+外部插件、分发 hook（`trigger`） |
| `plugin/loader.ts` | 外部插件解析、兼容性检查、动态 import |
| `plugin/shared.ts` | 插件 spec 解析、npm 安装、入口探测、版本兼容 |
| `plugin/install.ts` | `opencode plugin install` 命令 |
| `config/plugin.ts` | 从磁盘目录扫描 `{plugin,plugins}/*.{ts,js}` |
| `core/src/v1/config/plugin.ts` | 插件配置 Schema |
| 内置认证插件 | `openai/codex.ts`、`github-copilot/`、`azure.ts`、`cloudflare.ts` 等 |

---

## 三、如何配置/启用

插件来源有两条：

### 1. 配置声明（`opencode.json` 的 `plugin` 数组）

```jsonc
{ "plugin": [
    "some-npm-plugin",                    // npm 包名
    ["another-plugin", { "option": 1 }],  // 带选项
    "./my-local-plugin.ts"                // 本地路径
]}
```

### 2. 目录自动发现
扫描 `{plugin,plugins}/*.{ts,js}`（`config/plugin.ts:18-30`）。

插件代码约定（`shared.ts:272-304`）：默认导出对象，包含 `server(input, options)`（返回 hooks）和/或 `tui`，本地插件必须导出 `id`。

---

## 四、工作机制

```
服务初始化
  → 加载内置认证插件
  → PluginLoader.loadExternal 加载外部插件（解析→安装→兼容检查→动态 import）
  → applyPlugin 执行 server(input, options) 得到 hooks
  → 每个 hook 可挂 config() / event() / tool / dispose()

主流程通过 plugin.trigger(name, input, output) 分发事件
  → 逐个调用匹配的 hook
```

### hook 在主流程中的接入点（举例）

| hook | 接入点 |
|---|---|
| `tool.execute.before/after` | 工具执行前后（`session/tools.ts:106,121` 等） |
| `chat.params` / `chat.headers` | 模型请求参数/headers（`llm/request.ts:69,114,134`） |
| `experimental.chat.messages.transform` | 消息转换（`session/prompt.ts`） |
| `tool.definition` | 工具定义改写（`tool/registry.ts:318`） |

---

## 五、三个子系统的关系（一句话）

- **MCP** 把「外部工具能力」接进来给模型用；
- **LSP** 把「代码语言智能」接进来给模型和编辑工具用；
- **Plugin** 是「钩子/扩展框架」，贯穿整个会话生命周期，**最底层、覆盖面最广**——MCP 工具和 LSP 工具执行时也都会经过 plugin 的 `tool.execute.before/after` 钩子。

> 对改造 openhive 的意义：插件系统是最「低冲突」的扩展方式——**不改核心源码，只写插件就能注入自定义行为**。很多私有定制可以优先考虑用插件实现，而不是硬改核心。
