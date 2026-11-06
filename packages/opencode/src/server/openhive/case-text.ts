export * as OpenhiveCaseText from "./case-text"

import { inflateRawSync } from "node:zlib"

/**
 * 非表格材料的「文本层」。
 *
 * ## 只做两种
 *
 * `.txt/.md/.log` 按 UTF-8 严格解码，失败退 GBK（公安系统导出的文本大量是 GBK）。
 * UTF-8 用 `fatal` 而不是替换字符：替换字符会把「这是二进制文件」静默变成一段乱码文本，
 * 后面再喂给模型，等于把钱花在垃圾上。docx 用 zip 中央目录 ＋ `node:zlib`，不引第三方库
 * （R1 / Global Constraints）。
 *
 * ## 上限
 *
 * 字数上限是**扫描成本**的闸（`LEARNINGS #011-03`）：AI 抽取按片计费、按小时计等待，
 * 超限必须让用户拆文件，不能静默截断——截断后抽出来的「结论」看起来是完整的。
 *
 * 计的是 JS 字符串长度（UTF-16 code unit），**不是「用户眼里的字数」**：一个 emoji 或
 * 生僻字（代理对）算 2，一个汉字算 1。这是刻意的——闸的是后续扫描/切片成本，不是
 * 排版意义上的字数统计，别当 bug 修。
 */
export const 文本字数上限 = 2_000_000

/** docx 单个部件解压后的上限：防 zip 炸弹。 */
const 解压上限 = 50 * 1024 * 1024

export interface 文本结果 {
  readonly text: string
}

export function 抽取文本(bytes: Uint8Array, path: string): 文本结果 {
  const 低 = path.toLowerCase()
  const 原文 = 低.endsWith(".docx") ? 读docx(bytes) : 解码文本(bytes)
  const 文本 = 原文.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  if (文本.trim() === "") throw new Error("文件里没有可读的文字")
  if (怀疑二进制(文本))
    throw new Error("这个文件看起来不是纯文本（可能是二进制或 UTF-16）；请另存为 UTF-8 后再导入")
  if (文本.length > 文本字数上限)
    throw new Error(`文本共 ${文本.length} 字，超过单份材料上限（${文本字数上限} 字）；请拆分后再导入`)
  return { text: 文本 }
}

/**
 * 文本层只收纯文本。UTF-16LE 的 ASCII 文件是**合法 UTF-8**（每隔一字节一个 `\u0000`），
 * GBK 兜底也保留「任意字节对都能解」的口子——不拦就是把乱码当钱烧。
 * 控制字符按**比例**判：单个 `\f` 的老日志不该被拒，满篇控制字符的二进制必须拒。
 */
function 怀疑二进制(文本: string): boolean {
  let 控 = 0
  for (const 字符 of 文本) {
    const 码 = 字符.codePointAt(0)!
    if (码 === 0) return true
    if (码 < 0x20 && 码 !== 0x09 && 码 !== 0x0a && 码 !== 0x0d) 控++
  }
  return 控 > 0 && 控 / 文本.length > 0.01
}

function 解码文本(bytes: Uint8Array): string {
  for (const 编码 of ["utf-8", "gbk"]) {
    try {
      return new TextDecoder(编码, { fatal: true }).decode(bytes)
    } catch {
      // 换下一种；两种都不行时在循环外面报错，不能在这里吞掉。
    }
  }
  throw new Error("无法识别文件编码（既不是 UTF-8 也不是 GBK）")
}

function 读docx(bytes: Uint8Array): string {
  const 正文 = 读zip(bytes, "word/document.xml")
  if (正文 === undefined)
    throw new Error("这个 .docx 里没有正文（word/document.xml）；如果是旧版 .doc 改了后缀，请用 Word 另存为 .docx")
  return 去掉xml标签(new TextDecoder("utf-8").decode(正文))
}

/** Word 的段落/换行/制表符先变成我们认的分隔符，再剥标签。 */
function 去掉xml标签(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (原文: string, n: string) => 码点(Number(n), 原文))
    .replace(/&#x([0-9a-fA-F]+);/g, (原文: string, n: string) => 码点(Number.parseInt(n, 16), 原文))
    .replace(/&amp;/g, "&")
}

