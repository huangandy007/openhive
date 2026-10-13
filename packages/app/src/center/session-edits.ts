import { createSignal } from "solid-js"
import { createPathHelpers } from "@/context/file/path"

/**
 * 「这份文件被 AI 会话改过、中栏还没换成新的」——登记处（2026-10-13）。
 *
 * ## 它解决的那件事
 *
 * 中栏的取数是**一次性**的：`BinaryView` 的 effect 只依赖 `path`，`path` 不变就永不重读
 * （`center-content.tsx` / `binary-view.tsx` 各自的注释里写着这条）。于是右栏让 AI 改一份
 * 中栏正开着的文档，画面上**一点动静都没有**，用户不知道盘上已经变了。这个模块记的就是
 * 「哪些文件变了、还没被用户看见」。
 *
 * ## 为什么**模块级一份**，而不是塞进 `CenterTabsProvider`
 *
 * 写入方是**能读 SDK 的那一层**（`pages/layout-new.tsx` 的监听），而读出方在中栏深处
 * （`tab-bar` 画圆点、`center-content` 算重载）——两者隔着好几层、也不在同一个 provider 的
 * 作用域里。中栏的组件测试是**裸挂**的（不挂 SDK / 文件 provider），若把它做成 context，
 * 每条中栏用例都得补一层 provider 前提（`LEARNINGS #005-27` 那族）。
 *
 * 而「这个文件被改过」本就是**全局一份的事实**（同一个文件在分屏两栏开着，两栏说的必须是
 * 同一件事），不是某一棵子树的状态。故与 `views/reading-size.ts` 的 `阅读字号` 同一个写法：
 * 模块级 `createSignal`，活到页面卸载为止。
 *
 * ⚠️ **组件测试注意**：这一份跨用例活着 ⇒ 每条用例开头 `清空会话改过()`（同 `阅读字号`
 * 那条纪律）。
 *
 * ## 为什么是「记过没记过」而不是「改了几次」
 *
 * 用户要的是「这份文档的新版本我还没看」——看一次就没了。改 5 次仍是同一件事（一个圆点）。
 * 记次数只会让界面说一句用户不关心的话。
 */

/** 被会话改过、且还没被用户看见的路径（**已是中栏那一套相对路径**，见 `记会话改过`）。 */
const [被改, set被改] = createSignal<ReadonlySet<string>>(new Set())

/**
 * 这份文件是不是「被会话改过、还没换新」。
 *
 * ⚠️ 传的路径必须与中栏 tab 的 `path` **同口径**（项目相对、正斜杠）——归一是**写入方**的事
 * （`layout-new.tsx` 用 `context/file/path.ts` 的 `normalize`，与 file-tree 的 `node.path`
 * 是同一个函数）。两处口径不一致时**不报错**：圆点永远不出现（`LEARNINGS #006-23` 那族）。
 */
export const 会话改过 = (路径: string) => 被改().has(路径)

/**
 * 记一笔「这个文件被会话改过」。
 *
 * 已经记过就不新造集合（返回上一份 ⇒ `===` 相等 ⇒ Solid 不外传通知）：同一条消息里
 * 反复改同一个文件、或一个动作同时改到它两遍，都不该惊动下游重画。
 */
export function 记会话改过(路径: string): void {
  set被改((上一份) => {
    if (上一份.has(路径)) return 上一份
    const 下一份 = new Set(上一份)
    下一份.add(路径)
    return 下一份
  })
}

/** 用户看见新内容了（点了那张 tab）⇒ 这个圆点不再是「没看过」。没记过时不动（幂等）。 */
export function 清会话改过(路径: string): void {
  set被改((上一份) => {
    if (!上一份.has(路径)) return 上一份
    const 下一份 = new Set(上一份)
    下一份.delete(路径)
    return 下一份
  })
}

/**
 * 「这一份被要求重读了几次」——**按路径分**。
 *
 * 中栏的 `内容` signal 用一个逐字段比较器决定「还是同一份吗」（`center-content.tsx` 的
 * `还是同一份`）——重挂视图 = 重读盘上那份。要**主动**让它重挂，就得有一个**会变的值**
 * 参与那个比较。这就是它：用户点带圆点的 tab 时，那份文件的计数 +1 ⇒ 比较器放行 ⇒ 视图重挂重读。
 *
 * ⚠️ **为什么按路径分，而不是一个全局计数**：分屏时两栏各挂一份 `CenterContent`（`pane` 0/1），
 * 两栏都读这个信号。全局计数的话，用户点左栏那张 ⇒ 右栏也判「变了」⇒ 右栏那份**没被改过**的
 * 文档跟着重挂——正在编辑的草稿、阅读位置一起丢。按路径分，右栏的值没动 ⇒ 比较器照旧拦住
 * （`#006-32` 的同一条：去掉的是能力还是外观，别顺手牵走用户的东西）。
 *
 * 为什么不复用 `path` 本身：`path` 是 tab 的身份（`contentTabKey` 拿它当键），改它等于换一张 tab。
 */
