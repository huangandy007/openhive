# 05 · 子系统 · config 配置体系

> 这是**对 fork 改造最重要**的一个子系统——它直接决定「哪些改动靠配置就能做，哪些必须改源码」。学会它，你就掌握了「最小化合并冲突」的第一把钥匙。

---

## 一、配置是什么，为什么重要

opencode 几乎所有行为都可以通过「配置」调整：默认模型、默认 agent、权限、MCP 服务器、指令文件、插件……配置写在 `opencode.json` / `opencode.jsonc` 文件里，或通过环境变量注入。

**对改造 openhive 的意义**（呼应 CLAUDE.md 三原则第一条「品牌化优先用配置」）：能靠配置改的，就**绝不动源码**——因为改源码会和上游 `dev` 冲突，改配置则完全零冲突。

---

## 二、配置模块清单

配置相关代码分三处，容易混淆：

| 位置 | 作用 |
|---|---|
| `packages/opencode/src/config/`（14 文件） | **运行时配置服务**：读文件、合并、变量替换、写回 |
| `packages/core/src/v1/config/` | **V1 主 Schema**（当前实际生效的配置字段权威定义） |
| `packages/core/src/config/` | **V2 Schema**（较新，个别地方引用，暂非主路径） |

`packages/opencode/src/config/` 下的核心模块（AGENTS.md 提到的「self-export 模式」，每个文件 `export * as ConfigXxx`）：

- `config.ts` → `Config`：**核心入口**，读文件、合并、覆盖
- `paths.ts` → `ConfigPaths`：发现配置文件 / `.opencode` 目录
- `parse.ts` → `ConfigParse`：JSONC 解析 + Schema 校验
- `variable.ts` → `ConfigVariable`：`{env:VAR}` / `{file:path}` 变量替换
- `agent.ts` / `command.ts` / `plugin.ts`：从 `.md` 文件 / 目录加载 agent、command、plugin

**注意**：`permission`、`mcp`、`lsp`、`provider`、`model` 这些**不是** config 目录下的独立文件，而是主配置 Schema `ConfigV1.Info` 里的**字段**（定义在 `packages/core/src/v1/config/` 下的对应文件）。

---

## 三、配置文件从哪读

### 1. 全局配置（`config.ts:139-147`）
在 `Global.Path.config`（`~/.config/opencode`，Windows 走 XDG 对应目录）下找 `opencode.jsonc` / `opencode.json` / `config.json`。

### 2. 项目配置（`paths.ts:10-21`）
`ConfigPaths.files(...)` 从 cwd **向上遍历到 worktree**，找 `opencode.jsonc` / `opencode.json`。返回顺序是**根优先**，因此**越深的文件后合并、优先级越高**。

### 3. `.opencode` 目录（`paths.ts:23-41`）
全局 config 目录 → cwd 向上的 `.opencode` 目录 → home 下的 `.opencode` → `OPENCODE_CONFIG_DIR`。

---

## 四、配置合并顺序（9 层，从低到高优先级）

`config.ts:314-596` 的 `loadInstanceState`，后加载的覆盖先加载的（深合并 `mergeDeep`）：

1. `.well-known/opencode` 远程配置（登录态）
2. 全局配置（`config.json` → `opencode.json` → `opencode.jsonc`）
3. `OPENCODE_CONFIG` 指定文件
4. 项目 `opencode.json/jsonc`（自 cwd 向上，根优先）
5. `.opencode` 目录 + `OPENCODE_CONFIG_DIR`
6. `OPENCODE_CONFIG_CONTENT` 环境变量内容
7. 账号/组织远程配置
8. 系统托管配置目录
9. macOS MDM 托管偏好（**最高**）

> 记住两个特殊点：`instructions` 数组是**并集去重**而非覆盖；`mode` 字段会合并进 `agent`。

### 变量替换（`variable.ts:34-91`）
配置里可写 `{env:OPENAI_API_KEY}`（读环境变量）或 `{file:~/.token}`（读文件内容内联）。这让配置可以安全地引用敏感信息，而不硬编码。

---

## 五、★ 品牌化改造点清单（核心干货）

这是 agent 深挖出来的「能不能靠配置改」的完整对照：

### ✅ 能靠配置/环境变量改（零冲突）

| 品牌化点 | 配置字段 | 说明 |
|---|---|---|
| 默认模型 | `model: "provider/model"` | 见 `provider.ts:1947` |
| 小模型（标题/摘要用） | `small_model` | |
| 默认 agent | `default_agent` | 未设则回退 `build` |
| 用户名 | `username` | |
| mDNS 域名 | `server.mdnsDomain` | 默认 `opencode.local` |
| 自定义 provider/模型 | `provider` 字段 | 含 `baseURL`、`apiKey`、模型列表 |
| 自定义 agent | `agent` 字段 | 可改 `model`/`prompt`/`description`/`color` |
| 权限 | `permission` / `tools` / `OPENCODE_PERMISSION` | |
| 指令、MCP、LSP、插件 | 同名字段 | |
| 配置目录重定向 | `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG` | |

### ❌ 必须改源码（硬编码，会与上游冲突）

| 品牌化点 | 硬编码位置 |
|---|---|
| **产品名 `opencode`** | `packages/core/src/global.ts:10`（`const app = "opencode"`，决定所有数据/缓存/日志目录） |
| **CLI 名 / 二进制名** | `packages/opencode/package.json` 的 `name`+`bin`；`index.ts:47` 的 `.scriptName("opencode")` |
| **Logo / ASCII 字标** | `cli/ui.ts:5-10` 的 `wordmark`；`tui/src/logo.ts` |
| **`$schema` URL** | `config.ts` 多处（`https://opencode.ai/config.json`） |
| **发送给 provider 的标识头** | `provider.ts:462-494`（`X-Title: "opencode"` 等） |
| **MCP client name** | `mcp/index.ts:76`（`name: "opencode"`） |
| **默认 agent 的 `"build"` 字面量** | 散布多处（`agent.ts:142` 等） |
| **安装/升级渠道包名** | `installation/index.ts`（`brew`/`scoop`/`choco` 的 `opencode` 包名） |

### 改造策略（对应 CLAUDE.md 三原则）

1. **能配置的绝不动源码**。
2. **必须改源码的最小硬编码集合**集中在 4 处：① `global.ts:10` 的 `app` 常量；② `package.json` 的 `name`+`bin` + `index.ts:47` 的 `.scriptName`；③ `cli/ui.ts` 和 `tui/logo.ts` 的 Logo；④ 散布的 `"opencode"` 字面量。
3. **最高杠杆改动**是 ① 和 ②（改产品名 + CLI 名）；其余散点建议用「集中常量 + 后处理替换」而非逐行硬改，以减少冲突面。

> 这一节就是「层 5 改造地图」的核心原料。到层 5 时，我们会把它扩展成一份完整的、按优先级排序的改造清单。

---

## 六、小结

```
配置文件（全局/项目/.opencode）
  → ConfigPaths 发现
  → ConfigParse 解析（JSONC + Schema 校验）
  → ConfigVariable 替换（{env:}/{file:}）
  → 9 层合并（深合并）
  → 后处理（mode→agent、permission、tools 映射…）
  → 生效
```

掌握 config 后，你就知道 openhive 改造的**第一条路**：先问「这个能不能靠配置改」，能就不动源码。
