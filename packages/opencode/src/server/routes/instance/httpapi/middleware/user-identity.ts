import { UserIdentity } from "@/server/user-identity"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { JWT_SECRET_ENV } from "@opencode-ai/auth/policy"
import { jwtSecret, verifyToken } from "@opencode-ai/auth/token"
import { DatabaseConnectionRouting } from "@opencode-ai/core/database/connection-routing"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { User } from "@opencode-ai/core/user"
import { Context, Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const UNAUTHORIZED = 401

/**
 * openhive 身份门（全局中间件，装法同 `corsVaryFix`）。
 *
 * 开关关 → **直通**，与加这道门之前逐字相同；开关开 → 认不出身份一律 401。
 *
 * **认身份的方式 = 验签**（003 T003，裁定【甲】）。网关把登录时下发的 httpOnly Cookie
 * 原样透传，这里用 002 的 `verifyToken` 验签、取 subject 为 `User` 上下文。
 * 放行规则有四条刻意的选择：
 *
 * 1. **验不了就拒**。没凭证、签名不符、已过期、密钥缺失或过短（002 的 32 字符地板）——
 *    全部走同一个 401。**没有「验不了当通过」这条分支**，那正是这道门被取代之前的毛病。
 * 2. **`X-User-ID` 只在「与验签结果矛盾」时触发拒绝**。它是明文头，作不了凭证，
 *    已降级为路由提示：**缺失不拒**（提示不是必要条件，拒了等于又把它当身份来源）；
 *    **不一致拒**（令牌说 A 而头说 B，只有两种解释——链路被改写，或有人手工塞了头）。
 * 3. **验签结果填进 `User` 上下文**，供下游路由每用户 db / 锚定沙箱目录。
 *    这里**不制造**任何「默认用户」或空身份：拿不到身份就不放行，宁可 401 也不给下游一个假主体。
 * 4. **公共 UI 资源豁免**（与 Basic Auth 同款，见 `@/server/shared/public-ui`）。浏览器取 PWA
 *    manifest 的请求不带任何应用层凭证，拦了会让 PWA 装不上（上游 #25698）。
 *
 * 拒绝时**不发** `www-authenticate`：那是让浏览器弹 Basic 登录框用的，这里没有 Basic，
 * 发了只会弹出一个永远填不对的框。
 */
export const userIdentityLayer = HttpRouter.middleware<{ requires: UserIdentity.Config; handles: unknown }>()(
  Effect.gen(function* () {
    const config = yield* UserIdentity.Config
    if (!config.required) return (effect) => effect

    // 密钥在**层构造时**解析一次：省掉每请求一次判强度，也让「密钥不对」这件事
    // 只有一个发生地点。`undefined` = 这把密钥用不了，于是所有请求都 401（fail-closed）。
    const secret = resolveSecret(config)

    // 取连接钩子也在层构造时取一次。**必须在请求期塞进上下文**、不能靠 app 层——
    // 请求 fiber 的 context 里没有 app 层服务（实测见 `router.ts` 的 `hook` 注释）。
    // 依赖由 `server.ts` 那条 `Layer.provide(DatabaseRouter.layer())` 满足。
    const router = yield* DatabaseRouter.Service

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect

        const user = yield* authenticate(request, secret)
        if (!user) return HttpServerResponse.empty({ status: UNAUTHORIZED })

        // 身份与取连接钩子**同源注入**：下游拿到 `User` 的每一处，必然同时拿到按该身份
        // 换库的能力；反过来，没有身份就不给钩子（否则钩子会去猜一个主体）。
        return yield* Effect.provideService(
          Effect.provideService(effect, User.Service, user),
          DatabaseConnectionRouting.Hook,
          router.hook,
        )
      })
  }),
).layer

/**
 * **解析后**的配置形状（`{ required, secret }`）。
 *
 * 为什么不是 `UserIdentity.Config`：那个名字在**类型位置**指的是「键」——一个 `ServiceClass`，
 * 身上是 `key` / `[ServiceTypeId]` / `Service`，**没有** `required` 和 `secret`（那是 `yield*`
 * 之后才拿到的值）。取值形状得走 Effect 官方的提取器 `Context.Service.Shape`。
 */
type ResolvedConfig = Context.Service.Shape<typeof UserIdentity.Config>

/**
 * 解析并校验签名密钥。`undefined` 表示**用不了**（没配 / 短于 002 的地板），调用方一律拒绝。
 *
 * 强度判据复用 `packages/auth` 的 `jwtSecret()`，不在这里重写「≥32 字符」——
 * 那个数只有一处定义，两边各写一份就会在改地板时漏掉一边。
 *
 * 为什么在**取的时候**就查强度（与 `jwtSecret` 的注释同一立场）：宁可当场拒绝，
 * 不可带着弱密钥把每个请求都验过一遍——它跑起来的每一天，全系统的凭证都处于可伪造状态。
 */
function resolveSecret(config: ResolvedConfig) {
  const raw = Option.getOrUndefined(config.secret)
  if (raw === undefined) return undefined
  try {
    return jwtSecret({ [JWT_SECRET_ENV]: raw })
  } catch {
    return undefined
  }
}

/**
 * 验签并取回身份。返回 `undefined` = 认不出——**调用方必须拒绝**，不要把它当成匿名用户。
 *
 * 载荷到 `User.Info` 是**逐字段搬运**，不是把 `TokenSubject` 直接透传：两边的形状今天相同，
 * 但它们的契约不同（一个是「凭证里写了什么」，一个是「内核认定了什么」），
 * 直接透传会让将来任一边加字段时被另一边的类型悄悄接受。
 */
function authenticate(request: HttpServerRequest.HttpServerRequest, secret: string | undefined) {
  return Effect.gen(function* () {
    if (secret === undefined) return undefined

    const token = cookieValue(request.headers.cookie, UserIdentity.COOKIE_NAME)
    if (!token) return undefined

    const subject = yield* Effect.tryPromise({
      try: () => verifyToken(token, secret),
      // 签名不符 / 过期 / 载荷缺字段都会抛。**不区分原因**：对调用方一律是「认不出」，
      // 分辨「是过期还是伪造」只对攻击者有用。
      catch: () => undefined,
    }).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }))
    if (!subject) return undefined

    const hint = request.headers[UserIdentity.HEADER]
    if (hint && hint !== subject.id) return undefined

    return { id: subject.id, policeNo: subject.policeNo, name: subject.name, isAdmin: subject.isAdmin }
  })
}

/**
 * 从 `Cookie` 头里取一个具名 Cookie 的值。
 *
 * 自己解而不引依赖：只需要读一个名字，而 `packages/opencode` 既没有 `cookie` 也没有 `hono`。
 * **只做这一件事**——无 `=` 的段、名字不匹配的段一律跳过，不认识的输入不抛错。
 */
function cookieValue(header: string | undefined, name: string) {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    const raw = part.slice(separator + 1).trim()
    if (!raw) return undefined
    // 值可能被 URL 编码过（hono 的 setCookie 默认编码）。JWT 用的 base64url 字符集
    // 在 encodeURIComponent 下不变，所以正常路径上这是恒等变换；解不开就按原文用，
    // 反正下一步验签会把它判掉。
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}
