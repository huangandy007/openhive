/**
 * 「看不了」的**分类标记**——抛它的一方据此表达「这不是你的文件坏了」，字节视图壳
 * （`binary-view.tsx`）据此落对应的降级档，而不是一律落 `error`。
 *
 * **为什么非分不可**：`unsupported`（「这种格式暂时看不了」，换个工具打开就行）、
 * `encrypted`（「这个文件是加密的」，去要密码）、`load-failed`（「这次没能打开预览」，
 * 重开这张标签）与 `error`（「这个文件打不开 · 可能已经损坏」，要怀疑文件本身）
 * 对民警**各是一件不同的事**——每一档指向的下一个动作不同（换工具 / 要密码 / 重开标签 / 重新取证）。
 * ⚠️ 这里**刻意不写「几件事」**：降级档一共 5 个取值，写数字会与那份契约对不上账
 * （第十轮 M-10-4 正是这么数出来的）。⚠️ 而且**上面这 4 档里只有 3 档是本模块抛的**：
 * `empty`（壳判「没取到内容」）与 `error`（壳判真故障）都**不经这里的标记抛出**——
 * 证据就是下面 `可抛的档` 那份 `Extract`（第十一轮 M-11-2）。
 * 一份**完全合法**的文件被说成「可能已经损坏」，就是让民警去怀疑一份好文件——归因是反的。
 * 今天已知的抛出点：Word 97–2003 的 OLE2（`document-view.tsx`）、XMind 8 的老格式
 * （`mindmap-view.tsx`）、没接的压缩方式与 zip64 的三处哨兵（`zip-entry.ts`）落 `unsupported`；
 * 加密 PDF（`pdf-view.tsx`）、加密的 Office 容器（`document-view.tsx`，进容器认加密流名）、
 * 加密工作簿（`sheet-view.tsx`，靠 SheetJS 的说法）、加密的 zip 条目（`zip-entry.ts`）
 * 落 `encrypted`；**渲染器自己的懒加载块没到**（`document-view.tsx` 认加密流要的 xlsx、
 * `pdf-view.tsx` 的 worker 脚本）落 `load-failed`。
 *
 * ⚠️ 新增一档时别只加一处：同一个文件**按扩展名走不同视图**就会走不同的判定（加密的 `.xlsx`
 * 走 `sheet-view`、加密的 `.docx` 走 `document-view`）——只改一边的后果是同一个文件按扩展名
 * 给出两种说法。这正是加密的 Office 文档当初漏掉的那一处。
 *
 * **为什么用标记属性而不是 `instanceof` 自定义类**：渲染器是懒加载的独立 chunk，真跨了
 * chunk 边界的话同一个类会有两份，`instanceof` 会判 false——而这个坑要在生产里才炸得出来。
 * 字符串键不受模块实例影响。（测试环境里两边同模块，`instanceof` 本来也能过；这是**防御性**
 * 的选择，不是当前必需的。）
 *
 * **为什么单独一个模块，而不是留在 `binary-view.tsx` 里**：抛它的不只有渲染器，
 * `zip-entry.ts`（一个跟视图无关的字节工具）也要抛。让「读 zip」反向依赖「视图壳」是把依赖
 * 方向弄反了；分开之后标记串也只有一份。
 *
 * ⚠️ 依赖方向如今还剩**一条类型上的**：下面 `import type { DegradedReason }`（只为 `Extract` 出
 * `可抛的档`）。它是 `import type`，编译期就擦掉、运行期零依赖——被反对的那件事（字节层在
 * **运行期**依赖视图层）并不存在，所以这里也拿不到「顺手用了视图层的东西」的机会。
 *
 * 也可以把 `DegradedReason` 整个搬到这个模块来，让那条边彻底消失（审查提过）。权衡后没做：
 * 搬完那条边只是**换了方向**——`degraded-view.tsx` 反过来 import 这里，而「有哪几档」本来就是
 * 那个视图在定义的东西（档位与它的说法 `说法: Record<DegradedReason, 降级说法>` 摆在一起，
 * 穷尽性检查才咬得住「加了档却忘了写文案」）。收益是把一条编译期箭头的朝向摆正，代价是动两个
 * 文件加各自的测试——在一个「每次改动都是上游合并面」的 fork 里不划算（宪法 §二）。
 */
import type { DegradedReason } from "@/center/degraded-view"

const 降级标记 = "@@openhive/降级档"

/**
 * 会被**抛出来**的那三档。
 *
 * 收窄不是为了好看：`empty` / `error` 是**壳**自己判的（读不到内容、渲染时炸了），没有也不该有
 * 对应的标记错——若这里交回整个 `DegradedReason`，一个手写的属性能把「真故障」伪装成「已知边界」。
 *
 * ⚠️ 别拿「TS 会拦下调用点」当理由：类型上 `DegradedReason ⊂ BinaryViewState`，`setState(看不了)`
 * 两种写法**都编得过**（实测过）。真正咬住的是下面 `是哪种看不了` 里那份**字面量白名单**——
 * 它才是运行期那道闸，类型只负责让两边不走散。
 *
 * `load-failed` 后来**加进来**（它原本只由壳判）：渲染器**自己**知道它在下载我们这边的代码
 * （认加密流要的 xlsx、配 worker 脚本），块没到就该由它说这句话——而不是让壳去猜。壳猜不准：
 * 「chunk 没到」与「渲染时抛了 TypeError」在浏览器之间只有**消息文本**不同（Chrome / Firefox /
 * Safari 三套措辞），按文本认是本项目已判定为脆弱的那类判定（见 `pdf-view.tsx` 认加密 PDF 时
 * 专门记的那一笔）。谁知道自己在下东西，谁来说；判断权留在知道的那一层。
 */
export type 可抛的档 = Extract<DegradedReason, "unsupported" | "encrypted" | "load-failed">

/**
 * 造一个带档位的标记错。
 *
 * `说明` 是给**排障的人**看的（进 `Error.message`）：它到不了界面——界面上的措辞在
 * `degraded-view.tsx` 的 `说法` 里（DESIGN §4.6）。⚠️ 而且它多半连控制台都到不了：
 * 视图壳只在**没带标记**（真故障）时才 `console.warn`，带标记的**三档**都是「预期内的边界」、
 * 不喊（见 `binary-view.tsx` 那条 catch）。日常能读到它的地方是测试。
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
 * 造一个「我们这边的东西没加载出来」的错——**文件与格式都没问题**，是我们自己要用的那块代码没到
 * （懒加载的 chunk 下载失败、worker 脚本取不到）。动作是**重开这张标签**，不是怀疑文件。
 *
 * 没有它的话这类失败会被兜成 `error`（「可能已经损坏」）：把「我们的代码没到」说成「你的卷宗坏了」，
 * 归因是反的。
 */
export function 加载失败(说明: string): Error {
  return 标记错(说明, "load-failed")
}

/**
 * 读抛出来的东西带着哪一档标记；**没带就是 `undefined`**（＝真故障，壳落 `error`）。
 *
 * 只认会被抛出来的那三档：`empty` / `error` 由壳自己判，没有也不该有对应的标记错，
 * 外部就算硬塞进来也不认（否则一个手写的属性能把「真故障」伪装成「已知边界」）。
 */
export function 是哪种看不了(原因: unknown): 可抛的档 | undefined {
  if (typeof 原因 !== "object" || 原因 === null) return undefined
  const 档: unknown = Reflect.get(原因, 降级标记)
  if (档 === "unsupported" || 档 === "encrypted" || 档 === "load-failed") return 档
  return undefined
}
