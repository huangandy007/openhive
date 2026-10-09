import { createSignal, type JSX } from "solid-js"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { 改名草稿 } from "./session-actions"

/**
 * 会话重命名的**就地编辑器**——左栏右键菜单与右栏顶栏**共用这一个**。
 *
 * ## 它只做「改名字那一下」，不碰请求
 *
 * 发请求是 `session-actions.ts` 的 `重命名会话`（两个入口也都调它）。本组件只回答三个问题：
 * **预填什么**、**什么时候算改完了**（Enter / 失焦）、**什么时候不算**（Escape / 空 / 没改）。
 * 「不算」的那几种情形统一喊 `on取消`——**调用方只需要把编辑态收掉**，不必自己再判一遍
 * （判据只有一处，`LEARNINGS #002-06`）。
 *
 * ## 三条键盘语义逐条对齐蓝本
 *
 * 蓝本 = `pages/session/timeline/message-timeline.tsx` 的 `InlineInput` ＋ `saveTitleEditor`
 * （本仓库里已经在用的「点标题就地改名」）。本组件是它的**收窄版**：去掉 mutation、乐观更新与
 * `DropdownMenu`，只留交互。三条：
 *
 * 1. `Enter` ⇒ 交出去，`Escape` ⇒ 什么都不交；
 * 2. 交给 `改名草稿` 判「这份草稿值不值得发出去」——`trim()` 后为空、或与原样相同 ⇒ `undefined`
 *    ⇒ 走取消（**清空标题不是一次重命名**）；
 * 3. `event.isComposing || keyCode === 229` 时的 `Enter` 直接返回——中文输入法里那个 Enter 是
 *    **选字**，不是「改完了」。放在本产品上这条不是洁癖：民警用中文输入法是常态。
 *
 * ## ⚠️ 一次编辑**只结一次账**（2026-10-09 真栈实测后补的守卫）
 *
 * Enter / Escape 一交出，调用方就把编辑态收掉、本组件当场卸载。而**卸载一个仍聚焦的元素**在这里
 * **会**触发 `blur`（Chromium 实测；本文件原先那句「不会触发、规范如此」是错的）⇒ `onBlur={提交}`
 * 会**再结一次账**。真栈上看到的是**两条逐字同款的 `PATCH`**（同一场会话一次改名发两条），而
 * 「只失焦、不按 Enter」只发一条 ⇒ 多出来的那条正是这次补发的 `blur`。
 *
 * 比双发更坏的是 **Escape**：取消之后那次 `blur` 会把用户**刚反悔掉的草稿**交出去——按了 Escape，
 * 名字却改了。所以守卫不能只挡 `提交`，得把**两种结算（交 / 取消）一起挡**：`已结算` 一旦落下，
 * 后续的 Enter / Escape / blur 一律不再动作。
 *
 * 两条路径各有可红的用例钉着：`session-rename.test.tsx` 的「Enter 之后紧接着失焦」「Escape 之后
 * 紧接着失焦」；后者在**拆掉守卫**时实得 `["改了一半"]`（原本 `[]`）。
 */
export interface 会话重命名输入Props {
  /**
   * 当前的名字，**原样**交给 `改名草稿` 做「有没有改」的比较。`undefined` ＝ 还没有名字
   * （左栏 `会话列表行.title` 是可选的），这时预填空串。
   *
   * ⚠️ 不预填 `id`：id 是机器读的，「改个名」不该先从一串字母数字里删起。
   */
  原名?: string
  /** 交出的是**已 trim、且与原样不同**的新名字——判据在 `改名草稿` 里，这里不重写一份。 */
  on提交: (新名: string) => void
  /** Escape、空草稿、原样未改——三种都走这里。调用方把编辑态收掉即可。 */
  on取消: () => void
}

/** 编辑态与展示态用同一个可访问名称：屏幕阅读器读到的都是「会话名称」（DESIGN §4.3）。 */
const 可访问名称 = "会话名称"

export function 会话重命名输入(props: 会话重命名输入Props): JSX.Element {
  const [草稿, set草稿] = createSignal(props.原名 ?? "")

  /**
   * 这次编辑**结过账没有**——见文件头那段。一个实例一次编辑，落一次就不再受理。
   * 普通变量而不是信号：它不驱动任何渲染，只在一段同步的事件序列（Enter/Escape → 卸载 → blur）里
   * 当闸门用。
   */
  let 已结算 = false
  function 结算(动作: () => void) {
    if (已结算) return
    已结算 = true
    动作()
  }

  function 提交() {
    结算(() => {
      const 新 = 改名草稿(草稿(), props.原名)
      if (新 === undefined) return props.on取消()
      props.on提交(新)
    })
  }

  return (
    <InlineInput
      data-slot="session-rename-input"
      aria-label={可访问名称}
      value={草稿()}
      // 打开就聚焦并**全选**：改名多半是整条替换，全选之后直接打字。照蓝本用 `requestAnimationFrame`
      // ——Solid 的 `ref` 回调跑在挂载途中，此刻 `focus()` 会被随后的挂载动作抢走焦点。
      ref={(el) => {
        requestAnimationFrame(() => {
          if (!el.isConnected) return
          el.focus()
          el.select()
        })
      }}
      onInput={(event) => set草稿(event.currentTarget.value)}
      onKeyDown={(event) => {
        // 不让按键冒泡出去：右栏顶栏与左栏列表的外层都有自己的键盘语义，
        // 这里的 Enter / Escape 只属于这次编辑（蓝本同样 `stopPropagation()`）。
        event.stopPropagation()
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === "Enter") {
          event.preventDefault()
          提交()
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          // 走 `结算`：取消也要记账，否则卸载补发的 `blur` 会把刚反悔的草稿交出去（见文件头）。
          结算(() => props.on取消())
        }
      }}
      onBlur={提交}
    />
  )
}
