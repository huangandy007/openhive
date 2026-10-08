import { createEffect, createSignal, onCleanup, Show, type JSX, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DegradedView, type DegradedReason } from "./degraded-view"
import type { LoadFileContent } from "./file-content"
import { useCenterTabs } from "./tab-context"
import { contentTabKey } from "./tab-store"
import { extensionOf, type ViewComponent, type ViewRegistry } from "./view-registry"

export interface CenterContentProps {
  registry: ViewRegistry
  load?: LoadFileContent
  /**
   * 调用方的页面（`children`）此刻**可不可以露出来**。省略 = 可以（与引入本 prop 之前逐字同行为）。
   *
   * **为什么需要它**：`children` 在生产里是**上游路由自己的页面**——在
   * `/server/:key/session/:id` 上就是 `pages/session.tsx`（一页完整的 AI 会话：消息流 ＋ composer）。
   * 而中栏按 design-v2 §8.2 是「用户看结果、改结果」的地方、右栏才是「让 AI 干活」的地方
   * ⇒ 在这一条路由上，中栏把上游会话页露出来就等于**同一场会话在屏幕上画了两遍**（两个输入框、
   * 两条消息流），且两个 composer 都在真的发消息。这是 2026-10-08 真栈上肉眼报出的缺陷。
   *
   * **为什么不在这里读路由**：本组件（以及它的挂载者 `workspace-entry.tsx`）被组件测试**裸挂**
   * （不挂 Router）⇒ 在这里 `useLocation()` 会当场抛。判据由**壳层**算好传进来
   * （`pages/layout-new.tsx` 的 `routeSessionID(location.pathname) === undefined`），
   * 与 `right` / `projectData` / `loadFile` 同一个注入理由：**能读 context 的那一层算，本层只认值**。
   */
  pageVisible?: boolean
  /**
   * 「页面不露、也没有激活的 tab」时拿什么替。省略 = 什么都不露（中栏空白）。
   *
   * 判据（三选一）在下面那段注释里：**tab 优先，其次页面，最后才是它**。它**不是**「没有内容时
   * 的通用空态」——tab 开着但内容看不了时仍然由内容区说话（`degraded`），轮不到它。
   *
   * ⚠️ `JSX` 必须**从这个 import 进来**，不能靠全局那个：本包同时装着 `@types/react`，**裸写
   * `JSX.Element` 解析到的是 React 的 `ReactElement`**，而本文件里 JSX 表达式产出的却是 solid 的
   * `JSX.Element`（`jsxImportSource: "solid-js"`）——两者互不兼容，报错长成
   * 「Type 'Element' is not assignable to type 'Element | undefined'」，看不出是两个 `Element`。
   * 这是 2026-10-08 当场探针量出来的（`LEARNINGS #003-04`），不是推断。
   */
  empty?: JSX.Element
}

/**
 * 等一个视图 chunk 的上界。
 *
 * 为什么非要有个上界：`load()` 若**悬着不 settle**（网关把请求吃掉、网络卡在半路），
 * 上面那条「加载期间留着旧视图」的规矩就变成最糟的结果——民警对着「卷宗.pdf」的标题看立项书
 * 的内容，而且**永远等不到头**。失败至少还有个说法，悬挂连说法都没有。
 *
 * 上界只决定「什么时候不再干等」，不取消那次加载：chunk 若在到点后回来了，内容照常补上
 * （见测试「悬着的 chunk 到点后才回来」）。15 秒是「本地/内网拉一个 chunk」的极宽上限——
 * 正常是几十毫秒，超过这个数只可能是真出事了。
 */
export const 加载上界 = 15_000

/**
 * 内容区此刻该显示什么，三选一：
 * - `view`：解析到了视图，且它已经到场
 * - `degraded`：tab 开着，但这份内容**看不了**（没人认领的格式 / 预览组件没加载出来）
 * - `undefined`：没有激活的 tab —— 内容区交还调用方（生产里是上游路由页面）
 *
 * 「tab 开着」与「tab 没开」必须分开：前者内容区归 tab，哪怕看不了也得**由内容区说话**；
 * 后者才轮到调用方的页面（T015 之前这两种都落到 `undefined`，于是点开一个未知格式的文件
 * 会翻回路由页 —— 屏幕上看着像「点错了」，而不是「这个文件看不了」）。
 */
type 中栏内容 =
  | { kind: "view"; Component: ViewComponent; path: string }
  | { kind: "degraded"; reason: DegradedReason; name: string }

/**
 * 「还是同一份内容吗」。**这不是省渲染的优化，是正确性的一部分。**
 *
 * 上游 `CenterTabsProvider` 每个动作都 `setState` 一个**新对象**，所以下面那个读了 `center.tabs()`
 * 的 effect 会为「关掉别的 tab」「切模块」这类**内容一字未变**的操作重跑。若 `内容` 用默认的 `===`
 * 比较，effect 里写入的新字面量永远算「变了」，`<Show keyed>` 就会把当前视图**卸载重挂**——文件字节
 * 重新拉一遍、渲染器重跑（pdfjs 重解析 / docx 重排版）、代码编辑器与 PDF 阅读位置归零。全静默发生，
 * 却正好踩碎 FR-006 的「不打扰」与 SC-002 的「内容不丢失」。
 *
 * 但「换了文件」必须**照旧**重建：两张同类型 tab 之间切换时组件是同一个，不重建它就不会按新 path
 * 重新取数。所以这里逐字段比，而不是一刀切「什么都不重建」。
 */
