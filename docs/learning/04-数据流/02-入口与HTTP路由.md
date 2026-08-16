# 04 · 数据流 · 入口与 HTTP 路由

> 讲「两条链的上半段」：从命令行敲下 `opencode serve`，到 HTTP 请求到达 handler。这一段是理解 opencode 服务端的骨架。

---

## 一、CLI 入口：不是单个 main()，而是 yargs 多命令

入口 `packages/opencode/src/index.ts` 不是传统的一个 `main()` 函数，而是用 **yargs** 组装出一个「多命令」CLI：

- `index.ts:45` 创建 `yargs(args)`
- `index.ts:81-103` 注册所有子命令（`serve`、`run`、`auth` 等，其中 `.command(ServeCommand)` 在 `:93`）
- `index.ts:66-78` 全局 middleware：设置一堆环境变量（`AGENT=1`、`OPENCODE=1`、`OPENCODE_PID` 等）、启动 Heap 监控
- `index.ts:118-142` 解析参数、统一格式化错误、`process.exit()`

> 通俗理解：`opencode` 这个可执行文件本身是个「总开关」，`opencode serve`、`opencode run` 是不同的「档位」。我们要关注的 `serve` 是「跑一个 HTTP 服务器」这一档。

---

## 二、serve 命令：拉起 HTTP 服务

`packages/opencode/src/cli/cmd/serve.ts`：

- `:13` handler 里动态 `import("../../server/server")`
- `:19` 调 `Server.listen(opts)` 启动
- `:20` 打印监听地址
- `:22` `Effect.never` 挂起（让进程一直跑）

---

## 三、服务器组装：一个进程挂两套 API

`packages/opencode/src/server/server.ts` 是服务器的装配中心：

- `:73` `listen()` → `:85` `startWithPortFallback`（先试固定端口，占用则回退随机端口）
- `:100` 关键一行：`HttpRouter.serve(HttpApiApp.createRoutes(opts), {...})` —— 把「路由树」挂到 HTTP 服务器上

**路由树本体**在 `packages/opencode/src/server/routes/instance/httpapi/server.ts`：

- `:271` `createRoutes()` 用 `Layer.mergeAll` 合并了**七类路由**：`rootApiRoutes`、`eventApiRoutes`、`ptyConnectApiRoutes`、`instanceRoutes`、`serverRoutes`、`docRoute`、`uiRoute`

**关键结论**：`opencode serve` 一个进程同时挂了两套 HTTP API 面：

| API 面 | 路径前缀 | 会话层 |
|---|---|---|
| 旧 V2 | `/api/...` | `SessionV2`（`packages/server` 包的 `Api`） |
| 新 instance | `/session/...` | `SessionPrompt`（`packages/opencode` 内部的 `InstanceHttpApi`） |

---

## 四、两条链的 handler（找到对应函数）

### 链 A handler：`packages/server/src/handlers/session.ts:139-171`

- 端点定义在 `packages/protocol/src/groups/session.ts:205-224`：`POST /api/session/:sessionID/prompt`
- handler 里 `:143-150` 调 `session.prompt({ sessionID, id, prompt, delivery, resume })`
- 错误映射：`Session.NotFoundError` → `SessionNotFoundError`（`:152`）、`PromptConflictError` → `ConflictError`（`:160`）

### 链 B handler：`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295-309`

- 端点定义在 `.../groups/session.ts:316-328`：`POST /session/:sessionID/message`
- handler 里 `:300-304` 调 `promptSvc.prompt({ ...payload, sessionID })`，`:306` 用 `HttpServerResponse.stream` 流式返回

---

## 五、三个重要的中间件（请求进入 handler 前要过的关）

链 B（新 instance API）每个请求要经过三道中间件（`groups/session.ts:452-454`）：

### 1. InstanceContextMiddleware —— 建立「实例上下文」
根据 `x-opencode-directory` 请求头，确定这个请求属于哪个目录/实例。

### 2. WorkspaceRoutingMiddleware —— 工作区路由/代理
`middleware/workspace-routing.ts`：
- `:86` `defaultDirectory` 读取 `?directory` 参数或 `x-opencode-directory` 头
- `:148` `planWorkspaceRequest` 判断这个请求该「本地处理」还是「代理到远程」
- `:206` 远程 → `proxyRemote`；`:208` 本地 → 注入 `WorkspaceRouteContext`

> 这正是 `01-学习规划` 里「工作目录」概念在 HTTP 层的落地：**每个请求都先被路由到它所属的 workspace**。

### 3. Authorization —— 鉴权
`middleware/authorization.ts:118`：如果 `ServerAuth.required`，则从 `auth_token` query 或 `Authorization: Basic` 头解析凭证并校验。

---

## 六、小结

```
opencode serve
  → yargs 触发 ServeCommand（cli/cmd/serve.ts）
  → Server.listen → HttpRouter.serve(createRoutes)
  → 七类路由层合并成一个路由树
  → 请求按路径分发到 /api/... 或 /session/...
  → 过中间件（实例上下文 → 工作区路由 → 鉴权）
  → 到达 session handler
  → 调用对应的 session 层（SessionV2 或 SessionPrompt）
```

下一站：`03-session执行机制.md`，看链 A（新 V2）在 handler 之后发生了什么——输入如何被「准入」、如何被「唤醒」执行。
