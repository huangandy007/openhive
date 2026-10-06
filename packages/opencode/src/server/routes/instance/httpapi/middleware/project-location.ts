export * as ProjectLocation from "./project-location"

import { Database } from "@opencode-ai/core/database/database"
import { ProjectExt } from "@opencode-ai/core/project/ext"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { Headers, HttpMethod, HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { join } from "node:path"
import { AnchorWorkspace } from "./anchor-workspace"

/**
 * 「当前项目」的落地口径（005 T017，FR-001 · D0-1）。
 *
 * ## 这个中间件干什么
 *
 * 客户端用**请求头**报「我现在在哪个项目」（`PROJECT_HEADER`，裁定①），服务端据此把会话目录
 * 从**沙箱根**推进一层到 `join(沙箱根, projectId)`。`project_ext` 在这里的作用是
 * **「这个项目在不在」**（裁定③：那四列里**没有目录列**，「目录」就是 projectId 本身）。
 *
 * ## 三笔裁定（2026-10-06，用户裁定，见 `docs/superpowers/specs/005-project-management/state.md`）
 *
 * | 问题 | 裁定 |
 * |---|---|
 * | 客户端用什么通道报 `projectId` | **请求头 `x-openhive-project`**——`payload.location` 里没有这个字段（`Location.Ref` 只有 `directory` / `workspaceID`），两条链也只有**头**是共用的 |
 * | 这段代码落在哪 | **本文件（新的 fork 中间件）**，挂在 `anchorWorkspaceLayer` **之后** |
 * | `join(沙箱根, 目录)` 里的「目录」取什么 | **`projectId` 本身** |
 *
 * ## 为什么挂在锚定**之后**，以及为什么**重算**沙箱根而不是读请求
 *
 * 锚定（003 T006）把客户端能报目录的地方**全部**改写成 `join(config.root, user.id)`。
 * 本层只在**沙箱根里面**再加一段。这一层楼里有两条路可走，选的是第一条：
 *
 * ① **重算** `join(config.root, user.value.id)`（本文件的做法）；
 * ② 读锚定已经写进请求的 `x-opencode-directory`，在那上面接一段。
 *
 * ②少一处 `join`，但它把「基准安全」挂在**挂载次序**上：哪天本层被挪到锚定前面，
 * ②读到的就是**客户端填的**目录，`join(客户端目录, projectId)` 直接逃出沙箱——而次序错了
 * **没有任何测试会红**（挂载数组里两行换个位置而已）。①的失败模式轻得多：即使锚定将来
 * 把沙箱从 `{根}/{id}` 改成 `{根}/{id}/workspace`（多加一层），本层算出来的
 * `{根}/{id}/{projectId}` 仍在**沙箱信封之内**（锚定的沙箱**永远**以 `join(root, id)` 起头，
 * 那是它 R-05 的 fail-closed 基线）⇒ 漂移的结果是「目录落在另一个子目录里」，**不是逃逸**。
 *
 * ⇒ 判据一句话：**基准要能自己算出来，别从请求里捡**。代价是多一处 `join`，
 * 与 `anchor-workspace.ts` 那行**互为镜像**（改一处要改另一处；见下「镜像」）。
 *
 * ## 不变量：**客户端给的目录一律无效**（T017 的 ⚠️，锚定那半一字不动）
 *
 * 本层只**上移一层**，不碰锚定那条不变量：目录的**每一段**都来自「服务端算的根」＋
 * 「服务端校验过的身份段」，客户端报的 `?directory=` / 头 / 请求体三处**原样被覆盖**。
 * 两条守则：
 * - `projectId` 过 `User.isSafePathSegment`（**与锚定对 `userId` 同一判据、同一类逃逸**：
 *   空串 / `.` / `..` / 带分隔符的串会让沙箱**塌掉或逃出去**）⇒ 非法**拒**，不放行（判据理由见锚定
 *   文件头「为什么非法 id 必须拒」，那一段逐字适用于这里）；
 * - 查不到（R5）⇒ **落沙箱根**，**不做隐式建项目**。
 *
 * ⚠️ **一笔按先例落的裁定（2026-10-06，T017）**：非法 projectId 取「拒」而不是「忽略后落沙箱根」。
 * 依据是锚定的 R-05 对**同一类**输入（会被 `join` 进路径的身份段）已经选了 fail closed——
 * 这里若改成「忽略」，同一个仓库里两个同类输入就有了两种处置，而它们的安全性不因名字不同而不同。
 * 之所以显式记出来：`project_ext` 里**没有**这一行时是「落沙箱根」（正常路径），
 * 「非法」与「查不到」是**两件事**，别被前一句读混。
 *
 * ## 为什么两条链都要管（`LEARNINGS #004-01`：数**出口**）
 *
 * 建会话有两条链，目录从两个地方读：A 链 `POST /session` 读 **URL**（`?directory=`），
 * B 链 `POST /api/session` 读**请求体**（`payload.location.directory`，锚定当初漏过的那条缝）。
 * 所以这里照锚定的做法**三处都改**：`?directory=` ＋ `location[directory]` ＋ `x-opencode-directory`
 * 头 ＋ 请求体。只改一处 = 另一条链静默退回沙箱根（不会报错、不会变红）。
 *
 * ## 没有项目头 ⇒ **一次都不碰请求**
 *
 * 这是本层最重要的性质：`PROJECT_HEADER` 不在 ⇒ 立刻 `return yield* effect`，
 * 于是所有不带项目的请求（会话、文件、pty、上传……）走的是**与今天完全一样**的那条路。
 * 「不在场时不产生副作用」比「在场时做对」更容易被写坏，故写在这里。
 *
 * ## 镜像（两处，都不是近似的借口）
 *
 * 1. **沙箱根**：本文件的 `join(config.root, user.value.id)` ⇔ `anchor-workspace.ts` 里那行。
 * 2. **什么算「下游会当 JSON 解」**：本文件的 `isJsonRequest` ⇔ 锚定的同名函数 ⇔ 它们共同镜像的
 *    `HttpApiBuilder` 的 `getRequestContentType` / `getRequestMediaType`。
 *
 * ⚠️ 第 2 条是**第二份**（锚定那份已经是镜像了）。接受这个代价的理由：本层**改不动**锚定
 * （T017 明文「`anchor-workspace.ts` 一字不动」），而请求体这条缝**只有读体重建**一条路
 * （`HttpServerRequest.modify` 只管 url / headers / remoteAddress，没有 body）。
 * 分工上有一点让这个代价可接受：**安全边界在锚定那边**——本层的体改写若因判据漂移而跳过，
 * 结果是「退回沙箱根」，不是「逃出沙箱」（锚定已经把体里的落点改成沙箱根了）。
 * ⇒ 漂移的后果是**功能**缺口，不是安全缺口。
 *
 * 同理，本层**不做**锚定 `needsLocation` 那一半（「体里没有 location 就补一个」）：
 * 锚定先跑，跑到这里时建会话端点的体里**已经有了** `location.directory`（= 沙箱根）。
 * 少写一个会漂的判据，而不是少写一个安全属性。
 *
 * ## 已知不覆盖（别把它读大）
 *
 * - **不建目录**：本层只把路径**写进** `session.directory`。`{沙箱根}/{projectId}` 那个目录
 *   由建项目那一步（T006）落地。实测：两条链在目录**不存在**时照样 200
 *   （`anchor-workspace.test.ts` / `tenant-db-isolation.test.ts` 的沙箱根都从未被创建）。
 * - **剥头这件事没有测试守着**：本层把 `PROJECT_HEADER` 从往下游的请求上摘掉（同网关剥
 *   `X-User-ID` 的取向），但**本仓今天没有任何下游读它**，所以写不出会红的断言——
 *   这是一条**预防**，不是一条已验证的性质（`LEARNINGS #002-02` 的取向：如实标出来）。
 * - **射程 = 所有带头的请求，而断言只钉了建会话这一条**：本层**不按路由清单收窄**（收窄＝多一处会漂的
 *   清单，`session-quota.ts` 文件头讲的正是这个坑）——带了头，`?directory=` / 头 / 体三处**一律**
 *   上移一层，于是**文件树 / pty / 上传那些入口的实例目录也跟着上移**。这是产品想要的方向
 *   （「当前项目」就该是当前工作目录），但那些入口**没有跑过带头的情形**——它们的行为是**推**出来的，
 *   不是测出来的。要动它们之前先补一条用例，别默认这条路已经验过。
 */

/**
 * 客户端报「当前项目」的头名。
 *
 * ⚠️ **这个名字是客户端契约**：`test/server/openhive-project-directory.test.ts` **刻意不 import
 * 本常量**，而是用字面量钉住它——import 过来就变成「生产改什么、测试跟着改什么」，
 * 改名也测不出来（`LEARNINGS #003-05` 的假镜像）。改名要同时改那边那个字面量。
 */
export const PROJECT_HEADER = "x-openhive-project"

export const projectLocationLayer = HttpRouter.middleware<{
  requires: AnchorWorkspace.Config | Database.Service
  handles: unknown
}>()(
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    // 构造期取、请求期用（同 `middleware/session-quota.ts` 的实测：`Database.Service` 属于这一类）。
    // ⚠️ 这次查询**走 T005 的连接路由钩子**：钩子按 fiber 上下文里的 `User` 选库，
    // 所以下面那句查到的是**请求方自己的** `project_ext`（别人家的项目 id 在这里查不到，
    // 落到 R5 那一支）——本文件因此**不需要**任何身份判断。
    const database = yield* Database.Service

    return (effect) =>
      Effect.gen(function* () {
        const user = yield* Effect.serviceOption(User.Service)
        // 没有身份 ⇒ 直通（同锚定：身份门关着时上下文里**没有** User，不是空身份）。
        if (Option.isNone(user)) return yield* effect

        const request = yield* HttpServerRequest.HttpServerRequest
        const projectId = request.headers[PROJECT_HEADER]
        if (projectId === undefined) return yield* effect

        if (!User.isSafePathSegment(projectId))
          throw new Error(`非法项目 id，拒绝锚定项目目录：${JSON.stringify(projectId)}`)

        const project = yield* ProjectExt.findByProjectID(database.db, projectId)
        // R5：查不到就落沙箱根，**不做隐式建项目**（本层一个字都不写库）。
        //
        // 查库**报错**不吞（`findByProjectID` 用 `Effect.orDie`，真炸成 500）：那条路径上建会话
        // 本来就要写同一个库，吞掉只会把同一个故障挪到下一步，还多一个「看着还在、其实没有」的
        // 分支（`LEARNINGS #002-02`）。
        if (project === undefined) return yield* effect

        const target = join(config.root, user.value.id, projectId)
        const rewritten = rewriteBody(rewriteRequest(request, target), target)

        return yield* Effect.provideService(effect, HttpServerRequest.HttpServerRequest, yield* rewritten)
      })
  }),
).layer

