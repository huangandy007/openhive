import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import * as XLSX from "xlsx"
import type { FileContent } from "@/center/file-content"
import { 列上界, 行上界, renderSheet, SheetView } from "./sheet-view"

/**
 * 用 SheetJS 自己造一份**真 xlsx 字节**当夹具——不是手搓的假数据，走的是完整 zip/OOXML 往返。
 *
 * 直接喂给 `Uint8Array` 而不写 `as ArrayBuffer`：`XLSX.write` 在 SheetJS 自己的 d.ts 里
 * 声明就是 `any`（`types/index.d.ts:34`，无 `type: "array"` 的可用重载），断言只是把 `any`
 * 换个说法，还会招 lint 的 `no-unsafe-type-assertion`。构造器本就收 ArrayBufferLike，`any` 直接过。
 */
function 工作簿字节(表: unknown[][], 名 = "明细"): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), 名)
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

/**
 * 造一份**加密**的工作簿：真加密的 Office 文件不是 zip，而是 OLE2 复合文档（头 `D0 CF 11 E0`），
 * 里面存着一条 `/encryption` 流。这里用 SheetJS 自己的 CFB 写出这个容器——与 `工作簿字节()`
 * 同为「真库造的真字节」，不是手搓的假数据。
 *
 * ⚠️ 那条流的内容是假的（我们不真造一个能解密的容器）：SheetJS 只要看见这条流就抛
 * `File is password-protected`，而这正是要考的那一步。
 */
function 加密工作簿(): Uint8Array<ArrayBuffer> {
  const cfb = XLSX.CFB.utils.cfb_new()
  XLSX.CFB.utils.cfb_add(cfb, "/encryption", new TextEncoder().encode("假的加密信息"))
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }))
}

/** 逐字节拼串再 btoa——真 xlsx 有一万多字节，`String.fromCharCode(...bytes)` 会爆栈。 */
function 二进制内容(bytes: Uint8Array): FileContent {
  let 串 = ""
  for (const byte of bytes) 串 += String.fromCharCode(byte)
  return { type: "binary", content: btoa(串), encoding: "base64" }
}

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「load → decode → render」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

function 容器() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  return host
}

