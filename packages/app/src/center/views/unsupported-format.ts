/**
 * 「这种格式我认得出，但我不支持」——抛它的一方据此表达「不是文件坏，是这条路没接」，
 * 字节视图壳（`binary-view.tsx`）据此落 `unsupported` 而不是 `error`。
 *
 * **为什么非分不可**：`unsupported`（「这种格式暂时看不了」，换个工具打开就行）与
 * `error`（「这个文件打不开 · 可能已经损坏」，要怀疑文件本身）对民警是**两件事**。
 * 一份**完全合法**的文件被说成「可能已经损坏」，就是让民警去怀疑一份好文件——归因是反的。
 * 今天已知的三处：Word 97–2003 的 OLE2 二进制（`document-view.tsx`）、XMind 8 的老格式
 * （`mindmap-view.tsx`）、压缩方式没接的条目（`zip-entry.ts`）。
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
const 不支持标记 = "@@openhive/格式不支持"

/** 造一个「这种格式我认得出、但不支持」的错。`说明` 只进控制台与测试，进不了界面。 */
export function 格式不支持(说明: string): Error {
  return Object.assign(new Error(说明), { [不支持标记]: true })
}

/** 判断抛出来的东西是不是 `格式不支持`——是就落 `unsupported`，否则落 `error`。 */
export function 是不支持(原因: unknown): boolean {
  return typeof 原因 === "object" && 原因 !== null && 不支持标记 in 原因
}
