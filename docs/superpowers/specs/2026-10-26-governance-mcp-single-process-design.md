# 治理 MCP 单进程形态（生产就绪改造）· 设计

- **日期**：2026-10-26
- **状态**：设计已与用户谈定（Q1 进程模型 / Q2 沙箱口径 / Q3 范围），待评审
- **取代**：009 T014 的「每实例 stdio 子进程 + 每用户 `opencode.json`」形态，仅限**内建治理 server**
- **不在本文件**：三个工具的业务语义（`governance.md`）、授权矩阵（`authorization.md`）、生命周期（`lifecycle.md`）

## 1. 为什么改

用户的目标是「后期在生产 Linux + Docker 上能用，之后不再改，运维不做额外工作」。现形态有三处硬伤：

| # | 现状 | 证据 |
|---|---|---|
| ① | 上游镜像只含编译好的 `opencode` 二进制，没有 `bun`、也没有 `packages/asset-service` 源码；而命令是 `["bun","run",…/mcp-main.ts"]` | `packages/opencode/Dockerfile`；`asset-service/src/downlink.ts:123-125` |
| ② | 每个「用户 × 项目」常驻一个 MCP 子进程，实例按目录缓存且**无空闲回收** | `project/instance-store.ts` 的 `cache`；2026-10-26 实测单实例 ≈ 90MB（cmd 5MB + conhost 12MB + bun 75MB） |
| ③ | 每用户每项目一份 `opencode.json`，需有人写 | 2026-10-26 手工写下第一份（`.opencode/opencode.json`）才跑通 |

结论：人数一涨，②是内存与 PG 连接线性增长，③是运维要逐个铺文件。三条都不满足「不要再改」。

## 2. 现状里有利的一面（决定了方案能很小）

- `asset-service/src/governance.ts:288-295`：身份**本来就**每次调用从 `_meta["openhive/user"]` 取，缺了就拒；**不读** `USER_ID` env。
- 因此 `mcp-main.ts` 里唯一与「每个用户不同」绑定的，只有 `sourceRoot: process.cwd()`。
- `packages/opencode/src/mcp/openhive-identity.ts` 已有按调用注入 `_meta` 的通道（004 T007），扩展它加一个键即可。
- `@modelcontextprotocol/sdk@1.29.0` 自带 `webStandardStreamableHttp`，Bun/Hono 可直接挂。
- capability 第①层已按**精确名字**放行内建 server（`@opencode-ai/auth/builtin-mcp`），名字不变就仍然有效。

⇒ 把「每用户一份进程」换成「一份进程 + 每次调用带身份和目录」，改动集中在四个文件 + 一个新监督器。

## 3. 方案

**同容器、内核拉起的独立 MCP 子进程**（Q1 选定），只绑 `127.0.0.1`，端口由系统分配；配置用 **A1：`Config.updateGlobal()` upsert 一个保留键**（不写每用户文件、不碰上游配置装配）。

```
容器内
  kernel (bun) ──spawn──> governance-mcp (127.0.0.1:<随机端口>/mcp)
       │                          ▲
       └── MCP client (remote) ───┘   每次调用带 _meta{openhive/user, openhive/directory}
```

- 进程数：容器内恒定 2（内核 + 1 个 MCP），与用户数、项目数无关。
- 配置：所有实例拿到**同一条** `mcp.openhive-governance`，因此不需要任何 per-user 下发器。
- 崩溃隔离：MCP 崩了只死它，内核按退避重启；内核照常服务。

