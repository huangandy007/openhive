/**
 * 「待定位行」模块级通道（012 · T6 / R-F10 / FR-033）。
 *
 * 检查器里的出处被点开时，关系图视图先 `请求定位`，再打开材料 tab；材料页的
 * `MaterialFacts` 读 `取待定位`，等清单落地后滚动并高亮那一行。
 *
 * 为什么走模块级信号而不是 tab 参数：`case://` 伪路径只有三段（`case-route.ts`），
 * 往 `arg` 里塞行号要改路由段数（简报明确禁止），另开 tab 类型要动上游 tab 去重。
 *
 * `序` 每次请求都自增：同一 (`项目`,`材料`,`行号`) 连点两次也必须再次触发定位
 * （信号写同一个对象不会通知，写新对象但读者只比较载荷就会漏掉第二次）。
 */
import { createSignal } from "solid-js"

export interface 待定位 {
  readonly 项目: string
  /** 材料页的项目内相对路径（不是出处串里的材料 id）；材料页按 `props.path` 判命中。 */
  readonly 材料: string
  readonly 行号: number
  readonly 序: number
}

const [待定位, set待定位] = createSignal<待定位 | undefined>()

/** 当前待定位目标（材料页的 `createEffect` 读它）。 */
export const 取待定位 = 待定位

/** 请求定位到某份材料**路径**的某一行；`序` 自增，同一条再点一次也触发。 */
export function 请求定位(项目: string, 材料: string, 行号: number): void {
  set待定位((旧) => ({ 项目, 材料, 行号, 序: (旧?.序 ?? 0) + 1 }))
}

/** 清空（测试 / 离开上下文时用）。 */
export function 清待定位(): void {
  set待定位(undefined)
}
