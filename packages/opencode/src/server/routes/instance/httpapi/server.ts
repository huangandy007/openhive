import { Config as EffectConfig, Context, Effect, Layer } from "effect"
import { HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import { HttpClient, HttpMiddleware, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as Observability from "@opencode-ai/core/observability"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Workspace } from "@/control-plane/workspace"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { Git } from "@/git"
import { Installation } from "@/installation"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { PluginPtyEnvironment } from "@/plugin/pty-environment"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { SessionCompaction } from "@/session/compaction"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Worktree } from "@/worktree"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Npm } from "@opencode-ai/core/npm"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import * as SessionExecutionLocal from "@opencode-ai/core/session/execution/local"
import { lazy } from "@/util/lazy"
import { CorsConfig, isAllowedCorsOrigin, type CorsOptions } from "@opencode-ai/server/cors"
import { serveUIEffect } from "@/server/shared/ui"
import { ServerAuth } from "@/server/auth"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { Api } from "@opencode-ai/server/api"
import { PublicApi } from "./public"
import {
  authorizationLayer,
  authorizationRouterMiddleware,
  ptyConnectAuthorizationLayer,
  serverAuthorizationLayer,
} from "./middleware/authorization"
import { EventApi } from "./groups/event"
import { PtyConnectApi } from "./groups/pty"
import { eventHandlers } from "./handlers/event"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { controlPlaneHandlers } from "./handlers/control-plane"
import { experimentalHandlers } from "./handlers/experimental"
import { fileHandlers } from "./handlers/file"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { mcpHandlers } from "./handlers/mcp"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { projectCopyHandlers } from "./handlers/project-copy"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectHandlers, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { sessionHandlers } from "./handlers/session"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { handlers } from "@opencode-ai/server/handlers"
import { buildLocationServiceMap, LocationServiceMap } from "@opencode-ai/core/location-services"
import { layer as locationLayer } from "@opencode-ai/server/location"
import { sessionLocationLayer } from "@opencode-ai/server/middleware/session-location"
import { PtyEnvironment } from "@opencode-ai/server/pty-environment"
import { schemaErrorLayer as v2SchemaErrorLayer } from "@opencode-ai/server/middleware/schema-error"
import { workspaceHandlers } from "./handlers/workspace"
import { instanceContextLayer } from "./middleware/instance-context"
import { workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { compressionLayer } from "./middleware/compression"
import { corsVaryFix } from "./middleware/cors-vary"
import { errorLayer } from "./middleware/error"
import { fenceLayer } from "./middleware/fence"
import { schemaErrorLayer } from "./middleware/schema-error"
import { userIdentityLayer } from "./middleware/user-identity"
import {
  apiQuotaLayer,
  QuotaConfig as SessionQuotaConfig,
  uiQuotaLayer,
} from "./middleware/session-quota"
import { AnchorWorkspace, anchorWorkspaceLayer } from "./middleware/anchor-workspace"
import { projectLocationLayer } from "./middleware/project-location"

import { AuthGateway } from "@/server/openhive/gateway"
import { OpenhiveArchive } from "@/server/openhive/archive"
import { OpenhiveFile } from "@/server/openhive/file"
import { OpenhivePg } from "@/server/openhive/pg"
import { OpenhiveProject } from "@/server/openhive/project"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { UserIdentity } from "@/server/user-identity"

export const context = Context.makeUnsafe<unknown>(new Map())

const cors = (corsOptions?: CorsOptions) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, corsOptions),
      maxAge: 86_400,
    }),
    { global: true },
  )

