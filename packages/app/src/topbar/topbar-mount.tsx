import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Topbar, type TopbarUser } from "./topbar"

/**
 * 把顶栏投进**宿主元素**里。
 *
 * ## 为什么单独有这么一层
 *
 * 宿主是**上游那条 header 里我们自建的那个 `span`**（`useTitlebarHostMount()` 取到），所以这件事必须在
 * `pages/layout-new.tsx` 那一层做——`<Portal mount={…}>` 要现成的元素，而谁拿得到那个元素
 * 只有入口层知道。但那一层同时长着 `Titlebar` 与八层 provider，**裸挂不起来**（本仓的组件
 * 测试全是不带 provider 的裸挂），故照 `workspace-entry.tsx` 立下的老规矩分层：
 * **能读 context 的那一层算，本层只认值**——宿主、身份、按下态、回调一律从 props 进来。
 *
 * 于是「顶栏到底进没进宿主」这条判据有观测面（`topbar-mount.test.tsx`），
 * 不必去挂整个入口层。
 */
export function TopbarMount(props: {
  /** 宿主元素；为空 = 无处可挂，**一条顶栏都不渲染**（绝不退而求其次塞进中栏）。 */
  host?: HTMLElement | null
  user?: TopbarUser
  homeActive?: boolean
  onOpenHome?: () => void
}) {
  return (
    <Show when={props.host} keyed>
      {(host) => (
        /* 宿主由 `useTitlebarHostMount()` 自建（`span[data-slot=topbar-host]`，挂进 header 里），
           不是 header 自己——`<Portal>` 必然往宿主塞一个无名 `div`，宿主若是 header，那个 div 就是
           header 的直接 div 子元素、会被 `layout-new.tsx` 那条 `>div` 规则连同上游带子一起隐掉
           （2026-10-09 实测：顶栏 0×0）。宿主改自建 `span` 之后这条规则够不到了；Portal 那个无名
           div 的取宽由**宿主自己**（`flex flex-col`）兜底，见 `@/topbar/titlebar-host`。
           这里也**不给宽高**：`h-9` 由 header 给，`items-stretch` 会把它拉满。 */
        <Portal mount={host}>
          <span class="flex min-w-0 flex-1 items-center">
            <Topbar user={props.user} homeActive={props.homeActive} onOpenHome={props.onOpenHome} />
          </span>
        </Portal>
      )}
    </Show>
  )
}
