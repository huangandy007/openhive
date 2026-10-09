export * as AnchorWorkspace from "./anchor-workspace"

import { WORKSPACE_ROOT_ENV, workspaceRoot } from "@opencode-ai/auth/workspace"
import { User } from "@opencode-ai/core/user"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig, Effect, Option } from "effect"
import { Headers, HttpMethod, HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { join } from "node:path"
import { MatchedRoute } from "./matched-route"

/**
 * 工作目录**强制锚定**（003 T006，FR-005）。
 *
 * 内核里「当前工作目录」的每一处最终都来自**请求**：`planRequest` 的
 * `defaultDirectory()` 读 `?directory=` 与 `x-opencode-directory`，旧版
 * `@opencode-ai/server/location` 的 `ref()` 另读 `location[directory]`。
 * 也就是说，**目录是客户端说了算的**——一个够得着端口的人传 `?directory=/` 就能把
 * 文件 / pty / 会话的落点搬到沙箱外面去。
 *
 * 本中间件把客户端能报目录的地方**全部改写**成 `{沙箱根}/{userId}`，客户端传什么都无效。
 * 出口是「伪造 directory 被忽略，落沙箱根」。
 *
 * ## 第四个入参：**请求体**（审查 R-01 补，2026-10-02）
 *
 * 上面那句原本写的是「这三个入参」，把入参清点成「URL 与头」就收工了——**漏了从请求体读的那条**。
 * v2 的 `POST /api/session`（`v2.session.create`）把会话落点放在**请求体** `payload.location.directory`
 * 里（`packages/protocol/src/groups/session.ts`），handler 直接读 `ctx.payload.location`
 * （`packages/server/src/handlers/session.ts` 的 `session.create`）。这个端点**挂在生产路由树上**
 * （`server.ts` 的 `serverRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))`，
 * 而 `Api` 由 `makeDefaultApi` → `.add(makeSessionGroup(...))` 组成），所以只改 URL 与头的话，
 * 一个已登录用户 `POST {"location":{"directory":"C:/Windows"}}` 就能把会话落在沙箱之外。
 *
 * 请求体**改不动**——`HttpServerRequest.modify` 只管 `url` / `headers` / `remoteAddress`，
 * 没有 `body`。所以这条路只能**读体重建**：读出 JSON、把落点改写掉、换一个新请求进上下文。
 *
 * **为什么不做成「拦下带外目录的请求」**：那会让「客户端报的目录一律无效」变成「报错」，
 * 与 URL 那条的语义（静默改写）不一致，而且会误伤那些只是把当前目录原样回传的正常客户端。
 *
 * **为什么只重建这一类请求**：只在**下游会当 JSON 解**的请求上读体（方法见 `HttpMethod.hasBody`、
 * 媒体类型见 `isJsonRequest`——两处都**镜像** `HttpApiBuilder` 自己的判据，不是另写一份近似），
 * 其余请求**一次都不碰**。读了就必须重建（原体的流已经被消费掉），所以 `replaceBody` 是
 * 无条件调的；但「没改任何东西」时重建用的是**原样的文本**，行为等价。
 *
 * ⚠️ **入参清单是清过的**（别只修当下这一个点）：全仓 payload schema 里带目录的只有这一处——
 * `groups/session.ts` 的 `SessionsDirectoryQuery` / `SessionsQuery` 与 `groups/location.ts` 的
 * `LocationQuery` 都是 **query**，已由上面 `?directory=` 那条覆盖。再出新的，按本段补。
 *
 * ## 为什么是「改写请求」而不是「改解析函数」
 *
 * 两条解析链（v2 的 `workspace-routing.ts`、旧版 `location.ts`）是上游高频文件，
 * 改它们等于每次同步都冲突（宪法 §I）。而它们**都从同一个 `HttpServerRequest` 读**——
 * 在请求进路由树之前把它换掉，两条链同时被锚定，上游一行不动（§V 侵入是「加」不是「改」）。
 *
 * ## 为什么「没有 User 就直通」
 *
 * 身份门默认关着，此时上下文里**没有** `User`（不是空身份，是没有）。若锚定无条件生效，
 * 等于把一个没有身份的系统整体搬到 `{根}/{undefined}` 下面——那比它要堵的洞更像事故。
 * 判据是「**谁在跑**」而不是「有没有」：有身份才锚，与 T004 的裁定一致。
 *
 * ## 为什么非法 id 必须拒（审查 R-05，2026-10-02）
 *
 * 锚定那行是 `join(config.root, user.value.id)`——`id` 被直接当成一个**路径段**。
 * 它正常是 `auth.user.id`（002 用 `crypto.randomUUID()` 铸的 UUID），但**没有任何类型或校验
 * 把这条写死**：`User.Info.id` 是 `string`，`verifyToken` 只查 `typeof sub === "string"`。
 * 「id 是 UUID」于是靠的是**另一个模块的实现细节**，不是本边界自己能保证的事。
 *
 * 而拼错的后果不是错一格：`join(root, "../bob")` 落在根的**外面**，
 * `join(root, "")` / `join(root, ".")` 让沙箱**塌成根自己**——所有用户共用一个目录，隔离整个失效。
 *
 * 判据本来就有，且不止一处（`core/database/router.ts` 的 `userDatabasePath`、
 * `auth/workspace.ts` 的 `assertSafeUserId`），偏偏**锚定这一处漏了**——
 * 正是 `LEARNINGS #002-01` 的形状：同一维度上别只修当下这一个点。
 * 现在判据本体在 `User.isSafePathSegment`（core），core 与 opencode 侧共用那一份。
 *
 * 修法取**拒**（fail closed），不取「不锚定」：不锚定 = 客户端那个伪造的 `directory` 直接生效，
 * 那正是本中间件存在的理由。与 T011 磁盘配额对「量不出来」的选择同源——
 * **门看着还在、其实没有**是最坏的一种（`LEARNINGS #002-02`）。
 *
 * ⚠️ **射程据实**：这条**今天打不到**（拿不到密钥就签不出这样的令牌，系统自己签发的那条路只铸
 * UUID）。它守的是**边界不依赖别人家的实现细节**，不是「已经能被利用」。
 *
 * ## 残留（已知，不假装已闭合）
 *
 * `planRequest` 是 `session?.directory || defaultDirectory(...)`——**会话行里的 directory 优先于
 * 请求**。所以「锚定上线**之前**就已存在的会话」仍会解析到它当年记下的目录。T005 的每用户
 * 数据库把**跨用户**那一半关掉了（`Session.Service.get` 只读自己的库），**同一用户的历史会话**
 * 那一半不闭合，登记在 `state.md`。
 */
export class Config extends ConfigService.Service<Config>()("@opencode/OpenhiveWorkspaceAnchorConfig", {
  /**
   * 沙箱根。默认取 `workspaceRoot({})` 而不是另写一个 `"/workspaces"`——
   * 那个默认值只有一处定义（design-v2 §5.3），两边各写一份就会在改默认时漏掉一边。
   *
   * ## 解析出来的值一律过 `WorkspaceRoot.canonicalRoot`（2026-10-09，缺陷：左栏「看不到会话」）
   *
   * **实测的根因**（`test/server/openhive-project.test.ts` 那条用例，修前）：
   *
   * ```
   * 期望（项目清单给的 directory）C:\Users\ADMINI~1\AppData\Local\Temp\openhive-project-bTlaxp\workspaces\55e8…\55f3…
   * 实得（GET /path ＝ 实例层目录）  C:\Users\Administrator\AppData\Local\Temp\openhive-project-bTlaxp\workspaces\55e8…\55f3…
   * ```
   *
   * 同一个物理目录、两种写法。两侧各说各的：
   *
   * - **存储侧**：本文件算出的沙箱（＝ `join(config.root, userId)`）：`project-location.ts` 的
   *   `projectDirectory(config.root, …)` 原样写进请求 ⇒ `core/src/session.ts` 原样落库
   *   （`directory: input.location.directory`）——**不过 `resolve`**；
   * - **过滤侧**：`?directory=` 由实例层解析成 `InstanceState.directory`，
   *   而 `InstanceStore` 把它交给 `FSUtil.resolve`（`project/instance-store.ts`）——
   *   后者在 win32 上会把 8.3 短名展开（`ADMINI~1` → `Administrator`）。
   *
   * 两侧要相等，`projectDirectory(config.root, …)` 就必须是 `FSUtil.resolve` 的**不动点**。
   * 根不规范（win32 短名 / 根是符号链接）时这个前提当场破功，而**红的是别人**：请求被改写成
   * 「短名版」、落库也是短名版，实例层一解析变成「长名版」⇒ `GET /session?directory=…` 一行都
   * 选不出来（左栏空、右栏没反应），**不报错、不变红**。
   *
   * 修在**根**这一处，而不是改写 `projectDirectory` 或存储侧（那两处各有一个更硬的原因）：
   * ① `projectDirectory`（`auth/workspace.ts`）是**纯拼接**，文件头写明了「保持**纯**」；
   * ② 项目清单给的这个串还是**前端的缓存键**（`ensureDirSyncContext(目录)`）与
   *   `event-reducer.ts` 的 `directory` 判据——只改存储侧会让「清单给的串」与
   *   「落库的串」再分一次叉。根只有一处，五个消费者（锚定 / 项目落点 / 清单 / 建项目 /
   *   文件出口）全从它派生。
   *
   * ## 为什么函数本体搬到了 core（2026-10-09 当天第二步）
   *
   * 同一个缺陷在**另一个方向**上还有一份：`core/quota/disk-quota.ts` 的 `sandboxOf` 拿
   * `workspaceRoot(env)`（**原样** env 值，本机是短名）去和写入目标（实例层解析后的长名）比
   * 字面串 ⇒ `relative(短名根, 长名目标)` 是 `..` 开头 ⇒ 判成「沙箱外」⇒ 磁盘配额这道门
   * **静默放行**（探针实测：同一次写入、同一份阈值，短名根「放行」、长名根「拒写」）。
   *
   * 两份实现就是两个投影，一处改了另一处不会红（`LEARNINGS #004-02`）——所以归一化下沉到
   * `@opencode-ai/core/workspace-root`，**两边共用一份**：本文件在配置解析时过一次
   * （消费者是「沙箱落点」这一族），`sandboxOf` 在判归属时过一次（消费者是磁盘配额那道门）。
   * 那边的文件头写着它与 `FSUtil.resolve` 的两处差别、以及为什么不 import `fs-util`（会成环）。
   */
  root: EffectConfig.string(WORKSPACE_ROOT_ENV).pipe(
    EffectConfig.withDefault(workspaceRoot({})),
    EffectConfig.map(WorkspaceRoot.canonicalRoot),
  ),
}) {}

export const anchorWorkspaceLayer = HttpRouter.middleware<{ requires: Config; handles: unknown }>()(
  Effect.gen(function* () {
    const config = yield* Config

    return (effect) =>
      Effect.gen(function* () {
        const user = yield* Effect.serviceOption(User.Service)
        if (Option.isNone(user)) return yield* effect

        // 非法 id ⇒ **拒**，不放行也不锚（审查 R-05，理由见文件头「为什么非法 id 必须拒」）。
        if (!User.isSafePathSegment(user.value.id))
          throw new Error(`非法用户 id，拒绝锚定工作目录：${JSON.stringify(user.value.id)}`)

        const request = yield* HttpServerRequest.HttpServerRequest
        const sandbox = join(config.root, user.value.id)
        const anchored = anchor(request, sandbox)

        return yield* Effect.provideService(
          effect,
          HttpServerRequest.HttpServerRequest,
          yield* anchorBody(anchored, sandbox, yield* MatchedRoute.current),
        )
      })
  }),
).layer

/**
 * 把请求里的目录入参一律改写成 `sandbox`。
 *
 * 三处都要改，因为它们**不是同一条读法**：`?directory=` 是 v2 的，`location[directory]` 是旧版的，
 * 头是两条链共用的兜底。只改一处 = 留一条明路。
 *
 * `?workspace=` 一并删掉：它同样由客户端给，而 `planRequest` 会用工作区自己的 `target.directory`
 * **完全绕过** `defaultDirectory`——留着它，上面三处改写等于白改。删而不是替换，是因为
 * 「一人一工作区」（T004 裁定）下没有第二个工作区 id 可以填。
 * 它还能把请求 **proxy 到 Remote target**（`proxyRemote`），所以是转发开关、不只是换目录。
 *
 * ⚠️ **这一行是承重的，有测试守着**（`test/server/anchor-workspace.test.ts` 最后一条），
 * 且**做过变异验证**：去掉它之后只有那条用例红（500 而非 200）。别当无用代码删。
 */
function anchor(request: HttpServerRequest.HttpServerRequest, sandbox: string) {
  const url = new URL(request.url, "http://localhost")
  url.searchParams.set("directory", sandbox)
  url.searchParams.set("location[directory]", sandbox)
  url.searchParams.delete("workspace")

  return request.modify({
    url: `${url.pathname}${url.search}`,
    headers: Headers.set(request.headers, "x-opencode-directory", sandbox),
  })
}

/**
 * 这个请求会不会被下游**当成 JSON 解**。
 *
 * ⚠️ **这是镜像，不是近似**（复查 2026-10-02）：`HttpApiBuilder` 选解码器用的是
 * `getRequestContentType` / `getRequestMediaType`（effect 4.0.0-beta.83）——
 * **缺头或空串 ⇒ 当 `application/json`**，有头才 `toLowerCase().trim()` 再在 `;` 处切媒体类型。
 * 原先这里写的是 `(headers["content-type"] ?? "").includes("application/json")`，
 * 两条判据不一致 ⇒ 客户端**不发 `Content-Type`** 或写 `APPLICATION/JSON; charset=utf-8`
 * 就能跳过体改写，而下游照样按 JSON 解 —— R-01 那个洞换个入口原样复现。
 *
 * 判据错位的代价与 `LEARNINGS #002-06` 同源：**两处各写一份「同一个判断」，谁也不知道谁**。
 * 所以这里逐字对着上面那两个函数的行为写；上游改了，这条要跟着改
 * （守着它的用例在 `test/server/anchor-workspace.test.ts` 的 R-01 组：不带头 / 大写带参数两条）。
 */
function isJsonRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const header = request.headers["content-type"]
  const contentType = header ? header.toLowerCase().trim() : "application/json"
  const separator = contentType.indexOf(";")
  return (separator === -1 ? contentType : contentType.slice(0, separator).trim()) === "application/json"
}

