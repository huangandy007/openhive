/**
 * 「看不了」的**分类标记**——抛它的一方据此表达「这不是你的文件坏了」，字节视图壳
 * （`binary-view.tsx`）据此落对应的降级档，而不是一律落 `error`。
 *
 * **为什么非分不可**：`unsupported`（「这种格式暂时看不了」，换个工具打开就行）、
 * `encrypted`（「这个文件是加密的」，去要密码）与 `error`（「这个文件打不开 · 可能已经损坏」，
 * 要怀疑文件本身）对民警是**三件事**。一份**完全合法**的文件被说成「可能已经损坏」，
 * 就是让民警去怀疑一份好文件——归因是反的。
 * 今天已知的抛出点：老 `.doc` 的 OLE2（`document-view.tsx`）、XMind 8 的老格式
 * （`mindmap-view.tsx`）、没接的压缩方式与 zip64（`zip-entry.ts`）落 `unsupported`；
 * 加密 PDF（`pdf-view.tsx`）、加密工作簿（`sheet-view.tsx`）、加密的 zip 条目
 * （`zip-entry.ts`）落 `encrypted`。
 *
 * **为什么用标记属性而不是 `instanceof` 自定义类**：渲染器是懒加载的独立 chunk，真跨了
 * chunk 边界的话同一个类会有两份，`instanceof` 会判 false——而这个坑要在生产里才炸得出来。
 * 字符串键不受模块实例影响。（测试环境里两边同模块，`instanceof` 本来也能过；这是**防御性**
 * 的选择，不是当前必需的。）
 *
 * **为什么单独一个模块，而不是留在 `binary-view.tsx` 里**：抛它的不只有渲染器，
 * `zip-entry.ts`（一个跟视图无关的字节工具）也要抛。让「读 zip」反向依赖「视图壳」是把依赖
 * 方向弄反了；分开之后标记串也只有一份。
 */
import type { DegradedReason } from "@/center/degraded-view"

const 降级标记 = "@@openhive/降级档"

/**
 * 会被**抛出来**的那两档。
 *
 * 收窄到两档不是为了好看：`empty` / `error` / `load-failed` 是壳自己判的，没有对应的标记错，
 * 若这里交回整个 `DegradedReason`，调用点 `setState(看不了 ?? "error")` 就会被 TS 拦下
 * （`load-failed` 不是字节视图的状态）——这个错拦得对，它说明「标记错只走这两档」。
 */
export type 可抛的档 = Extract<DegradedReason, "unsupported" | "encrypted">

/**
 * 造一个带档位的标记错。
 *
 * `说明` 是给**排障的人**看的（进 `Error.message`）：它到不了界面——界面上的措辞在
 * `degraded-view.tsx` 的 `说法` 里（DESIGN §4.6）。⚠️ 而且它多半连控制台都到不了：
 * 视图壳只在**没带标记**（真故障）时才 `console.warn`，带标记的两档是「预期内的边界」、不喊
 * （见 `binary-view.tsx` 那条 catch）。日常能读到它的地方是测试。
 */
function 标记错(说明: string, 档: 可抛的档): Error {
  return Object.assign(new Error(说明), { [降级标记]: 档 })
}

/** 造一个「这种格式我认得出、但不支持」的错。 */
export function 格式不支持(说明: string): Error {
  return 标记错(说明, "unsupported")
}

/** 造一个「文件是加密的」的错——文件一点没坏，缺的只是密码。 */
export function 需要密码(说明: string): Error {
  return 标记错(说明, "encrypted")
}

/**
 * 读抛出来的东西带着哪一档标记；**没带就是 `undefined`**（＝真故障，壳落 `error`）。
 *
 * 只认会被抛出来的那两档：`empty` / `error` / `load-failed` 由壳自己判，没有对应的标记错，
 * 外部就算硬塞进来也不认（否则一个手写的属性能把「真故障」伪装成「已知边界」）。
 */
export function 是哪种看不了(原因: unknown): 可抛的档 | undefined {
  if (typeof 原因 !== "object" || 原因 === null) return undefined
  const 档: unknown = Reflect.get(原因, 降级标记)
  if (档 === "unsupported" || 档 === "encrypted") return 档
  return undefined
}
