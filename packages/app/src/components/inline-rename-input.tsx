import { createSignal, type JSX } from "solid-js"
import { InlineInput } from "@opencode-ai/ui/inline-input"

/**
 * **就地改名输入**——「改个名字」这一下交互的唯一实现。
 *
 * ## 它只做「改名字那一下」，不碰请求
 *
 * 发请求是各调用方自己的事（会话标题走 `session-actions.ts` 的 `重命名会话`、文件树走
 * `openhive-file-ops.ts` 的 `renameEntry`）。本组件只回答三个问题：**预填什么**、
 * **什么时候算改完了**（Enter / 失焦）、**什么时候不算**（Escape / 空 / 没改）。
 * 「不算」的那几种情形统一喊 `on取消`——**调用方只需要把编辑态收掉**，不必自己再判一遍
 * （判据只有一处，`LEARNINGS #002-06`）。
 *
 * ## ⚠️ 三个入口共用一份，别在旁边再写一份
 *
 * 会话标题（左栏右键菜单 / 右栏顶栏）与文件树的行内重命名走的是**同一套**交互。真正会漂的是
 * 那几条**看不见的**判据——一次性结算、中文输入法那个 Enter、trim 之后算不算改过——它们
 * **不报错、不变红**，只是「文件能改、会话不能」这种沉默的分叉（用户对这一类需求的原话：
 * 「与 1 中的功能一致，直接复用，不要重复造轮子」）。
 *
 * 于是各入口只选**三样**：`槽位`（`data-slot`，测试与样式要用）、`可访问名称`（屏幕阅读器读的）、
 * `占位`（**新建**那一支唯一的提示——没有原名可预填）。
 *
 * ## 三条键盘语义逐条对齐蓝本
 *
 * 蓝本 = `pages/session/timeline/message-timeline.tsx` 的 `InlineInput` ＋ `saveTitleEditor`
 * （本仓库里已经在用的「点标题就地改名」）。本组件是它的**收窄版**：去掉 mutation、乐观更新与
 * `DropdownMenu`，只留交互。三条：
 *
 * 1. `Enter` ⇒ 交出去，`Escape` ⇒ 什么都不交；
 * 2. 交给 `改名草稿` 判「这份草稿值不值得发出去」——`trim()` 后为空、或与原样相同 ⇒ `undefined`
 *    ⇒ 走取消（**清空名字不是一次改名**）；
 * 3. `event.isComposing || keyCode === 229` 时的 `Enter` 直接返回——中文输入法里那个 Enter 是
 *    **选字**，不是「改完了」。放在本产品上这条不是洁癖：民警用中文输入法是常态。
 *
 * ## ⑥ 步落点清单：同形的有两处，只合并得动这一处
 *
 * 「就地改名」这条前提（**预填原名 · Enter 交 · Escape 撤 · 失焦＝交 · 草稿与原样比较 · 一次编辑只结一次账**）
 * 在全仓只有三处用它，逐处问过「是不是同一条前提」：
 *
 * | 落点 | 是不是同一条前提 | 本次处置 |
 * |---|---|---|
 * | `ai-session/session-rename.tsx` | 是（向左栏/右栏两处供给） | 收成薄包装，指向本文件 |
 * | `pages/session/timeline/message-timeline.tsx:1430` 的 `saveTitleEditor` | 是——**它就是蓝本** | ⚠️ **上游文件，一字不动**（第一号约束：最小化合并冲突）；登记为「已知同形、暂不合并」 |
 * | `pages/layout/inline-editor.tsx:87` | **不是** | 失焦＝**放弃**草稿（不是提交）、无一次性结算、值挂在控制器级共享 store（同一刻只许一个编辑器）⇒ 语义不同，不动 |
 *
 * 另外全仓十几处 `isComposing` 守卫（`search-keydown.ts` / `list.tsx` / `dialog-*.tsx` /
 * `prompt-input.tsx` / `line-comment-v2.tsx` …）的前提是「**Enter 提交这一下**」——没有「原名草稿」
 * 这件事，不在这条前提上。
 * ## ⚠️ 一次编辑**只结一次账**（2026-10-09 真栈实测后补的守卫）
 *
 * Enter / Escape 一交出，调用方就把编辑态收掉、本组件当场卸载。而**卸载一个仍聚焦的元素**在这里
 * **会**触发 `blur`（Chromium 实测；本文件的前身曾断言「不会触发、规范如此」，**被实测证伪**）
 * ⇒ `onBlur={提交}` 会**再结一次账**。真栈上看到的是**两条逐字同款的 `PATCH`**（同一场会话一次
 * 改名发两条），而「只失焦、不按 Enter」只发一条 ⇒ 多出来的那条正是这次补发的 `blur`。
 *
 * 比双发更坏的是 **Escape**：取消之后那次 `blur` 会把用户**刚反悔掉的草稿**交出去——按了 Escape，
 * 名字却改了。所以守卫不能只挡 `提交`，得把**两种结算（交 / 取消）一起挡**：`已结算` 一旦落下，
 * 后续的 Enter / Escape / blur 一律不再动作。
 *
 * 两条路径各有可红的用例钉着：`inline-rename-input.test.tsx` 的「Enter 之后紧接着失焦」
 * 「Escape 之后紧接着失焦」；后者在**拆掉守卫**时实得 `["改了一半"]`（原本 `[]`）。
 */
