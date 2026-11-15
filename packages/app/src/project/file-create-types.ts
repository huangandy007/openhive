/**
 * 「新建文件」弹窗里的**类型胶囊**（012 · T007，形状决策见 `research.md:228`）。
 *
 * 数据驱动：弹窗只遍历这个数组画胶囊，新增一种类型不改弹窗结构。本期只有「关系图」。
 *
 * 胶囊是**可选开关**：默认不选 = 普通文件（否则「新建文件」从此每个都变成 `.hgraph`）；
 * 选中才把后缀补到名字后面。目录类型不显示胶囊（目录不能变成图文件）。
 */
export interface 可新建类型 {
  readonly 标签: string
  /** 带点、小写（与 `extensionOf` / 视图注册表同口径）。 */
  readonly 后缀: string
  /**
   * 建好后立刻写进文件的内容；`undefined` = 不预填，交给后端 `POST /hgraph/init` 生成
   * 骨架（0 字节文件打开时也会再 init 一次，幂等）。
   */
  readonly 初始内容?: string
}

export const 可新建类型: readonly 可新建类型[] = Object.freeze([
  Object.freeze({ 标签: "关系图", 后缀: ".hgraph", 初始内容: undefined }),
])

/**
 * 名字已带同后缀（**大小写不敏感**）⇒ 原样；否则追加。
 *
 * 带**其它**后缀（如 `.md`）按名字处理 ⇒ `张三.md.hgraph`——与契约 ui.md §7 的裁定一致。
 * 判据只此一份，弹窗不另写。
 */
export function 补类型后缀(name: string, 类型: 可新建类型): string {
  const 后缀 = 类型.后缀.toLowerCase()
  return name.toLowerCase().endsWith(后缀) ? name : `${name}${类型.后缀}`
}
