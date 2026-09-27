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

export function CenterContent(props: ParentProps<CenterContentProps>) {
  const center = useCenterTabs()
  const [内容, set内容] = createSignal<中栏内容 | undefined>(undefined)

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
    onCleanup(() => {
      alive = false
    })

    // 加载期间**不清空**旧视图：一清空，下面那层就会把调用方的路由页翻出来闪一下。这个空档只有
    // 一次 chunk 拉取那么长（同一类格式还只在首次进入时拉），但闪一下的观感像是「点错了」。
    // 视图组件自己管「内容读取中」那一档（`BinaryView` 的 pending 态），这里只管 chunk 这一小段。
    void load().then(
      (Component) => {
        if (alive) set内容({ kind: "view", Component, path: tab.path })
      },
      // 但 chunk **加载不出来**时（断网 / 构建产物缺失）必须收手清空：留着旧文件会让民警
      // 对着「卷宗.pdf」这个标题看立项书的内容。**只是收手还不够**——tab 还开着，内容区得
      // 说清这一回是「预览组件没到位」，与「这个文件坏了」分开说（两者对民警是两件事）。
      () => {
        if (alive) set内容({ kind: "degraded", reason: "load-failed", name: tab.title })
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
