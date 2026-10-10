/**
 * 登录门（003 T015-c）：应用外壳上唯一一处「先有身份、再有界面」的分岔。
 *
 * 三种启动结局，各自对应一个必须判对的东西：
 * - **网关不在** ⇒ 放行。`bun run dev` 的 `OPENHIVE_REQUIRE_USER_ID` 默认关，此时网关一个端点
 *   都不注册；把它判成「没登录」的后果是**本机开发全站进不去**。判据见 `gateway.ts` 的
 *   `probeSession`（只有 401 与「200 且真是一份身份」才算数，其余一律当不在）。
 * - **没登录** ⇒ 显示登录页。
 * - **已登录** ⇒ 工作台 + 把身份喂进 001 留的接线缝（`workspace/current-user.ts`，
 *   在此之前**零生产调用者**）。
 *
 * 它同时是强制改密遮罩的宿主：遮罩**盖在**工作台上而不是把它换掉——换掉的话，
 * 改完密还得把整个工作台重建一遍，而且「稍后修改」就不再是「放行」而是「重进」。
 *
 * **第四种情形（2026-10-10 补）：人已经站在工作台上，会话却在某个出口上没了（401）。**
 * 这一层是全仓唯一能处理它的人（只有它知道当前显示哪一屏），所以由外呼底座把消息递进来
 * （`./session-expired`），它做的是**再问一次**——与启动时同一个 `probeSession`，结论也由同一处
 * `view()` 定。见 `onMount` 里那段。
 *
 * ⚠️ 这不是安全边界。能改前端的人当然也能跳过它；真正的门禁在内核身份门 + 网关验签。
 */

import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from "solid-js"
import { showToast } from "@/utils/toast"
import { setCurrentUser } from "@/workspace/current-user"
import { ChangePassword } from "./change-password"
import { logout, probeSession, type AuthFetch, type Identity, type Session } from "./gateway"
import { LoginPage } from "./login-page"
import { onSessionExpired } from "./session-expired"
import { AuthSessionProvider, type AuthSession } from "./session-context"

export interface AuthGateProps {
  /**
   * 探查 / 登录 / 改密用的 `fetch`；省略 = 真 `fetch`。
   * 留这个入参是为了让「三种启动结局」「登录后切换」「遮罩开合」这几条可测——
   * 它们都是**行为**，不该靠起一个真内核才能验。
   */
  send?: AuthFetch
}

