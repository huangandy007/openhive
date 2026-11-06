import { describe, expect, test } from "bun:test"
import { deflateRawSync } from "node:zlib"
import { 抽取文本, 文本字数上限 } from "../../src/server/openhive/case-text"

/**
 * 只造本用例需要的 zip：stored / deflate 两种，目录里只放给定条目。
 * `损坏` 里的条目：声明长度不动，只把压缩数据首 4 字节改成 0xff（读到就 inflate 失败）。
 */
function 造zip(条目: Record<string, string>, 压缩: boolean, 损坏?: string[]): Uint8Array {
  const 编码 = new TextEncoder()
  const 本地: Uint8Array[] = []
  const 目录: Uint8Array[] = []
  const 损坏位置: number[] = []
  let 偏移 = 0
  for (const [名, 内容] of Object.entries(条目)) {
    const 名节 = 编码.encode(名)
    const 原 = 编码.encode(内容)
    const 数据 = 压缩 ? new Uint8Array(deflateRawSync(原)) : 原
    if (损坏?.includes(名) && 数据.length >= 4) 损坏位置.push(偏移 + 30 + 名节.length)
    const 头 = new DataView(new ArrayBuffer(30))
    头.setUint32(0, 0x04034b50, true)
    头.setUint16(8, 压缩 ? 8 : 0, true)
    头.setUint32(14, 0, true) // crc 不校验
    头.setUint32(18, 数据.length, true)
    头.setUint32(22, 原.length, true)
    头.setUint16(26, 名节.length, true)
    本地.push(new Uint8Array(头.buffer), 名节, 数据)

    const 中 = new DataView(new ArrayBuffer(46))
    中.setUint32(0, 0x02014b50, true)
    中.setUint16(10, 压缩 ? 8 : 0, true)
    中.setUint32(20, 数据.length, true)
    中.setUint32(24, 原.length, true)
    中.setUint16(28, 名节.length, true)
    中.setUint32(42, 偏移, true)
    目录.push(new Uint8Array(中.buffer), 名节)

    偏移 += 30 + 名节.length + 数据.length
  }
  const 目录起 = 偏移
  const 目录长 = 目录.reduce((n, 片) => n + 片.length, 0)
  const 尾 = new DataView(new ArrayBuffer(22))
  尾.setUint32(0, 0x06054b50, true)
  尾.setUint16(8, Object.keys(条目).length, true)
  尾.setUint16(10, Object.keys(条目).length, true)
  尾.setUint32(12, 目录长, true)
  尾.setUint32(16, 目录起, true)
  const 全 = [...本地, ...目录, new Uint8Array(尾.buffer)]
  const 总长 = 全.reduce((n, 片) => n + 片.length, 0)
  const out = new Uint8Array(总长)
  let at = 0
  for (const 片 of 全) {
    out.set(片, at)
    at += 片.length
  }
  for (const 位 of 损坏位置) out.set(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 位)
  return out
}

const 正文xml = `<w:document><w:body><w:p><w:r><w:t>2026年3月5日，张三向李四转账28万元。</w:t></w:r></w:p><w:p><w:r><w:t>第二段。</w:t></w:r></w:p></w:body></w:document>`

describe("文本抽取", () => {
  test("UTF-8 与 BOM", () => {
    expect(抽取文本(new TextEncoder().encode("﻿你好\n世界"), "a.txt").text).toBe("你好\n世界")
  })

  test("GBK 兜底（公安导出常见）", () => {
    // 「中文」的 GBK 编码
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    expect(抽取文本(bytes, "a.txt").text).toBe("中文")
  })

  test("两种编码都不认 ⇒ 可解释的报错", () => {
    expect(() => 抽取文本(new Uint8Array([0xff, 0xfe, 0x00]), "a.txt")).toThrow("无法识别文件编码")
  })

  test("空文件 ⇒ 报错，不返回空串", () => {
    expect(() => 抽取文本(new Uint8Array(), "a.txt")).toThrow("没有可读的文字")
  })

  test("docx：deflate 压缩能读，段落变行", () => {
    const zip = 造zip({ "word/document.xml": 正文xml }, true)
    expect(抽取文本(zip, "笔录.docx").text).toBe("2026年3月5日，张三向李四转账28万元。\n第二段。\n")
  })

  test("docx：stored（不压缩）也能读", () => {
    const zip = 造zip({ "word/document.xml": 正文xml }, false)
    expect(抽取文本(zip, "笔录.docx").text).toBe("2026年3月5日，张三向李四转账28万元。\n第二段。\n")
  })

  test("docx 里没有 word/document.xml ⇒ 指出「旧版 .doc 改后缀」", () => {
    const zip = 造zip({ "word/other.xml": "<x/>" }, false)
    expect(() => 抽取文本(zip, "笔录.docx")).toThrow("旧版 .doc")
  })

  test("不是 zip ⇒ 报错，不说「解析失败」这种空话", () => {
    expect(() => 抽取文本(new TextEncoder().encode("plain"), "笔录.docx")).toThrow("找不到 zip 目录")
  })

  test("压缩数据损坏 ⇒ 中文报错，不漏 zlib 原文", () => {
    const zip = 造zip({ "word/document.xml": 正文xml }, true, ["word/document.xml"])
    let 消息 = ""
    try {
      抽取文本(zip, "笔录.docx")
    } catch (e) {
      消息 = (e as Error).message
    }
    expect(消息).toContain("这个 .docx 的压缩数据已损坏")
    expect(消息).not.toMatch(/code lengths|invalid|zlib|RangeError|ERR_/)
  })

  test("别的部件坏了不影响正文：只解压 word/document.xml", () => {
    const zip = 造zip({ "word/document.xml": 正文xml, "word/media/坏.bin": "随便" }, true, ["word/media/坏.bin"])
    expect(抽取文本(zip, "笔录.docx").text).toBe("2026年3月5日，张三向李四转账28万元。\n第二段。\n")
  })

  test("越界的字符引用不让英文 RangeError 漏出来", () => {
    const zip = 造zip({ "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>甲&#1114112;乙</w:t></w:r></w:p></w:body></w:document>` }, true)
    expect(抽取文本(zip, "笔录.docx").text).toBe("甲&#1114112;乙\n")
  })

  test("命名实体 &nbsp; / &mdash; 也要解开", () => {
    const zip = 造zip({ "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>甲&nbsp;乙&mdash;丙</w:t></w:r></w:p></w:body></w:document>` }, true)
    expect(抽取文本(zip, "笔录.docx").text).toBe("甲 乙—丙\n")
  })

  test("UTF-16LE 的 ASCII 文件被当成文本 ⇒ 拒掉，别把乱码喂给模型", () => {
    const bytes = new Uint8Array([0x68, 0x00, 0x65, 0x00, 0x6c, 0x00])
    expect(() => 抽取文本(bytes, "a.txt")).toThrow("不是纯文本")
  })

  test("偶发一个 \\f 的老日志不该被拒（按比例判）", () => {
    const 正文 = "第一段\n".repeat(20) + "\f" + "第二段\n".repeat(20)
    expect(抽取文本(new TextEncoder().encode(正文), "老.log").text).toContain("第二段")
  })

  test("超过字数上限 ⇒ 可操作报错（R8）", () => {
    const 大 = "字".repeat(文本字数上限 + 1)
    expect(() => 抽取文本(new TextEncoder().encode(大), "a.txt")).toThrow("超过单份材料上限")
  })
})
