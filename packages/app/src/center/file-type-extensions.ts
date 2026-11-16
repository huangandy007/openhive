/**
 * 扩展名清单（带点、小写，与 `extensionOf` 同口径）——**文件类型的共同出处**（013 · T2）。
 *
 * 谁在读它：`center/views/index.ts`（视图注册表）与 `project/file-create-catalog.ts`
 * （新建文件清单）认的是**同一批**后缀。**改这里就是改所有引用方**；别在调用侧再写
 * 字面量数组——同一前提两处各写一份，改一处漏一处**不报错、不变红**（`LEARNINGS #002-06`）。
 *
 * 零依赖：本模块只装数据，不 import 任何东西。类型一律 `readonly string[]`（**不用**
 * `as const`）：`open-file.ts` 会对它调 `.includes(扩展名: string)`，字面量联合类型收不了。
 */

export const 文档扩展名: readonly string[] = [".doc", ".docx"]

/**
 * 表格类扩展名（`.xls` / `.xlsx` / `.csv`）。
 *
 * **提成常量**是一个判据要求，不是整理洁癖（2026-10-12）：文件大小的**闸门**
 * （`center/open-file.ts`）要按「是不是表格」分两档阈值（表格 5 MB、其余 10 MB），
 * 而「哪些扩展名算表格」这件事**只能有一份**——注册表认它、闸门也认它。
 */
export const 表格扩展名: readonly string[] = [".xls", ".xlsx", ".csv"]

export const PDF扩展名: readonly string[] = [".pdf"]

export const 图片扩展名: readonly string[] = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]

export const 图文扩展名: readonly string[] = [".md", ".txt"]

export const 思维导图扩展名: readonly string[] = [".xmind"]

export const 关系图扩展名: readonly string[] = [".hgraph"]

/**
 * HTML 预览（2026-10-30）：渲染成网页，另给「源码」切换。
 *
 * 从下面的 `代码扩展名` 里摘出来了——代码视图对网页只显示「这是代码文件」+ 一个按钮，
 * 等于什么都没看到；而同一个扩展名不能有两个归属（`register` 会抛），故两者只能各管各的。
 */
export const 网页扩展名: readonly string[] = [".html", ".htm"]

/**
 * 代码类扩展名（T016）：源码 + 脚本 + 配置三类文本格式。
 *
 * `.md` / `.txt`（图文）与 `.csv`（表格）已有归属，故不在此列——**重复认领会抛错**
 * （`view-registry` 的 `register`），注册表在导入时即会炸，不会静默抢走别人的归属。
 * `.html` / `.htm` 同理（已改归网页预览）。
 */
export const 代码扩展名: readonly string[] = [
  // 源码
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".java", ".kt", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".scala", ".lua", ".r", ".pl", ".m",
  ".c", ".h", ".cc", ".cpp", ".hpp",
  // 脚本
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql",
  // 配置
  // ⚠️ `.env` 这一项认的是 `xxx.env` 这种**带主名**的文件。名字就叫 `.env` 的那些（点开头）
  //    在 `extensionOf` 眼里**没有扩展名**（点的左边没有名字），落 T015 的降级——
  //    **别把这一项读成「.env 文件已支持」**。（代码审查曾把这一项判成「永不命中」，
  //    复核后不成立：`点在首位`才算无扩展名，`点在中间`照常切出后缀。）
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env", ".properties",
  ".xml", ".css", ".scss", ".less",
]
