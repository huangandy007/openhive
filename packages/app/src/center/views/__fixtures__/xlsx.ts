/**
 * 手搓的最小 .xlsx：只够 SheetJS 读出一张表。
 *
 * **为什么需要它**（2026-11-24）：真实导出工具会把 `<dimension>` 写成**单格且不含冒号**
 * （三湘平台 `ref="G27006"`、支付宝/财付通导出 `ref="A1"`）。SheetJS 的 `dimregex`
 * （`node_modules/xlsx/xlsx.mjs:15859`，`/"(\w*:\w*)"/`）认不出这种写法，于是 `sheetRows`
 * 截断时**不设** `!fullref` —— 调用方拿 `!ref` 当总范围，就只剩首屏那几百行。
 *
 * `XLSX.write` 自产的文件 dimension 一定是 `A1:B2` 这种带冒号的形状，**测不出这个洞**；
 * 真文件又没法为每个断言各造一份。所以复用 `__fixtures__/zip.ts` 的造包器手搭一个。
 *
 * 单元格一律用 `inlineStr`，不建 sharedStrings —— 表结构越小，坏形状越显眼。
 */

import { 造包 } from "./zip"

/**
 * @param 行数 含表头在内的总行数
 * @param 维度 `<dimension ref>` 的原文；默认 `"A1"`（真实导出里最常见的坏写法）
 */
export function 单格Dimension工作簿(行数: number, 维度 = "A1"): Uint8Array<ArrayBuffer> {
  const 行: string[] = [
    `<row r="1"><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="B1" t="inlineStr"><is><t>金额</t></is></c></row>`,
  ]
  for (let r = 2; r <= 行数; r++) {
    行.push(
      `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>张三${r}</t></is></c><c r="B${r}"><v>${r}</v></c></row>`,
    )
  }
  const 表 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${维度}"/><sheetData>${行.join("")}</sheetData></worksheet>`
  return 造包([
    {
      name: "[Content_Types].xml",
      数据: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      方式: 0,
    },
    {
      name: "_rels/.rels",
      数据: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      方式: 0,
    },
    {
      name: "xl/workbook.xml",
      数据: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      方式: 0,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      数据: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      方式: 0,
    },
    { name: "xl/worksheets/sheet1.xml", 数据: 表, 方式: 0 },
  ])
}
