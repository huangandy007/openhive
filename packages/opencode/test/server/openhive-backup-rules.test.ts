import { describe, expect, test } from "bun:test"
import { MANIFEST_VERSION } from "../../src/server/openhive/backup-model"
import {
  estimateManifestBytes,
  isExcluded,
  isPathInScope,
  isSafeRelativePath,
  keepBothName,
  snapshotIdOf,
  validateManifest,
} from "../../src/server/openhive/backup-rules"

describe("isSafeRelativePath", () => {
  test("放行正常相对路径与空串", () => {
    for (const path of ["", "a.txt", "资料/话单.csv", ".git/HEAD"]) expect(isSafeRelativePath(path)).toBe(true)
  })
  test("拒绝穿越、绝对路径、盘符、反斜杠、NUL、空段与 '.' 段", () => {
    for (const path of ["../x", "a/../b", "/etc/passwd", "C:/x", "a\\b", "a\u0000b", "a//b", "./a", "a/"]) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })
})

describe("isExcluded", () => {
  test("排除临时文件与 git 锁", () => {
    for (const path of [
      ".git/index.lock",
      ".git/refs/heads/x.lock",
      ".git/objects/pack/tmp_pack_123",
      "资料/a.tmp",
      "资料/b.swp",
      "资料/c.swo",
      "资料/d~",
      ".DS_Store",
      "资料/Thumbs.db",
      "资料/desktop.ini",
      "资料/.DS_Store",
      "desktop.ini",
      "~$报告.docx",
      ".openhive-restore-abc.tmp",
      ".openhive-old-abc",
    ]) {
      expect(isExcluded(path), path).toBe(true)
    }
  })
  test("不排除 .git 本身与普通文件", () => {
    // `资料/x.lock`：`.lock` 只在 `.git/` 下才是锁；根外的同名后缀是用户自己的文件，不能误伤。
    for (const path of [".git", ".git/HEAD", ".git/objects/ab/cdef", "资料/报告.docx", "资料/x.lock"]) {
      expect(isExcluded(path), path).toBe(false)
    }
  })
})

describe("isPathInScope", () => {
  test("根范围覆盖一切", () => expect(isPathInScope("", "a/b.txt")).toBe(true))
  test("文件范围只覆盖它自己", () => {
    expect(isPathInScope("a.txt", "a.txt")).toBe(true)
    expect(isPathInScope("a.txt", "a.txt.bak")).toBe(false)
    expect(isPathInScope("a.txt", "a/b.txt")).toBe(false)
  })
  test("目录范围覆盖整棵子树，且不误伤同前缀兄弟", () => {
    expect(isPathInScope("资料", "资料/甲.txt")).toBe(true)
    expect(isPathInScope("资料", "资料")).toBe(true)
    expect(isPathInScope("资料", "资料2/甲.txt")).toBe(false)
  })
})

describe("snapshotIdOf", () => {
  test("形如 YYYYMMDDTHHMMSSmmmZ-6位十六进制", () => {
    expect(snapshotIdOf(Date.parse("2026-10-18T14:03:05.123Z"), "a1b2c3d4")).toBe("20261018T140305123Z-a1b2c3")
  })
})

describe("keepBothName", () => {
  const at = new Date(2026, 9, 18, 14, 3, 5).getTime()
  test("带目录、带扩展名", () => {
    expect(keepBothName("资料/报告.docx", at, () => false)).toBe("资料/报告 (MinIO 2026-10-18 14-03-05).docx")
  })
  test("重名追加 (2)", () => {
    const 已有 = new Set(["资料/报告 (MinIO 2026-10-18 14-03-05).docx"])
    expect(keepBothName("资料/报告.docx", at, (candidate) => 已有.has(candidate))).toBe(
      "资料/报告 (MinIO 2026-10-18 14-03-05) (2).docx",
    )
  })
  test("无扩展名与根目录", () => {
    expect(keepBothName("README", at, () => false)).toBe("README (MinIO 2026-10-18 14-03-05)")
  })
})

describe("validateManifest", () => {
  /**
   * 合法基线。三条拒绝用例都只改它的一处，**先有一条基线通过**才能说明另外三条的
   * `undefined` 是守卫生效，而不是夹具自己就过不了校验（否则三条全是空转）。
   */
  const 合法 = () => ({
    version: MANIFEST_VERSION,
    id: "20261018T140305123Z-a1b2c3",
    projectId: "p1",
    ownerId: "u1",
    kind: "manual" as const,
    scope: "",
    createdAt: 1,
    createdBy: "u1",
    source: "manual" as const,
    timezone: "Asia/Shanghai",
    status: "complete" as const,
    files: [{ path: "资料/a.txt", hash: "a".repeat(64), size: 3, mtimeMs: 1 }],
    dirs: ["资料"],
    skipped: [],
    totals: { files: 1, bytes: 3, uploadedBytes: 3, skipped: 0 },
  })
  const 期望 = { projectId: "p1", ownerId: "u1" }

  test("合法 manifest 原样通过（基线）", () => {
    expect(validateManifest(合法(), 期望)).toEqual(合法())
  })
  test("files 里的路径过不了 isSafeRelativePath ⇒ undefined", () => {
    const raw = 合法()
    raw.files[0].path = "a/../../x"
    expect(validateManifest(raw, 期望)).toBeUndefined()
  })
  test("hash 不是 64 位小写十六进制 ⇒ undefined", () => {
    const raw = 合法()
    raw.files[0].hash = "A".repeat(64) // 大写：形状对、字符集不对
    expect(validateManifest(raw, 期望)).toBeUndefined()
  })
  test("projectId 与期望不符 ⇒ undefined", () => {
    const raw = 合法()
    raw.projectId = "p2"
    expect(validateManifest(raw, 期望)).toBeUndefined()
  })
})

test("estimateManifestBytes 向上取整", () => {
  expect(estimateManifestBytes(0)).toBe(0)
  expect(estimateManifestBytes(1)).toBe(1)
  expect(estimateManifestBytes(21)).toBe(2)
})
