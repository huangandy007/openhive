import { describe, expect, test } from "bun:test"
import { MANIFEST_VERSION, type SnapshotSummary } from "../../src/server/openhive/backup-model"
import {
  estimateManifestBytes,
  isExcluded,
  isPathInScope,
  isSafeRelativePath,
  keepBothName,
  referencedHashes,
  retentionKeepIds,
  snapshotIdOf,
  validateManifest,
  zoneOf,
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

describe("zoneOf", () => {
  test("按给定时区切桶：UTC 傍晚 ≠ 上海的同一天", () => {
    // 16:30Z ⇒ 上海 2026-10-19 00:30（周一）。用 UTC 切会得到 18 日 16 点，两条都错。
    expect(zoneOf(Date.parse("2026-10-18T16:30:00.000Z"), "Asia/Shanghai")).toEqual({
      hour: "2026-10-19T00",
      day: "2026-10-19",
      week: "2026-10-19",
    })
  })
  test("周桶按 ISO 周（周一为首日）", () => {
    // 2026-10-18 是周日 ⇒ 所在 ISO 周从 12 日（周一）起。
    const zone = zoneOf(Date.parse("2026-10-18T12:00:00.000Z"), "Asia/Shanghai")
    expect(zone).toEqual({ hour: "2026-10-18T20", day: "2026-10-18", week: "2026-10-12" })
  })
})

describe("retentionKeepIds", () => {
  const tz = "Asia/Shanghai"
  // 取 12:30Z（上海 20:30）而不是整点：整点减 10 分钟会掉进上一个小时桶，
  // 与下面「同一小时两条」的用例名不符（那个桶边界不是这条用例要测的东西）。
  const now = Date.parse("2026-10-18T12:30:00.000Z")

  function 摘要(id: string, at: number): SnapshotSummary {
    return {
      id,
      kind: "auto",
      scope: "",
      createdAt: at,
      status: "complete",
      totals: { files: 1, bytes: 1, uploadedBytes: 1, skipped: 0 },
    }
  }

  test("最新自动快照永远保留，哪怕它已经超过 84 天", () => {
    const old = now - 100 * 86400_000
    expect(retentionKeepIds([摘要("old", old)], now, tz).has("old")).toBe(true)
  })

  test("最近 24 个不同小时各留最新的一条", () => {
    const 同一小时两条 = [摘要("b", now), 摘要("a", now - 10 * 60_000)]
    expect([...retentionKeepIds(同一小时两条, now, tz)]).toEqual(["b"])
  })

  test("超过 84 天且不是最新的自动快照被删", () => {
    const snapshots = [摘要("new", now), 摘要("old", now - 85 * 86400_000)]
    expect(retentionKeepIds(snapshots, now, tz).has("old")).toBe(false)
  })

  test("1–30 天按天留最新一张", () => {
    // 两条都在上海 10-17 这一天、都超过 24 小时：按天桶只留较新的那条。
    const 同一天 = [摘要("近", now - 25 * 3600_000), 摘要("远", now - 26 * 3600_000)]
    expect([...retentionKeepIds(同一天, now, tz)]).toEqual(["近"])
  })

  test("31–84 天按 ISO 周留最新一张", () => {
    // now-40 与 now-41 天同属 2026-09-07 那一周（周一为首日）。
    const 同一周 = [摘要("近", now - 40 * 86400_000), 摘要("远", now - 41 * 86400_000)]
    expect([...retentionKeepIds(同一周, now, tz)]).toEqual(["近"])
  })

  test("小时 / 天 / 周三层各有独占条目，不是「只留最新一条」", () => {
    // 每一层都必须有「同一桶里的第二条」，否则删掉那一层也不会红：
    // - h1/h2：同一本地日、不同小时（删小时层 ⇒ h2 落入天桶被去重）；
    // - d2/d3：同一 ISO 周（删天层 ⇒ d3 落入周桶被去重）；
    // - w40/w47：两个不同 ISO 周的周桶条目（删周层 ⇒ 两条都不留）。
    // now＝上海 10-18 20:30；d2/d3 是 10-16/10-15（同属 10-12 那一周）；w40/w47 是 09-08/09-01。
    const snapshots = [
      摘要("now", now),
      摘要("h1", now - 3600_000),
      摘要("h2", now - 2 * 3600_000),
      摘要("d2", now - 2 * 86400_000),
      摘要("d3", now - 3 * 86400_000),
      摘要("w40", now - 40 * 86400_000),
      摘要("w47", now - 47 * 86400_000),
    ]
    expect([...retentionKeepIds(snapshots, now, tz)].sort()).toEqual(["d2", "d3", "h1", "h2", "now", "w40", "w47"])
  })

  test("天桶按用户时区分桶：UTC 同一天、上海跨两天", () => {
    // 距 now 24.5h / 25h：UTC 下都在 10-17（只留一条）；上海下 24.5h 前是 10-18 00:00、
    // 25h 前是 10-17 23:30（分属两天，两条都留）。用天桶而不是小时桶：UTC+8 下小时边界
    // 只整体平移，区分不了两种时区。
    const 跨日 = Date.parse("2026-10-18T16:30:00.000Z")
    const snapshots = [摘要("新", 跨日 - 24.5 * 3600_000), 摘要("旧", 跨日 - 25 * 3600_000)]
    const kept = retentionKeepIds(snapshots, 跨日, tz)
    expect(kept.has("新")).toBe(true)
    expect(kept.has("旧")).toBe(true)
  })

  test("手动快照不参与自动删除", () => {
    const manual = { ...摘要("manual", now - 200 * 86400_000), kind: "manual" as const }
    expect(retentionKeepIds([manual, 摘要("auto", now)], now, tz).has("manual")).toBe(true)
  })
})

describe("referencedHashes", () => {
  test("把所有 manifest 的 files.hash 并起来", () => {
    const a = { files: [{ hash: "a".repeat(64) }] }
    const b = { files: [{ hash: "b".repeat(64) }] }
    expect([...referencedHashes([a as never, b as never])]).toEqual(["a".repeat(64), "b".repeat(64)])
  })
})
