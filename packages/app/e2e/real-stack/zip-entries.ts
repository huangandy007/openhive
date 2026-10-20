import { readFileSync } from "fs"
import { inflateRawSync } from "zlib"

/**
 * 真栈里读 zip 的最小实现（2026-10-20）。
 *
 * ## 为什么不用 zip.js
 *
 * `packages/app` **不依赖** `@zip.js/zip.js`（只有 `packages/opencode` / `desktop` 有）。为一条
 * E2E 往 app 里加依赖，会动 `bun.lock`——那是本项目第一号约束明令避免的冲突面。
 * 中央目录是公开格式，读几个字段比加依赖便宜。
 *
 * ## 只读两样
 *
 * 条目名（相对路径）与内容正文。压缩方法只支持 store(0) / deflate(8)：内核用 zip.js 的
 * `useCompressionStream`，产的正是 deflate。
 */

export interface ZipEntry {
  name: string
  directory: boolean
  size: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

function 找中央目录(view: DataView) {
  const 最短 = 22
  const 下限 = Math.max(0, view.byteLength - 最短 - 0xffff)
  for (let 位 = view.byteLength - 最短; 位 >= 下限; 位--) {
    if (view.getUint32(位, true) === EOCD) {
      return { 条数: view.getUint16(位 + 10, true), 偏移: view.getUint32(位 + 16, true) }
    }
  }
  throw new Error("不是 zip：找不到中央目录结束记录（EOCD）")
}

export function readZipEntries(file: string): ZipEntry[] {
  const bytes = readFileSync(file)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { 条数, 偏移 } = 找中央目录(view)
  const 解码 = new TextDecoder("utf-8")
  const entries: ZipEntry[] = []
  let 位 = 偏移
  for (let i = 0; i < 条数; i++) {
    if (view.getUint32(位, true) !== CENTRAL) throw new Error(`第 ${i} 条中央目录记录签名不对`)
    const 名长 = view.getUint16(位 + 28, true)
    const 附加长 = view.getUint16(位 + 30, true)
    const 注释长 = view.getUint16(位 + 32, true)
    const 大小 = view.getUint32(位 + 24, true)
    const name = 解码.decode(bytes.subarray(位 + 46, 位 + 46 + 名长))
    entries.push({ name, directory: name.endsWith("/"), size: 大小 })
    位 += 46 + 名长 + 附加长 + 注释长
  }
  return entries
}

/** 读一条非目录条目的正文。 */
export function readZipText(file: string, name: string): string {
  const bytes = readFileSync(file)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { 条数, 偏移 } = 找中央目录(view)
  const 解码 = new TextDecoder("utf-8")
  let 位 = 偏移
  for (let i = 0; i < 条数; i++) {
    const 名长 = view.getUint16(位 + 28, true)
    const 附加长 = view.getUint16(位 + 30, true)
    const 注释长 = view.getUint16(位 + 32, true)
    const 方法 = view.getUint16(位 + 10, true)
    const 压缩长 = view.getUint32(位 + 20, true)
    const 本地偏移 = view.getUint32(位 + 42, true)
    const 条目名 = 解码.decode(bytes.subarray(位 + 46, 位 + 46 + 名长))
    if (条目名 === name) {
      if (view.getUint32(本地偏移, true) !== LOCAL) throw new Error(`「${name}」本地头签名不对`)
      const 本地名长 = view.getUint16(本地偏移 + 26, true)
      const 本地附加长 = view.getUint16(本地偏移 + 28, true)
      const 数据起 = 本地偏移 + 30 + 本地名长 + 本地附加长
      const 压缩 = bytes.subarray(数据起, 数据起 + 压缩长)
      if (方法 === 0) return 解码.decode(压缩)
      if (方法 === 8) return 解码.decode(inflateRawSync(压缩))
      throw new Error(`不支持的压缩方法 ${方法}`)
    }
    位 += 46 + 名长 + 附加长 + 注释长
  }
  throw new Error(`zip 里没有「${name}」`)
}