// Route tree:
// - rootApiRoutes: typed /global/* and control routes; auth is declared by RootHttpApi.
// - eventApiRoutes: typed SSE route with instance routing context and its existing API contract.
// - ptyConnectApiRoutes: typed WebSocket upgrade route with ticket-aware auth.
// - instanceApiRoutes: remaining typed instance routes.
// - uiRoute: raw catch-all fallback; auth is router middleware so public static assets can bypass it.
const authOnlyRouterLayer = authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.layer))
const httpApiAuthLayer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.layer))
const ptyConnectHttpApiAuthLayer = ptyConnectAuthorizationLayer.pipe(Layer.provide(ServerAuth.Config.layer))
const serverHttpApiAuthLayer = serverAuthorizationLayer.pipe(Layer.provide(ServerAuth.Config.layer))
const workspaceRoutingLive = workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(
  Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
  Layer.provide(schemaErrorLayer),
  Layer.provide(httpApiAuthLayer),
)
const eventApiRoutes = HttpApiBuilder.layer(EventApi).pipe(
  Layer.provide(eventHandlers),
  Layer.provide([httpApiAuthLayer, workspaceRoutingLive, instanceContextLayer]),
)
const ptyConnectApiRoutes = HttpApiBuilder.layer(PtyConnectApi).pipe(
  Layer.provide(ptyConnectHandlers),
  Layer.provide([ptyConnectHttpApiAuthLayer, workspaceRoutingLive, instanceContextLayer]),
)
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers,
    instanceHandlers,
    mcpHandlers,
    projectHandlers,
    projectCopyHandlers,
    ptyHandlers,
    questionHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    syncHandlers,
    tuiHandlers,
    workspaceHandlers,
  ]),
)

const instanceRoutes = instanceApiRoutes.pipe(
  Layer.provide([
    httpApiAuthLayer,
    workspaceRoutingLive,
    instanceContextLayer,
    // A 链（UI）的配额守卫（003 T010）。它挂在 `groups/session.ts` 的 `promptAsync` 端点上
    // （端点级，才在实例上下文之内）；这里只负责**把层供上**。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T010）。
    uiQuotaLayer.pipe(Layer.provide(SessionQuotaConfig.layer)),
    schemaErrorLayer,
  ]),
)
const serverRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(handlers),
  Layer.provide(PluginPtyEnvironment.layer),
  Layer.provide([serverHttpApiAuthLayer, v2SchemaErrorLayer]),
)

// `OpenApi.fromApi` is non-trivial; defer until /doc is actually hit so
// processes that never serve it (CLI, scripts) don't pay at module load.
// `HttpServerResponse.jsonUnsafe` runs JSON.stringify eagerly, so caching
// the response also caches the serialized body — every /doc request reuses
// the same Uint8Array instead of re-stringifying the spec.
const docResponse = lazy(() => HttpServerResponse.jsonUnsafe(OpenApi.fromApi(PublicApi)))

const docRoute = HttpRouter.use((router) => router.add("GET", "/doc", () => Effect.succeed(docResponse()))).pipe(
  Layer.provide(authOnlyRouterLayer),
)

// openhive 网关的登录面（003 T014）。开关关着时这个层**什么都不注册**（登录路径 404），
// 开着时才要求 `AUTH_JWT_SECRET`（`AuthGateway.routes` 构造期调 `jwtSecret`）。
// 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T014）。
const authGatewayRoutes = AuthGateway.routes.pipe(Layer.provide(UserIdentity.Config.layer))

const uiRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const client = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    yield* router.add("*", "/*", (request) =>
      serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
    )
  }),
).pipe(Layer.provide(authOnlyRouterLayer))

type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>

const app = LayerNode.group([
  Npm.node,
  FSUtil.node,
  Database.node,
  Auth.node,
  Account.node,
  Config.node,
  Env.node,
  Git.node,
  Ripgrep.node,
  Storage.node,
  Snapshot.node,
  Plugin.node,
  ModelsDev.node,
  Provider.node,
  ProviderAuth.node,
  Agent.node,
  Skill.node,
  Discovery.node,
  Question.node,
  Permission.node,
  PermissionSaved.node,
  Todo.node,
  Session.node,
  SessionProjector.node,
  SessionStatus.node,
  BackgroundJob.node,
  RuntimeFlags.node,
  EventV2Bridge.node,
  SessionRunState.node,
  SessionProcessor.node,
  SessionCompaction.node,
  SessionRevert.node,
  SessionSummary.node,
  SessionPrompt.node,
  Instruction.node,
  LLM.node,
  LSP.node,
  MCP.node,
  McpAuth.node,
  Command.node,
  Truncate.node,
  ToolRegistry.node,
  Format.node,
  Project.node,
  Vcs.node,
  Workspace.node,
  Worktree.node,
  Installation.node,
  ShareNext.node,
  SessionShare.node,
  InstanceStore.node,
  httpClient,
  EventV2.node,
  ProjectV2.node,
  ProjectCopy.node,
  PtyTicket.node,
])