/**
 * URL 与头那一半：三处一起改，**外加把头摘掉**。
 *
 * - `?directory=` 是 v2 的读法，`location[directory]` 是旧版 `@opencode-ai/server/location` 的读法，
 *   头是两条链共用的兜底 —— 只改一处就留一条明路（照锚定 `anchor()` 的清单）。
 * - `?workspace=` **不在这里删**：锚定已经删过，且它排在本层前面（挂载次序在 `server.ts` 里钉着）。
 *   本层重复一遍只会多一处会漂的清单。
 * - **摘掉自己的头**：往下游传的请求里不该留 `x-openhive-project`（同网关剥 `X-User-ID` 的取向：
 *   客户端能填的东西不往下游流）。⚠️ 详见文件头「已知不覆盖」——这条**没有**测试守着。
 */
function rewriteRequest(request: HttpServerRequest.HttpServerRequest, target: string) {
  const url = new URL(request.url, "http://localhost")
  url.searchParams.set("directory", target)
  url.searchParams.set("location[directory]", target)

  return request.modify({
    url: `${url.pathname}${url.search}`,
    headers: Headers.remove(Headers.set(request.headers, "x-opencode-directory", target), PROJECT_HEADER),
  })
}

/**
 * 请求体那一半（B 链的落点在这里，见文件头「为什么两条链都要管」）。
 *
 * 结构照 `anchor-workspace.ts` 的 `anchorBody`：**只在下游会当 JSON 解的请求上读体**
 * （读了就必须重建——原体的流已经被消费掉），其余请求**一次都不碰**。
 */
