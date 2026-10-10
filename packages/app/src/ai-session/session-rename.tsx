import type { JSX } from "solid-js"
import { 就地改名输入 } from "../components/inline-rename-input"

/**
 * 会话重命名的**就地编辑器**——左栏右键菜单与右栏顶栏**共用这一个**。
 *
 * ## 它是一个薄包装；交互只有一份
 *
 * 「改名字那一下」的全部判据——三条键盘语义（Enter 交 / Escape 不交 / 失焦＝改完了）、
 * **一次性结算**守卫、中文输入法里那个 Enter、`trim()` 之后算不算改过——都长在
 * `components/inline-rename-input.tsx`。本文件只选**三样**：
 *
 * - `槽位="session-rename-input"`：既有测试与样式按它查，**一个字都不能改**；
 * - `可访问名称="会话名称"`：编辑态与展示态同名（DESIGN §4.3）；
 * - **不传占位**：会话总是有一个名字可预填（`undefined` 时预填空串就够，见 `原名`）。
 *
 * ⚠️ **为什么不把这段交互留在会话目录**：文件树的行内重命名要走**同一套**。真正会漂的是那几条
 * **看不见的**判据——它们不报错、不变红，只长成「文件能改、会话不能」这种沉默的分叉
 * （用户对这一类需求的原话：「与 1 中的功能一致，直接复用，不要重复造轮子」；`LEARNINGS #002-06`：
 * 同一个判断不许两处各写一份）。
 *
 * ⚠️ props 形状（`原名` / `on提交` / `on取消`）**原样保留**：两个调用点（`sidebar-sessions.tsx`
 * 与 `ai-session-slot.tsx`）一处都不用改，改动面只剩本文件。
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

export function 会话重命名输入(props: 会话重命名输入Props): JSX.Element {
  return (
    <就地改名输入
      槽位="session-rename-input"
      可访问名称="会话名称"
      原名={props.原名}
      on提交={props.on提交}
      on取消={props.on取消}
    />
  )
}
