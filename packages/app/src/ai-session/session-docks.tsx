import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { SDKProvider } from "@/context/sdk"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import { showToast } from "@/utils/toast"

/**
 * 右栏里那两个**待答闸门**（权限 / 提问）的宿主。
 *
 * ## 为什么它在右栏，而不是留在会话页
 *
 * 全仓**只有一处**回话：`pages/session/composer/session-composer-state.ts` 的 `decide`
 * （`api.permission.reply`；2026-10-08 `grep` 全 `src/` 只有这一个调用点），而它只被
 * `pages/session.tsx` 用 ⇒ 闸门的 UI（`SessionPermissionDock` / `SessionQuestionDock`）
 * 原本只长在**中栏那页上游会话页**上。
 *
 * 006 那三栏把中栏的那页在会话路由下**藏掉了**（`center-content.tsx` 的 `pageVisible`：
 * 藏 ≠ 卸，仍 `display:none` 挂在 DOM 里）⇒ 那两个 dock 还在，但**没人点得到**。
 * 后果不是「少一个按钮」：`Permission.ask` 在内核里阻塞在 `Deferred` 上，工具会**永远挂着**
 * ——而界面上什么都没说。这正是 `LEARNINGS #005-11` 那一族（横切机制在新出口上没人验），
 * 只是这次的反面：**机制的老出口被藏了，没人发现它的活没人接**。
 *
 * ## 三件事注入进来，不在这里读 context
 *
 * - `autoResponds`：判「这条请求是不是已经被自动放行规则吃掉了」。它要 `usePermission()`，
 *   而 `PermissionProvider` 依赖 Router / Global / Server / Tabs / Settings 五份 context
 *   ⇒ 本组件读它就**挂不进 `bun test`**，那两张最要紧的断言（渲染 / 回话）就写不成了。
 *   注入之后本组件只剩 props 与 `useLanguage()`，单测直接喂假对象（`#004-13`：断言不是空的，
 *   缺的只是观测面——换个观测面即可，不必放弃）。
 * - `reply`：目录作用域的 `api.permission.reply`。同上，它要 `ServerSDKProvider`。
 * - `sessions` / `permission` / `question`：三份原始表。**待答请求的选择复用上游纯函数**
 *   `sessionPermissionRequest` / `sessionQuestionRequest`，不重写——它们已含「沿 `parentID`
 *   走子会话」那套语义（父会话在等人答子会话的闸门）。
 *
 * ## ⚠️ 提问那半**没有单测**（如实记，别读成「已覆盖」）
 *
 * `SessionQuestionDock` 内部**自己**用 `useSDK()` 与 `useServerSDK()`
 * （`sdk().api.question.reply` 在它里面、`ScopedKey.from(serverSDK().scope, …)` 也是），
 * 前者本组件用 `<SDKProvider>` 兜住了，后者要一个**活着的服务器连接**才建得起来
 * ⇒ 在 `bun test` 里挂不动（与 `ai-session-slot.tsx` 同一条口径，`LEARNINGS #002-02`：
 * 「测不了」要写成「缺口」，不能写成「覆盖」）。已记进
 * `docs/superpowers/specs/006-ai-session/state.md` 的缺口表。
 * ⇒ **权限那半**（本组件自己接线的 3 条线）有单测；**提问那半**只有人读代码看得见。
 *
 * ## `onSubmit` 传空实现，代价是「多留一瞬」
 *
 * `SessionQuestionDock` 自己发 `question.reply`，成功后再调 `props.onSubmit()` 做**乐观收起**
 * （上游那页给的是 `controller.onResponseSubmit`）。右栏这一档没有对应的 controller
 * ⇒ 传空函数：dock 会等服务的 `question.replied` 事件把它摘掉，多留一瞬。
 * 如实记（与本文件头那条同族）。
 */
export interface SessionDocksProps {
  /** 目录作用域。`SDKProvider` 与 `SessionQuestionDock` 都要它。 */
  directory: string
  /** 当前会话 id（右栏唯一产地是 URL）。 */
  sessionID: string
  /** `data.session`：待答请求要沿 `parentID` 走子会话。 */
  sessions: Session[]
  /** `data.permission`：按会话 id 分组的待答权限请求。 */
  permission: Record<string, PermissionRequest[] | undefined>
  /** `data.question`：同上，待答提问。 */
  question: Record<string, QuestionRequest[] | undefined>
  /** 这条请求是不是已经被「自动放行」规则吃掉了（生产 = `usePermission().autoResponds(item, 目录)`）。 */
  autoResponds: (permission: PermissionRequest) => boolean
  /** 目录作用域的 `api.permission.reply`。 */
  reply: (input: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }) => Promise<unknown>
}

export function SessionDocks(props: SessionDocksProps): JSX.Element {
  const language = useLanguage()

  /**
   * 在途的那条请求 id（**不是**布尔）。与上游 `session-composer-state.ts` 的 `store.responding`
   * 同形：按 id 记，这样「答完 A、B 还在等」时 B 的按钮不会跟着一起变灰。
   */
  const [响应中, set响应中] = createSignal<string | undefined>()

  // ⚠️ 与上游 `session-composer-state.ts` 的 `permissionRequest` **同一份判据、同一种次序**：
  // 先沿 `parentID` 找会话，再用 `autoResponds` 筛掉已自动放行的。**不在这里另写一份**
  // ——`LEARNINGS #002-06` 说的就是「同一个判断两处各写一份」。
  const 待答权限 = createMemo(() =>
    sessionPermissionRequest(props.sessions, props.permission, props.sessionID, (item) => !props.autoResponds(item)),
  )
  const 待答提问 = createMemo(() => sessionQuestionRequest(props.sessions, props.question, props.sessionID))

  const 这条在途中 = createMemo(() => 待答权限()?.id === 响应中())

  /**
   * 决定一手。三件事与上游 `decide` 逐条对齐：① 在途时**不重入**（连点两下只发一次）；
   * ② 用 `perm.sessionID` 而**不是** `props.sessionID`（请求可能落在**子会话**上）；
   * ③ 失败必须回话——不接就是一条没人看的 unhandled rejection，而界面上只是「点了没反应」。
   *
   * ⚠️ 这是**第二份实现**（第一份在 `session-composer-state.ts:78-88`，那是页面级的 controller，
   * 上游文件不能改、也搬不动）。两处要对齐的是上面那三条；改动一处时**去看另一处**。
   */
  const 决定 = (response: "once" | "always" | "reject") => {
    const 请求 = 待答权限()
    if (!请求) return
    if (响应中() === 请求.id) return

    set响应中(请求.id)
    props
      .reply({ sessionID: 请求.sessionID, requestID: 请求.id, reply: response })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => set响应中((id) => (id === 请求.id ? undefined : id)))
  }

  return (
    <>
      {/* 提问先、权限后——与上游 `session-composer-region.tsx` 的次序一致（同一屏里两个都待答时，
          先答「AI 反问你」再答「AI 要动你的东西」）。 */}
      <Show when={待答提问()} keyed>
        {(请求) => (
          <SDKProvider directory={props.directory}>
            <SessionQuestionDock request={请求} onSubmit={() => {}} />
          </SDKProvider>
        )}
      </Show>
      <Show when={待答权限()} keyed>
        {(请求) => <SessionPermissionDock request={请求} responding={这条在途中()} onDecide={决定} />}
      </Show>
    </>
  )
}