## 4. 组件与改动点

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/asset-service/src/mcp-http.ts` | **新增** | Streamable HTTP 入口。读 `PG_*` / `OPENHIVE_ASSETS_ROOT` / `OPENHIVE_WORKSPACE_ROOT`；绑 `127.0.0.1:${OPENHIVE_GOVERNANCE_MCP_PORT:-0}`；就绪后向 stdout 打一行 `GOVERNANCE_MCP_READY {"port":N}`；`GET /healthz` 回 200 |
| `packages/asset-service/src/governance.ts` | 改 | `sourceRoot: string` → `resolveSandbox(meta)`：取 `_meta["openhive/directory"]`，必须落在 `${WORKSPACE_ROOT}/${_meta["openhive/user"]}/` 内且存在；越界抛 `source_outside_sandbox` |
| `packages/asset-service/src/mcp-main.ts` | 保留 | stdio 入口不删（单元测试与降级路径），内部改用同一套 `createGovernanceServer` |
| `packages/opencode/src/mcp/openhive-identity.ts` | 改 | `userMeta()` 增补 `openhive/directory`（从实例上下文取当前目录），仍遵守「没有身份就不带任何键」 |
| `packages/opencode/src/server/openhive/governance-mcp-supervisor.ts` | **新增** | spawn 子进程 → 解析就绪行 → `Config.updateGlobal({mcp:{"openhive-governance":{type:"remote",url}}})` → 崩溃按 1s/2s/4s…60s 退避重启 → 内核退出时收尾 |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 改一行 | 在 openhive 路由合并处挂 supervisor 的 scoped layer（**加**，不改上游 endpoint） |

**保留键的约定**：`mcp.openhive-governance` 由服务端管理；管理员手工改它会在下次启动被覆盖，文档里写明。

## 5. 身份与沙箱契约

调用方（内核）注入：

```jsonc
"_meta": {
  "openhive/user": "<auth.user.id>",
  "openhive/directory": "<当前实例的项目目录>"
}
```

服务端规则：

1. 两个键缺任一 ⇒ `identity_required`（现有错误码，消息区分缺哪个）。
2. `resolve(directory)` 必须落在 `${workspaceRoot(env)}/${user}/` 之内（`resolve` 规范化后比较，`..` 不能逃逸）⇒ 否则 `source_outside_sandbox`。**不 stat**：安全性质只取决于包含关系；目录不存在时由后续 `skill_file_not_found` 给出更具体的错误，而「必须存在」会把「别人的沙箱目录尚未创建」误判成越界（2026-10-26 实现期与用户确认）。
3. 工具入参 `sourceDirectory` 仍只收**相对路径**，相对 `directory` 解析，且解析后必须仍在 `directory` 内（现有 `resolveSourceDirectory` 语义不变）。

这样「谁能读哪些文件」由服务端独立判定，不依赖内核传来的目录是否可信。

两个传输共用同一套契约：`_meta` 由内核**按调用**注入，与 transport 无关，所以保留的 stdio 入口同样拿到这两个键，两条路径的判据不会分叉。

## 6. 生命周期与失败处理

| 场景 | 行为 |
|---|---|
| MCP 起不来 / 反复崩 | 内核 WARN 日志（`onFailure` → `logWarning`）+ 退避重启；该实例的 MCP 状态为 `failed`，治理工具对模型**不可见**；会话本身照常可用 |
| 子进程就绪但**配置写入失败**（如配置目录只读） | 记 **ERROR** 日志（`readyHandler` → `logError` + `Cause.pretty`；`updateGlobal` 的失败走 defect 通道，所以是 `catchCause` 而不是普通 `catch`，否则监督器纤维整个死掉），首次就绪等待不放行，15s 超时后 WARN 放行、后台继续按退避重试 |
| 就绪行迟迟不来 | 15s 超时视为启动失败，按上一条处理 |
| 内核正常退出 | 先 SIGTERM 子进程，超时再 SIGKILL；不留孤儿（`#010-03`：按进程树收） |
| 端口被占 | 端口用 0（系统分配），不存在占用问题；若显式配置的端口被占，按「起不来」处理 |
| `_meta` 目录越界 | 工具返回 `source_outside_sandbox`，不写任何文件、不落库 |
| 无身份的入口（`bun run dev` 跨源、未登录） | 内核不注入 `_meta` ⇒ 工具返回 `identity_required`；这是既有口径，本次不改 |

## 7. 测试策略

