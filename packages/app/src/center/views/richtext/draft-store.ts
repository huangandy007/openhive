import { createSignal } from "solid-js"
import type { LoadFileContent, SaveFileContent } from "@/center/file-content"

/**
 * 中栏文档的草稿 store（2026-10-19）。
 *
 * ## 为什么是模块级、按路径键控
 *
 * 中栏视图在换文件 / 换分屏时会**重挂**（keyed `<Show>`），组件本地信号随卸载一起没。
 * 民警打了半页字再去开另一个文件，回来字就没了——用户实报的第一条。草稿必须活得比组件久，
 * 且按**路径**分开：同时开两篇文档，各自的草稿不能串。
 *
 * ## 为什么定时器与在飞请求也在这里
 *
 * 自动保存的计时器若挂在组件上，切 tab 时 `onCleanup` 一跑就没人再存了。store 活着，
 * 计时器就活着；「切换视图」不再是「放弃保存」的同义词。
 *
 * ## 状态机
 *
 * `clean → dirty → saving → clean`
 *                  ↘ `error`（下一次输入重试）
 *                  ↘ `conflict`（`STALE`：盘上变了，暂停自动保存，等用户载入盘上版本）
 *
 * `conflict` **不因继续打字而解除**：那会把「盘上已经不同」这件事吞掉，下一次保存又会撞。
 */

export type 草稿状态 = "clean" | "dirty" | "saving" | "error" | "conflict"

export interface 草稿 {
  path: string
  content: string
  base: string
  /**
   * **上一次成功交出去的正文**（没有成功过就是初始正文）。
   *
   * 不能拿 `content === base` 判「有没有未保存的字」：写口回来的 `base` 是 `落盘.trim()`，
   * 用户输入的首尾空白被削掉了。拿它比，用户打的尾空行会在存成功后永远显示「未保存」，
   * 并每 800ms 再存一次。`base` 只用于**并发比对**，`已存` 只用于**脏判断**。
   */
  已存: string
  mode: "edit" | "preview"
  status: 草稿状态
  savedAt?: number
  message?: string
  selection: { start: number; end: number }
}

interface 出口 {
  save?: SaveFileContent
  load?: LoadFileContent
}

const 出口表 = new Map<string, 出口>()
const 定时器 = new Map<string, ReturnType<typeof setTimeout>>()
/** 第一笔「与底本不同」的时刻——「上限」从它算起，不是从最后一次击键算起。 */
const 首改 = new Map<string, number>()
const 在飞 = new Map<string, Promise<boolean>>()
let 延迟 = 800
let 上限 = 5000
/** `清空草稿()` 之后，上一代的回包一律作废（换项目时在飞的保存不许写回来）。 */
let 代次 = 0

const [表, set表] = createSignal<ReadonlyMap<string, 草稿>>(new Map())

/** 只读快照；视图用它做细粒度响应。 */
export const 草稿表 = 表

export function 取草稿(path: string): 草稿 | undefined {
  return 表().get(path)
}

export function 登记出口(path: string, 出口项: 出口): void {
  出口表.set(path, { ...出口表.get(path), ...出口项 })
}

function 改表(path: string, 改: (旧: 草稿 | undefined) => 草稿 | undefined): void {
  set表((旧表) => {
    const 旧 = 旧表.get(path)
    const 新 = 改(旧)
    if (新 === 旧) return 旧表
    const 副本 = new Map(旧表)
    if (新 === undefined) 副本.delete(path)
    else 副本.set(path, 新)
    return 副本
  })
}

function 清定时器(path: string): void {
  const 计时 = 定时器.get(path)
  if (计时 !== undefined) clearTimeout(计时)
  定时器.delete(path)
  首改.delete(path)
}

/** 按「停手 800ms、最长 5s」排一次自动保存。conflict 与预览态不排。 */
function 排(path: string): void {
  const 项 = 取草稿(path)
  if (!项 || 项.mode !== "edit" || 项.status === "conflict") return
  if (项.content === 项.已存) {
    清定时器(path)
    return
  }

  const 已有 = 定时器.get(path)
  if (已有 !== undefined) clearTimeout(已有)

  const 起 = 首改.get(path) ?? Date.now()
  首改.set(path, 起)
  const 剩余 = Math.max(0, 上限 - (Date.now() - 起))
  const 等待 = Math.min(延迟, 剩余)

  定时器.set(
    path,
    setTimeout(() => {
      定时器.delete(path)
      void 立即保存(path)
    }, 等待),
  )
}