/**
 * 请求体里的落点（`payload.location.directory`，另兼容顶层 `directory`）一并改写成 `sandbox`。
 *
 * 见文件顶部「第四个入参」。要点：**读了体就必须重建**（原体的流已被消费），
 * 所以「没改」时也走 `replaceBody`，只是文本原样传回去。
 *
 * 方法集合同样**镜像下游的 `HttpMethod.hasBody`**（除 `GET` / `HEAD` / `OPTIONS` / `TRACE` 之外
 * 都算带体），不自己再列一份 `POST/PUT/PATCH` 清单——清单少一个方法，那个方法就绕过去了，
 * 而它不会报错、不会变红。
 */
function anchorBody(
  request: HttpServerRequest.HttpServerRequest,
  sandbox: string,
  route: MatchedRoute.Route | undefined,
): Effect.Effect<HttpServerRequest.HttpServerRequest> {
  if (!HttpMethod.hasBody(request.method)) return Effect.succeed(request)
  if (!isJsonRequest(request)) return Effect.succeed(request)

  return request.text.pipe(
    // 读不出来（例如声明了 JSON 却是空体）就原样放行，让下游按它自己的方式报错——
    // 这里不该替它决定成功还是失败。
    Effect.orElseSucceed(() => undefined),
    Effect.map((text) => {
      if (text === undefined) return request
      const parsed = parseJsonObject(text)
      const rewritten = parsed && withSandboxDirectory(parsed, sandbox, needsLocation(request, route))
      return replaceBody(request, rewritten ? JSON.stringify(rewritten) : text)
    }),
  )
}

