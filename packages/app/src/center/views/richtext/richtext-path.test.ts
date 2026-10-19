import { describe, expect, test } from "bun:test"
import { 引用路径, 相对引用 } from "./richtext-path"

describe("Markdown 引用路径", () => {
  test("相对当前文件所在目录", () => {
    expect(引用路径("卷宗/纪要.md", "附件/图.png")).toBe("卷宗/附件/图.png")
  })

  test("去掉开头的 ./", () => {
    expect(引用路径("卷宗/纪要.md", "./附件/图.png")).toBe("卷宗/附件/图.png")
  })

  test("../ 回上一层，仍在项目内", () => {
    expect(引用路径("卷宗/子目录/纪要.md", "../图.png")).toBe("卷宗/图.png")
  })

  test("相对路径越出项目根 ⇒ 不认", () => {
    expect(引用路径("纪要.md", "../图.png")).toBeUndefined()
  })

  test("以 / 开头 ⇒ 项目根写法，不是本机绝对路径", () => {
    expect(引用路径("卷宗/纪要.md", "/附件/图.png")).toBe("附件/图.png")
  })

  test("协议 / 锚点 ⇒ 不认", () => {
    expect(引用路径("卷宗/纪要.md", "https://example.com/图.png")).toBeUndefined()
    expect(引用路径("卷宗/纪要.md", "data:image/png;base64,AAAA")).toBeUndefined()
    expect(引用路径("卷宗/纪要.md", "#小节")).toBeUndefined()
  })

  test("百分号编码先解码再对盘上的名字", () => {
    expect(引用路径("卷宗/纪要.md", "%E9%99%84%E4%BB%B6/%E5%9B%BE.png")).toBe("卷宗/附件/图.png")
  })

  test("尖括号包住的路径（有空格时的写法）", () => {
    expect(引用路径("卷宗/纪要.md", "<附件/图 1.png>")).toBe("卷宗/附件/图 1.png")
  })

  test("反斜杠按 Windows 习惯也认", () => {
    expect(引用路径("卷宗/纪要.md", "附件\\图.png")).toBe("卷宗/附件/图.png")
  })

  test("去掉 URL 的 #片段 与 ?查询", () => {
    expect(引用路径("卷宗/纪要.md", "附件/图.png#x")).toBe("卷宗/附件/图.png")
    expect(引用路径("卷宗/纪要.md", "附件/图.png?v=1")).toBe("卷宗/附件/图.png")
  })
})

describe("插入引用时的反向写法", () => {
  test("同目录 ⇒ 只剩文件名", () => {
    expect(相对引用("卷宗/纪要.md", "卷宗/附件/图.png")).toBe("附件/图.png")
  })

  test("目标在上层目录 ⇒ 先 ../ 再往下", () => {
    expect(相对引用("卷宗/子目录/纪要.md", "卷宗/附件/图.png")).toBe("../附件/图.png")
  })

  test("当前文件在项目根 ⇒ 原样是项目根相对路径", () => {
    expect(相对引用("纪要.md", "卷宗/名单.pdf")).toBe("卷宗/名单.pdf")
  })

  test("与 引用路径 互为逆运算（四种深度各验一遍）", () => {
    const 对: Array<[string, string]> = [
      ["纪要.md", "卷宗/附件/图.png"],
      ["卷宗/纪要.md", "卷宗/附件/图.png"],
      ["卷宗/子目录/纪要.md", "卷宗/附件/图.png"],
      ["卷宗/子目录/纪要.md", "名单.pdf"],
    ]
    for (const [当前, 目标] of 对) {
      expect(引用路径(当前, 相对引用(当前, 目标))).toBe(目标)
    }
  })

  test("路径里有空格时原样留着（尖括号由 插入引用 加）", () => {
    expect(相对引用("卷宗/纪要.md", "卷宗/附件/图 1.png")).toBe("附件/图 1.png")
  })
})
