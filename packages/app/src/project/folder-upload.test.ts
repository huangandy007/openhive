import { describe, expect, test } from "bun:test"
import { folderUploadPlan, 拆目录 } from "./folder-upload"

/**
 * 「上传文件夹」的计划器（2026-10-24 用户下达：右键上传只能选文件，不能选文件夹）。
 *
 * 这一份只测**纯计算**：浏览器给的 `webkitRelativePath` 怎么折成「要建哪些目录、每个文件落哪」。
 * 发请求、开传输弹窗、报错那一侧的判据在 `workspace-entry.test.tsx`。
 *
 * 口径（2026-10-24 用户裁定）：**保留所选文件夹本身**——在「资料」下上传文件夹「卷宗」，
 * 得到「资料/卷宗/…」，与资源管理器里把文件夹拖进另一个文件夹同义。
 */

/** 浏览器 `<input webkitdirectory>` 交出来的文件：`webkitRelativePath` 是「顶层/子目录/文件名」。 */
function 文件(name: string, 相对?: string): File {
  const file = new File(["甲"], name)
  if (相对 !== undefined) Object.defineProperty(file, "webkitRelativePath", { value: 相对 })
  return file
}

describe("文件夹上传计划器", () => {
  test("保留所选文件夹本身：落点「资料」＋ 选中「卷宗」⇒ 落在「资料/卷宗」", () => {
    const 计划 = folderUploadPlan("资料", [文件("账单.xlsx", "卷宗/账单.xlsx")], ["资料/话单.csv"])

    expect(计划.要建的目录).toEqual(["资料/卷宗"])
    expect(计划.任务.map((项) => [项.dir, 项.显示名])).toEqual([["资料/卷宗", "卷宗/账单.xlsx"]])
  })

  test("多层子目录 ⇒ 浅的在前（父目录必须先存在，服务端 create 不递归）", () => {
    const 计划 = folderUploadPlan("资料", [文件("说明.docx", "卷宗/附件/说明.docx")], [])

    expect(计划.要建的目录).toEqual(["资料/卷宗", "资料/卷宗/附件"])
    expect(计划.任务.map((项) => 项.dir)).toEqual(["资料/卷宗/附件"])
  })

  test("清单里已有的目录不再建（含由子路径带出的目录、带尾分隔符的空目录）", () => {
    const 计划 = folderUploadPlan(
      "资料",
      [文件("账单.xlsx", "卷宗/账单.xlsx"), 文件("挂账.csv", "卷宗/回款/挂账.csv")],
      ["资料/话单.csv", "资料/卷宗/旧件.pdf", "资料/卷宗/空子目录\\"],
    )

    // 「资料」「资料/卷宗」都已存在；只剩「资料/卷宗/回款」
    expect(计划.要建的目录).toEqual(["资料/卷宗/回款"])
  })

  test("落点是项目根 ⇒ 目录不带前导分隔符", () => {
    const 计划 = folderUploadPlan("", [文件("账单.xlsx", "卷宗/账单.xlsx")], [])

    expect(计划.要建的目录).toEqual(["卷宗"])
    expect(计划.任务.map((项) => 项.dir)).toEqual(["卷宗"])
  })

  test("同一目录的多个文件 ⇒ 目录只列一次，任务按浏览器给的顺序保留", () => {
    const 计划 = folderUploadPlan(
      "资料",
      [文件("甲.csv", "卷宗/甲.csv"), 文件("乙.csv", "卷宗/乙.csv")],
      [],
    )

    expect(计划.要建的目录).toEqual(["资料/卷宗"])
    expect(计划.任务.map((项) => 项.file.name)).toEqual(["甲.csv", "乙.csv"])
  })

  test("没有 webkitRelativePath（不是目录选择器给的）⇒ 落到落点本身，不凭空造目录", () => {
    const 计划 = folderUploadPlan("资料", [文件("孤儿.csv")], [])

    expect(计划.要建的目录).toEqual([])
    expect(计划.任务).toHaveLength(1)
    expect(计划.任务[0]?.dir).toBe("资料")
    expect(计划.任务[0]?.显示名).toBe("孤儿.csv")
  })

  test("空文件夹（浏览器一个文件都交不出来）⇒ 没有任务、没有目录", () => {
    expect(folderUploadPlan("资料", [], [])).toEqual({ 要建的目录: [], 任务: [] })
  })

  test("win32 的清单路径用反斜杠 ⇒ 归一后仍认得出已存在的目录", () => {
    const 计划 = folderUploadPlan("资料", [文件("账单.xlsx", "卷宗/账单.xlsx")], ["资料\\卷宗\\旧件.pdf"])

    expect(计划.要建的目录).toEqual([])
  })
})

describe("拆目录（createEntry 要的 parent / name）", () => {
  test("一层目录 ⇒ 父是根", () => {
    expect(拆目录("资料")).toEqual({ parent: "", name: "资料" })
  })

  test("多层 ⇒ 父是前几段", () => {
    expect(拆目录("资料/卷宗/附件")).toEqual({ parent: "资料/卷宗", name: "附件" })
  })
})
