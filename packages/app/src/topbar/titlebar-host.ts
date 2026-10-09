import { createSignal, onCleanup, onMount } from "solid-js"

/**
 * 我们的顶栏要挂进的**宿主元素**：上游那条 v2 标题栏的 `<header data-slot="titlebar-v2">`
 * 里，**本产品自建的一个 `span`**（`[data-slot="topbar-host"]`）。
 *
 * ## 为什么挂进 header 里当**静态子元素**，而不是在它外面自己铺一条带子
 *
 * 那条 header 身上有四样本产品不该重算、也重算不对的东西：
 * ① `h-9`（行高）；② macOS 红绿灯的 `padding-left`；③ Windows 下
 * `env(titlebar-area-width)` 的宽度 ＋ `margin-right: auto`（避开原生 caption 按钮）；
 * ④ Electron 的拖窗区（`data-tauri-drag-region`，样式规则在 `packages/ui/src/styles/base.css`）。
 * 挂进去当**子元素**，这四样自动跟着走；在外面自己 `absolute` 铺一条，就得逐条镜像一遍
 * ——而镜像会漂，且漂了不报错（`LEARNINGS #003-05`）。
 *
 * ## 为什么宿主**不能是 header 自己**（2026-10-09 修「主界面顶栏一个元素都看不到」）
 *
 * 原来是把 header 本身交给 `<Portal>` 当宿主。但 **`<Portal>` 必然**往宿主里塞一个**无名
 * `div`**（solid-js 1.9.10 `web/dist/web.js:731` `createElement("div")` ＋ `:742 appendChild`），
 * 而 `pages/layout-new.tsx` 上那条 `[&_header[data-slot=titlebar-v2]>div]:hidden` 吃的正是
 * **header 的直接 `div` 子元素** ⇒ 我们整棵顶栏落进那个 div、被**同一条规则**一起隐掉。
 * 真浏览器实测（1440×900，真栈）：header **1438×36 可见**，而顶栏 / 品牌 / 动作全是 **0×0**；
 * 对照实测：把那个 div 内联 `display:block` ⇒ 顶栏当场 **392×28**（宽仍不对，见下）。
 * 症状是**顶栏空白**——不报错、不变红（`LEARNINGS #006-13` 那一族：另一个写入出口）。
 *
 * 宿主改成自建的 `span` 后，那条 `>div` 规则**在结构上**就够不到我们的子树了。但还留着一个
 * 洞：Portal 那个无名 div **没有 class、也就没法自己 `flex-1`**，当 flex 项会缩到内容宽
 * （实测 **392px** / header 1438px）——所以宿主的主轴取**竖的**（`flex flex-col`）：
 * 那个 div 便在**交叉轴**方向自动撑满宽度，这条兜底与宿主一起长在**同一个文件**里
 * （不靠外层那条类去补，少一处与上游漂移的面）。
 *
 * ## 取法照上游的 `useTitlebarRightMount`（`components/titlebar.tsx`）
 *
 * 同一个套路：`onMount` 时按属性查一次、存成信号。上游那个的查询键是 `#opencode-titlebar-right`
 * 这个 id，我们这个是 `data-slot="titlebar-v2"` 这个属性。
 *
 * ⚠️ **这个字符串同时是两处的前提**：本文件的查询、`pages/layout-new.tsx` 上那条把上游带子隐掉的
 * 类。上游若改了它，症状是「上游那条带子（标签页条 / 渠道徽标 / 上游主页按钮）重新露出来」
 * ——**看得见**，不是静默的（那时 `mount()` 也会返回 null、顶栏不渲染）。
 * 挂载点是我们自己造的，所以**也得我们自己收**（`onCleanup` 摘掉）。
 */
export function useTitlebarHostMount() {
  const [mount, setMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    const header = document.querySelector<HTMLElement>('header[data-slot="titlebar-v2"]')
    if (!header) return
    /* 刻意是 `span` 而不是 `div`：`layout-new.tsx` 那条 `>div` 规则吃的就是 div 子元素。
       · `flex-1 min-w-0`：它作为 flex 项在 header（`flex flex-row`）里取宽；
       · `flex flex-col justify-center`：**为 Portal 那个无名 div 兜底**——那个 div 没有 class、
         自己 `flex-1` 不了，若宿主的**主轴是横的**它就会缩到内容宽（实测 392 / 1438）；
         主轴改成竖的之后，它作为**交叉轴**方向自动撑满宽度，`justify-center` 再把它竖直居中。
         真浏览器实测（1440×900）：顶栏 1438×28 = header 宽 1438 的 100%、居中。 */
    const host = document.createElement("span")
    host.dataset.slot = "topbar-host"
    host.className = "flex flex-col justify-center flex-1 min-w-0"
    header.appendChild(host)
    setMount(host)
  })
  onCleanup(() => mount()?.remove())
  return mount
}
