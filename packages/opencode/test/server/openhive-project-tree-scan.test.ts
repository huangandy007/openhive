import { describe, expect, test } from "bun:test"
import { 扫树, type 条目, type 读目录 } from "@/server/openhive/project-tree-scan"

const 目录 = (path: string, ignored = false): 条目 => ({ path, type: "directory", ignored })
const 文件 = (path: string, ignored = false): 条目 => ({ path, type: "file", ignored })

function 替身(routes: Record<string, 条目[] | Error | undefined>) {
  const 走过: string[] = []
  const 读: 读目录 = async (dir) => {
    走过.push(dir)
    if (!(dir in routes)) throw new Error(`替身没配这条路径：${JSON.stringify(dir)}`)
    const route = routes[dir]
    if (route === undefined) return undefined
    if (route instanceof Error) return undefined
    return route
  }
  return { 读, 走过 }
}

describe("扫树：顺序规则（文件就地、目录后序、空目录补自己）", () => {
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

  /**
   * 与上一条**同一条判据的另一半**（2026-10-28 迁移补齐）。两个隐藏根共用 `隐藏根()` 同一个
   * 谓词，但只钉 `.git` 的话，谓词被改成「任何一段是隐藏根」时 `.opencode` 半边没人守：
   * 用户解压进来的 `资料\.opencode\` 是项目**内容**，会静默消失。
   */
  test("资料\\.opencode\\ 照常（边界：只看第一段）", async () => {
    const { 读, 走过 } = 替身({
      "": [目录("资料\\")],
      "资料\\": [目录("资料\\.opencode\\"), 文件("资料\\笔记.md")],
      "资料\\.opencode\\": [文件("资料\\.opencode\\config")],
    })
    expect(await 扫树(读)).toEqual({
      paths: ["资料\\.opencode\\config", "资料\\笔记.md"],
      truncated: false,
    })
    expect(走过).toEqual(["", "资料\\", "资料\\.opencode\\"])
  })

  test("顺序：文件就地、目录后序、空目录在自己那一支的末尾", async () => {
    const { 读 } = 替身({
      "": [文件("r.txt"), 目录("dirA\\"), 文件("z.txt"), 目录("dirB\\")],
      "dirA\\": [文件("dirA\\x.txt"), 目录("dirA\\empty\\")],
      "dirA\\empty\\": [],
      "dirB\\": [],
    })
    expect(await 扫树(读)).toEqual({
      paths: ["r.txt", "dirA\\x.txt", "dirA\\empty\\", "z.txt", "dirB\\"],
      truncated: false,
    })
  })
})

describe("扫树：并发（2026-10-29）", () => {
  /** 每读一层都「等一会儿」的替身：串行时峰值恒为 1，并发时才看得出重叠。 */
  function 慢替身(routes: Record<string, 条目[]>) {
    let 在飞 = 0
    let 峰值 = 0
    const 读: 读目录 = async (dir) => {
      在飞 += 1
      峰值 = Math.max(峰值, 在飞)
      await new Promise((resolve) => setTimeout(resolve, 5))
      在飞 -= 1
      return routes[dir] ?? []
    }
    return { 读, 峰值: () => 峰值 }
  }

  test("同一层的多个目录**同时在读**，且不超过并发度", async () => {
    const 根: 条目[] = []
    const routes: Record<string, 条目[]> = { "": 根 }
    for (let i = 0; i < 8; i++) {
      根.push(目录(`d${i}\\`))
      routes[`d${i}\\`] = [文件(`d${i}\\f.txt`)]
    }
    const { 读, 峰值 } = 慢替身(routes)
    const 结果 = await 扫树(读)
    // 串行时这里是 1；并行必须真的重叠，且不把盘打满（默认并发度 4）。
    expect(峰值()).toBeGreaterThan(1)
    expect(峰值()).toBeLessThanOrEqual(4)
    // 并行只改「什么时候读」，不改「交出来什么」：顺序仍是条目顺序。
    expect(结果).toEqual({
      paths: Array.from({ length: 8 }, (_, i) => `d${i}\\f.txt`),
      truncated: false,
    })
  })

  test("并发与串行的成品**逐字相同**（含空目录补自己）", async () => {
    const 配 = () => ({
      "": [文件("r.txt"), 目录("a\\"), 文件("z.txt"), 目录("b\\"), 目录("e\\")],
      "a\\": [文件("a\\x.txt"), 目录("a\\empty\\")],
      "a\\empty\\": [],
      "b\\": [目录("b\\c\\")],
      "b\\c\\": [文件("b\\c\\y.txt")],
      "e\\": [],
    })
    const 串行 = await 扫树(替身(配()).读, 50000, 1)
    const 并发 = await 扫树(替身(配()).读, 50000, 8)
    expect(并发).toEqual(串行)
    expect(并发).toEqual({
      paths: ["r.txt", "a\\x.txt", "a\\empty\\", "z.txt", "b\\c\\y.txt", "e\\"],
      truncated: false,
    })
  })

  test("截断时并发交出的仍是**顺序前缀**", async () => {
    const 配 = () => ({
      "": [目录("一\\"), 文件("m.txt"), 目录("二\\")],
      "一\\": [文件("一\\a"), 文件("一\\b")],
      "二\\": [文件("二\\c")],
    })
    const 串行 = await 扫树(替身(配()).读, 2, 1)
    const 并发 = await 扫树(替身(配()).读, 2, 8)
    expect(并发).toEqual(串行)
    expect(并发).toEqual({ paths: ["一\\a", "一\\b"], truncated: true })
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

  /**
   * 口径变更（2026-10-29 并行化）：改前「截断点一到就不再发下一个目录的读」，并行之后同层的
   * 兄弟目录在收第一个结果之前**已经一起发出去了**，收不回来——这是并行换速度的代价：
   * 成品不变，多读的只是**同层已列出**的目录。所以这里改钉成品与「多读了哪些」，不再钉「一个不多读」。
   */
  test("截断时成品仍是顺序前缀（同层兄弟可能已被一并读过）", async () => {
    const { 读, 走过 } = 替身({
      "": [目录("一\\"), 目录("二\\")],
      "一\\": [文件("一\\a"), 文件("一\\b")],
      "二\\": [文件("二\\c")],
    })
    const 结果 = await 扫树(读, 1)
    expect(结果).toEqual({ paths: ["一\\a"], truncated: true })
    // 并发下谁先读完不定，比集合不比顺序。
    expect([...走过].sort()).toEqual(["", "一\\", "二\\"])
  })

  /**
   * 这条钉的是**失败的位置**：截断点之内的读失败 ⇒ 整份 undefined；截断点之外的 ⇒ 不算数
   * （改前它根本不会被读到，`#004-09`「门在副作用之前」）。并行之后两者在同一层里同时发生，
   * 所以失败必须带成数据、到最后按位置裁——不能一失败就返回 undefined。
   */
  test("截断点**之外**的目录读失败，不该把整份变成 undefined", async () => {
    const { 读, 走过 } = 替身({
      "": [目录("一\\"), 目录("二\\")],
      "一\\": [文件("一\\a")],
      "二\\": undefined, // 这一层取不到，但它在上限（1 条）之外
    })
    expect(await 扫树(读, 1)).toEqual({ paths: ["一\\a"], truncated: true })
    expect([...走过].sort()).toEqual(["", "一\\", "二\\"])
  })
})