function rewriteBody(request: HttpServerRequest.HttpServerRequest, target: string) {
  if (!HttpMethod.hasBody(request.method)) return Effect.succeed(request)
  if (!isJsonRequest(request)) return Effect.succeed(request)

  return request.text.pipe(
    // 读不出来（例如声明了 JSON 却是空体）就原样放行，让下游按它自己的方式报错——
    // 这里不该替它决定成功还是失败（同锚定的处置）。
    Effect.orElseSucceed(() => undefined),
    Effect.map((text) => {
      if (text === undefined) return request
      const parsed = parseJsonObject(text)
      const rewritten = parsed && withProjectDirectory(parsed, target)
      return replaceBody(request, rewritten ? JSON.stringify(rewritten) : text)
    }),
  )
}

/**
 * 这个请求会不会被下游**当成 JSON 解**。
 *
 * ⚠️ **这是镜像的第二份**（第一份在 `anchor-workspace.ts`，它镜像的是 `HttpApiBuilder` 的
 * `getRequestContentType` / `getRequestMediaType`：**缺头或空串 ⇒ 当 `application/json`**，
 * 有头才 `toLowerCase().trim()` 再在 `;` 处切媒体类型）。代价与分工见文件头「镜像」。
 */
function isJsonRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const header = request.headers["content-type"]
  const contentType = header ? header.toLowerCase().trim() : "application/json"
  const separator = contentType.indexOf(";")
  return (separator === -1 ? contentType : contentType.slice(0, separator).trim()) === "application/json"
}

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
 * 把体里**已经存在**的目录键改成 `target`；一个都没改到就返回 `undefined`
 * （调用方据此知道「不必重建内容」）。
 *
 * ⚠️ 与锚定 `withSandboxDirectory` 的**唯一**差别：这里**没有**「没有也得补一个」那一支
 * （`mustCarryLocation`）。理由见文件头「镜像」最后一段：锚定先跑，跑到这里时建会话端点的体里
 * 已经有 `location.directory` 了 ⇒ 「补一个」这件事不存在，少写一个会漂的判据。
 */
function withProjectDirectory(
  body: Record<string, unknown>,
  target: string,
): Record<string, unknown> | undefined {
  const next = { ...body }
  let changed = false

  const location = body["location"]
  if (isRecord(location) && typeof location["directory"] === "string") {
    next["location"] = { ...location, directory: target }
    changed = true
  }

  if (typeof body["directory"] === "string") {
    next["directory"] = target
    changed = true
  }

  return changed ? next : undefined
}

/**
 * 换一个请求进上下文。`fromWeb` 只丢 `remoteAddress`，补回来；`content-length` 必须删
 * （改写后的 JSON 多半换了长度，留着头就是给下游一个假数）。
 *
 * ⚠️ **删掉的头必须一路带到 `modify`**——锚定当初在这一点上栽过（复查 2026-10-02：
 * `headers.delete("content-length")` 之后又整份覆盖回原头，等于没删）。这里照修好的形状抄。
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