/** 进入编辑态。已有一份草稿（比如刚切回来）**绝不拿盘上版本盖掉它**。 */
export function 开始编辑(path: string, 初始: { content: string; base: string }): void {
  改表(path, (旧) => {
    if (旧) return { ...旧, mode: "edit" }
    return {
      path,
      content: 初始.content,
      base: 初始.base,
      已存: 初始.content,
      mode: "edit",
      status: "clean",
      selection: { start: 0, end: 0 },
    }
  })
}

/** 用户改字 / 移光标。只有正文真的变了才动状态。 */
export function 改草稿(path: string, content: string, selection: { start: number; end: number }): void {
  改表(path, (旧) => {
    if (!旧) return 旧
    const 正文变了 = content !== 旧.content
    const 选区变了 = selection.start !== 旧.selection.start || selection.end !== 旧.selection.end
    if (!正文变了 && !选区变了) return 旧
    if (!正文变了) return { ...旧, selection }
    // 冲突期间只留字，不恢复自动保存：盘上已经不同，自动存只会再撞一次。
    if (旧.status === "conflict") return { ...旧, content, selection }
    return {
      ...旧,
      content,
      selection,
      // 改回与「上次交出去的那份」相同 ⇒ 已经没有未保存的字，收回 clean。
      // 在飞时继续打字 ⇒ 立刻回 dirty（否则状态栏在用户已经接着改之后还说「保存中…」）；
      // 回包发现正文变了会保持 dirty 并再排一次。
      status: content === 旧.已存 ? "clean" : "dirty",
      message: undefined,
    }
  })
  排(path)
}

/**
 * 立刻存一次。重入时**等在飞那次**，回来若仍有未保存的字就再存一次（不并发、不丢字）。
 *
 * ⚠️ 守卫写在函数里而不是「把按钮置灰」：置灰的按钮在 happy-dom 里连事件都不派，
 * 守卫就永远走不到、拆掉也不变红（`LEARNINGS #006-16`）。
 */
export async function 立即保存(path: string, 强制 = false): Promise<boolean> {
  const 飞的 = 在飞.get(path)
  if (飞的) {
    const 成 = await 飞的
    const 项 = 取草稿(path)
    if (!项 || 项.content === 项.已存) return 成
    return 立即保存(path, 强制)
  }

  const 项 = 取草稿(path)
  if (!项) return false

  if (项.content === 项.已存) {
    if (项.status !== "clean") {
      改表(path, (旧) => 旧 && { ...旧, status: "clean", message: undefined })
    }
    return true
  }

  // 冲突只能由用户明确点「重试 / 保存」穿透；定时器与切预览都走非强制，不许悄悄覆盖。
  if (项.status === "conflict" && !强制) return false

  const save = 出口表.get(path)?.save
  if (!save) {
    改表(path, (旧) => 旧 && { ...旧, status: "error", message: "现在没有存盘出口，改动只在这台机器的内存里。" })
    return false
  }

  清定时器(path)
  const 代 = 代次
  const 存的内容 = 项.content
  const 存底本 = 项.base

  改表(path, (旧) => 旧 && { ...旧, status: "saving", message: undefined })

  const 任务 = (async () => {
    try {
      const 结论 = await save(path, 存的内容, 存底本)
      if (代 !== 代次) return false
      if (!结论.ok) {
        改表(path, (旧) =>
          旧 && {
            ...旧,
            status: 结论.code === "STALE" ? "conflict" : "error",
            message: 结论.message,
          },
        )
        return false
      }

      改表(path, (旧) => {
        if (!旧) return 旧
        const 没再改 = 旧.content === 存的内容
        return {
          ...旧,
          base: 结论.base,
          已存: 存的内容,
          // ⚠️ 不回写 `content`：写口回来的 base 是 `content.trim()` 的口径，回写会把用户
          // 刚打的尾空行当场抹掉。正文保持原样，脏判断靠 `已存`。
          // 存的是旧内容而用户又打了字 ⇒ 状态回 dirty，下面再排一次。
          status: 没再改 ? "clean" : "dirty",
          savedAt: Date.now(),
          message: undefined,
        }
      })
      return true
    } catch (原因) {
      if (代 === 代次) {
        console.warn(`[openhive] 存盘没走通（${path}）`, 原因)
        改表(path, (旧) => 旧 && { ...旧, status: "error", message: "保存文件失败" })
      }
      return false
    } finally {
      在飞.delete(path)
    }
  })()

  在飞.set(path, 任务)
  const 成 = await 任务

  const 后 = 取草稿(path)
  if (后 && 后.status === "dirty") 排(path)
  return 成
}