/**
 * 落点**可以省略**、省了就落到内核进程 cwd 的那个端点——必须替它补上沙箱，不能"什么都不做"。
 *
 * 省与伪造是同一个洞的两种填法：`payload.location` 是 optional，省略时
 * `packages/server/src/handlers/session.ts` 的 `session.create` 兜底成
 * `AbsolutePath.make(process.cwd())`，那是**内核进程的**目录，不是该用户的沙箱。
 *
 * 判据是路径 + 方法，不是"看体里有没有 location"——客户端**一个字段都不发**时也得补。
 * 全仓 `packages/server/src/handlers` 与 `middleware` 里 `process.cwd()` 只此一处
 * （grep 过），所以这里只列这一个；再出新的，按本段补。
 *
 * ⚠️ **路径取自路由匹配结果**（`MatchedRoute`），不是 `new URL(request.url).pathname`：
 * 后者是**请求原文**，而 `/api/session/`、`/api//session`、`/API/SESSION`、`/api/%73ession`
 * 这些写法对匹配器是同一个端点，对字面比对却不是——一个尾斜杠就够让「补 location」这一半
 * 静默失效，体里没有 `location` 时 handler 就兜底到 `process.cwd()`。理由与全貌见
 * `middleware/matched-route.ts`。
 */
function needsLocation(request: HttpServerRequest.HttpServerRequest, route: MatchedRoute.Route | undefined): boolean {
  return request.method === "POST" && route?.path === SESSION_CREATE_ROUTE
}