function 还是同一份(a: 中栏内容 | undefined, b: 中栏内容 | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind === "view" && b.kind === "view") return a.Component === b.Component && a.path === b.path
  if (a.kind === "degraded" && b.kind === "degraded") return a.reason === b.reason && a.name === b.name
  return false
}

export function CenterContent(props: ParentProps<CenterContentProps>) {
  const center = useCenterTabs()
  const [内容, set内容] = createSignal<中栏内容 | undefined>(undefined, { equals: 还是同一份 })

  createEffect(() => {
    const key = center.active()
    const tab = key ? center.tabs().find((candidate) => contentTabKey(candidate) === key) : undefined

    if (!tab) {
      set内容(undefined)
      return
    }

    const extension = extensionOf(tab.path)
    const load = extension ? props.registry.resolve(extension) : undefined

    if (!load) {
      // 没人认领这个格式（未知扩展名，或者干脆没有扩展名）。**不白屏**：内容区当场给出
      // 降级提示，且说得出是哪个文件——这一步没有 chunk 要等，同步给（T015 / FR-007）。
      set内容({ kind: "degraded", reason: "unsupported", name: tab.title })
      return
    }

    // 视图是**懒加载**的（注册表存的是 `load: () => Promise<组件>`），拿到它要等一个 chunk。
    // 结果可能**迟到**：用户等不及已经切走了。`alive` 在 effect 重跑 / 组件卸载时被 Solid 置否，
    // 迟到的结果就此丢弃——否则上一个文件的组件会盖掉后选中的文件。
    let alive = true
    let 计时器: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => {
      alive = false
      clearTimeout(计时器)
    })

    /**
     * 没等到 chunk 就收手（失败到点 / 干脆悬着不回来都走这条）。
     *
     * 收手清空是不能省的：留着旧文件会让民警对着「卷宗.pdf」这个标题看立项书的内容。
     * 但**只是收手还不够**——tab 还开着，内容区得说清这一回是「预览组件没到位」，
     * 与「这个文件坏了」分开说（两者对民警是两件事）。
     */
    const 收手 = () => {
      if (alive) set内容({ kind: "degraded", reason: "load-failed", name: tab.title })
    }
    计时器 = setTimeout(收手, 加载上界)

    // 加载期间**不清空**旧视图：一清空，下面那层就会把调用方的路由页翻出来闪一下。这个空档只有
    // 一次 chunk 拉取那么长（同一类格式还只在首次进入时拉），但闪一下的观感像是「点错了」。
    // 视图组件自己管「内容读取中」那一档（`BinaryView` 的 pending 态），这里只管 chunk 这一小段。
    void load().then(
      (Component) => {
        clearTimeout(计时器)
        // 到点收过手之后 chunk 才回来：照样把内容补上——那个提示说的是「不再干等」，
        // 不是「这次一定看不了」。晚到的比永远不到强。
        if (alive) set内容({ kind: "view", Component, path: tab.path })
      },
      () => {
        // 失败与悬挂在这里合流：对民警是同一件事——**预览组件没到位**，说法也只该有一种。
        clearTimeout(计时器)
        收手()
      },
    )
  })

  /**
   * 页面此刻露不露。省略 `pageVisible` 即恒真（与引入这个 prop 之前逐字同行为）。
   * 读一次 props 就够了——调用方传的是 getter，Solid 会把这条访问挂进依赖图。
   */
  const 露页 = () => props.pageVisible ?? true

  return (
    <>
      {/*
        页面**常驻**，不看它时只把它藏起来（`display:none`），而不是从树上摘掉。
        生产里 `children` 是上游路由页面，卸载重挂会丢掉整页状态（滚动位置、已取的数据、表单填写）。
        可见时用 `contents` 而非 `block`：不引入多余盒，页面仍是中栏原本的 flex 子项。

        三档，优先级从上到下（与上面 `中栏内容` 那段注释同一套判据，别在别处再写一份）：
        ① tab 开着（含降级提示）⇒ 藏页面，由内容区说话（否则未知格式看起来像「点错了」）；
        ② 没 tab 且 `露页()` ⇒ 露页面 —— 这是引入 `pageVisible` 之前的唯一形态；
        ③ 没 tab 且 `!露页()` ⇒ 页面不露，交 `empty`（会话路由下中栏让位给右栏，见 prop 上注释）。
      */}
      <div data-slot="center-page" style={{ display: 内容() || !露页() ? "none" : "contents" }}>
        {props.children}
      </div>
      <Show when={!内容() && !露页()}>{props.empty}</Show>
      <Show when={内容()} keyed>
        {(current) =>
          current.kind === "view" ? (
            <Dynamic component={current.Component} path={current.path} load={props.load} />
          ) : (
            <DegradedView reason={current.reason} name={current.name} />
          )
        }
      </Show>
    </>
  )
}
