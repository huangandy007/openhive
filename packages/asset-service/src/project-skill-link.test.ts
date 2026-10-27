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

    const 结果 = await reconcileSkillLinks(项目, new Map([["asset_1", 已发布], ["asset_2", 已发布]]))
    expect(结果).toEqual({ created: 2, removed: 1, skipped: [] })
    expect(existsSync(skillLinkPath(项目, "asset_old"))).toBe(false)
    expect(existsSync(skillLinkPath(项目, "asset_1"))).toBe(true)
    expect(existsSync(skillLinkPath(项目, "asset_manual"))).toBe(true)
  })
})
