import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"
import {
  ASSETS_ROOT_ENV,
  archiveDirectory,
  assetDirectory,
  assetsRoot,
  assertWithinRoot,
  commitStagedDirectory,
  copyDirectory,
  ensureDir,
  moveDirectory,
  pendingDirectory,
  publishDirectory,
  removeDirectory,
  replaceDirectory,
} from "./storage"

const roots: string[] = []

function tempRoot(): string {
  const root = join(tmpdir(), `openhive-assets-${randomUUID()}`)
  roots.push(root)
  return root
}

/**
 * 本机跨卷用例的第二个根：只有 Windows 且 `D:` 存在、而 `tmpdir()` 不在 D: 时才跑。
 * 跨卷 `EXDEV` 是存储设计里明确要求覆盖的一条；在只有单卷的 CI 上无法伪造，
 * 跳过是如实记录，不是把它标成已覆盖。
 */
const CROSS_VOLUME_ROOT =
  process.platform === "win32" && existsSync("D:/") && parse(tmpdir()).root.toLowerCase() !== "d:\\"
    ? "D:/"
    : undefined

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

async function readTree(root: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) Object.assign(result, await readTree(root, relative))
    else result[relative] = await readFile(join(root, relative), "utf8")
  }
  return result
}

async function leftovers(parent: string): Promise<string[]> {
  return (await readdir(parent)).filter((name) => name.includes(".tmp-") || name.includes(".bak-"))
}

async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught.cause instanceof Error ? caught.cause : caught
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

describe("目录复制（T003）", () => {
  test("复制源目录到目标：嵌套目录与隐藏文件都在", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    const files = {
      "SKILL.md": "skill",
      ".hidden": "dot-file",
      "references/a.txt": "a",
      "references/deep/b.txt": "b",
    }
    await writeTree(source, files)

    await copyDirectory(source, target)

    expect(await readTree(target)).toEqual(files)
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("目标已存在且未允许替换：报错、旧目标不动、暂存不残留", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "new" })
    await writeTree(target, { "SKILL.md": "old" })

    const error = await failure(() => copyDirectory(source, target))

    expect(error.message).toContain("目标目录已存在")
    expect(await readTree(target)).toEqual({ "SKILL.md": "old" })
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("允许替换：旧文件被清掉，新内容完整", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "new", "references/a.txt": "a" })
    await writeTree(target, { "SKILL.md": "old", "stale.txt": "stale" })

    await copyDirectory(source, target, { replace: true })

    expect(await readTree(target)).toEqual({ "SKILL.md": "new", "references/a.txt": "a" })
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("重复替换幂等：连跑两次结果一致，且不留暂存 / 备份", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "same" })
    await writeTree(target, { "SKILL.md": "old" })

    await copyDirectory(source, target, { replace: true })
    await copyDirectory(source, target, { replace: true })

    expect(await readTree(target)).toEqual({ "SKILL.md": "same" })
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("源不存在：报错且不建目标", async () => {
    const source = join(tempRoot(), "missing")
    const target = join(tempRoot(), "target")

    const error = await failure(() => copyDirectory(source, target))

    expect(error.message).toContain("ENOENT")
    expect(await stat(target).then(() => true, () => false)).toBe(false)
  })

  test("目标不能位于源目录内（否则复制会把自己递归进去）", async () => {
    const source = join(tempRoot(), "source")
    const target = join(source, "nested")
    await writeTree(source, { "SKILL.md": "skill" })

    const error = await failure(() => copyDirectory(source, target))

    expect(error.message).toContain("目标目录不能位于源目录内")
    expect(await readTree(source)).toEqual({ "SKILL.md": "skill" })
  })
})

describe("暂存提交的回滚（T003）", () => {
  test("提交失败时把旧版恢复回目标，且不留下备份目录", async () => {
    const parent = tempRoot()
    const target = join(parent, "target")
    await writeTree(target, { "SKILL.md": "old" })

    const staging = join(parent, "missing-staging")
    const error = await failure(() => commitStagedDirectory(staging, target, { replace: true }))

    expect(error.message).toContain("ENOENT")
    expect(await readTree(target)).toEqual({ "SKILL.md": "old" })
    expect(await leftovers(parent)).toEqual([])
  })
})