/** 越界的码点不去构造字符（`String.fromCodePoint` 会抛英文 RangeError），原样留着。 */
function 码点(码: number, 原文: string): string {
  if (!Number.isInteger(码) || 码 < 0 || 码 > 0x10ffff) return 原文
  // 代理区（0xD800–0xDFFF）在 XML 里本就不该被引用：`fromCodePoint` 不抛错，
  // 但会产出孤立代理，编码成 UTF-8 时变成 U+FFFD——保留原文更好交代。
  if (码 >= 0xd800 && 码 <= 0xdfff) return 原文
  return String.fromCodePoint(码)
}

/** 解压上限真的兜在解压器上：中央目录里的「原始长」是**声明值**，不能当闸用。 */
function 解压(数据: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateRawSync(数据, { maxOutputLength: 解压上限 }))
  } catch (失败) {
    // 撞上解压上限与「数据本身坏了」是两种话：前者可操作（拆文件），后者只能重导。
    if (失败 instanceof Error && "code" in 失败 && 失败.code === "ERR_BUFFER_TOO_LARGE")
      throw new Error("这个 .docx 的正文太大，已拒绝解压", { cause: 失败 })
    throw new Error("这个 .docx 的压缩数据已损坏", { cause: 失败 })
  }
}

const 中央目录签名 = 0x02014b50
const 本地头签名 = 0x04034b50

function 读zip(bytes: Uint8Array, 目标名: string): Uint8Array | undefined {
  const 视 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let 尾 = -1
  const 最早 = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= 最早; i--) {
    if (视.getUint32(i, true) === 0x06054b50 && i + 22 + 视.getUint16(i + 20, true) === bytes.length) {
      尾 = i
      break
    }
  }
  if (尾 < 0) throw new Error("这不是一个有效的 .docx（找不到 zip 目录）")

  const 条目数 = 视.getUint16(尾 + 10, true)
  let 偏移 = 视.getUint32(尾 + 16, true)
  if (条目数 === 0xffff || 偏移 === 0xffffffff) throw new Error("暂不支持 zip64 的 .docx")
  for (let n = 0; n < 条目数; n++) {
    if (偏移 + 46 > bytes.length || 视.getUint32(偏移, true) !== 中央目录签名)
      throw new Error("这个 .docx 的 zip 目录损坏了")
    const 方法 = 视.getUint16(偏移 + 10, true)
    const 压缩长 = 视.getUint32(偏移 + 20, true)
    const 原始长 = 视.getUint32(偏移 + 24, true)
    const 名长 = 视.getUint16(偏移 + 28, true)
    const 附长 = 视.getUint16(偏移 + 30, true)
    const 注长 = 视.getUint16(偏移 + 32, true)
    const 本地偏移 = 视.getUint32(偏移 + 42, true)
    if (压缩长 === 0xffffffff || 原始长 === 0xffffffff || 本地偏移 === 0xffffffff)
      throw new Error("暂不支持 zip64 的 .docx")
    if (偏移 + 46 + 名长 > bytes.length) throw new Error("这个 .docx 的 zip 目录损坏了")

    const 名 = new TextDecoder("utf-8").decode(bytes.subarray(偏移 + 46, 偏移 + 46 + 名长))
    if (本地偏移 + 30 > bytes.length || 视.getUint32(本地偏移, true) !== 本地头签名)
      throw new Error("这个 .docx 的 zip 条目损坏了")
    const 本地名长 = 视.getUint16(本地偏移 + 26, true)
    const 本地附长 = 视.getUint16(本地偏移 + 28, true)
    const 数据起 = 本地偏移 + 30 + 本地名长 + 本地附长
    if (数据起 + 压缩长 > bytes.length) throw new Error("这个 .docx 的 zip 条目越界了")

    if (名 === 目标名) {
      const 数据 = bytes.subarray(数据起, 数据起 + 压缩长)
      if (原始长 > 解压上限) throw new Error("这个 .docx 的正文太大，已拒绝解压")
      if (方法 === 0) return 数据
      if (方法 === 8) {
        const 解 = 解压(数据)
        if (解.length !== 原始长) throw new Error("这个 .docx 的压缩数据长度对不上")
        return 解
      }
      throw new Error(`这个 .docx 用了不支持的压缩方式（${方法}）`)
    }

    偏移 += 46 + 名长 + 附长 + 注长
  }
  return undefined
}