export function createRoutes(
  corsOptions?: CorsOptions,
): Layer.Layer<never, EffectConfig.ConfigError, RouteRequirements> {
  const locationServiceMapV2 = buildLocationServiceMap()

  return Layer.mergeAll(
    rootApiRoutes,
    eventApiRoutes,
    ptyConnectApiRoutes,
    instanceRoutes,
    serverRoutes,
    docRoute,
    uiRoute,
    authGatewayRoutes,
    // openhive 项目出口（005 T018）：建项目 / 列项目。
    // **唯一**不可避免的侵入——新增出口不可能不上挂（fork 的新文件本身不与上游冲突，
    // 冲突面只有这一行）。不改上游 `api.ts` 的 endpoint 定义；`AnchorWorkspace.Config`
    // 用与上一项同一个（沙箱根只有一处定义）。
    // 第二个是共享仓库根——**本层自己的配置服务，必须在这里供上**：路由体在层构造期
    // `yield* SharedRootConfig`，漏供是**层构造期炸**（`Service not found`），不是静默回退。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T018）。
    OpenhiveProject.routes.pipe(
      Layer.provide(OpenhiveProject.SharedRootConfig.layer),
      Layer.provide(AnchorWorkspace.Config.layer),
      // 业务 PG 客户端（005 T015）：这三个消费方（建/列项目、归档/找回、中间件那道「已归档」
      // 的门）**必须拿到同一个实例**——它们都读 `auth.project_archive`，两个客户端跑同一句
      // SQL 文本会在 PGlite 夹具上撞 `42P05`（理由与取舍见 `@/server/openhive/pg` 文件头）。
      // `OpenhivePg.layer` 是**同一个模块级值**，三处 provide 同一对象 ⇒ 层记忆化只建一次。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T015）。
      Layer.provide(OpenhivePg.layer),
    ),
    // openhive 归档出口（005 T013）：项目归档（上传 MinIO ＋ 删沙箱 ＋ 标记）。
    // 沙箱根**复用**上一项同一个 `AnchorWorkspace.Config`（沙箱根只有一处定义，两处漂了就是
    // 「建到 A、归档时去 B 找」）；`MinioConfig` 是本层自己的配置服务，同样必须在这里供上
    // （路由体在层构造期 `yield*`，漏供是**层构造期炸**）。它是 `Option`：没配 MinIO 的应用
    // 照常起得来，只是归档回 503（见该模块文件头）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T013）。
    OpenhiveArchive.routes.pipe(
      Layer.provide(OpenhiveArchive.MinioConfig.layer),
      Layer.provide(AnchorWorkspace.Config.layer),
      // 与建/列项目**共用同一个**业务 PG 客户端（005 T015，理由见上面那一项）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T015）。
      Layer.provide(OpenhivePg.layer),
    ),
    // openhive 文件操作出口（005 T020）：复制 / 移动 / 上传 / 下载（FR-005）。
    // 沙箱根**复用**同一个 `AnchorWorkspace.Config`（沙箱根只有一处定义）——本模块要用它
    // 判「这次请求在不在一个项目里」（`?directory=` 相对沙箱根恰好一层）。
    // ⚠️ 这四个出口**依赖 `projectLocationLayer` 在场**：基准目录取自那个中间件改写的
    // `?directory=`，而它同时也把「已归档 ⇒ 403」那道门套在这四个出口上（门在中间件里，
    // 所以本模块**一个字都不用写**，也就不会漂成两份）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T020）。
    OpenhiveFile.routes.pipe(Layer.provide(AnchorWorkspace.Config.layer)),
  ).pipe(
    Layer.provide([
      errorLayer,
      compressionLayer,
      corsVaryFix,
      fenceLayer,
      // openhive 网关（003 T014）：**必须排在身份门之前**——它干的是「剥掉客户端自带的
      // `X-User-ID`、按验签过的 Cookie 覆盖注入」，排到门后面等于门先看到客户端自己填的头
      // （剥离注入测试守着这个次序；它是全局中间件，与身份门同层，次序即数组次序）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T014）。
      AuthGateway.layer.pipe(Layer.provide(UserIdentity.Config.layer)),
      // openhive 身份门（002 T018）：全局中间件，装在合并路由之上，故只有这一处接线。
      // 默认关（`OPENHIVE_REQUIRE_USER_ID` 未设即直通），开关与信任模型见 `@/server/user-identity`。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T005）。
      // 身份门除身份外还每请求注入「取连接钩子」，钩子的依赖在这里满足。
      // 没有它：门会在层构造期直接炸（缺 `DatabaseRouter.Service`），不会静默回退。
      userIdentityLayer.pipe(Layer.provide(UserIdentity.Config.layer), Layer.provide(DatabaseRouter.layer())),
      // 工作目录强制锚定（003 T006）：**必须排在身份门之后**——它靠身份门放进去的 `User`
      // 决定锚到谁的沙箱，排在前面就抓不到 User、整道锚定静默直通（测试守着这个次序）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T006）。
      anchorWorkspaceLayer.pipe(Layer.provide(AnchorWorkspace.Config.layer)),
      // 「当前项目」的落地口径（005 T017）：**必须排在锚定之后**——它在**沙箱根里面**再进一层，
      // 排在前面就会被锚定原样覆盖掉（锚定把三处目录入参全改成沙箱根）。
      // 与锚定共用同一个 `AnchorWorkspace.Config`（沙箱根只有一处定义，别在这里再定义一个）。
      // 次序与理由见 `middleware/project-location.ts` 文件头「为什么挂在锚定之后」。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T017）。
      // T015 起它还要一个业务 PG 客户端（「已归档 ⇒ 拒」那道门要读 `auth.project_archive`）——
      // 与建/列项目、归档/找回**共用同一个**（同上，否则夹具上撞 `42P05`）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T015）。
      projectLocationLayer.pipe(
        Layer.provide(AnchorWorkspace.Config.layer),
        Layer.provide(OpenhivePg.layer),
      ),
      // B 链（CLI serve / sdk-next）的配额守卫（003 T010）。**必须挂在这一层**：
      // 它的活跃集合来自 `SessionV2.active`（进程级）与按用户路由的 `Database`，
      // 两者在这个 provide 链的外层可用；A 链那条读不到实例作用域的 `SessionStatus`，
      // 所以两条链是**两次挂载、一个判定模块**（实测依据见 `middleware/session-quota.ts` 文件头）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 多租户隔离（003 T010）。
      apiQuotaLayer.pipe(Layer.provide(SessionQuotaConfig.layer)),
      cors(corsOptions),
      AppNodeBuilderV1.build(MoveSession.node, [[LocationServiceMap.node, locationServiceMapV2]]),
      HttpServer.layerServices,
    ]),
    Layer.provide(Layer.succeed(CorsConfig)(corsOptions)),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(PtyEnvironment.layer),
    Layer.provide(
      AppNodeBuilderV1.build(SessionV2.node, [
        [LocationServiceMap.node, locationServiceMapV2],
        [SessionExecution.node, SessionExecutionLocal.node],
      ]),
    ),
    Layer.provide(locationServiceMapV2),

    Layer.provide(AppNodeBuilderV1.build(app)),
    // Must stay last: layers provided later in this pipe build beneath earlier ones,
    // so Observability must come after every service graph. Otherwise eagerly forked
    // fibers (e.g. the ModelsDev background refresh) capture Effect's default stdout
    // logger and corrupt the TUI (#34730).
    Layer.provideMerge(Observability.layer),
  )
}

export const routes = createRoutes()

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as HttpApiApp from "./server"
