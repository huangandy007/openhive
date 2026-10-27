import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeAssetLinksAcrossWorkspaces } from "./asset-link-fanout"
import { linkSkill, SKILL_LINK_DIR } from "./project-skill-link"

/**
 * 下线撤回（需求 5a，2026-10-27）：资产不再是「已发布/迭代中」时，把它从**所有**沙箱里摘掉。
 *
 * 判据：① 我们建的链接被摘、② 返回的目录正是**真的摘过**的那些（调用方拿它丢实例缓存）、
 * ③ 不是我们建的东西一个字节都不动（手写真目录 / 指向别处的链接）。
 */

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-fanout-"))
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }))

const 根 = join(SANDBOX, "workspaces")
const 共享 = join(SANDBOX, "assets", "global", "skills", "asset_fanout")
const 资产 = "asset_fanout"

function 项目(userId: string, projectId: string): string {
  const directory = join(根, userId, projectId)
  mkdirSync(directory, { recursive: true })
  return directory
}

describe("下线撤回：从所有沙箱摘链接", () => {
  test("摘掉我们建的链接、返回摘过的目录；手写目录与别的资产不动", async () => {
    mkdirSync(共享, { recursive: true })
    writeFileSync(join(共享, "SKILL.md"), "---\nname: 下线演示\n---\n", "utf8")

    const 甲 = 项目("u1", "p1")
    const 乙 = 项目("u1", "p2")
    const 丙 = 项目("u2", "p3")
    await linkSkill(甲, 资产, 共享)
    await linkSkill(乙, 资产, 共享)
    await linkSkill(丙, 资产, 共享)

    // 对照组：别的资产（同目录）不该被带走。
    const 别的 = join(SANDBOX, "assets", "global", "skills", "asset_other")
    mkdirSync(别的, { recursive: true })
    writeFileSync(join(别的, "SKILL.md"), "---\nname: 别的\n---\n", "utf8")
    await linkSkill(甲, "asset_other", 别的)

    // 对照组：手写的真目录（内核也从这里加载，但不是我们的投影）。
    const 手写 = 项目("u3", "p4")
    mkdirSync(join(手写, SKILL_LINK_DIR, 资产), { recursive: true })

    const 结果 = await removeAssetLinksAcrossWorkspaces(根, 资产)

    expect([...结果.removed].sort()).toEqual([甲, 乙, 丙].sort())
    expect(结果.failed).toEqual([])
    expect(existsSync(join(甲, SKILL_LINK_DIR, 资产))).toBe(false)
    expect(existsSync(join(乙, SKILL_LINK_DIR, 资产))).toBe(false)
    expect(existsSync(join(丙, SKILL_LINK_DIR, 资产))).toBe(false)
    // 别的资产还在（只摘目标那一个 id）。
    expect(existsSync(join(甲, SKILL_LINK_DIR, "asset_other"))).toBe(true)
    // 手写真目录不许动。
    expect(existsSync(join(手写, SKILL_LINK_DIR, 资产))).toBe(true)
  })

  test("没有沙箱根 / 没有链接时是空操作（幂等）", async () => {
    expect(await removeAssetLinksAcrossWorkspaces(join(SANDBOX, "nope"), 资产)).toEqual({ removed: [], failed: [] })
    expect(await removeAssetLinksAcrossWorkspaces(根, 资产)).toEqual({ removed: [], failed: [] })
  })
})