/** 建会话端点（`packages/protocol/src/groups/session.ts` 的 `session.create`）。 */
const SESSION_CREATE_ROUTE = "/api/session"

/** 是不是一个 JSON 对象（不是 null、数组、标量）。用谓词而不是 `as`——`as` 会被 lint 门拦下。 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** 只认 JSON 对象；数组、标量、解析失败一律 `undefined`（= 没什么可改的）。 */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 把体里所有客户端可报的目录键改成 `sandbox`；**一个都没改到就返回 `undefined`**
 * （调用方据此知道"不必重建内容"）。
 *
 * `mustCarryLocation`（见 `needsLocation`）：该端点的落点字段可以省略、省了就落进程 cwd，
 * 所以**没有也得补一个**。它为真的端点只有一个。
 */
function withSandboxDirectory(
  body: Record<string, unknown>,
  sandbox: string,
  mustCarryLocation: boolean,
): Record<string, unknown> | undefined {
  const next = { ...body }
  let changed = false

  const location = body["location"]
  if (isRecord(location)) {
    const fields = location
    if (fields["directory"] !== sandbox && (typeof fields["directory"] === "string" || mustCarryLocation)) {
      next["location"] = { ...fields, directory: sandbox }
      changed = true
    }
  } else if (mustCarryLocation) {
    next["location"] = { directory: sandbox }
    changed = true
  }

  if (typeof body["directory"] === "string" && body["directory"] !== sandbox) {
    next["directory"] = sandbox
    changed = true
  }

  return changed ? next : undefined
}

/**
 * 换一个请求进上下文。`fromWeb` 只丢 `remoteAddress`，补回来。
 *
 * `content-length` 必须删：改写后的 JSON 多半换了长度，留着头就是给下游/代理一个假数，
 * 而 `new Request(..., { body })` 会按新体自己算一个。
 *
 * ⚠️ **删掉的头必须一路带到 `modify`**（复查 2026-10-02 抓到）：原先这里是
 * `headers.delete("content-length")` 之后又 `headers: request.headers` **整份覆盖回去**——
 * 而 `request.headers` 是**原请求的头**，那个 `content-length` 从头到尾没被删过。
 * 于是删了等于没删：改写后的体换了长度，头还是老数字。
 */
function replaceBody(request: HttpServerRequest.HttpServerRequest, body: string) {
  const headers = Headers.remove(request.headers, "content-length")

  return HttpServerRequest.fromWeb(
    new Request(new URL(request.url, "http://localhost").toString(), {
      method: request.method,
      headers,
      body,
    }),
  ).modify({
    url: request.url,
    headers,
    remoteAddress: request.remoteAddress,
  })
}
