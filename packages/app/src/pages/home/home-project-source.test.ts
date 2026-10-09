import { describe, expect, test } from "bun:test"
import type { LocalProject } from "@/context/layout"
import type { ProjectEntry } from "@/project/project-panel"
import { 主页项目 } from "./home-project-source"

/**
 * 主页项目列的**取数判据**（2026-10-09 用户下达 #4：「目前系统已经有项目和会话的数据，但是没有
 * 展现到现有的主页中，请真正予以实现」）。
 *
 * ## 缺陷（真栈实测 ＋ 注入实验双证）
 *
 * 真后端 `GET /openhive/project` 有 **2** 个项目（`1009测试01` / `1009测试02`），而主页渲染出的
 * 项目行 **0** 条；`localStorage["opencode.global.dat:server"].projects["local"]` 实测是 `[]`。
 * ——主页唯一的取数口是后者（`context/server.tsx` 的 `createServerProjects`，**上游**文件），
 * 而它是「**我打开过的**项目」这份本地记录，**不是**服务端的真项目清单。新用户这份记录天然为空
 * ⇒ 项目列空 ⇒ 中栏 `projectDirectories` 跟着空 ⇒ 会话索引也空（**一个根因解释两处空**）。
 *
 * 第二个缺陷是同一根因的另一面：`StoredProject` 只有 `{ worktree, expanded }`、**没有 name**
 * ⇒ 主页只能拿目录末段当项目名 ⇒ 显示成 `9902aff9-41d8-404b-9e93-…`（UUID）。
 *
 * ## 本文件钉什么、不钉什么
 *
 * 钉的是**这一条纯计算**：给「真清单 ＋ 本地记录」，主页该列出哪些项目、每个项目叫什么、什么次序。
 * **不钉**的是「`home-controller.ts` 真的去读了 `projectList()` 这个信号」——那要 `useServerSync()`
 * 等一串 provider，`bun test` 里挂不起来（同 `sidebar-sessions.tsx` 文件头的口径）。
 * 那一半是**缺口**，靠真栈验收（`LEARNINGS #002-02`：测不了的写成缺口，别写成覆盖）。
 *
 * ## 为什么要「叠加」而不是「只读真清单」
 *
 * 本地记录不决定「**有哪些**项目」（那是真清单的活），但它仍管着两件**用户看得见**的事：
 * ① **次序**（拖拽排序 → `projects.move`）；② **收起**（右键「关闭」→ `projects.close` 会把它移进
 * `recentlyClosed`）。若主页只读真清单，这两个动作都会变成**静默空操作**——点了没反应、不报错、
 * 不变红（红线：不做表面修改）。所以两者的分工是：**真清单定集合，本地记录定次序与可见性**。
 *
 * ## 三态（`project-list.ts` 文件头）
 *
 * 真清单 `undefined` = **还没取到**，`[]` = **取到了、一个都没有**。这两件事在这一层**分得开**
 * （`undefined` 时仍然列本地记录里那些），但主页视图今天没有「加载中」那一态 ⇒ 接线处会把它压成
 * `[]`，那一处压平**记进缺口**，不在这里假装它不存在。
 */

/** 一行真项目。`directory` 是**服务端算出来的**，不是前端拼的（`sidebar-sessions.tsx` 文件头）。 */
const 真项目 = (over: { id: string; name: string; directory: string }): ProjectEntry => ({
  type: "private",
  lastAccessedAt: 0,
  ...over,
})

/** 本地记录里的一行「打开过的项目」——**没有 name**（这正是 UUID 那个缺陷的来源）。 */
const 打开过 = (worktree: string): LocalProject => ({ worktree, expanded: true })

describe("主页项目", () => {
  test("「打开过」记录是空的 ⇒ 仍然列出真清单里的项目（本次缺陷的正红点）", () => {
    const 得 = 主页项目(
      [真项目({ id: "p1", name: "1009测试01", directory: "C:\\ws\\1009-01" })],
      [],
      [],
    )

    expect(得.map((项目) => 项目.worktree)).toEqual(["C:\\ws\\1009-01"])
  })

  test("项目名取真清单的 name，不是目录末段（钉掉那个 UUID）", () => {
    const 得 = 主页项目(
      [真项目({ id: "p1", name: "1009测试01", directory: "C:\\ws\\9902aff9-41d8-404b-9e93-abcd" })],
      [],
      [],
    )

    expect(得[0]?.name).toBe("1009测试01")
  })

  test("真清单里的行一律 expanded（主页的项目都是展开的）", () => {
    const 得 = 主页项目([真项目({ id: "p1", name: "甲", directory: "C:\\ws\\甲" })], [], [])

    expect(得[0]?.expanded).toBe(true)
  })

  test("真清单的行带上 id（`projectByID` / `projectForSession` 正是按它认项目）", () => {
    const 得 = 主页项目([真项目({ id: "proj-1", name: "甲", directory: "C:\\ws\\甲" })], [], [])

    expect(得[0]?.id).toBe("proj-1")
  })

  test("真清单里没有 directory 的行被跳过（没有目录就取不到会话，列出来是空壳）", () => {
    const 无目录: ProjectEntry = { id: "p0", name: "孤儿", type: "private", lastAccessedAt: 0 }
    const 得 = 主页项目(
      [无目录, 真项目({ id: "p1", name: "甲", directory: "C:\\ws\\甲" })],
      [],
      [],
    )

    expect(得.map((项目) => 项目.worktree)).toEqual(["C:\\ws\\甲"])
  })

  test("本地记录里排过序的在前，(move 拖过的次序仍然算数)；真清单新增的追加在后", () => {
    const 得 = 主页项目(
      [
        真项目({ id: "p1", name: "甲", directory: "C:\\ws\\甲" }),
        真项目({ id: "p2", name: "乙", directory: "C:\\ws\\乙" }),
        真项目({ id: "p3", name: "丙", directory: "C:\\ws\\丙" }),
      ],
      [打开过("C:\\ws\\丙"), 打开过("C:\\ws\\甲")],
      [],
    )

    expect(得.map((项目) => 项目.worktree)).toEqual(["C:\\ws\\丙", "C:\\ws\\甲", "C:\\ws\\乙"])
  })

  test("本地记录里那些行的 name 用真清单的补上（同名目录只剩一份、且带名字）", () => {
    const 得 = 主页项目(
      [真项目({ id: "p1", name: "1009测试01", directory: "C:\\ws\\甲" })],
      [打开过("C:\\ws\\甲")],
      [],
    )

    expect(得).toHaveLength(1)
    expect(得[0]?.name).toBe("1009测试01")
  })

  test("收起的目录不出现在项目列里（右键「关闭」仍然算数）", () => {
    const 得 = 主页项目(
      [真项目({ id: "p1", name: "甲", directory: "C:\\ws\\甲" })],
      [打开过("C:\\ws\\乙")],
      ["C:\\ws\\甲", "C:\\ws\\乙"],
    )

    expect(得).toEqual([])
  })

  test("真清单还没取到（undefined）⇒ 仍列出本地记录里的项目，别把已经打开的清空", () => {
    const 得 = 主页项目(undefined, [打开过("C:\\ws\\乙")], [])

    expect(得.map((项目) => 项目.worktree)).toEqual(["C:\\ws\\乙"])
  })

  test("真清单说「一个都没有」且本地也没打开过 ⇒ 空（合法的空，不是「还没取到」）", () => {
    expect(主页项目([], [], [])).toEqual([])
  })
})
