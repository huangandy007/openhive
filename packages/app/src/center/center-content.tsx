import { createEffect, createSignal, onCleanup, Show, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { LoadFileContent } from "./file-content"
import { useCenterTabs } from "./tab-context"
import { contentTabKey } from "./tab-store"
import { extensionOf, type ViewComponent, type ViewRegistry } from "./view-registry"

export interface CenterContentProps {
  registry: ViewRegistry
  load?: LoadFileContent
}

/** 屏幕上正在渲染的视图：组件 + 它认领的文件。 */
interface 当前视图 {
  Component: ViewComponent
  path: string
}

export function CenterContent(props: ParentProps<CenterContentProps>) {
  const center = useCenterTabs()
  const [view, setView] = createSignal<当前视图 | undefined>(undefined)

  createEffect(() => {
    const key = center.active()
    const tab = key ? center.tabs().find((candidate) => contentTabKey(candidate) === key) : undefined
    const extension = tab ? extensionOf(tab.path) : undefined
    const load = extension ? props.registry.resolve(extension) : undefined

    if (!tab || !load) {
      setView(undefined)
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
        if (alive) setView({ Component, path: tab.path })
      },
      // 但 chunk **加载不出来**时（断网 / 构建产物缺失）必须收手清空：留着旧文件会让民警
      // 对着「卷宗.pdf」这个标题看立项书的内容。
      () => {
        if (alive) setView(undefined)
      },
    )
  })

  return (
    <>
      {/*
        页面**常驻**，有视图时只把它藏起来（`display:none`），而不是从树上摘掉。
        生产里 `children` 是上游路由页面，卸载重挂会丢掉整页状态（滚动位置、已取的数据、表单填写）。
        可见时用 `contents` 而非 `block`：不引入多余盒，页面仍是中栏原本的 flex 子项。
      */}
      <div data-slot="center-page" style={{ display: view() ? "none" : "contents" }}>
        {props.children}
      </div>
      <Show when={view()} keyed>
        {(current) => <Dynamic component={current.Component} path={current.path} load={props.load} />}
      </Show>
    </>
  )
}
