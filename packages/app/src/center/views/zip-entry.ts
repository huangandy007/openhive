/**
 * 从 zip 容器里取出**一个**条目的原始字节。
 *
 * 为什么手写而不是引一个 zip 库：这里要的只是「读一条」，而 `.xmind` 是本轮唯一用得上的地方。
 * 引 jszip 要多一个依赖（宪法：侵入是「加」不是「改」，依赖越少越好），
 * 解压本身则交给浏览器自带的 `DecompressionStream("deflate-raw")`。
 *
 * 支持的：普通 zip（EOCD + 中央目录 + 局部头）、`存储`(0) 与 `deflate`(8) 两种方式。
 * **不支持的**：zip64（>4GB 或 >65535 条目）、加密、data descriptor——这些在 .xmind 里不出现。
 *
 * 返回值的语义只有两种，且**刻意不合并**：
 * - `undefined` = 包是好的，只是**没有这一条**。调用方照常往下走（`.xmind` 可能就是老格式）。
 * - 抛错 = 这压根不是 zip / 结构损坏 / 读不动。**读不出来就说读不出来**，不假装「没这条」——
 *   把一份彻底坏掉的文件说成「压缩包里没有 content.json」，归因是反的。
 */

const 读16 = (b: Uint8Array, 处: number) => b[处]! | (b[处 + 1]! << 8)
const 读32 = (b: Uint8Array, 处: number) =>
  (b[处]! | (b[处 + 1]! << 8) | (b[处 + 2]! << 16) | (b[处 + 3]! << 24)) >>> 0

/**
 * 单个条目解压后的字节数上界。
 *
 * 压缩包是**别人给的文件**，deflate 的压缩比能到 1000:1——几百 KB 的 `.xmind` 可以解出几十 GB，
 * 这就是 zip bomb，代价是这个标签页当场崩掉。所以先看中央目录里**声明**的解压后大小，超了直接
 * 说超了，不心疼那一次解压。
 *
 * 32 MB 对 `.xmind` 是极宽的（真实导图几十 KB）：挡住的是数量级不对的东西，不是正常文件。
 */
export const 解压上界 = 32 * 1024 * 1024

/** 中央目录条目（只需要这几个字段）。 */
interface 条目 {
  方式: number
  压缩大小: number
  解压大小: number
  局部头偏移: number
}

/**
 * 找 EOCD（`PK\x05\x06`）。它固定在文件末尾，后面只可能跟一段最长 65535 的注释，
 * 所以**从尾巴往前扫**——不能只认最后 22 字节，打包工具塞了注释就不在那儿了。
 */
function 找尾记录(bytes: Uint8Array): number | undefined {
  const 最早 = Math.max(0, bytes.length - 22 - 65535)
  for (let 处 = bytes.length - 22; 处 >= 最早; 处--) {
    if (读32(bytes, 处) === 0x06054b50) return 处
  }
  return undefined
}

/** 在中央目录里找条目。找不到就返回 `undefined`（这是「没这条」；包本身坏掉是抛错）。 */
function 找条目(bytes: Uint8Array, name: string): 条目 | undefined {
  const 尾 = 找尾记录(bytes)
  if (尾 === undefined) throw new Error("这不是一个 zip 压缩包")

  const 条数 = 读16(bytes, 尾 + 10)
  let 处 = 读32(bytes, 尾 + 16)
  for (let i = 0; i < 条数; i++) {
    if (处 + 46 > bytes.length || 读32(bytes, 处) !== 0x02014b50) {
      throw new Error("压缩包结构损坏：中央目录读不下去")
    }
    const 名长 = 读16(bytes, 处 + 28)
    const 附加长 = 读16(bytes, 处 + 30)
    const 注释长 = 读16(bytes, 处 + 32)
    const 名 = new TextDecoder().decode(bytes.subarray(处 + 46, 处 + 46 + 名长))

    if (名 === name) {
      return {
        方式: 读16(bytes, 处 + 10),
        压缩大小: 读32(bytes, 处 + 20),
        解压大小: 读32(bytes, 处 + 24),
        局部头偏移: 读32(bytes, 处 + 42),
      }
    }
    处 += 46 + 名长 + 附加长 + 注释长
  }
  return undefined
}

/**
 * 取出条目内容；**包里没有这条就返回 `undefined`**（不抛错——「没有」和「坏了」是两回事，
 * 怎么报由调用方决定）。剩下的情况一律抛错：读不出来就说读不出来，别交回半截或一堆乱码。
 */
export async function readZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const 条 = 找条目(bytes, name)
  if (!条) return undefined

  // 上界先看声明的解压后大小。`存储`(0) 方式没有「解压」这一步，它的体积本来就被手上这份
  // 文件限死了，不设上界。
  if (条.方式 !== 0 && 条.解压大小 > 解压上界) {
    throw new Error(`压缩包里的条目太大（声明解压后 ${条.解压大小} 字节，上界 ${解压上界}）`)
  }

  // 局部头里的「附加字段长度」**未必**等于中央目录里记的那个，所以必须重新读一遍局部头。
  const 头 = 条.局部头偏移
  if (头 + 30 > bytes.length || 读32(bytes, 头) !== 0x04034b50) {
    throw new Error("压缩包结构损坏：局部头读不出来")
  }
  const 数据起 = 头 + 30 + 读16(bytes, 头 + 26) + 读16(bytes, 头 + 28)
  // `subarray` 越界**不报错**，只会安静地给一段短的——所以自己先量：数据被截断是「坏了」，
  // 不是「没这条」，绝不能就这么把半截字节当成内容交出去。
  if (数据起 + 条.压缩大小 > bytes.length) throw new Error("压缩包结构损坏：条目数据被截断")
  const 压缩数据 = bytes.subarray(数据起, 数据起 + 条.压缩大小)

  if (条.方式 === 0) return 压缩数据
  if (条.方式 !== 8) throw new Error(`不支持的压缩方式：${条.方式}`)

  const 流 = new Blob([压缩数据]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  const 解压 = new Uint8Array(await new Response(流).arrayBuffer())
  // 上面那道看的是**声明值**，而打包工具可以撒谎（恶意的必然撒谎），所以解完再量一次实际长度。
  // ⚠️ 这一道只能「事后拒绝」，挡不住解压那一刻的内存峰值——要连那一步也挡住，得改成手工流式
  // 读 `DecompressionStream`、边读边计数。本轮没做，理由与承接任务见 state.md。
  if (解压.length > 解压上界) {
    throw new Error(`压缩包里的条目太大（解压后 ${解压.length} 字节，上界 ${解压上界}）`)
  }
  return 解压
}