describe("目录移动（T003）", () => {
  test("同卷 rename：源消失、目标出现", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "move" })

    await moveDirectory(source, target)

    expect(await readTree(target)).toEqual({ "SKILL.md": "move" })
    expect(await stat(source).then(() => true, () => false)).toBe(false)
  })

  test("目标已存在且未允许替换：报错且源不动", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "source" })
    await writeTree(target, { "SKILL.md": "target" })

    const error = await failure(() => moveDirectory(source, target))

    expect(error.message).toContain("目标目录已存在")
    expect(await readTree(source)).toEqual({ "SKILL.md": "source" })
    expect(await readTree(target)).toEqual({ "SKILL.md": "target" })
  })

  test("目标已存在且允许替换：目标换成源内容、源消失", async () => {
    const source = join(tempRoot(), "source")
    const target = join(tempRoot(), "target")
    await writeTree(source, { "SKILL.md": "source" })
    await writeTree(target, { "SKILL.md": "target", "stale.txt": "stale" })

    await moveDirectory(source, target, { replace: true })

    expect(await readTree(target)).toEqual({ "SKILL.md": "source" })
    expect(await stat(source).then(() => true, () => false)).toBe(false)
  })

  test.skipIf(CROSS_VOLUME_ROOT === undefined)("跨卷 EXDEV：退化为复制到目标卷后再删源", async () => {
    const source = join(tempRoot(), "source")
    const targetRoot = await mkdtemp(join(CROSS_VOLUME_ROOT!, "openhive-exdev-"))
    roots.push(targetRoot)
    const target = join(targetRoot, "target")
    await writeTree(source, { "SKILL.md": "cross-volume", "references/a.txt": "a" })

    await moveDirectory(source, target)

    expect(await readTree(target)).toEqual({ "SKILL.md": "cross-volume", "references/a.txt": "a" })
    expect(await stat(source).then(() => true, () => false)).toBe(false)
  })
})

describe("目录替换（T008：先留备份，确认后再删）", () => {
  test("替换后目标是新内容；备份保留到 commit 才删", async () => {
    const root = tempRoot()
    const source = join(root, "pending", "asset_1")
    const target = join(root, "global", "skills", "asset_1")
    await writeTree(source, { "SKILL.md": "新版" })
    await writeTree(target, { "SKILL.md": "旧版" })

    const replacement = await replaceDirectory(source, target)

    expect(await readTree(target)).toEqual({ "SKILL.md": "新版" })
    expect(await stat(source).then(() => true, () => false)).toBe(false)
    expect(replacement.backup).toBeDefined()
    expect(await readTree(replacement.backup!)).toEqual({ "SKILL.md": "旧版" })

    await replacement.commit()

    expect(await stat(replacement.backup!).then(() => true, () => false)).toBe(false)
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("回滚：新版退回源，旧版回到目标", async () => {
    const root = tempRoot()
    const source = join(root, "pending", "asset_1")
    const target = join(root, "global", "skills", "asset_1")
    await writeTree(source, { "SKILL.md": "新版" })
    await writeTree(target, { "SKILL.md": "旧版" })

    const replacement = await replaceDirectory(source, target)
    await replacement.rollback()

    expect(await readTree(target)).toEqual({ "SKILL.md": "旧版" })
    expect(await readTree(source)).toEqual({ "SKILL.md": "新版" })
    expect(await leftovers(dirname(target))).toEqual([])
  })

  test("目标原本不存在时没有备份；源不存在先抛错、不动目标", async () => {
    const root = tempRoot()
    const source = join(root, "pending", "asset_1")
    const target = join(root, "archive", "asset_1")
    await writeTree(source, { "SKILL.md": "内容" })

    const replacement = await replaceDirectory(source, target)
    expect(replacement.backup).toBeUndefined()
    await replacement.commit()
    expect(await readTree(target)).toEqual({ "SKILL.md": "内容" })

    const missing = join(root, "pending", "missing")
    const missingError = await failure(() => replaceDirectory(missing, join(root, "archive", "missing")))
    expect(missingError.message).toContain("源目录不存在")
    expect(await stat(join(root, "archive", "missing")).then(() => true, () => false)).toBe(false)
  })
})

describe("目录删除与根路径校验（T003）", () => {
  test("删除幂等：第一次删掉，第二次不报错", async () => {
    const root = tempRoot()
    const target = join(root, "pending", "asset_1")
    await writeTree(target, { "SKILL.md": "bye" })

    await removeDirectory(root, target)
    await removeDirectory(root, target)

    expect(await stat(target).then(() => true, () => false)).toBe(false)
  })

  test("根目录外的路径拒绝删除，且外部目录原样保留", async () => {
    const root = tempRoot()
    const outside = tempRoot()
    await writeTree(outside, { "keep.txt": "keep" })

    const error = await failure(() => removeDirectory(root, outside))

    expect(error.message).toContain("不在资产根")
    expect(await readTree(outside)).toEqual({ "keep.txt": "keep" })
  })

  test("资产根本身不能被当作可删目标", async () => {
    const root = tempRoot()
    await ensureDir(root)

    const error = await failure(() => removeDirectory(root, root))

    expect(error.message).toContain("不在资产根")
  })

  test("根路径校验：内部放行，同前缀兄弟目录与 .. 越界都拒绝", () => {
    const root = tempRoot()

    expect(() => assertWithinRoot(root, join(root, "pending", "asset_1"))).not.toThrow()
    expect(() => assertWithinRoot(root, `${root}-evil`)).toThrow("不在资产根")
    expect(() => assertWithinRoot(root, join(root, "pending", "..", "..", "escape"))).toThrow("不在资产根")
  })
})
