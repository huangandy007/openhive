/**
 * 从「被 SDK 包过的错误」里取**状态码**与**服务端原话**。
 *
 * ## 为什么需要这一层（形状是实测的，不是从文档推的）
 *
 * 2026-10-11 真栈实测（内核 4711，带 `openhive_session` cookie）：
 * - 归档项目的会话 ⇒ `HTTP 403`，体 `{"error":"项目已归档，请先找回"}`
 * - 不存在的会话 ⇒ `HTTP 404`，体 `{"name":"NotFoundError","data":{"message":"Session not found: ses_x"}}`
 *
 * 而客户端（`throwOnError: true`，`context/server-sdk.tsx:433`）把它们包成真正的 `Error`：
 * 状态码落在 `Error.cause.status`、解析出来的体落在 `Error.cause.body`，**体里的
 * `data.message` 还会被抬成 `Error.message`**（`packages/sdk/js/src/error-interceptor.ts:31`）。
 *
 * ⚠️ **推论一（本文件存在的理由）**：两种形态包完之后 `.message` **都像人话**——
 * 403 那条是 `GET http://127.0.0.1:4711/session/<id> → 403 Forbidden`，404 那条是
 * `Session not found: <id>`。⇒ **判「是哪种失败」只能靠 `cause.status`**；拿 `.message`
 * 做判据的写法会同时错两边（把 403 当 404 剪标签、把 404 说成「请求失败」）。
 *
 * ⚠️ **推论二**：服务端**特意写好给人看**的那句话（`{"error":…}`，见
 * `project-location.ts` 那段「前端能直接把这句话显示给人看」）**不在 `.message` 上**，
 * 只在 `cause.body.error` 里。想把它显示出来就必须下到 `.cause` 那一层。
 *
 * 本文件是**加**（新文件），不动上游的 `utils/server-errors.ts`——那边管的是「错误对象
 * 长什么样」（`isSessionNotFoundError` 等谓词），这边管的是「HTTP 信封里还剩什么」。
 */

function 因(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const cause = (error as { cause?: unknown }).cause
  if (typeof cause !== "object" || cause === null) return undefined
  return cause as Record<string, unknown>
}

/** HTTP 状态码。**没有**（网络错、客户端自己合成的错）⇒ `undefined`——这个区分很重要，见文件头。 */
export function httpStatus(error: unknown): number | undefined {
  const status = 因(error)?.status
  return typeof status === "number" ? status : undefined
}

/**
 * 服务端在那条错误体里给出的原话。
 *
 * 优先取 `{"error": …}`（这是本仓中间件给人看的那句话，如「项目已归档，请先找回」），
 * 退到 `{"name":…,"data":{"message":…}}`（上游命名错误的形状）。都没有 ⇒ `undefined`。
 */
export function serverErrorText(error: unknown): string | undefined {
  const body = 因(error)?.body
  if (typeof body !== "object" || body === null) return undefined
  const 记录 = body as Record<string, unknown>

  const 一句话 = 记录.error
  if (typeof 一句话 === "string" && 一句话.trim()) return 一句话.trim()

  const data = 记录.data
  if (typeof data === "object" && data !== null) {
    const message = (data as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return undefined
}
