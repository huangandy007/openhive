import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readlink, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeAssetLinksAcrossWorkspaces, retargetAssetLinksAcrossWorkspaces } from "./asset-link-fanout"
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

/**
 * 发布后把「指着草稿副本」的链接改指发布目录（2026-11-01，设计 §4.6）。
 *
 * 判据只有一条：**当前确实指向旧目标**才动。指向别处的链接、手写的真目录一个字节都不许碰——
 * 拿它去「顺手统一」别处就是事故。
 */
describe("发布后重指：retargetAssetLinksAcrossWorkspaces", () => {
  test("只改指向旧目标的链接；指向别处的、手写的真目录都不动", async () => {
    const 路径根 = join(SANDBOX, "retarget")
    const 旧 = join(路径根, "assets", "draft", "a1")
    const 新 = join(路径根, "assets", "global", "skills", "a1")
    const 别处 = join(路径根, "别处")
    mkdirSync(旧, { recursive: true })
    mkdirSync(新, { recursive: true })
    // junction 的硬要求：目标必须存在，所以「指向别处」的对照组也得先造出来。
    mkdirSync(别处, { recursive: true })

    const 甲 = join(路径根, "ws", "u1", "p1") // 指向旧目标 → 应改
    const 乙 = join(路径根, "ws", "u2", "p2") // 指向别处 → 不动
    const 丙 = join(路径根, "ws", "u3", "p3") // 手写真目录 → 不动
    for (const d of [甲, 乙, 丙]) mkdirSync(join(d, SKILL_LINK_DIR), { recursive: true })
    await symlink(旧, join(甲, SKILL_LINK_DIR, "a1"), "junction")
    await symlink(别处, join(乙, SKILL_LINK_DIR, "a1"), "junction")
    mkdirSync(join(丙, SKILL_LINK_DIR, "a1"), { recursive: true })
    // 手写真目录里放个文件：「一个字节不动」要能验到内容仍在，不能只验「不是链接」——
    // 删掉再原地建个同名空目录也满足那个断言。
    writeFileSync(join(丙, SKILL_LINK_DIR, "a1", "SKILL.md"), "人手写的", "utf8")

    const 结果 = await retargetAssetLinksAcrossWorkspaces(join(路径根, "ws"), "a1", 旧, 新)

    expect(结果.removed).toEqual([甲])
    expect(结果.failed).toEqual([])
    expect(await readlink(join(甲, SKILL_LINK_DIR, "a1"))).toBe(新)
    expect(await readlink(join(乙, SKILL_LINK_DIR, "a1"))).toBe(别处)
    expect(lstatSync(join(丙, SKILL_LINK_DIR, "a1")).isSymbolicLink()).toBe(false)
    expect(existsSync(join(丙, SKILL_LINK_DIR, "a1", "SKILL.md"))).toBe(true)
  })

  test("工作区根读不了（是个文件）：记入 failed、不抛，removed 为空", async () => {
    const 路径根 = join(SANDBOX, "retarget-unreadable")
    const 坏根 = join(路径根, "根是文件")
    mkdirSync(路径根, { recursive: true })
    writeFileSync(坏根, "不是目录", "utf8")

    const 结果 = await retargetAssetLinksAcrossWorkspaces(
      坏根,
      "a2",
      join(路径根, "旧"),
      join(路径根, "新"),
    )

    // 失败如实回给调用方（不静默、不抛出），调用方据此告警。
    expect(结果.removed).toEqual([])
    expect(结果.failed.map((失败) => 失败.directory)).toEqual([坏根])
  })
})
