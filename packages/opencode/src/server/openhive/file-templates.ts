/**
 * 013 T1 · **新建文件按后缀写一份最小可用的预置模板**。
 *
 * 现状（本文件之前）：`POST /openhive/file/create` 一律 `writeFile(target, "")` ⇒ `.docx` /
 * `.xlsx` / `.pdf` / 图片建出来都是 **0 字节**，双击打开只会是「空文件」或解析失败。
 *
 * ## 为什么按**后缀**隐式生效，而不是加请求字段
 *
 * 前端勾选类型的结果就是「名字带该后缀」（`spec.md` §4.3）——语义无歧义。这样 API 契约
 * 一字不变（与官方上游的合并冲突面最小），未列出的后缀仍写 0 字节（`.md` / `.txt` / `.csv`
 * 刻意留空：打开编辑器即可写，见 §4.5）。
 *
 * ## 每一类都必须**真的能被读回**
 *
 * 这里刻意不做「看起来像」的字节：docx / xmind 是能被 zip 解开的包，xlsx 走 `xlsx` 库生成，
 * PDF 的 `xref` 偏移按**实际生成结果**计算（先拼对象、再回填偏移），图片是真实可解码的
 * 1×1 文件。结构校验见 `test/server/openhive-file-templates.test.ts`。
 *
 * 结果按**后缀**缓存（模块级 `Map`，缓存的是 Promise）⇒ 同后缀只生成一次，并发的两次
 * 调用也共用同一趟生成。
 */

import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
  type WorkerConfiguration,
  type ZipWriterConstructorOptions,
} from "@zip.js/zip.js"

/** 与 `file.ts` 打包下载同一套选项（zip.js 2.7.62 的类型把 `useCompressionStream` 挂在 WorkerConfiguration 上）。 */
const ZIP_OPTIONS: ZipWriterConstructorOptions & WorkerConfiguration = { useCompressionStream: true }

const 编码 = new TextEncoder()

/** 打一个 zip 包：条目按给定顺序写，内容一律 UTF-8 文本。 */
async function 打包(条目: Array<[name: string, text: string]>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), ZIP_OPTIONS)
  for (const [名, 文本] of 条目) await writer.add(名, new TextReader(文本))
  return writer.close()
}

// ─────────────────────────────────────────────────────────────── docx

const DOCX内容类型 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
`

const DOCX关系 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`

