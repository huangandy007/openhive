import { describe, expect, test } from "bun:test"
import { viewRegistry } from "@/center/views"
import { 补类型后缀, 新建大类 } from "./file-create-catalog"

/**
 * 「新建文件」清单的纯函数守卫（013 · T3）。
 *
 * 清单与视图注册表是**同一批后缀的两个读者**：清单列出来一个后缀，用户就能建出这种文件；
 * 若注册表不认识它，建出来的东西双击打不开。这条一致性不能靠人眼对两处（`LEARNINGS #002-06`、
 * `#013-07`：排除不跨规则），故 parity 断言直接拿真实 `viewRegistry` 比。
 */
describe("新建文件清单（file-create-catalog）", () => {
  test("九个大类按序排列（用户 2026-11-16 逐条确认的顺序）", () => {
    expect(新建大类.map((大类) => 大类.名称)).toEqual([
      "文档",
      "表格",
      "图文",
      "关系图",
      "思维导图",
      "PDF",
      "图片",
      "网页",
      "代码",
    ])
  })

  test("每个后缀都带点、全小写", () => {
    for (const 大类 of 新建大类) {
      expect(大类.后缀们.length).toBeGreaterThan(0)
      for (const 后缀 of 大类.后缀们) {
        expect(后缀.startsWith(".")).toBe(true)
        expect(后缀).toBe(后缀.toLowerCase())
        expect(后缀.length).toBeGreaterThan(1)
      }
    }
  })

  /** 一个后缀只能属一个大类——两处都列会让「选的是哪类」出现两个答案。 */
  test("全部后缀无重复（同一后缀只属一个大类）", () => {
    const 归属 = new Map<string, string>()
    for (const 大类 of 新建大类) {
      for (const 后缀 of 大类.后缀们) {
        const 已有 = 归属.get(后缀)
        expect(已有 === undefined ? null : `${后缀} 重复归属：${已有} 与 ${大类.名称}`).toBeNull()
        归属.set(后缀, 大类.名称)
      }
    }
  })

  /**
   * parity：清单里**每一个**后缀都必须能被视图注册表打开。
   * 这不是形式检查——列一个打不开的后缀，用户点下去就得到一份「空文件 / 解析失败」。
   */
  test("清单里每个后缀都在视图注册表里有归属（parity）", () => {
    for (const 大类 of 新建大类) {
      for (const 后缀 of 大类.后缀们) {
        expect({ 后缀, 大类: 大类.名称, 有视图: viewRegistry.resolve(后缀) !== undefined }).toEqual({
          后缀,
          大类: 大类.名称,
          有视图: true,
        })
      }
    }
  })

  /**
   * 全量快照：9 大类 × 每个后缀逐字钉住（2026-11-16 审查 R2）。
   *
   * 这是「前端清单 ↔ 后端模板表」之间的**那道闸**：两份表分属两个 package，没法互相 import，
   * 于是任何新增后缀（例如给「图片」加 `.svg`）都必然让这条红。改动者被迫去确认
   * `packages/opencode/src/server/openhive/file-templates.ts` 里有没有对应模板——
   * 没有的话，用户会建出一份 0 字节的 `.svg`，而所有其它用例都是绿的（`#005-18` 假绿四问）。
   */
  test("清单全量快照（增删后缀必须过这条）", () => {
    expect(新建大类.map((大类) => ({ 名称: 大类.名称, 后缀们: [...大类.后缀们] }))).toEqual([
      { 名称: "文档", 后缀们: [".docx"] },
      { 名称: "表格", 后缀们: [".xlsx", ".csv"] },
      { 名称: "图文", 后缀们: [".md", ".txt"] },
      { 名称: "关系图", 后缀们: [".hgraph"] },
      { 名称: "思维导图", 后缀们: [".xmind"] },
      { 名称: "PDF", 后缀们: [".pdf"] },
      { 名称: "图片", 后缀们: [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"] },
      { 名称: "网页", 后缀们: [".html", ".htm"] },
      {
        名称: "代码",
        后缀们: [
          ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
          ".py", ".java", ".kt", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".scala", ".lua", ".r", ".pl", ".m",
          ".c", ".h", ".cc", ".cpp", ".hpp",
          ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql",
          ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env", ".properties",
          ".xml", ".css", ".scss", ".less",
        ],
      },
    ])
  })

  /** §4 裁定 1：`.doc` / `.xls` 是 legacy 二进制，没有可靠模板生成器 ⇒ 不列（既有文件仍可打开）。 */
  test("文档只列 .docx（.doc 不列）、表格只列 .xlsx/.csv（.xls 不列）", () => {
    expect(新建大类.find((大类) => 大类.名称 === "文档")?.后缀们).toEqual([".docx"])
    expect(新建大类.find((大类) => 大类.名称 === "表格")?.后缀们).toEqual([".xlsx", ".csv"])
  })

  test("代码大类默认折叠，其它大类不折叠", () => {
    for (const 大类 of 新建大类) {
      expect({ 名称: 大类.名称, 折叠: 大类.默认折叠 === true }).toEqual({
        名称: 大类.名称,
        折叠: 大类.名称 === "代码",
      })
    }
  })
})

/**
 * `补类型后缀` 从 `file-create-types.ts` 迁来（签名改成收后缀字符串，行为逐字不变）。
 * 四条判据：无后缀追加；同后缀（大小写不敏感）不重复；其它后缀照常追加。
 */
describe("补类型后缀", () => {
  test("名字没有后缀 ⇒ 追加", () => {
    expect(补类型后缀("张三", ".hgraph")).toBe("张三.hgraph")
  })

  test("名字带同后缀（大小写不敏感）⇒ 不重复加", () => {
    expect(补类型后缀("张三.hgraph", ".hgraph")).toBe("张三.hgraph")
    expect(补类型后缀("张三.HGRAPH", ".hgraph")).toBe("张三.HGRAPH")
  })

  test("名字带其它后缀 ⇒ 追加在后（张三.md + .hgraph ⇒ 张三.md.hgraph）", () => {
    expect(补类型后缀("张三.md", ".hgraph")).toBe("张三.md.hgraph")
  })

  test("名字以相似但不是同后缀的片段结尾 ⇒ 照常追加（张三graph + .hgraph）", () => {
    expect(补类型后缀("张三graph", ".hgraph")).toBe("张三graph.hgraph")
  })
})
