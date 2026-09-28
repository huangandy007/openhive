import { createEffect, createSignal, onCleanup, Show, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DegradedView, type DegradedReason } from "./degraded-view"
import type { LoadFileContent } from "./file-content"
import { useCenterTabs } from "./tab-context"
import { contentTabKey } from "./tab-store"
import { extensionOf, type ViewComponent, type ViewRegistry } from "./view-registry"

export interface CenterContentProps {
  registry: ViewRegistry
  load?: LoadFileContent
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

  return (
    <>
      {/*
        页面**常驻**，有内容时只把它藏起来（`display:none`），而不是从树上摘掉。
        生产里 `children` 是上游路由页面，卸载重挂会丢掉整页状态（滚动位置、已取的数据、表单填写）。
        可见时用 `contents` 而非 `block`：不引入多余盒，页面仍是中栏原本的 flex 子项。
        「有内容」含降级提示——tab 开着就轮不到页面（否则未知格式看起来像「点错了」）。
      */}
      <div data-slot="center-page" style={{ display: 内容() ? "none" : "contents" }}>
        {props.children}
      </div>
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