/** 显式切预览：先冲刷，存成功才切。失败留在编辑态（字一个都不丢）。 */
export async function 切预览(path: string): Promise<boolean> {
  const 项 = 取草稿(path)
  if (!项) return true
  if (项.content !== 项.已存 || 项.status !== "clean") {
    const 成 = await 立即保存(path)
    if (!成) return false
  }
  const 后 = 取草稿(path)
  if (!后 || 后.status !== "clean") return false
  改表(path, (旧) => 旧 && { ...旧, mode: "preview" })
  return true
}

/**
 * 预览那一侧读回来的盘上版本。
 *
 * - 还没有草稿 ⇒ 建一份 preview / clean 的；
 * - 预览且 clean ⇒ 换成新读到的（切回 tab 时盘上可能已经变了）；
 * - 编辑态：底本一致就什么都不做；**底本变了 ⇒ conflict**，绝不静默拿盘上版本盖掉用户手里的字。
 */
export function 记盘上版本(path: string, 盘上: { content: string; base: string }): void {
  改表(path, (旧) => {
    if (!旧) {
      return {
        path,
        content: 盘上.content,
        base: 盘上.base,
        已存: 盘上.content,
        mode: "preview",
        status: "clean",
        // 从预览进编辑时没有「上次的光标」，落到正文末尾（spec §7.2）；放 0 会让用户
        // 一点编辑就从第一个字开始背对刚才在看的地方。
        selection: { start: 盘上.content.length, end: 盘上.content.length },
      }
    }
    if (旧.mode === "preview" && 旧.status === "clean") {
      if (旧.content === 盘上.content && 旧.base === 盘上.base) return 旧
      return { ...旧, content: 盘上.content, base: 盘上.base, 已存: 盘上.content }
    }
    if (旧.base === 盘上.base) return 旧
    return {
      ...旧,
      status: "conflict",
      message: "这份文件在你打开之后被改过（可能有人在别处改过）。为避免覆盖别人的改动，请载入盘上版本。",
    }
  })
}

/** 冲突时用户选「载入盘上版本」：重新读一次，把草稿换成盘上那份。 */
export async function 载入盘上版本(path: string): Promise<boolean> {
  const load = 出口表.get(path)?.load
  if (!load) return false
  const 内容 = await load(path)
  if (内容?.type !== "text") return false
  清定时器(path)
  // 读口回来的 content 正是服务端比对用的 base（BOM / 首尾空白已削、CRLF 保留）。
  改表(
    path,
    (旧) =>
      旧 && {
        ...旧,
        content: 内容.content,
        base: 内容.content,
        已存: 内容.content,
        status: "clean",
        message: undefined,
      },
  )
  return true
}

/** 换项目时清空：旧项目的正文不许跟着串到新项目。 */
export function 清空草稿(): void {
  代次++
  for (const 计时 of 定时器.values()) clearTimeout(计时)
  定时器.clear()
  首改.clear()
  在飞.clear()
  出口表.clear()
  set表(new Map())
}

/** 测试与「读者偏好」用；省略 = 回到 800ms / 5s。 */
export function 设自动保存参数(参数: { 延迟?: number; 上限?: number } | undefined): void {
  延迟 = 参数?.延迟 ?? 800
  上限 = 参数?.上限 ?? 5000
}