export function AuthGate(props: ParentProps<AuthGateProps>) {
  /** `undefined` = 还在探。**刻意不用 `false` 起手**：那会让首帧先渲染工作台再被顶掉。 */
  const [session, setSession] = createSignal<Session | undefined>(undefined)
  /** 「稍后修改」按过了。内存态，刷新即失效（理由见 `change-password.tsx` 的文件头）。 */
  const [deferred, setDeferred] = createSignal(false)

  /**
   * 问一次「我现在是谁」，把结论落进会话。
   *
   * **启动时与「某个出口吃到 401」时都走它**——两处是同一个问题，不写第二份判据
   * （`LEARNINGS #002-06`）。区别只在「谁先开的口」：启动时是门自己问的，
   * 之后是外呼底座转告的（`@/auth/session-expired`）。
   */
  const 重探 = async () => setSession(await probeSession(props.send))

  onMount(() => {
    void 重探()

    /**
     * 会话在**运行中**没了（2026-10-10 用户下达的第 2 件）。
     *
     * 修之前：401 只在几个结论函数里被翻成一句「登录已过期，请重新登录」，够不到**唯一能处理它的
     * 这一层**。真栈实测：横幅说得对，而界面一动不动（登录页 0、工作台 1、URL 停在 `/`）；
     * 同一条坏 cookie 冷加载却出得来登录页 ⇒ 判据没坏，缺的是**第二次探查**。
     *
     * ⚠️ **听见 ≠ 一定没身份了**：一次 401 可能只是一条链上的偶发（内核刚重启、会话正好在这一次
     * 往返里被顶掉）。所以这里只负责**再问一次**，跳不跳登录页由 `view()` 依重探的结论定
     * （`auth-gate.test.tsx` 那条「重探说『你还是你』⇒ 留在工作台」的对照用例钉的就是这件事）。
     *
     * `onCleanup` 不能省：接缝是模块级的，门卸载了它还挂着就会把后来的实例算进去。
     * 与 `session-context.ts` 那条老话同一个理由（那条讲 context 能自己收回来，这条讲信号收不回来）。
     */
    onCleanup(onSessionExpired(() => void 重探()))
  })

  // 每次身份落定都重喂一遍接线缝：顶栏的名字、管理员可见项都读它。
  // `undefined` 分支是**必须的**——登不进来时不能留着上一个人的身份。
  createEffect(() => {
    const current = session()
    setCurrentUser(
      current?.kind === "signed-in"
        ? { name: current.identity.name, policeId: current.identity.policeNo, isAdmin: current.identity.isAdmin }
        : undefined,
    )
  })

  const signIn = (identity: Identity) => {
    // 换人进来，「稍后修改」的旧决定作废。
    setDeferred(false)
    setSession({ kind: "signed-in", identity })
  }

  const changed = () => {
    setSession((current) =>
      current?.kind === "signed-in"
        ? { kind: "signed-in", identity: { ...current.identity, mustChangePw: false } }
        : current,
    )
  }

  /**
   * 当前该显示哪一屏。
   *
   * ⚠️ **必须收敛成一个字符串，再让每个 `Show` 判它**——不能把三种结局直接喂给 `Show`/`Switch`
   * 的 `when`。非 keyed 的 `Show` 只在**真假**变化时重渲染（`equals` 是 `!a === !b`），
   * 而「未探到 / 未登录 / 已登录」三个值**都是真值**：登录成功后条件没变，子树就停在原地，
   * 页面永远停在登录页。实测踩到两次（工作台的 `data-slot` 一直不出现），
   * 换成布尔量后立刻正常。**真假翻转才是这个分支的驱动力，不是身份对象本身在变。**
   *
   * 用 `keyed` 能绕开上面那个坑，但不能用：它会在每次身份对象更新时把整个工作台重建一遍。
   */
  const view = () => {
    const current = session()
    if (current === undefined) return "probing" as const
    return current.kind === "signed-out" ? ("login" as const) : ("app" as const)
  }

  /**
   * 该不该弹强制改密。写成函数而不是内联进 `when`：`session()` 是联合类型，
   * 内联的 `&&` 链过不了类型收窄（后半段访问 `identity` 时 TS 看不到前半段已判过 `kind`）。
   */
  const mustChangePassword = () => {
    const current = session()
    return current?.kind === "signed-in" && current.identity.mustChangePw && !deferred()
  }

  /** 当前身份（`unavailable` 时没有）。写成函数，理由同上——联合类型要收窄。 */
  const 身份 = () => {
    const current = session()
    return current?.kind === "signed-in" ? current.identity : undefined
  }

  /**
   * 退出登录（2026-10-09 用户下达：「下拉三项全部真实实现」）。
   *
   * 两件事的次序是刻意的：**先问内核**（`POST /openhive/auth/logout`，它会把会话 Cookie 用
   * `Max-Age=0` 覆盖掉），**拿不到 204 就不改界面**。
   *
   * 失败那一支为什么不能「也退了吧」：Cookie 还在，刷新一下人又回来了——把人送去登录页却什么
   * 都没清，是这一层能说出的最坏的一句谎（比报错坏，因为它长得像成功）。所以失败只弹一句提示，
   * 停在原处。
   *
   * 成功后**只做一件事**：把会话置成 `signed-out`。界面切到登录页、顶栏的名字与管理员可见项
   * 一并消失——都由既有的那条 `createEffect`（`setCurrentUser(undefined)`）与 `view()` 负责，
   * 不在这里重写一遍（`LEARNINGS #002-06`：同一个判断只有一处）。
   */
  const signOut = async () => {
    const outcome = await logout(props.send)
    if (outcome.kind !== "signed-out") {
      showToast(outcome.message)
      return
    }
    // 换人之前，把「稍后修改」那个旧决定一并作废（同 `signIn`）——否则下一个人登进来时
    // 该弹的强制改密被上一个人的决定挡掉。
    setDeferred(false)
    setSession({ kind: "signed-out" })
  }

  /**
   * 交给下游的会话对象。**身份走 getter**：它在会话变化时才该变，而本对象在门的整个生命周期里
   * 是同一个引用——写成字面量快照的话，改密之后（`changed()` 换掉了 identity 对象）下游读到的
   * 仍是旧的那一份，且**不报错、不变红**。
   */
  const 会话: AuthSession = {
    get identity() {
      return 身份()
    },
    signOut,
  }

  return (
    <>
      {/* 探查期间**不闪工作台**——先渲染再被顶掉，用户看到的是自己的会话「跳」了一下。
          但「不闪工作台」不等于「什么都不渲染」（审查 R-09）：那样整页是一片**纯白**，
          内核挂住时既没有去向也没有尽头。占位只占位，`children` 一个字都不出现。
          底色取工作台那一支（`bg-v2-background-bg-base`）而不是留白，省得进工作台时再跳一下色。 */}
      <Show when={view() === "probing"}>
        <div
          data-slot="auth-probing"
          class="flex h-dvh w-screen items-center justify-center bg-v2-background-bg-base text-[13px] leading-5 text-v2-text-text-muted"
        >
          正在启动…
        </div>
      </Show>

      <Show when={view() === "login"}>
        <LoginPage send={props.send} onSignedIn={signIn} />
      </Show>
      {/* 会话只发给**工作台那一支**：登录页与探查占位上没有任何东西该读身份，发出去只是多一个
          能读错的地方。`AuthSessionProvider` 随这棵子树生死，门一卸载它一并没了。 */}
      <Show when={view() === "app"}>
        <AuthSessionProvider value={会话}>{props.children}</AuthSessionProvider>
      </Show>
      <Show when={mustChangePassword()}>
        <ChangePassword send={props.send} onChanged={changed} onLater={() => setDeferred(true)} />
      </Show>
    </>
  )
}
