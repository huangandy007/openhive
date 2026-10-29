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
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
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
import { OpenhiveAssetFavorite } from "@/server/openhive/favorites"
import { OpenhiveAssets } from "@/server/openhive/assets"
import { OpenhiveCategories } from "@/server/openhive/categories"
import { OpenhivePreferences } from "@/server/openhive/preferences"
import { OpenhiveBackup } from "@/server/openhive/backup"
import { OpenhiveFile } from "@/server/openhive/file"
import { OpenhiveGovernanceAccounts } from "@/server/openhive/governance-accounts"
import { OpenhiveGovernanceAssets } from "@/server/openhive/governance-assets"
import { OpenhiveGovernanceAssetGroups } from "@/server/openhive/governance-asset-groups"
import { OpenhiveGovernanceCategories } from "@/server/openhive/governance-categories"
import { OpenhiveGovernanceAudit } from "@/server/openhive/governance-audit"
import { OpenhiveGovernanceDataSource } from "@/server/openhive/governance-data-source"
import { OpenhiveGovernanceMcp } from "@/server/openhive/governance-mcp-supervisor"
import { OpenhiveGovernanceOrg } from "@/server/openhive/governance-org"
import { OpenhiveGovernanceProjects } from "@/server/openhive/governance-projects"
import { OpenhiveGovernanceTemplates } from "@/server/openhive/governance-templates"
import { OpenhiveGovernanceUsage } from "@/server/openhive/governance-usage"
import { OpenhiveMember } from "@/server/openhive/member"
import { OpenhivePg } from "@/server/openhive/pg"
import { OpenhiveProject } from "@/server/openhive/project"
import { OpenhiveProjectAssets } from "@/server/openhive/project-assets"
import { OpenhiveProjectTree } from "@/server/openhive/project-tree"
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
  SessionShare.node,
  InstanceStore.node,
  httpClient,
  EventV2.node,
  ProjectV2.node,
  ProjectCopy.node,
  PtyTicket.node,
])

/**
 * `backupRoutes` 只为测试注入（`openhive-backup.test.ts` 用 `routesWithQuota(TEST_QUOTA)`
 * 把上限压到 1 MiB——10 GiB 的本机造不出来）。生产调用不传，恒为下面这个默认值。
 * 【保留的定制 · 同步上游时不要丢】—— openhive 文件级备份（2026-10-18）。
 */
const defaultBackupRoutes = OpenhiveBackup.routes.pipe(
  Layer.provide(OpenhiveArchive.MinioConfig.layer),
  Layer.provide(AnchorWorkspace.Config.layer),
  Layer.provide(OpenhivePg.layer),
)