| 层 | 用例 |
|---|---|
| asset-service 单测 | 沙箱校验：用户根内通过 / 越界拒绝 / `..` 逃逸拒绝 / 缺键拒绝；HTTP 传输下三工具可列可调（真端口，127.0.0.1:0） |
| opencode 单测 | supervisor：解析就绪行、退避重启、退出收尾；`userMeta()` 带目录；`Config.updateGlobal` 幂等（连调两次结果相同） |
| 真栈验收 | 起真栈后 `GET /mcp` = `connected`，且 `ps` 中治理进程数为 1；一次真实登记（draft → in_review） |
| 缺口表 | Docker 镜像内实测：**没跑**（本机无镜像，2026-10-26）。部署机验收命令：`docker compose exec openhive sh -lc 'ps -ef \| grep -c "[m]cp-http.ts"'` ⇒ 期望 `1`；`docker compose exec openhive sh -lc 'cat "$XDG_CONFIG_HOME/opencode/opencode.json*"'` ⇒ 期望含 `openhive-governance`。**文件名用 `opencode.json*` 而不是 `opencode.json`**：`globalConfigFile()` 在目录里没有既有配置文件时取 `candidates[0]`，实测落盘是 `opencode.jsonc`（2026-10-26 真栈：`<state>/config/opencode/opencode.jsonc`）。同时记入 `009/state.md` 缺口 |

## 8. 部署要求（写进部署文档，不是运维手工步骤）

| 项 | 值 |
|---|---|
| 镜像 | 基于 bun（或把 entypoint 编译进镜像）；必须包含 `packages/asset-service` 及其依赖 |
| 环境变量 | `PG_*`、`OPENHIVE_ASSETS_ROOT`、`OPENHIVE_WORKSPACE_ROOT`（默认 `/workspaces`）、可选 `OPENHIVE_GOVERNANCE_MCP_PORT` |
| 卷 | `workspaces/`、`assets/`。全局配置目录**不挂卷**（见下一行） |
| `XDG_CONFIG_HOME`（容器） | 必须是**可写目录**（默认 `/root/.config`）；**不需要**挂卷——配置每次启动重建（supervisor 每次 upsert 同一个保留键） |
| 全局配置隔离（重要） | `Config.updateGlobal` 写的是 `Global.Path.config` = `$XDG_CONFIG_HOME/opencode`（`config.ts:140-146` 用模块常量 `Global.Path`，**不受** `OPENCODE_CONFIG_DIR` 影响）。真栈 / 本地联调必须设 `XDG_CONFIG_HOME` 到栈状态目录，否则会污染开发机真实的 `~/.config/opencode/opencode.json`（2026-10-26 实现期实测确认） |
| 命令行 | `OPENHIVE_ASSET_SERVICE_DIR`（asset-service 包目录；不设就不起进程）、可选 `OPENHIVE_GOVERNANCE_MCP=off`、`OPENHIVE_GOVERNANCE_MCP_CMD`（JSON 数组覆盖命令）、`OPENHIVE_GOVERNANCE_MCP_PORT`（固定端口，缺省 0） |
| compose | **不需要**新增服务；MCP 由内核自己拉起 |

## 9. 不做的事

- **业务 MCP 资产的 per-user 下发器**（Q3 定：延后；`buildUserMcpConfig()` 保留不动）。
- 多副本内核共享一个 MCP：每个内核副本各起一个，各连各的 PG 池；规模上来再议。⚠️ 前提是**每个副本各自独立的 `XDG_CONFIG_HOME`**（§8：容器里不挂卷、按需可写）——同一宿主上跑多个内核而无配置目录隔离时，它们会互相覆盖同一份全局配置里的 `mcp.openhive-governance.url`（后写的赢），表现为「连到别人的端口」。
- 删除 stdio 入口。
- 改上游 `packages/opencode/src/mcp/index.ts`（remote 客户端通道已够用）。

## 10. 决策记录

| 问题 | 选择 | 理由 |
|---|---|---|
| 进程模型（Q1） | 同容器独立子进程 | 崩溃隔离有、不用改上游传输层；独立容器要多挂一次 workspaces 卷且路径必须一致 |
| 沙箱口径（Q2） | 内核带目录 + 服务端校验 | 与今天「相对项目目录」语义一致；服务端独立判定，不信任客户端 |
| 本次范围（Q3） | 不含业务 MCP 下发器 | 治理改单进程后不再需要它；今天没有业务 MCP 资产，等有真实需求再写 |
| 配置送达 | A1 `Config.updateGlobal` | 唯一「内核自己拉起 + 不碰上游装配」的组合 |
