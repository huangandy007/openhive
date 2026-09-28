import * as XLSX from "xlsx"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 需要密码 } from "./unsupported-format"

/**
 * 铺进 DOM 的行 / 列上界。
 *
 * 表格是**一格一个 DOM 节点**铺的（`<td>`），所以「表有多大」直接等于「页面上有多少节点」。
 * 公安那边的表动辄十万行话单，不看上界地铺下去就是把标签页卡死。超出的部分**明说截断**，
 * 不静默少给（静默少给＝民警拿着前 1000 行当整份数据用，比卡死更危险）。
 *
 * 数值是权衡后的取舍：1000 × 64 = 6.4 万个格子，是浏览器铺表还能交互的量级；列 64 覆盖得住
 * 话单/资金表常见的三四十列。**整份解析**（含超大表）是另一个量级的活儿，已登记在 state.md
 * 的承接任务里（移进 Worker + 超时 terminate），不在本轮。
 */
export const 行上界 = 1000
export const 列上界 = 64

/**
 * 把工作簿的第一张工作表铺成 HTML 表格。
 *
 * `codepage: 65001` 不可省：`.csv` 这类**没有 zip 头**的文本，SheetJS 默认按 Latin-1 解，
 * 中文会变成「å§å」这类乱码（探针实测）。公安数据大量是中文 CSV，不设它整类都不可用。
 * 对真 `.xlsx`/`.xls` 无影响（探针已验：zip 路径自带编码声明，不读这个值）。
 * 副作用：SheetJS 会往 stderr 打一行「Codepage tables are not loaded」——那是它的可选码页表
 * 没随包发布，UTF-8 这条路径不依赖它，结果正确。
 */
export const renderSheet: BytesRenderer = async (bytes, container) => {
  let book: XLSX.WorkBook
  try {
    book = XLSX.read(bytes, { type: "array", codepage: 65001 })
  } catch (原因) {
    // 加密的工作簿**单独认出来**：真加密的 Office 文件不是 zip，而是 OLE2 容器
    // （头 `D0 CF 11 E0`）+ 一条 `/encryption` 流，此时 SheetJS 抛
    // `Error("File is password-protected")`。它认得出是加密，但没有自己的错误类型，
    // 只能按消息认（`password-protected` 是它几个抛出点共有的那段词）。
    // 落 `error` 会显示「这个文件打不开 · 可能已经损坏」——文件一点没坏、只是锁着，
    // 民警该做的是去要密码（机制见 `unsupported-format.ts`）。
    //
    // ⚠️ **不要**改用「见到 OLE2 魔数就拒收」来偷懒：老 `.doc`（BIFF）同样是 OLE2，
    // 但 SheetJS 读得了它、那边是另一个档（`document-view` 的「不支持的格式」，不是加密）。
    // 两类分得开，靠的是 SheetJS 自己交回的说法，不是魔数。
    if (原因 instanceof Error && /password-protected/i.test(原因.message)) {
      throw 需要密码("工作簿是加密的，SheetJS 报 password-protected")
    }
    throw 原因
  }
  // 不做「有没有工作表」的判空：探针查实零工作表的工作簿造不出来（SheetJS 写出时自己抛
  // `Workbook is empty`），而读垃圾字节也总会得到 `SheetNames: ["Sheet1"]` —— 那是条死代码。
  const sheet = book.Sheets[book.SheetNames[0]]

  // 表本身的尺寸从 `!ref`（形如 `A1:BL99999`）读，**在铺之前**读——铺完再数行数就晚了。
  const 全范围 = XLSX.utils.decode_range(sheet["!ref"] ?? "A1")
  const 总行 = 全范围.e.r - 全范围.s.r + 1
  const 总列 = 全范围.e.c - 全范围.s.c + 1
  const 截了行 = 总行 > 行上界
  const 截了列 = 总列 > 列上界
  // `range` 交回 SheetJS 去裁：只喂前 上界 行/列，而不是全铺完再在 DOM 这边丢——
  // 后者照样要把整张表物化成 JS 数组，白花一次大表的内存。
  const 范围 = {
    s: { r: 全范围.s.r, c: 全范围.s.c },
    e: { r: Math.min(全范围.e.r, 全范围.s.r + 行上界 - 1), c: Math.min(全范围.e.c, 全范围.s.c + 列上界 - 1) },
  }

  // `defval` + `blankrows` 一起保证**行宽对齐**：真实表格大量是残缺行（某行少几列、或有整行空），
  // 不补齐的话每行格数不一，列会串位。已用「临时摘掉这两个选项」验证过下方测试确实抓得住（收到 [3,2]）。
  // 行类型显式写成「单元格联合的数组」而非 `unknown[]`：默认 `raw: true` 下 SheetJS 交回的单元格
  // 就是这几种原始值（文本 / 数字 / 布尔 / `defval` 补的空），标出来 `String(cell)` 才有据可依——
  // 否则 `unknown` 会被 lint 判为「可能拼出 `[object Object]`」。（注意 `sheet_to_json<T>` 的 `T`
  // 是**行**类型，`header: 1` 下行本身是数组，漏掉外层 `[]` 会 typecheck 不过。）
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    range: 范围,
  })

  if (截了行 || 截了列) {
    const 砍掉 = [截了行 ? `前 ${行上界} 行` : undefined, 截了列 ? `前 ${列上界} 列` : undefined]
    const 提示 = document.createElement("p")
    // 配色走 v2 语义 token（`text-12-regular` 只是字号/字重那一档的既有工具类，不带颜色）。
    // 本 feature 自己的文案一律不用 v1 的 `text-text-weak`——那是上游遗留口径。
    提示.dataset.slot = "sheet-truncated"
    提示.className = "mb-2 text-12-regular text-v2-text-text-muted"
    提示.textContent = `表太大，这里只显示${砍掉.filter(Boolean).join(" × ")}（原表共 ${总行} 行 × ${总列} 列）。`
    container.appendChild(提示)
  }

  const table = document.createElement("table")
  for (const row of rows) {
    const tr = document.createElement("tr")
    for (const cell of row) {
      const td = document.createElement("td")
      // `== null` 一并盖住 null 与 undefined：`defval` 补的是 null，但没必要为此少一层保险。
      td.textContent = cell == null ? "" : String(cell)
      tr.appendChild(td)
    }
    table.appendChild(tr)
  }
  container.appendChild(table)
}

export const SheetView: ViewComponent = (props) => (
  <BinaryView name="sheet-view" path={props.path} load={props.load} render={renderSheet} />
)
