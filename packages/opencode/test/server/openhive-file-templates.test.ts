import { describe, expect, test } from "bun:test"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
import * as XLSX from "xlsx"
import { 模板字节 } from "../../src/server/openhive/file-templates"

/**
 * 013 T1：`模板字节(name)` 的**结构**判据。
 *
 * 每类都不止断「非空」——非空只能证明「写了点什么」，证明不了「写出来的是那类文件」。
 * 所以一律用**各自的读回手段**验：zip 用 `ZipReader` 逐条目读、xlsx 用 `XLSX.read`、PDF 解析
 * `startxref` 与每个对象偏移、图片断 magic 与头部字段（`LEARNINGS #005-18`：假绿四问之一就是
 * 「断言太弱，坏实现照样绿」）。
 */

/** 1 字节 = 1 字符的读法：PDF 的偏移是**字节**偏移，用 UTF-8 解码会把位置对错。 */
const 字节串 = (bytes: Uint8Array) => {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

interface 解开的条目 {
  name: string
  text: string
}

/** 把模板字节当 zip 读回来。条目**非目录**，文本一律按 UTF-8 解。 */
async function 读zip(bytes: Uint8Array): Promise<解开的条目[]> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entries = await reader.getEntries()
    return await Promise.all(
      entries.map(async (entry) => ({
        name: entry.filename,
        text: entry.directory ? "" : await entry.getData!(new TextWriter()),
      })),
    )
  } finally {
    await reader.close()
  }
}

const 条目文本 = (条目: 解开的条目[], name: string) => {
  const found = 条目.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`zip 里没有条目「${name}」，实得：${条目.map((e) => e.name).join(", ")}`)
  return found.text
}

/** JSON.parse 的结果先当 `unknown`，用这个守卫收窄（不写 `as Record`）。 */
const 是记录 = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