describe("表格视图：字节 → 表格", () => {
  test("真 xlsx 字节渲染成表格，单元格文本落到表里", async () => {
    const host = 容器()

    await renderSheet(工作簿字节([["姓名", "金额"], ["张三", 1200]]), host)

    expect(host.querySelector("table")).not.toBeNull()
    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("1200")
  })

  // 探针查实：SheetJS 对「无 zip 头的文本」按 Latin-1 解，中文 CSV 会变成「å§å」这类乱码。
  // 公安数据大量是中文 CSV，这条不是锦上添花——不修的话 .csv 这一整类都是废的。
  test("UTF-8 中文 CSV 不作乱码（.csv 也归表格这一类）", async () => {
    const host = 容器()

    await renderSheet(new TextEncoder().encode("姓名,金额\n张三,1200\n"), host)

    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("姓名")
  })

  test("长短不一的行按最宽行补齐，表格不错位（真实表格大量是残缺行）", async () => {
    const host = 容器()

    await renderSheet(工作簿字节([["姓名", "金额", "备注"], ["张三", 1200]]), host)

    const 每行格数 = [...host.querySelectorAll("tr")].map((tr) => tr.querySelectorAll("td").length)
    expect(每行格数).toEqual([3, 3])
  })

  test("文件读不出表格结构：渲染器抛错（由壳落 error，不在这里静默吞掉）", async () => {
    const host = 容器()

    // 探针查实：这不是「随便喂点垃圾」——SheetJS 对多数垃圾会**当成 CSV 成功解析**。
    // 只有带 PK 头的残缺 zip 才真抛 `Unsupported ZIP file`，即「看着像 xlsx 但坏了」，
    // 也正是一个下载中断的表格文件的真实样子。
    await expect(renderSheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), host)).rejects.toThrow()
    expect(host.querySelector("table")).toBeNull()
  })

  test("单元格里的 HTML 当文本，不是当结构（文件内容是不可信输入）", async () => {
    const host = 容器()

    await renderSheet(工作簿字节([["<img src=x onerror=alert(1)>"]]), host)

    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  test("超长表：只铺前 行上界 行，并明说是截断（不许悄悄少给）", async () => {
    const 表 = Array.from({ length: 行上界 + 5 }, (_, i) => [`第${i}行`])
    const host = 容器()

    await renderSheet(工作簿字节(表), host)

    expect(host.querySelectorAll("tr").length).toBe(行上界)
    expect(host.textContent).toContain(`第${行上界 - 1}行`) // 最后一条该在的
    expect(host.textContent).not.toContain(`第${行上界}行`) // 第一条该被砍的
    expect(host.textContent).toContain("只显示前")

    // 提示是**我们自己的**文案（不是文件里的内容），配色走 v2 语义 token——与 T015 的降级面板、
    // T016 的代码视图同一套。v1 的 `text-text-weak` 是上游遗留口径，本 feature 的视图不用它。
    const 提示 = host.querySelector<HTMLElement>('[data-slot="sheet-truncated"]')
    expect(提示?.className ?? "").toContain("text-v2-text-text-muted")
    expect(提示?.className ?? "").not.toContain("text-text-weak")
  })

  test("超宽表：只铺前 列上界 列，并明说是截断", async () => {
    const 表 = [Array.from({ length: 列上界 + 3 }, (_, i) => `列${i}`)]
    const host = 容器()

    await renderSheet(工作簿字节(表), host)

    expect([...host.querySelectorAll("tr")].map((tr) => tr.querySelectorAll("td").length)).toEqual([列上界])
    expect(host.textContent).not.toContain(`列${列上界}`)
    expect(host.textContent).toContain("只显示前")
  })

  test("刚好到上界不算截断：不出提示（提示一旦泛滥就等于没有）", async () => {
    const host = 容器()

    await renderSheet(工作簿字节([Array.from({ length: 列上界 }, (_, i) => `列${i}`)]), host)

    expect(host.textContent).not.toContain("只显示前")
  })

  /**
   * 加密的工作簿：SheetJS **认得出**（它自己抛 `File is password-protected`），
   * 故由渲染器分类成「需要密码」那一档，别在这里静默吞掉。
   *
   * 注意**不能**用「见到 OLE2 魔数就当加密」来偷懒：老 `.doc` 也是 OLE2，
   * 而它是「不支持的格式」不是加密（`document-view.tsx` 那条）。两类分开，靠的是
   * SheetJS 自己交回的说法，不是魔数。
   */
  test("加密的工作簿：渲染器抛错，由壳落「需要密码」（不静默吞掉）", async () => {
    const host = 容器()

    await expect(renderSheet(加密工作簿(), host)).rejects.toThrow(/加密/)
    expect(host.querySelector("table")).toBeNull()
  })

  test("多张工作表：铺第一张（表格视图不给工作表切换，见源码注释）", async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["第一张的格子"]]), "第一张")
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["第二张的格子"]]), "第二张")
    const host = 容器()

    await renderSheet(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), host)

    expect(host.textContent).toContain("第一张的格子")
    expect(host.textContent).not.toContain("第二张的格子")
  })
})

describe("表格视图接进通用壳（FR-007 的 .xls/.xlsx/.csv）", () => {
  const 视图 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='sheet-view']")

  test("读不到文件：停在 empty，不渲染表格", async () => {
    const host = mount(() => <SheetView path="/p/没.xlsx" load={async () => undefined} />)

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
    expect(host.querySelector("table")).toBeNull()
  })

  test("拿到真表格字节：表格长在视图里，状态 ready", async () => {
    const host = mount(() => (
      <SheetView path="/p/名单.xlsx" load={async () => 二进制内容(工作簿字节([["姓名"], ["张三"]]))} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("ready")
    expect(host.querySelector("[data-component='sheet-view'] table")).not.toBeNull()
    expect(视图(host)?.textContent).toContain("张三")
  })

  /**
   * 加密的 .xlsx/.xls 落 `encrypted`，**不能落 `error`**——理由同 `.doc` / XMind 8 / 压缩方式：
   * 文件一点没坏，说成「这个文件打不开 · 可能已经损坏」就是让民警去怀疑一份好文件。
   */
  test("加密的工作簿：落「需要密码」，不说文件损坏", async () => {
    const host = mount(() => <SheetView path="/p/账册.xlsx" load={async () => 二进制内容(加密工作簿())} />)

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("encrypted")
    const 降级 = host.querySelector("[data-component='degraded-view']")
    expect(降级?.getAttribute("data-reason")).toBe("encrypted")
    expect(降级?.textContent).toContain("密码")
    // 「损坏」是 error 那一档的说法——一份锁着的文件不该被说成这样
    expect(降级?.textContent).not.toContain("损坏")
  })
})
