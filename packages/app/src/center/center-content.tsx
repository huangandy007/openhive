import { createMemo, Show, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { LoadFileContent } from "./file-content"
import { useCenterTabs } from "./tab-context"
import { contentTabKey } from "./tab-store"
import { extensionOf, type ViewRegistry } from "./view-registry"

export interface CenterContentProps {
  /** 扩展名 → 视图的注册表。**注入**而非 import 应用单例：测试各用各的，互不串味。 */
  registry: ViewRegistry
  /** 取内容的接缝，原样交给视图（视图不自行取数）。 */
  load?: LoadFileContent
}

/**
 * 中栏内容区（FR-007）：把**当前激活的** tab 按扩展名路由到它的视图。
 *
 * 这一层只做路由，不碰内容——内容怎么来由注入的 `load` 决定，怎么画由视图决定。
 *
 * 路由不到就落回 `children`：不替调用方猜「未知类型长什么样」（那是 T015 的降级呈现），
 * 也不留白屏。`keyed` 是必需的——两张 document tab 之间切换时组件是同一个，
 * 不重挂则视图不会按新 path 重新取数。
 */
export function CenterContent(props: ParentProps<CenterContentProps>) {
  const center = useCenterTabs()

  const current = createMemo(() => {
    const key = center.active()
    if (!key) return undefined
    const tab = center.tabs().find((candidate) => contentTabKey(candidate) === key)
    if (!tab) return undefined
    const extension = extensionOf(tab.path)
    if (!extension) return undefined
    const Component = props.registry.resolve(extension)
    if (!Component) return undefined
    return { Component, path: tab.path }
  })

  return (
    <Show when={current()} keyed fallback={props.children}>
      {(view) => <Dynamic component={view.Component} path={view.path} load={props.load} />}
    </Show>
  )
}
