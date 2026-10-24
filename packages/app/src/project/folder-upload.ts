/**
 * 「上传文件夹」的纯计划器（2026-10-24 用户下达：右键上传只能选文件，不能选文件夹）。
 *
 * 浏览器 `<input type="file" webkitdirectory>` 交出来的是一份**扁平的** `File` 清单，每个
 * `File` 的 `webkitRelativePath` 是「顶层文件夹/子目录/文件名」。服务端上传出口一次只收
 * **一个文件**、且落点目录**必须已存在**（`server/openhive/file.ts` 的 `handleUpload`），
 * 所以这一层要算清两件事：哪些目录得先建（**浅的在前**）、每个文件落到哪个目录。
 *
 * ## 口径：保留所选文件夹本身
 *
 * 2026-10-24 用户裁定（见预览图）：在「资料」下上传文件夹「卷宗」，得到「资料/卷宗/…」。
 * 与 Windows 资源管理器里把文件夹拖进另一个文件夹同义，也不会把一堆文件散落到落点目录里。
 *
 * ## 现取的清单，不是本地那份
 *
 * 「目录是否已存在」只能由文件清单回答：清单里既有文件路径（目录由前缀带出），也有
 * **带尾分隔符的空目录**（`openhive-files.ts` 文件头）。调用方传**刚从服务端取回的**那一份，
 * 不用界面上的旧信号——AI 在沙箱里建过目录时，旧信号是不知道的，而重复 create 会被服务端拒。
 *
 * 这里只做纯计算（不碰网络、不碰 DOM），判据在 `folder-upload.test.ts`。
 */

/** 一个待上传的文件：落到哪个目录（项目相对、`/` 分隔；`""` = 项目根）、弹窗里显示什么名字。 */
export type FolderUploadTask = {
  readonly file: File
  readonly dir: string
  /** 带上文件夹路径（`卷宗/附件/说明.docx`）：不同子目录里的同名文件分得清。 */
  readonly 显示名: string
}

export type FolderUploadPlan = {
  /** 要新建的目录（项目相对、`/` 分隔），**浅的在前**。清单里已有的不出现。 */
  readonly 要建的目录: readonly string[]
  /** 逐个上传的任务，顺序与浏览器给的一致。 */
  readonly 任务: readonly FolderUploadTask[]
}

/**
 * 浏览器给的相对路径。`File` 上的 `webkitRelativePath` **不在 lib.dom 的类型里**
 * （只有目录选择器会填），这里按「有就用、没有就当空」读，不发明第二个字段名。
 */
export function 相对路径(file: File): string {
  const 值 = (file as File & { webkitRelativePath?: unknown }).webkitRelativePath
  return typeof 值 === "string" ? 值 : ""
}

/** 两种分隔符折成 `/`、去掉首尾分隔符。中间的空段不修——那是浏览器给的原文，不替它改。 */
function 折(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
}

/** 目录的父目录与末段名（`createEntry` 要的是「在哪个目录里、叫什么」，父目录必须先在）。 */
export function 拆目录(dir: string): { parent: string; name: string } {
  const 段们 = 折(dir).split("/").filter(Boolean)
  const name = 段们.pop() ?? ""
  return { parent: 段们.join("/"), name }
}

export function folderUploadPlan(
  落点: string,
  files: readonly File[],
  现有路径: readonly string[],
): FolderUploadPlan {
  const 落 = 折(落点)

  // 每个文件 → 目标目录 ＋ 显示名。**保留所选文件夹本身**：相对路径的第一段就是它。
  const 任务 = files.map((file): FolderUploadTask => {
    const 段们 = 折(相对路径(file)).split("/").filter(Boolean)
    const 文件名 = 段们.pop() ?? file.name
    const dir = [落, ...段们].filter(Boolean).join("/")
    return { file, dir, 显示名: [...段们, 文件名].join("/") || file.name }
  })

  // 落点本身由**树**判过、点得动就说明它存在（同 `onUpload` 的口径：落点由树给，本层不重判）。
  // 把它算进「已有」，否则每个文件的目标目录会连落点一起再去建一遍——对已存在的目录，
  // 服务端 `create` 回的是「已经有同名的东西了」，整批上传会在这里无谓地停下。
  const 已有 = new Set<string>(落 === "" ? [] : [落])
  // 清单里的目录：非目录项（文件）只贡献它的**祖先**，目录项（带尾分隔符）把自己也算上。
  for (const 原 of 现有路径) {
    const 是目录 = /[\\/]$/.test(原)
    const 段们 = 折(原).split("/").filter(Boolean)
    const 上限 = 是目录 ? 段们.length : 段们.length - 1
    for (let 层 = 1; 层 <= 上限; 层++) 已有.add(段们.slice(0, 层).join("/"))
  }

  // 目标目录的**每一层**都要建（没有文件直接落在中间层时，它不会作为别人的目标出现）。
  const 需要 = new Set<string>()
  for (const 项 of 任务) {
    const 段们 = 项.dir.split("/").filter(Boolean)
    for (let 层 = 1; 层 <= 段们.length; 层++) 需要.add(段们.slice(0, 层).join("/"))
  }

  const 要建 = [...需要]
    .filter((dir) => !已有.has(dir))
    .sort((甲, 乙) => 甲.split("/").length - 乙.split("/").length || 甲.localeCompare(乙))

  return { 要建的目录: 要建, 任务 }
}
