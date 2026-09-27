import * as XLSX from "xlsx"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

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
  const book = XLSX.read(bytes, { type: "array", codepage: 65001 })
  // 不做「有没有工作表」的判空：探针查实零工作表的工作簿造不出来（SheetJS 写出时自己抛
  // `Workbook is empty`），而读垃圾字节也总会得到 `SheetNames: ["Sheet1"]` —— 那是条死代码。
  const sheet = book.Sheets[book.SheetNames[0]]

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
  })

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
