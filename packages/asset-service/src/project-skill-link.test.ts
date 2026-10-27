import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  linkSkill,
  NotALinkError,
  reconcileSkillLinks,
  SKILL_LINK_DIR,
  skillLinkPath,
  skillLinkTarget,
  unlinkSkill,
} from "./project-skill-link"

let 根: string
let 项目: string
let 已发布: string

beforeEach(() => {
  根 = mkdtempSync(join(tmpdir(), "openhive-link-"))
  项目 = join(根, "sandbox", "u1", "proj_1")
  已发布 = join(根, "assets", "global", "skills", "asset_1")
  mkdirSync(项目, { recursive: true })
  mkdirSync(已发布, { recursive: true })
  writeFileSync(join(已发布, "SKILL.md"), "---\nname: 资金分析\ndescription: 测试\n---\n")
})

afterEach(() => rmSync(根, { recursive: true, force: true }))

describe("project-skill-link", () => {
  test("链接目标按 published 目录算；全局与部门两档", () => {
    expect(skillLinkTarget("/assets", { id: "a1", visibility: "global", department: "" })).toBe(
      join("/assets", "global", "skills", "a1"),
    )
    expect(skillLinkTarget("/assets", { id: "a2", visibility: "department", department: "刑侦" })).toBe(
      join("/assets", "dept", "刑侦", "skills", "a2"),
    )
    // 需求 3b：第四档有自己的存放目录，不能落到部门目录下（那会让人误以为「同部门都能用」）。
    expect(skillLinkTarget("/assets", { id: "a3", visibility: "targeted", department: "刑侦" })).toBe(
      join("/assets", "targeted", "skills", "a3"),
    )
  })

  test("建、读、删：删完链接没了、目标还在", async () => {
    const link = skillLinkPath(项目, "asset_1")
    await linkSkill(项目, "asset_1", 已发布)
    expect(link).toBe(join(项目, SKILL_LINK_DIR, "asset_1"))
    expect(readlinkSync(link)).toBe(已发布)
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toContain("资金分析")
    await unlinkSkill(项目, "asset_1")
    expect(existsSync(link)).toBe(false)
    expect(existsSync(join(已发布, "SKILL.md"))).toBe(true)
  })

  test("重复建是空操作（幂等）", async () => {
    await linkSkill(项目, "asset_1", 已发布)
    await linkSkill(项目, "asset_1", 已发布)
    expect(readlinkSync(skillLinkPath(项目, "asset_1"))).toBe(已发布)
  })

  test("目标变了就换链接（重发布后指向新目录）", async () => {
    const 新的 = join(根, "assets", "dept", "刑侦", "skills", "asset_1")
    mkdirSync(新的, { recursive: true })
    await linkSkill(项目, "asset_1", 已发布)
    await linkSkill(项目, "asset_1", 新的)
    expect(readlinkSync(skillLinkPath(项目, "asset_1"))).toBe(新的)
  })

  test("删一个不是链接的真目录：抛 NotALinkError，目录原封不动", async () => {
    const 真目录 = skillLinkPath(项目, "asset_9")
    mkdirSync(真目录, { recursive: true })
    writeFileSync(join(真目录, "SKILL.md"), "手写的")
    // oxlint-disable-next-line await-thenable -- Bun 的 `.rejects` 是 thenable，但 @types/bun 未标注（实测 oxlint 1.60）。
    await expect(unlinkSkill(项目, "asset_9")).rejects.toBeInstanceOf(NotALinkError)
    expect(existsSync(join(真目录, "SKILL.md"))).toBe(true)
  })

  test("删不存在的链接是空操作", async () => {
    await unlinkSkill(项目, "asset_x")
  })

  test("对账：多出来的链接被摘、缺的补上、真目录被跳过", async () => {
    const 另一个 = join(根, "assets", "global", "skills", "asset_old")
    mkdirSync(另一个, { recursive: true })
    await linkSkill(项目, "asset_old", 另一个)
    mkdirSync(skillLinkPath(项目, "asset_manual"), { recursive: true })

    const 结果 = await reconcileSkillLinks(项目, new Map([["asset_1", 已发布], ["asset_2", 已发布]]), join(根, "assets"))
    expect(结果).toEqual({ created: 2, removed: 1, skipped: [] })
    expect(existsSync(skillLinkPath(项目, "asset_old"))).toBe(false)
    expect(existsSync(skillLinkPath(项目, "asset_1"))).toBe(true)
    expect(existsSync(skillLinkPath(项目, "asset_manual"))).toBe(true)
  })

  // R5（复审 Critical）：对账**只摘自己的投影**。
  // 同一个目录里还长着别人的链接：个人草稿（另一条 feature 指向 `<assets>/draft/`）与用户
  // 手工建的链接（可能指向任意位置）。它们不在 `desired` 里，但不是我们建的——摘掉就是静默
  // 删用户的文件。判据只能是「目标落在共享发布目录之下」。
  test("对账只摘指向共享发布目录的链接：草稿与外部目标留着", async () => {
    const 资产根 = join(根, "assets")

    // (a) 草稿送达：`<assets>/draft/<id>`，同一个项目的沙箱里。
    const 草稿目标 = join(资产根, "draft", "asset_draft")
    mkdirSync(草稿目标, { recursive: true })
    await linkSkill(项目, "asset_draft", 草稿目标)

    // (b) 仓库外 / 资产根外的手工链接。
    const 外部 = mkdtempSync(join(tmpdir(), "openhive-external-"))
    try {
      await linkSkill(项目, "asset_external", 外部)

      // (c) 共享发布目录（global）——这是我们的投影，`desired` 里没有就该摘。
      const 共享目标 = join(资产根, "global", "skill", "asset_shared")
      mkdirSync(共享目标, { recursive: true })
      await linkSkill(项目, "asset_shared", 共享目标)

      const 结果 = await reconcileSkillLinks(项目, new Map(), 资产根)

      expect(existsSync(skillLinkPath(项目, "asset_draft"))).toBe(true)
      expect(existsSync(skillLinkPath(项目, "asset_external"))).toBe(true)
      expect(existsSync(skillLinkPath(项目, "asset_shared"))).toBe(false)
      expect(结果).toEqual({ created: 0, removed: 1, skipped: [] })
    } finally {
      rmSync(外部, { recursive: true, force: true })
    }
  })

  // 判据是**严格之下**：只摘我们建得出来的投影，边界宁可偏保守。
  //
  // 兄弟前缀：`<root>/globalX` 与 `<root>/global` 只差一个字符。松成 `startsWith(根)`
  // 就会把前者当成自己的投影摘掉（复审判定的变异 A 实测），这条钉住「必须保留」。
  test("对账：兄弟前缀（<root>/globalX）不是共享发布目录，链接保留", async () => {
    const 资产根 = join(根, "assets")
    const 兄弟 = join(资产根, "globalX", "x")
    mkdirSync(兄弟, { recursive: true })
    await linkSkill(项目, "asset_sibling", 兄弟)

    const 结果 = await reconcileSkillLinks(项目, new Map(), 资产根)

    expect(existsSync(skillLinkPath(项目, "asset_sibling"))).toBe(true)
    expect(结果).toEqual({ created: 0, removed: 0, skipped: [] })
  })

  // 档根（`<root>/global`）本身我们从不建，也不该认作投影。旧判据把 `归一 === 根`
  // 也算在内，会把指向档根的链接摘掉。
  test("对账：档根（<root>/global）本身不是投影，链接保留", async () => {
    const 资产根 = join(根, "assets")
    const 档根 = join(资产根, "global")
    mkdirSync(档根, { recursive: true })
    await linkSkill(项目, "asset_root", 档根)

    const 结果 = await reconcileSkillLinks(项目, new Map(), 资产根)

    expect(existsSync(skillLinkPath(项目, "asset_root"))).toBe(true)
    expect(结果).toEqual({ created: 0, removed: 0, skipped: [] })
  })

  // 反方向的钉子：收紧不能收成「什么都不摘」，部门档下的真投影必须照摘。
  test("对账：共享发布目录之下的真投影仍被摘（防一刀切全不摘）", async () => {
    const 资产根 = join(根, "assets")
    const 部门目标 = join(资产根, "dept", "刑侦", "skill", "asset_dept")
    mkdirSync(部门目标, { recursive: true })
    await linkSkill(项目, "asset_dept", 部门目标)

    const 结果 = await reconcileSkillLinks(项目, new Map(), 资产根)

    expect(existsSync(skillLinkPath(项目, "asset_dept"))).toBe(false)
    expect(结果).toEqual({ created: 0, removed: 1, skipped: [] })
  })

  // 两种「真目录」要分开：`desired` 之外的（上一条用例）是用户自己的，静默不动；
  // `desired` 里的名字被真目录占住时，那一份 skill **送不到**，必须据实报给调用方去告警
  // ——而且不能因此中断整次对账（其余条目的链接照样要建）。
  test("对账：要建的名字被手写真目录占住 ⇒ 进 skipped、不中断、其余照建", async () => {
    const 占位 = skillLinkPath(项目, "asset_9")
    mkdirSync(占位, { recursive: true })
    writeFileSync(join(占位, "SKILL.md"), "手写的")

    const 结果 = await reconcileSkillLinks(
      项目,
      new Map([
        ["asset_9", 已发布],
        ["asset_1", 已发布],
      ]),
      join(根, "assets"),
    )

    expect(结果).toEqual({ created: 1, removed: 0, skipped: [占位] })
    expect(readFileSync(join(占位, "SKILL.md"), "utf8")).toBe("手写的")
    expect(existsSync(skillLinkPath(项目, "asset_1"))).toBe(true)
  })
})