describe("013 T1 · 按后缀生成最小预置模板", () => {
  test(".docx ⇒ 三条 OOXML 条目齐全，document 里有一行「正文」，Content_Types 声明主文档类型", async () => {
    const bytes = await 模板字节("新建文档.docx")
    expect(bytes).toBeDefined()
    expect(bytes!.byteLength).toBeGreaterThan(0)

    const 条目 = await 读zip(bytes!)
    expect(条目.map((entry) => entry.name).toSorted()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "word/document.xml"].toSorted(),
    )

    const 内容类型 = 条目文本(条目, "[Content_Types].xml")
    expect(内容类型).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    )
    expect(内容类型).toContain('PartName="/word/document.xml"')
    expect(条目文本(条目, "word/document.xml")).toContain("正文")
    expect(条目文本(条目, "_rels/.rels")).toContain("word/document.xml")
  })

  test(".xmind ⇒ 只有一个 content.json，且是一张带 rootTopic「中心主题」的画布", async () => {
    const bytes = await 模板字节("思维导图.xmind")
    expect(bytes).toBeDefined()

    const 条目 = await 读zip(bytes!)
    expect(条目.map((entry) => entry.name)).toEqual(["content.json"])

    const 画布们 = JSON.parse(条目文本(条目, "content.json")) as unknown
    expect(Array.isArray(画布们)).toBe(true)
    if (!Array.isArray(画布们) || !是记录(画布们[0])) throw new Error("content.json 的第一项不是画布对象")
    const 画布 = 画布们[0]
    expect(画布.class).toBe("sheet")
    expect(画布.title).toBe("画布 1")
    if (!是记录(画布.rootTopic)) throw new Error("画布缺 rootTopic 对象")
    expect(画布.rootTopic.title).toBe("中心主题")
    expect(画布.rootTopic.class).toBe("topic")
  })

  test(".xlsx ⇒ 能被 xlsx 读回，至少一个工作表且名字是 Sheet1", async () => {
    const bytes = await 模板字节("新建表格.xlsx")
    expect(bytes).toBeDefined()

    const book = XLSX.read(bytes!, { type: "array" })
    expect(book.SheetNames.length).toBeGreaterThanOrEqual(1)
    expect(book.SheetNames).toContain("Sheet1")
  })

  test(".pdf ⇒ %PDF- 开头、%%EOF 结尾；startxref 指向 xref，每个 xref 偏移落在对象头", async () => {
    const bytes = await 模板字节("新建文档.pdf")
    expect(bytes).toBeDefined()

    const text = 字节串(bytes!)
    expect(text.startsWith("%PDF-")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(text).toContain("/BaseFont /Helvetica")
    expect(text).toContain("/MediaBox [0 0 595 842]")

    const 起始 = text.match(/startxref\s+(\d+)/)
    expect(起始).not.toBeNull()
    const 交叉表偏移 = Number(起始![1])
    expect(text.slice(交叉表偏移, 交叉表偏移 + 4)).toBe("xref")

    // xref 表：第一行是 `xref`，第二行 `0 N`，随后 N 条 20 字节定长记录。
    const 行们 = text.slice(交叉表偏移).split("\n")
    const 计数 = 行们[1].match(/^0 (\d+)$/)
    expect(计数).not.toBeNull()
    if (计数 === null) throw new Error("xref 表第二行不是「0 N」")
    const 对象数 = Number(计数[1])
    // 0 号是空闲项（65535 f），其余逐个是对象偏移。
    for (let index = 1; index < 对象数; index++) {
      const 记录 = 行们[2 + index].match(/^(\d{10}) (\d{5}) n/)
      expect(记录).not.toBeNull()
      if (记录 === null) throw new Error(`xref 第 ${index} 条记录形状不对`)
      const offset = Number(记录[1])
      const 对象头 = `${index} 0 obj`
      expect(text.slice(offset, offset + 对象头.length)).toBe(对象头)
    }
  })

  test(".png ⇒ 8 字节 magic + IHDR，宽高都是 1", async () => {
    const bytes = await 模板字节("图片.png")
    expect(bytes).toBeDefined()

    expect(Array.from(bytes!.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(字节串(bytes!.slice(12, 16))).toBe("IHDR")
    const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength)
    expect(view.getUint32(16)).toBe(1)
    expect(view.getUint32(20)).toBe(1)
  })

  test(".jpg ⇒ FFD8FF 开头、FFD9 收尾", async () => {
    const bytes = await 模板字节("图片.jpg")
    expect(bytes).toBeDefined()

    expect(Array.from(bytes!.slice(0, 3))).toEqual([0xff, 0xd8, 0xff])
    expect(Array.from(bytes!.slice(-2))).toEqual([0xff, 0xd9])
  })

  test(".jpeg ⇒ 与 .jpg 同一种文件", async () => {
    const bytes = await 模板字节("图片.jpeg")
    expect(bytes).toBeDefined()

    expect(Array.from(bytes!.slice(0, 3))).toEqual([0xff, 0xd8, 0xff])
    expect(Array.from(bytes!.slice(-2))).toEqual([0xff, 0xd9])
  })

  test(".gif ⇒ GIF89a 头", async () => {
    const bytes = await 模板字节("图片.gif")
    expect(bytes).toBeDefined()

    expect(字节串(bytes!.slice(0, 6))).toBe("GIF89a")
  })

  test(".bmp ⇒ BM 头，DIB 里的宽高都是 1", async () => {
    const bytes = await 模板字节("图片.bmp")
    expect(bytes).toBeDefined()

    expect(字节串(bytes!.slice(0, 2))).toBe("BM")
    const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength)
    expect(view.getInt32(18, true)).toBe(1)
    expect(view.getInt32(22, true)).toBe(1)
    expect(bytes!.byteLength).toBe(58)
  })

  test(".webp ⇒ RIFF 容器，偏移 8 处是 WEBP", async () => {
    const bytes = await 模板字节("图片.webp")
    expect(bytes).toBeDefined()

    expect(字节串(bytes!.slice(0, 4))).toBe("RIFF")
    expect(字节串(bytes!.slice(8, 12))).toBe("WEBP")
    const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength)
    expect(view.getUint32(4, true)).toBe(bytes!.byteLength - 8)
  })

  test(".html / .htm ⇒ 逐字节等于约定的 UTF-8 骨架", async () => {
    const 骨架 = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<title>新建网页</title>\n</head>\n<body>\n\n</body>\n</html>\n"
    const decoder = new TextDecoder()

    const html = await 模板字节("网页.html")
    const htm = await 模板字节("网页.htm")
    if (html === undefined || htm === undefined) throw new Error("html / htm 应当有模板")
    expect(decoder.decode(html)).toBe(骨架)
    expect(decoder.decode(htm)).toBe(骨架)
  })

  test("未列出的后缀 ⇒ undefined（.hgraph / .md / .txt / .csv，以及无后缀）", async () => {
    for (const name of ["关系图.hgraph", "说明.md", "笔记.txt", "表格.csv", "没有后缀"]) {
      expect(await 模板字节(name)).toBeUndefined()
    }
  })

  test("后缀大小写不敏感（.DOCX / .Pdf 同样命中）", async () => {
    const docx = await 模板字节("报告.DOCX")
    expect(docx).toBeDefined()
    expect(字节串(docx!.slice(0, 2))).toBe("PK")

    const pdf = await 模板字节("报告.Pdf")
    expect(pdf).toBeDefined()
    expect(字节串(pdf!.slice(0, 5))).toBe("%PDF-")
  })

  test("同后缀只生成一次（缓存返回同一份字节）", async () => {
    const 第一次 = await 模板字节("甲.docx")
    const 第二次 = await 模板字节("乙.docx")
    expect(第二次).toBe(第一次)
  })
})
