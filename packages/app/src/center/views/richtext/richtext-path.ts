/**
 * Markdown 里的引用路径 → **项目内**的实际路径（`/` 分隔、相对项目根）。
 *
 * 预览里的图片要经 `load(path)` 取字节，而 `load` 只认项目内路径；`<img src>` 原样交给
 * 浏览器会去请求前门（404），并且相对路径的基准是页面 URL，不是当前文件——两处都不对。
 *
 * 以 `/` 开头按 **Markdown 的常规约定**读成「项目根」，不当作本机绝对路径。不认的写法一律
 * `undefined`：带协议的 URL、纯锚点、以及 `../` 走到项目根之外。
 */
export function 引用路径(当前文件: string, href: string): string | undefined {
  let 路径 = href.trim()
  if (路径.startsWith("<") && 路径.endsWith(">")) 路径 = 路径.slice(1, -1)
  if (路径 === "" || 路径.startsWith("#")) return undefined
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(路径)) return undefined

  路径 = 路径.split("#")[0]!.split("?")[0]!
  // 中文文件名在 Markdown 里常被写成百分号编码；盘上的名字是解码后的。
  try {
    路径 = decodeURIComponent(路径)
  } catch {
    return undefined
  }
  if (路径 === "") return undefined

  const 从根 = 路径.startsWith("/")
  const 去点 = (从根 ? 路径.slice(1) : 路径).replace(/^\.\//, "").replace(/\\/g, "/")
  const 目录 = 从根 ? "" : 当前文件.split("/").slice(0, -1).join("/")
  const 段 = [...(目录 === "" ? [] : 目录.split("/")), ...去点.split("/")]
  const 结果: string[] = []
  for (const 一 of 段) {
    if (一 === "" || 一 === ".") continue
    if (一 === "..") {
      if (结果.length === 0) return undefined
      结果.pop()
      continue
    }
    结果.push(一)
  }
  return 结果.length === 0 ? undefined : 结果.join("/")
}

/**
 * `引用路径` 的反向：项目根相对的**目标** → 从当前文件所在目录出发的 Markdown 写法。
 *
 * 文件树与文件选择弹层给的都是项目根相对路径（`卷宗/附件/图.png`）；原样写进 Markdown 后，
 * 预览会按**当前文件目录**解析（§8.2），在 `卷宗/纪要.md` 里就变成了
 * `卷宗/卷宗/附件/图.png`。插入引用时在这里反算一次，写下去的就是 `附件/图.png`。
 */
export function 相对引用(当前文件: string, 目标: string): string {
  const 段 = (path: string) => path.split("/").filter((一) => 一 !== "" && 一 !== ".")
  const 目录 = 段(当前文件).slice(0, -1)
  const 目标段 = 段(目标)
  let 同 = 0
  while (同 < 目录.length && 同 < 目标段.length && 目录[同] === 目标段[同]) 同++
  return [...Array<string>(目录.length - 同).fill(".."), ...目标段.slice(同)].join("/")
}