const [重载代, 写重载代] = createSignal<ReadonlyMap<string, number>>(new Map())

/** 读「这份文件现在是第几代」。`center-content.tsx` 的比较器读它（读的是**自己那一份**的路径）。 */
export const 当前重载代 = (路径: string): number => 重载代().get(路径) ?? 0

/** 请中栏把**这一份**重新读一遍（用户点了那张带圆点的 tab）。 */
export function 触发重载(路径: string): void {
  写重载代((上一份) => {
    const 下一份 = new Map(上一份)
    下一份.set(路径, (上一份.get(路径) ?? 0) + 1)
    return 下一份
  })
}

/**
 * 全清（换项目时喊；组件测试的 `beforeEach` 也喊它）。
 *
 * 换项目必须清：新项目里的 `甲.md` 与旧项目里的 `甲.md` 是**同一个相对路径**——不清的话，
 * 新项目一打开就顶着一个属于旧项目的圆点（`LEARNINGS #002-06`：同一个前提在两处各写一份）。
 */
export function 清空会话改过(): void {
  set被改(new Set<string>())
  写重载代(new Map<string, number>())
}

/**
 * 内核报来的一条 `file.edited` ⇒ 该登记成哪个**中栏相对路径**（不属于当前项目就 `undefined`）。
 *
 * ## 为什么要过这一道（`LEARNINGS #006-27` 那族）
 *
 * 内核报的 `file` 是**绝对路径**（`edit.ts` 把入参绝对化到 `instance.directory`），而中栏 tab
 * 存的是**项目相对路径**（与左栏文件树 `node.path` 同源）。两处口径不同，**不报错、不变红**，
 * 症状只是「圆点永远不出现」。故这里显式归一，用的还是左栏那一个现成函数
 * （`createPathHelpers`，与 `context/file.tsx` 同一份，不另写第二份判据——`#002-06`）。
 *
 * ## 判「是不是本项目的文件」：拿归一函数自己对自己归一
 *
 * `归一(本目录)` 会把 root 前缀切掉（切得掉才有那一步）⇒ **同一个目录归一得空串**；不是同一个
 * 目录就切不掉、剩一段非空路径。比 `a === b` 多两样：win32 的大小写不敏感与分隔符不敏感
 * （`#006-23`：win32 上同一目录有 4 种以上写法，「两边都 resolve 一下」并不等于「两边同形」——
 * 这里两边走的是**同一个函数**，就不存在两份判据漂开的余地）。
 *
 * ⚠️ 不判这一条会怎样：另一个项目里被 AI 改的同名文件，会让**当前项目**那张 tab 亮一个假圆点。
 * 不是灾难（点了只是重读一遍当前这份），但那是假话，而假话正是这个功能要消灭的东西。
 *
 * ## ⚠️ 用 `normalizeDir` 而不是 `normalize`（2026-10-14 真栈实测修）
 *
 * `normalize` 剥根前缀那一步是 `path.slice(root.length)`，它的注释写着「preserve native
 * separators」——**win32 上因此回的是反斜杠**：`D:\…\p2\卷宗\纪要.md` ⇒ `卷宗\纪要.md`。
 * 而中栏 tab 的 `path` 是**正斜杠**（内核的文件清单给的就是 `卷宗/纪要.md`，file-tree 的
 * `data-path` 也是它）⇒ 两个键**永远对不上**、圆点永远不出现，且不报错、不变红。
 * 真栈上就是这么红的：真模型调 `write` 改了盘、变更卡都画出来了，tab 上却没有圆点。
 *
 * `normalizeDir` 是仓里**已有的**「折成仓内统一的正斜杠相对写法」那一处（`tree-store` 用它做目录
 * 键），且它只在**根像 win32 路径**时才折（`/^[A-Za-z]:/` 或 UNC）——POSIX 上反斜杠可以是**文件名
 * 的一部分**，那时原样留着才对。⇒ 这里复用它，不另写一份「什么时候该折」的判据（`#002-06`）。
 *
 * ⚠️ 它与 `normalize` 的差别只有「折分隔符 ＋ 砍尾部斜杠」，尾部斜杠对文件路径无影响。
 */
export function 归一事件路径(事件目录: string, 本目录: string | undefined, 文件: string): string | undefined {
  if (本目录 === undefined) return undefined
  const 归一 = createPathHelpers(() => 事件目录)
  if (归一.normalizeDir(本目录) !== "") return undefined
  const 相对 = 归一.normalizeDir(文件)
  return 相对 === "" ? undefined : 相对
}
