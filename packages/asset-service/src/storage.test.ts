import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ASSETS_ROOT_ENV,
  archiveDirectory,
  assetDirectory,
  assetsRoot,
  ensureDir,
  pendingDirectory,
  publishDirectory,
} from "./storage"

const roots: string[] = []

function tempRoot(): string {
  const root = join(tmpdir(), `openhive-assets-${randomUUID()}`)
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("资产共享根（D0-2）", () => {
  test("环境变量优先，未配置落到 /assets", () => {
    expect(ASSETS_ROOT_ENV).toBe("OPENHIVE_ASSETS_ROOT")
    expect(assetsRoot({})).toBe("/assets")
    expect(assetsRoot({ [ASSETS_ROOT_ENV]: "" })).toBe("/assets")
    expect(assetsRoot({ [ASSETS_ROOT_ENV]: "D:\\openhive-stack-state\\assets" })).toBe(
      "D:\\openhive-stack-state\\assets",
    )
  })

  test("目录布局与 design §2.5 一致", () => {
    const root = tempRoot()

    expect(pendingDirectory(root, "asset_1")).toBe(join(root, "pending", "asset_1"))
    expect(archiveDirectory(root, "asset_1")).toBe(join(root, "archive", "asset_1"))

    expect(publishDirectory(root, "skill", { visibility: "global" }, "asset_1")).toBe(
      join(root, "global", "skills", "asset_1"),
    )
    expect(
      publishDirectory(
        root,
        "skill",
        { visibility: "department", department: "经侦支队" },
        "asset_1",
      ),
    ).toBe(join(root, "dept", "经侦支队", "skills", "asset_1"))

    expect(publishDirectory(root, "mcp", { visibility: "global" }, "asset_1")).toBe(
      join(root, "global", "mcp", "asset_1"),
    )
    expect(publishDirectory(root, "knowledge_base", { visibility: "global" }, "asset_1")).toBe(
      join(root, "global", "knowledge-base", "asset_1"),
    )
  })

  test("路径段不允许越界，错误里点名是哪个字段", () => {
    const root = tempRoot()

    for (const bad of ["", ".", "..", "../evil", "a/b", "a\\b", "C:"]) {
      expect(() => pendingDirectory(root, bad)).toThrow("非法资产 id")
    }

    expect(() =>
      publishDirectory(root, "skill", { visibility: "department", department: "../escape" }, "asset_1"),
    ).toThrow("非法部门 id")
    expect(() => assetDirectory(root, "global", "..", "skills")).toThrow("非法路径段")
  })

  test("个人可见范围没有发布目录（个人资产留在沙箱）", () => {
    const root = tempRoot()
    expect(() =>
      publishDirectory(root, "skill", { visibility: "personal" }, "asset_1"),
    ).toThrow("个人资产不发布")
  })

  test("ensureDir 幂等：重复调用不报错，目录真实存在", async () => {
    const dir = join(tempRoot(), "pending", "asset_1")

    await ensureDir(dir)
    await ensureDir(dir)

    expect((await stat(dir)).isDirectory()).toBe(true)
  })
})
