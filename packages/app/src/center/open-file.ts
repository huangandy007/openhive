/**
 * 打开文件前的**闸门**（2026-10-12 / FR-005）：从「点了打开」到「真的开一张 tab」之间，
 * 问一句大小；太大了先问用户一声。
 *
 * ## 为什么是纯模块，而不是写在 `workspace-entry.tsx` 里
 *
 * 四件事（已经在受焦栏里开着、问大小、问用户、开 tab）各有各的失败方式，而**它们的分支顺序
 * 就是这条需求本身**：先看开没开、再问大小、问不到就放行、太大了才问用户。写成纯模块
 * ⇒ 11 条判据一个组件、一次外呼都不用起（`open-file.test.ts`）。依赖全注入，与
 * `tab-store.ts` 是同一个范式。
 *
 * ## 闸门是「提醒」，不是「关卡」（设计文档 §4.2 ③）
 *
 * `stat` 问不到（没身份 / 网络错 / 服务端那边出了别的岔子）时**放行**：闸门挡的是
 * 「文件太大、界面可能卡」这一件**我们有把握的事**；对没把握的事拦人，等于把网络抖动
 * 变成「打不开文件」。放行之后真卡了，用户还有浏览器自己那条出路。
 *
 * ## 阈值为什么分两档
 *
 * 表格那一档低（5 MB）是因为 SheetJS 要把**整个工作簿模型**在内存里铺开，同样的字节数
 * 比 PDF 贵得多；其余格式（PDF / 图片 / 文本）5 MB 与 10 MB 之间没有这条额外开销。
 * 两个数都是**用户 2026-10-12 裁定的**。
 */

import { contentTabKey, type ContentTab } from "./tab-store"
import { 表格扩展名 } from "./views"
import { extensionOf } from "./view-registry"

/** 闸门的两档阈值（字节）。用户 2026-10-12 裁定：**表格 5 MB，其余 10 MB**。 */
export const 大小闸门 = {
  表格: 5 * 1024 * 1024,
  其余: 10 * 1024 * 1024,
} as const

/** 弹窗要说的两件事：给谁看的名字，和**真实的大小**（不说「很大」这种形容词）。 */
export interface 打开提醒 {
  /** 文件名（含扩展名）。 */
  文件: string
  /** 字节数。 */
  字节: number
}

/** 问用户一句。`true` ＝ 仍然打开。 */
export type 问用户 = (提醒: 打开提醒) => Promise<boolean>

/** 一栏的读写口。`已有` 是**那一刻的快照**，不是 getter——判定与动作必须看同一份。 */
export interface 栏操作 {
  /** 这一栏里已经开着的 tab key（`contentTabKey` 形态）。 */
  已有: readonly string[]
  切到: (key: string) => void
  开: (tab: ContentTab) => void
}

export interface 打开文件的依赖 {
  /** 新 tab 的**来源模块**（`center.module()`），FR-005 的着色与 tab 身份依据。 */
  module: () => string
  /**
   * **新 tab 要落进哪一栏**（受焦栏）。
   *
   * ⚠️ 一次调用里**只读一次**（`createOpenFile` 开头那个 `栏` 常量）：判「已经在栏里开着」、
   * 切过去、开一张，三件事必须落在**同一栏**。分成三个函数各读一次 `activePane()`，
   * 读到两次就可能落在两栏——而那种缺陷不报错、不变红（`LEARNINGS #002-06`）。
   */
  受焦栏: () => 栏操作
  /** 问服务端这个文件多大；`undefined` ＝ **问不到** ⇒ 放行。 */
  stat: (path: string) => Promise<number | undefined>
  /** 超阈值时问用户。 */
  dialog: 问用户
}

/** 某个路径走哪一档阈值。判据与 `view-registry` 认视图时**同一个** `extensionOf`（不另写一份）。 */
function 阈值(path: string): number {
  const 扩展名 = extensionOf(path)
  // 大小写已经在 `extensionOf` 里归一（它回 `.csv` 这种小写形态）。
  return 扩展名 !== undefined && 表格扩展名.includes(扩展名) ? 大小闸门.表格 : 大小闸门.其余
}

/**
 * 造一个「打开文件」的动作。返回值是异步的：问大小与问用户都要等。
 */
export function createOpenFile(依赖: 打开文件的依赖) {
  return async function 打开文件(文件: { path: string; 标题: string }): Promise<void> {
    const 栏 = 依赖.受焦栏()
    const tab: ContentTab = { module: 依赖.module(), title: 文件.标题, path: 文件.path }
    const key = contentTabKey(tab)

    // ① 已经在**这一栏**开着 ⇒ 切过去就完事：内容早就读过，既不问大小也不弹窗。
    if (栏.已有.includes(key)) {
      栏.切到(key)
      return
    }

    // ② 问大小。问不到 ⇒ 放行（`undefined` 与「很小」在这里走同一条路，这是刻意的）。
    const 字节 = await 依赖.stat(文件.path)
    if (字节 !== undefined && 字节 > 阈值(文件.path)) {
      const 要开 = await 依赖.dialog({ 文件: 文件.标题, 字节 })
      // ③ 用户说不了（取消 / 关掉弹窗）⇒ 一张 tab 都不开。**取消就是取消**。
      if (!要开) return
    }

    栏.开(tab)
  }
}