const DOCX正文 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>
`

const 生成docx = () =>
  打包([
    ["[Content_Types].xml", DOCX内容类型],
    ["_rels/.rels", DOCX关系],
    ["word/document.xml", DOCX正文],
  ])

// ─────────────────────────────────────────────────────────────── xlsx

/** 惰性 `import("xlsx")`：只有真的新建表格时才付这个包的加载成本。 */
async function 生成xlsx(): Promise<Uint8Array> {
  const XLSX = await import("xlsx")
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), "Sheet1")
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" })
}

// ─────────────────────────────────────────────────────────────── xmind

/** 一张空画布（XMind 的 `content.json` 就是这个形状）。 */
const XMIND内容 = JSON.stringify([
  {
    id: "sheet-1",
    class: "sheet",
    title: "画布 1",
    rootTopic: { id: "root", class: "topic", title: "中心主题", children: { attached: [] } },
  },
])

const 生成xmind = () => 打包([["content.json", XMIND内容]])

// ─────────────────────────────────────────────────────────────── pdf

/**
 * 手写最小单页 PDF：A4（595×842）、Helvetica、一行「正文」。
 *
 * `xref` 的偏移**必须**按实际生成结果算：先按顺序拼出对象并记下每个对象的起始字节，
 * 再回填 xref 表，最后 `startxref` 指向 `xref` 关键字。任何「先按长度猜一个数」的写法
 * 都会让查看器拒绝打开（测试逐条把偏移读回来对对象头）。
 */
function 生成pdf(): Uint8Array {
  const 正文 = "BT /F1 24 Tf 72 770 Td (正文) Tj ET"
  const 对象们 = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${编码.encode(正文).byteLength} >>\nstream\n${正文}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  const 部件: Uint8Array[] = []
  let 长度 = 0
  const 追加 = (text: string) => {
    const bytes = 编码.encode(text)
    部件.push(bytes)
    const 起始 = 长度
    长度 += bytes.byteLength
    return 起始
  }

  追加("%PDF-1.4\n")
  const 偏移 = 对象们.map((对象, index) => 追加(`${index + 1} 0 obj\n${对象}\nendobj\n`))

  const 交叉表 = 追加("xref\n")
  追加(`0 ${对象们.length + 1}\n`)
  追加("0000000000 65535 f \n")
  for (const 起始 of 偏移) 追加(`${String(起始).padStart(10, "0")} 00000 n \n`)
  追加("trailer\n")
  追加(`<< /Size ${对象们.length + 1} /Root 1 0 R >>\n`)
  追加(`startxref\n${交叉表}\n%%EOF\n`)

  const 合并 = new Uint8Array(长度)
  let 写到 = 0
  for (const 部 of 部件) {
    合并.set(部, 写到)
    写到 += 部.byteLength
  }
  return 合并
}

// ─────────────────────────────────────────────────────────────── 图片

/** 真实可解码的 1×1 文件（不是手搓的「看起来像」字节；生成后用 PIL 逐张解码核对过）。 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="
const GIF_BASE64 = "R0lGODlhAQABAIEAAAAAAAAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAgEAAEEBAA7"
const WEBP_BASE64 = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA="

const 静态图片: Record<string, string> = {
  png: PNG_BASE64,
  jpg: JPEG_BASE64,
  jpeg: JPEG_BASE64,
  gif: GIF_BASE64,
  webp: WEBP_BASE64,
}

/** BMP 直接算字节：54 字节头（含 40 字节 DIB）＋ 24bpp 一行 4 字节（3 字节像素＋1 字节行填充）。 */
function 生成bmp(): Uint8Array {
  const bytes = new Uint8Array(58)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42 // "B"
  bytes[1] = 0x4d // "M"
  view.setUint32(2, bytes.byteLength, true) // 文件大小
  view.setUint32(10, 54, true) // 像素数据偏移
  view.setUint32(14, 40, true) // DIB 头大小
  view.setInt32(18, 1, true) // 宽
  view.setInt32(22, 1, true) // 高
  view.setUint16(26, 1, true) // planes
  view.setUint16(28, 24, true) // 每像素位数
  view.setUint32(34, 4, true) // 像素数据大小
  bytes.fill(0xff, 54, 57) // 一个白色像素（BGR）；第 57 字节是行填充，保持 0
  return bytes
}

// ─────────────────────────────────────────────────────────────── 网页 / 分派

const HTML骨架 = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>新建网页</title>
</head>
<body>

</body>
</html>
`

/** 最后一个点之后的后缀，**大小写不敏感**；没有后缀（或无点的隐藏名）回 `undefined`。 */
function 取后缀(name: string): string | undefined {
  const 点 = name.lastIndexOf(".")
  if (点 <= 0 || 点 === name.length - 1) return undefined
  return name.slice(点 + 1).toLowerCase()
}

async function 生成(后缀: string): Promise<Uint8Array | undefined> {
  switch (后缀) {
    case "docx":
      return 生成docx()
    case "xlsx":
      return 生成xlsx()
    case "xmind":
      return 生成xmind()
    case "pdf":
      return 生成pdf()
    case "bmp":
      return 生成bmp()
    case "html":
    case "htm":
      return 编码.encode(HTML骨架)
    default: {
      const base64 = 静态图片[后缀]
      return base64 === undefined ? undefined : Buffer.from(base64, "base64")
    }
  }
}

/**
 * 按 `name` 的后缀返回预置模板字节；未列出的后缀回 `undefined`（调用方仍写 0 字节）。
 *
 * 缓存的是 **Promise**：同后缀的并发调用也只跑一趟生成（`#002-06` 同一个前提不两处各算）。
 */
const 缓存 = new Map<string, Promise<Uint8Array | undefined>>()

export async function 模板字节(name: string): Promise<Uint8Array | undefined> {
  const 后缀 = 取后缀(name)
  if (后缀 === undefined) return undefined

  const 已有 = 缓存.get(后缀)
  if (已有 !== undefined) return 已有

  const 生成中 = 生成(后缀)
  缓存.set(后缀, 生成中)
  return 生成中
}
