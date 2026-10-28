import { describe, expect, test } from "bun:test"
import { 扫树, type 条目, type 读目录 } from "@/server/openhive/project-tree-scan"

const 目录 = (path: string, ignored = false): 条目 => ({ path, type: "directory", ignored })
const 文件 = (path: string, ignored = false): 条目 => ({ path, type: "file", ignored })

function 替身(routes: Record<string, unknown>) {
  const 走过: string[] = []
  const 读: 读目录 = async (dir) => {
    走过.push(dir)
    const route = routes[dir]
    if (route === undefined) throw new Error(`替身没配这条路径：${JSON.stringify(dir)}`)
    if (route instanceof Error) return undefined
    return route as 条目[]
  }
  return { 读, 走过 }
}

describe("扫树：与前端 walk 逐字同序", () => {
  test("只回文件 ⇒ 原样给出", async () => {
    const { 读 } = 替身({ "": [文件("笔记.md")] })
    expect(await 扫树(读)).toEqual({ paths: ["笔记.md"], truncated: false })
  })

  test("目录往下走一层，结果里只有文件路径", async () => {
    const { 读 } = 替身({
      "": [目录("资料\\"), 文件("笔记.md")],
      "资料\\": [文件("资料\\8·17\\话单.csv")],
    })
    expect(await 扫树(读)).toEqual({ paths: ["资料\\8·17\\话单.csv", "笔记.md"], truncated: false })
  })

  test("空目录 ⇒ 清单里有它自己", async () => {
    const { 读 } = 替身({ "": [目录("资料\\"), 文件("笔记.md")], "资料\\": [] })
    expect(await 扫树(读)).toEqual({ paths: ["资料\\", "笔记.md"], truncated: false })
  })

  test("只有空子目录的目录 ⇒ 自己与那个空子目录都在", async () => {
    const { 读 } = 替身({
      "": [目录("资料\\")],
      "资料\\": [目录("资料\\8·17\\")],
      "资料\\8·17\\": [],
    })
    expect(await 扫树(读)).toEqual({ paths: ["资料\\8·17\\", "资料\\"], truncated: false })
  })

  test("全是空目录 ⇒ 那几条空目录，不是 undefined", async () => {
    const { 读 } = 替身({ "": [目录("资料\\"), 目录("归档\\")], "资料\\": [], "归档\\": [] })
    expect(await 扫树(读)).toEqual({ paths: ["资料\\", "归档\\"], truncated: false })
  })

  test("根目录就是空的 ⇒ paths 为 []", async () => {
    const { 读 } = 替身({ "": [] })
    expect(await 扫树(读)).toEqual({ paths: [], truncated: false })
  })

  test("ignored 的文件不进清单、ignored 的目录也不进去走", async () => {
    const { 读, 走过 } = 替身({ "": [目录(".git\\", true), 文件(".env", true), 文件("笔记.md")] })
    expect(await 扫树(读)).toEqual({ paths: ["笔记.md"], truncated: false })
    expect(走过).toEqual([""])
  })

  test("走到一半某层取不到 ⇒ undefined（不交半棵树）", async () => {
    const { 读 } = 替身({ "": [目录("资料\\"), 文件("笔记.md")], "资料\\": new Error("挂了") })
    expect(await 扫树(读)).toBeUndefined()
  })

  test(".git / .GIT / .opencode / .OPENCODE 既不进清单也不往下走", async () => {
    for (const 名 of [".git", ".GIT", ".opencode", ".OPENCODE"]) {
      const { 读, 走过 } = 替身({ "": [目录(`${名}\\`), 文件("笔记.md")] })
      expect(await 扫树(读)).toEqual({ paths: ["笔记.md"], truncated: false })
      expect(走过).toEqual([""])
    }
  })

  test(".gitignore / .gitx\\ / .opencode.json 照常（判据是「那一段等于」，不是开头）", async () => {
    const { 读 } = 替身({
      "": [文件(".gitignore"), 目录(".gitx\\"), 文件(".opencode.json")],
      ".gitx\\": [文件(".gitx\\config")],
    })
    expect(await 扫树(读)).toEqual({
      paths: [".gitignore", ".gitx\\config", ".opencode.json"],
      truncated: false,
    })
  })

  test("资料\\.git\\ 照常（边界：只看第一段）", async () => {
    const { 读, 走过 } = 替身({
      "": [目录("资料\\")],
      "资料\\": [目录("资料\\.git\\"), 文件("资料\\笔记.md")],
      "资料\\.git\\": [文件("资料\\.git\\config")],
    })
    expect(await 扫树(读)).toEqual({ paths: ["资料\\.git\\config", "资料\\笔记.md"], truncated: false })
    expect(走过).toEqual(["", "资料\\", "资料\\.git\\"])
  })

  test("顺序：文件就地、目录后序、空目录在自己那一支的末尾", async () => {
    const { 读 } = 替身({
      "": [文件("r.txt"), 目录("甲\\"), 文件("z.txt"), 目录("乙\\")],
      "甲\\": [文件("甲\\x.txt"), 目录("甲\\空\\")],
      "甲\\空\\": [],
      "乙\\": [],
    })
    expect(await 扫树(读)).toEqual({
      paths: ["r.txt", "甲\\x.txt", "甲\\空\\", "z.txt", "乙\\"],
      truncated: false,
    })
  })
})

describe("扫树：上限与截断", () => {
  test("恰好到上限 ⇒ 不截断", async () => {
    const { 读 } = 替身({ "": [文件("a"), 文件("b")] })
    expect(await 扫树(读, 2)).toEqual({ paths: ["a", "b"], truncated: false })
  })

  test("超过上限 ⇒ truncated 且交出前 N 条", async () => {
    const { 读 } = 替身({ "": [文件("a"), 文件("b"), 文件("c")] })
    expect(await 扫树(读, 2)).toEqual({ paths: ["a", "b"], truncated: true })
  })

  test("截断后不再继续走后面的目录", async () => {
    const { 读, 走过 } = 替身({
      "": [目录("一\\"), 目录("二\\")],
      "一\\": [文件("一\\a"), 文件("一\\b")],
      "二\\": [文件("二\\c")],
    })
    const 结果 = await 扫树(读, 1)
    expect(结果).toEqual({ paths: ["一\\a"], truncated: true })
    expect(走过).toEqual(["", "一\\"])
  })
})
