export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export type ProviderModelNotFoundError = {
  name: "ProviderModelNotFoundError"
  data: {
    providerID: string
    modelID: string
    suggestions?: string[]
  }
}

type Translator = (key: string, vars?: Record<string, string | number>) => string

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  const unwrapped = unwrapNamedError(error)
  if (isConfigInvalidErrorLike(unwrapped)) return parseReadableConfigInvalidError(unwrapped, translate)
  if (isProviderModelNotFoundErrorLike(unwrapped)) return parseReadableProviderModelNotFoundError(unwrapped, translate)
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

function unwrapNamedError(error: unknown): unknown {
  if (error instanceof Error && error.cause && typeof error.cause === "object" && "body" in error.cause) {
    return (error.cause as Record<string, unknown>).body
  }
  return error
}

// Client-synthesized session not-found errors share one constructor and
// predicate so the message contract cannot drift between the sync store
// (server-session.ts), the route lineage (session-lineage.ts), and the
// not-found fallback matching (session.tsx).
const sessionNotFoundMessage = (sessionID: string) => `Session not found: ${sessionID}`

export function sessionNotFoundError(sessionID: string) {
  return new Error(sessionNotFoundMessage(sessionID))
}

export function isLocalSessionNotFoundError(error: unknown, sessionID: string) {
  return error instanceof Error && error.message === sessionNotFoundMessage(sessionID)
}

export function isSessionNotFoundError(error: unknown, sessionID: string) {
  const unwrapped = unwrapNamedError(error)
  if (typeof unwrapped !== "object" || unwrapped === null) return false
  const value = unwrapped as Record<string, unknown>
  return value._tag === "SessionNotFoundError" && value.sessionID === sessionID
}

/**
 * 服务端的「这场会话不存在」**在两种协议下被交到手里的形状不同**，这一条认的是**体**那一支。
 *
 * 实测（2026-10-11，假后端 ＋ 真客户端）：
 * - **v1**（部署跑的就是它）：`Error { cause: { status: 404, body: {name:"NotFoundError", data:{message}} } }`
 *   ——状态码在 `cause.status` 上，谓词那一支其实用不着。
 * - **v2**：404 是**已声明**状态，生成客户端走 `throw await json(response)` ⇒ 抛出来的就是
 *   **裸体**（不是 `Error`、没有 `cause`、**没有状态码**）：
 *   `{name:"NotFoundError", data:{message:"Session not found: ses_x"}}`。
 *   实测打印见 `e2e/regression/right-pane-unavailable.spec.ts` 的文件头。
 *
 * 少了这一条，「这场会话是不是真的没了」在 v2 下**恒判否**——不报错、不变红，只是永远不清理
 * （幽灵标签照旧每次刷新 404 一轮）。判据取 `name` 而不比对 `data.message`：调用方问的就是
 * 「我这场会话在不在」，而 v1/v2 的文案格式将来都可能变（`sessionNotFoundMessage` 只绑定
 * 客户端**自己合成**的那一支）。
 */
export function isSessionNotFoundBody(error: unknown) {
  const unwrapped = unwrapNamedError(error)
  if (typeof unwrapped !== "object" || unwrapped === null) return false
  return (unwrapped as Record<string, unknown>).name === "NotFoundError"
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ProviderModelNotFoundError" && typeof o.data === "object" && o.data !== null
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()
      if (!issue.path.length) return msg
      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)
  const msg = issues.length ? issues.join("\n") : detail
  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })
  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (opencode.json) provider/model names")
  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")
    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }
  return [body, tail].join("\n")
}
