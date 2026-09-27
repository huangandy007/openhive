/**
 * 从 zip 容器里取出**一个**条目的原始字节。
 *
 * 为什么手写而不是引一个 zip 库：这里要的只是「读一条」，而 `.xmind` 是本轮唯一用得上的地方。
 * 引 jszip 要多一个依赖（宪法：侵入是「加」不是「改」，依赖越少越好），
 * 解压本身则交给浏览器自带的 `DecompressionStream("deflate-raw")`。
 *
 * 支持的：普通 zip（EOCD + 中央目录 + 局部头）、`存储`(0) 与 `deflate`(8) 两种方式。
 * **不支持的**：zip64（>4GB 或 >65535 条目）、加密、data descriptor——
 * 这些在 .xmind 里不出现；真遇到了会走到「没这条」或「不认识的方式」，不会静默读错。
 */

const 读16 = (b: Uint8Array, 处: number) => b[处]! | (b[处 + 1]! << 8)
const 读32 = (b: Uint8Array, 处: number) =>
  (b[处]! | (b[处 + 1]! << 8) | (b[处 + 2]! << 16) | (b[处 + 3]! << 24)) >>> 0

/** 中央目录条目（只需要这几个字段）。 */
interface 条目 {
  方式: number
  压缩大小: number
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

/** 在中央目录里找条目。找不到（含「压根不是 zip」）返回 `undefined`。 */
function 找条目(bytes: Uint8Array, name: string): 条目 | undefined {
  const 尾 = 找尾记录(bytes)
  if (尾 === undefined) return undefined

  const 条数 = 读16(bytes, 尾 + 10)
  let 处 = 读32(bytes, 尾 + 16)
  for (let i = 0; i < 条数; i++) {
    if (处 + 46 > bytes.length || 读32(bytes, 处) !== 0x02014b50) return undefined
    const 名长 = 读16(bytes, 处 + 28)
    const 附加长 = 读16(bytes, 处 + 30)
    const 注释长 = 读16(bytes, 处 + 32)
    const 名 = new TextDecoder().decode(bytes.subarray(处 + 46, 处 + 46 + 名长))

    if (名 === name) {
      return {
        方式: 读16(bytes, 处 + 10),
        压缩大小: 读32(bytes, 处 + 20),
        局部头偏移: 读32(bytes, 处 + 42),
      }
    }
    处 += 46 + 名长 + 附加长 + 注释长
  }
  return undefined
}

/**
 * 取出条目内容；**包里没有这条就返回 `undefined`**（不抛错——「没有」和「坏了」是两回事，
 * 怎么报由调用方决定）。压缩方式不认识才抛错：读不出来就说读不出来，别交回一堆乱码。
 */
export async function readZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const 条 = 找条目(bytes, name)
  if (!条) return undefined

  // 局部头里的「附加字段长度」**未必**等于中央目录里记的那个，所以必须重新读一遍局部头。
  const 头 = 条.局部头偏移
  if (头 + 30 > bytes.length || 读32(bytes, 头) !== 0x04034b50) return undefined
  const 数据起 = 头 + 30 + 读16(bytes, 头 + 26) + 读16(bytes, 头 + 28)
  const 压缩数据 = bytes.subarray(数据起, 数据起 + 条.压缩大小)

  if (条.方式 === 0) return 压缩数据
  if (条.方式 !== 8) throw new Error(`不支持的压缩方式：${条.方式}`)

  const 流 = new Blob([压缩数据]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(流).arrayBuffer())
}