export function createRoutes(
  corsOptions?: CorsOptions,
  backupRoutes = defaultBackupRoutes,
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
    // openhive 项目级 skill 启用出口（2026-10-27）：查 / 启用 / 停用。
    // 启用 = 库里一行关系 ＋ 项目目录里一条链接；链接的落点由 `AnchorWorkspace.Config` 的
    // 沙箱根算出（与建项目/归档同一个定义），关系行与成员判定读同一个业务 PG 客户端。
    // `InstanceStore.Service` 由 `app` 组供上（不在本层 provide），路由体用 `serviceOption` 取。
    // 【保留的定制 · 同步上游时不要丢】—— 项目级 skill 启用（2026-10-27）。
    OpenhiveProjectAssets.routes.pipe(
      Layer.provide(AnchorWorkspace.Config.layer),
      Layer.provide(OpenhivePg.layer),
    ),
    // openhive 项目文件树批量取数（2026-10-28）：一次请求交回整棵树。
    // **不供 `OpenhivePg`**（本端点一个库都不查）；`LocationServiceMap` 由外层
    // `locationServiceMapV2` 供上——这里再 provide 一次会建出第二个服务图，
    // 文件系统实例就与 `handlers/file.ts` 不是同一份了。
    // 【保留的定制 · 同步上游时不要丢】—— 项目文件树批量取数（2026-10-28）。
    OpenhiveProjectTree.routes.pipe(Layer.provide(AnchorWorkspace.Config.layer)),
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
      // 2026-10-16 项目删除（006）：删除要删 `/shared/<projectId>.git`（spec §6 ④），
      // 共享根走 `OpenhiveProject.SharedRootConfig`（沙箱根只有一处定义，共享根也只有一处——
      // 复用 `OpenhiveProject` 的同一个 Config 服务，不另造一个）。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（006 删除）。
      Layer.provide(OpenhiveProject.SharedRootConfig.layer),
      // 删除要按项目 id 删 `project_directory` 行（spec §6 ⑦），走 `ProjectDirectories.removeAll`。
      // ⚠️ 它**不是** `app` 组里的顶层成员（`Project.node` / `ProjectCopy.node` 只是把它当 dep 嵌在
      // 自己层内），所以这里**必须**单独供一层——不供就是层构造期 `Service not found`。
      // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（006 删除）。
      Layer.provide(AppNodeBuilderV1.build(ProjectDirectories.node)),
    ),
    // openhive 文件级备份快照（2026-10-18）：备份 / 恢复点 / 预览 / 恢复 / 任务。
    // 配置与归档那条**共用两份服务**（`MinioConfig` / `AnchorWorkspace.Config`），另加
    // `OpenhivePg.layer`（授权要读 `auth.project_member` / `auth.project_archive`）。
    // 默认值见 `defaultBackupRoutes`（只为测试注入留了一个参数）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 文件级备份（2026-10-18）。
    backupRoutes,
    // openhive 文件操作出口（005 T020）：复制 / 移动 / 上传 / 下载（FR-005）。
    // 沙箱根**复用**同一个 `AnchorWorkspace.Config`（沙箱根只有一处定义）——本模块要用它
    // 判「这次请求在不在一个项目里」（`?directory=` 相对沙箱根恰好一层）。
    // ⚠️ 这四个出口**依赖 `projectLocationLayer` 在场**：基准目录取自那个中间件改写的
    // `?directory=`，而它同时也把「已归档 ⇒ 403」那道门套在这四个出口上（门在中间件里，
    // 所以本模块**一个字都不用写**，也就不会漂成两份）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T020）。
    OpenhiveFile.routes.pipe(Layer.provide(AnchorWorkspace.Config.layer)),
    // openhive 账号管理出口（010 T005）：列表 / 详情 / 录入 / 重置 / 停用 / 启用 / 批量停用（FR-004）。
    // 沙箱根与项目出口共用同一个 `AnchorWorkspace.Config`（`provisionUser` 要在这里建目录——
    // 两处漂了就是「账号建在 A、文件树去 B 找」）；业务 PG 与上面几项共用同一个实例
    // （它们读同一批 `auth.user` / `auth.role_resource` 行，理由见 T015 那条）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T005）。
    OpenhiveGovernanceAccounts.routes.pipe(
      Layer.provide(AnchorWorkspace.Config.layer),
      Layer.provide(OpenhivePg.layer),
    ),
    // openhive 组织架构出口（010 T006）：三级树 / 建节点 / 改名 / 删除 / 从账号导入（FR-005）。
    // 只读业务 PG——树没有沙箱目录，改名级联也只改 `auth.user` 的三列文本。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T006）。
    OpenhiveGovernanceOrg.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 资产治理出口（010 T007）：待审列表 / 审核 / 发布 / 上下架 / 归档（FR-006）。
    // 复用 009 的 `listAssets` ＋ `transitionAsset`（状态机与文件迁移不重写）；资产根从
    // `process.env.OPENHIVE_ASSETS_ROOT` 每请求读一次，与 009 的出口同一个约定。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T007）。
    OpenhiveGovernanceAssets.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 业务分类管理出口（需求 4）：列表（含停用）/ 新建 / 改名 / 排序 / 启停，**无删除**。
    // 板块是 `asset-governance`：读要 read、写要 admin；表规则全在 `category-store.ts`。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（需求 4）。
    OpenhiveGovernanceCategories.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 授权组出口（需求 3b，2026-10-27）：列表 / 建组 / 加组员。「指定人员」这一档的
    // 读权只来自授权行，没有组就没有可选的名单；本模块只管组本身，资产的授权行由发布动作写。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（需求 3b）。
    OpenhiveGovernanceAssetGroups.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 使用面资产出口（T017）：「我能用的已发布资产」。与上面那条治理出口**不是一套**：
    // 那条给管理员看全量、进门要板块授权；这条给普通民警，只要登录，且逐条过 009 的
    // `canReadAsset()`（可见性规则只有那一份）。资产根不读——列表不碰磁盘。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产使用面（T017）。
    OpenhiveAssets.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 资产收藏出口（2026-10-29）：`POST /openhive/asset-favorite`。详情页「收藏」。
    // 写操作的唯一入口；可见性判定复用 `canReadAsset()`（收藏不能成为越权读的旁路）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心。
    OpenhiveAssetFavorite.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 账号偏好出口（需求 6，2026-10-27）：中栏「每页条数」跨设备一致。
    // 只供业务 PG（`auth.user_preference`）；值的白名单复用 `paging.ts` 的 `PAGE_SIZES`。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（需求 6）。
    OpenhivePreferences.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 使用面业务分类出口（需求 4，2026-10-27）：左栏分类改由服务端给（管理员可维护），
    // 只回启用项。与资产列表同一条口径：登录即可读，卡在这里等于整页打不开。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（需求 4）。
    OpenhiveCategories.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 数据项目权限出口（010 T008）：全部项目 / 名单 / 兜底撤销成员 / 兜底归档（FR-007）。
    // 授权是治理板块的 `data-project-perm`（**不是** 005 的成员身份 `decide`——管理员按定义不是
    // 项目成员，见该模块文件头）；写动作复用 `removeMember` 与 `archiveProject`。
    // 三份服务与上面几项**同一个实例**：沙箱根（归档要给每个成员算目录，与建项目/归档同一处定义）、
    // MinIO 配置（与归档出口共用同一个 `MinioConfig`，两处漂了就是「一个说配了一个说没配」）、
    // 业务 PG（同一批 `auth.project_member` / `auth.project_archive` 行）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T008）。
    OpenhiveGovernanceProjects.routes.pipe(
      Layer.provide(AnchorWorkspace.Config.layer),
      Layer.provide(OpenhiveArchive.MinioConfig.layer),
      Layer.provide(OpenhivePg.layer),
    ),
    // openhive 用量/成本看板出口（010 T009）：一条只读报表（FR-008）。
    // 数据来自 T004 的分析库；本模块**不取** `AnchorWorkspace.Config`——分析库与每用户 SQLite
    // 的根是 `OPENHIVE_DATA_ROOT`，不是沙箱根（混用会让抽取永远「缺库」且不报错，见该模块文件头）。
    // 只供业务 PG（授权查询 ＋ `auth.user` 名册）；分析库句柄按请求开关，不进层。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T009）。
    OpenhiveGovernanceUsage.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 审计日志检索出口（010 T010b）：一条只读检索（FR-009）。
    // 只供业务 PG（审计表在 `auth` schema）；本模块**不审计自己**——「谁看了审计日志」
    // 若记进同一张表，翻页本身会让 total 一直涨，永远翻不到底（见该模块文件头）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T010b）。
    OpenhiveGovernanceAudit.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 模板库出口（010 T011）：报告模板 / 图谱样式 / 报表口径的列表 / 新建 / 编辑 / 停用（FR-010）。
    // 板块 `template-lib` **只在业务专家手里**（系统管理员模板里没有这一行，见该模块文件头）；
    // 表规则全在 `@opencode-ai/auth/template`，本层只做身份、授权、载荷收窄、错误翻译。
    // 只供业务 PG。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T011）。
    OpenhiveGovernanceTemplates.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 数据源配置出口（010 T012）：注册 / 编辑 / 列表 / 血缘（FR-011）。
    // 板块 `data-source` **只授系统管理员**（业务专家那一行是空的，见该模块文件头）；
    // connector 只留接口（`@opencode-ai/auth/connector`），**没有**「测试连接」这类假按钮。
    // 只供业务 PG。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 治理后台（010 T012）。
    OpenhiveGovernanceDataSource.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 成员管理出口（005 T021）：名单 / 邀请 / 移除 / 退群（FR-004）。
    // 只供一个服务——业务 PG（与上面两项共用**同一个**客户端实例，理由同 T015 那条：
    // 它们读的是同一批 `auth.project_member` / `auth.project_archive` 行）。
    // 沙箱根**不供**：本模块一个文件都不碰（项目身份走查询串 / 请求体，不当路径段用）——
    // 少供一个服务是默认，不是遗漏。
    // ⚠️ 这四个出口**刻意不带 `x-openhive-project`**：带了就会被 `projectLocationLayer`
    // 套上「已归档 ⇒ 403」，而名单要的恰恰是「归档 ≠ 看不见」——决定「冻不冻」的判据
    // 因此只留 `decide` 一处（见该模块文件头）。
    // 【保留的定制 · 同步上游时不要丢】—— openhive 项目管理（005 T021）。
    OpenhiveMember.routes.pipe(Layer.provide(OpenhivePg.layer)),
    // openhive 治理 MCP 监督器（2026-10-26）：内核启动时拉起**一份**本地治理 MCP
    //（127.0.0.1，系统分配端口），把 `mcp.openhive-governance` 写进全局配置。
    // 只在这里挂一次；spawn / 退避重启 / 收尾都在它自己的作用域里。
    // 没设 `OPENHIVE_ASSET_SERVICE_DIR` 就是无操作（dev / 单测默认不起进程）。
    // 【保留的定制 · 同步上游时不要丢】—— 治理 MCP 单进程形态。
    OpenhiveGovernanceMcp.layer,
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