export interface 就地改名输入Props {
  /** `data-slot` 的名字——各调用方**自己那一处**的槽位名（测试与样式都按它查）。 */
  槽位: string
  /** 屏幕阅读器读到的名字（DESIGN §4.3：不单以图形 / 上下文传意）。 */
  可访问名称: string
  /** 空态提示。**新建**那一支没有原名可预填，这是唯一的提示。 */
  占位?: string
  /**
   * 当前的名字，**原样**交给草稿判据做「有没有改」的比较。`undefined` ＝ 还没有名字
   * （会话的 `title` 是可选的 / 文件树的新建），这时预填空串。
   *
   * ⚠️ 不预填 id 一类的机器值：那会让「改个名」变成「先把那串字母数字删掉」。
   */
  原名?: string
  /** 交出的是**已 trim、且与原样不同**的新名字——判据在下面 `草稿` 里，调用方不重写一份。 */
  on提交: (新名: string) => void
  /** Escape、空草稿、原样未改——三种都走这里。调用方把编辑态收掉即可。 */
  on取消: () => void
}

/**
 * 这份草稿**值不值得发出去**——不值得就是 `undefined`（调用方据此**不发请求**、直接退出编辑态）。
 *
 * 三条判据，一条一个理由：
 * - **trim 后为空** ⇒ 不改：把名字清空不是一次改名（会话那侧会退回去显示 id、文件那侧根本
 *   建不出一个没有名字的条目）。
 * - **trim 后与原名相同** ⇒ 不改：用户点开输入框、什么都没动就关掉，不该产生一次写请求
 *   （蓝本 `message-timeline.tsx` 的 `saveTitleEditor` 就是这么收尾的）。
 * - 其余 ⇒ 交 **trim 后**的值：`"  新名字  "` 两头的空白是输入法的边角，不是名字的一部分。
 *
 * ⚠️ 这个函数**曾经长在** `ai-session/session-actions.ts`（会话改名那两个入口引它）。文件树要用
 * 同一条判据时它被搬到这里——**一份实现、一个名字**，那边改成再导出，既有 import 一处没动
 * （`LEARNINGS #002-06`：同一个判断不许两处各写一份）。
 */
export function 改名草稿(草稿: string, 原名: string | undefined): string | undefined {
  const 新 = 草稿.trim()
  if (新 === "" || 新 === 原名) return undefined
  return 新
}

export function 就地改名输入(props: 就地改名输入Props): JSX.Element {
  const [草稿值, set草稿值] = createSignal(props.原名 ?? "")

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
      const 新 = 改名草稿(草稿值(), props.原名)
      if (新 === undefined) return props.on取消()
      props.on提交(新)
    })
  }

  return (
    <InlineInput
      data-slot={props.槽位}
      aria-label={props.可访问名称}
      placeholder={props.占位}
      value={草稿值()}
      // 打开就聚焦并**全选**：改名多半是整条替换，全选之后直接打字。照蓝本用 `requestAnimationFrame`
      // ——Solid 的 `ref` 回调跑在挂载途中，此刻 `focus()` 会被随后的挂载动作抢走焦点。
      //
      // ⚠️ 新建那一支**也全选**（空串上全选＝无操作），不为它单开一条分支：两种情形的差别只是
      // 预填值，而「打开就聚焦并全选」这条判据对两者都能说清。
      ref={(el) => {
        requestAnimationFrame(() => {
          if (!el.isConnected) return
          el.focus()
          el.select()
        })
      }}
      onInput={(event) => set草稿值(event.currentTarget.value)}
      onKeyDown={(event) => {
        // 不让按键冒泡出去：文件树的**行**自己也有键盘语义（回车/空格＝选中、←/→＝开合），
        // 会话列表的行同样有自己的键盘语义——这里的 Enter / Escape 只属于这次编辑（蓝本同样
        // `stopPropagation()`）。少了这一句，敲 Enter 会**同时**改名与选中那一行。
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
