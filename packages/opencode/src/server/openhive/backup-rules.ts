import {
  MANIFEST_VERSION,
  type Manifest,
  type ManifestFile,
  type ManifestSkip,
  type ManifestTotals,
  type SkipReason,
  type SnapshotSummary,
} from "./backup-model"

const DRIVE = /^[A-Za-z]:/

/** 项目内相对路径的守卫。与 `Minio.assertSafeSegment` 同一条判据（只多允许 `""`＝项目根）。 */
export function isSafeRelativePath(path: string): boolean {
  if (path === "") return true
  if (path.includes("\\") || path.includes("\u0000")) return false
  if (path.startsWith("/") || DRIVE.test(path)) return false
  const segments = path.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

const 精确排除 = new Set([".git/index.lock", ".DS_Store", "Thumbs.db", "desktop.ini"])
const 后缀排除 = [/\.tmp$/i, /\.swp$/i, /\.swo$/i, /~$/]

/** 备份排除名单（spec §5.3）。**不排除 `.git`**——整份版本库要在快照里。 */
export function isExcluded(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1)
  // 精确名单按**文件名**也比一次：`.DS_Store` / `Thumbs.db` / `desktop.ini` 是
  // 系统在每个目录里都撒的，只盯项目根会漏掉子目录里的那些（实测清单里有 `资料/Thumbs.db`）。
  if (精确排除.has(path) || 精确排除.has(name)) return true
  if (name.startsWith("~$")) return true
  if (name.startsWith(".openhive-restore-") || name.startsWith(".openhive-old-")) return true
  if (path.startsWith(".git/")) {
    if (path.endsWith(".lock")) return true
    const parts = path.split("/")
    if (parts.length === 4 && parts[1] === "objects" && parts[2] === "pack" && parts[3].startsWith("tmp_")) return true
  }
  return 后缀排除.some((rule) => rule.test(name))
}

/** `path` 是否落在这次备份的范围里。scope 是文件时只覆盖它自己。 */
export function isPathInScope(scope: string, path: string): boolean {
  if (scope === "") return true
  if (path === scope) return true
  return path.startsWith(`${scope}/`)
}

/** 快照 id：`YYYYMMDDTHHMMSSmmmZ-<6 位十六进制>`（spec §4.6）。 */
export function snapshotIdOf(at: number, randomHex: string): string {
  const iso = new Date(at).toISOString() // 2026-10-18T14:03:05.123Z
  const 秒 = iso.slice(0, 19).replace(/[-:]/g, "") // 20261018T140305
  const 毫秒 = String(at % 1000).padStart(3, "0")
  return `${秒}${毫秒}Z-${randomHex.slice(0, 6)}`
}

function 本地时间戳(at: number): string {
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(
    date.getMinutes(),
  )}-${two(date.getSeconds())}`
}

/** 「保留两者」的新名字（spec §6.3）。`taken` 回答「这个名字在目标目录里已经有人占了吗」。 */
export function keepBothName(path: string, at: number, taken: (candidate: string) => boolean): string {
  const slash = path.lastIndexOf("/")
  const dir = slash === -1 ? "" : path.slice(0, slash)
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  const stamp = 本地时间戳(at)
  const build = (suffix: string) => {
    const base = `${stem} (MinIO ${stamp})${suffix}${ext}`
    return dir ? `${dir}/${base}` : base
  }
  let candidate = build("")
  let n = 2
  while (taken(candidate)) candidate = build(` (${n++})`)
  return candidate
}

/** 预计 manifest 大小：`ceil(logicalBytes / 20)`（spec §8.3 的粗估）。 */
export function estimateManifestBytes(logicalBytes: number): number {
  return Math.ceil(logicalBytes / 20)
}

/** 由 manifest 生成 state 里的摘要。 */
export function summaryOf(manifest: Manifest): SnapshotSummary {
  return {
    id: manifest.id,
    kind: manifest.kind,
    scope: manifest.scope,
    createdAt: manifest.createdAt,
    status: manifest.status,
    totals: manifest.totals,
  }
}

const SNAPSHOT_ID = /^\d{8}T\d{9}Z-[0-9a-f]{6}$/
const SHA256 = /^[0-9a-f]{64}$/

function 是记录(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 数字(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function 读文件(value: unknown): ManifestFile | undefined {
  if (!是记录(value)) return undefined
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path) || value.path === "") return undefined
  if (typeof value.hash !== "string" || !SHA256.test(value.hash)) return undefined
  if (!数字(value.size) || !数字(value.mtimeMs)) return undefined
  if (value.mode !== undefined && !数字(value.mode)) return undefined
  return {
    path: value.path,
    hash: value.hash,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ...(value.mode === undefined ? {} : { mode: value.mode }),
  }
}

const 跳过原因: readonly SkipReason[] = [
  "excluded",
  "too-large",
  "unreadable",
  "changed-during-backup",
  "symlink",
  "upload-failed",
]

function 读跳过(value: unknown): ManifestSkip | undefined {
  if (!是记录(value)) return undefined
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path)) return undefined
  if (typeof value.reason !== "string" || !跳过原因.includes(value.reason as SkipReason)) return undefined
  return { path: value.path, reason: value.reason as SkipReason }
}

function 读总计(value: unknown): ManifestTotals | undefined {
  if (!是记录(value)) return undefined
  if (!数字(value.files) || !数字(value.bytes) || !数字(value.uploadedBytes) || !数字(value.skipped)) return undefined
  return { files: value.files, bytes: value.bytes, uploadedBytes: value.uploadedBytes, skipped: value.skipped }
}

/**
 * 把 manifest 当**不可信输入**校验（spec §9.5）。
 *
 * 返回 `undefined` ＝ 这份 manifest 不能用；调用方必须 fail-closed（GC 遇到它就不删任何 blob）。
 * 校验的是「读回来能不能安全地拿去写盘」：路径不许穿越、哈希必须是 sha256、id 必须是那个形状。
 */
export function validateManifest(
  raw: unknown,
  expected: { projectId: string; ownerId: string },
): Manifest | undefined {
  if (!是记录(raw)) return undefined
  if (raw.version !== MANIFEST_VERSION) return undefined
  if (typeof raw.id !== "string" || !SNAPSHOT_ID.test(raw.id)) return undefined
  if (raw.projectId !== expected.projectId || raw.ownerId !== expected.ownerId) return undefined
  if (raw.kind !== "manual" && raw.kind !== "auto") return undefined
  if (typeof raw.scope !== "string" || !isSafeRelativePath(raw.scope)) return undefined
  if (!数字(raw.createdAt)) return undefined
  if (typeof raw.createdBy !== "string") return undefined
  if (raw.source !== "manual" && raw.source !== "auto") return undefined
  if (typeof raw.timezone !== "string") return undefined
  if (raw.status !== "complete" && raw.status !== "partial") return undefined
  if (!Array.isArray(raw.files) || !Array.isArray(raw.dirs) || !Array.isArray(raw.skipped)) return undefined

  const files: ManifestFile[] = []
  for (const value of raw.files) {
    const file = 读文件(value)
    if (!file) return undefined
    files.push(file)
  }
  const dirs: string[] = []
  for (const value of raw.dirs) {
    if (typeof value !== "string" || !isSafeRelativePath(value) || value === "") return undefined
    dirs.push(value)
  }
  const skipped: ManifestSkip[] = []
  for (const value of raw.skipped) {
    const skip = 读跳过(value)
    if (!skip) return undefined
    skipped.push(skip)
  }
  const totals = 读总计(raw.totals)
  if (!totals) return undefined

  return {
    version: MANIFEST_VERSION,
    id: raw.id,
    projectId: raw.projectId,
    ownerId: raw.ownerId,
    kind: raw.kind,
    scope: raw.scope,
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    source: raw.source,
    timezone: raw.timezone,
    status: raw.status,
    files,
    dirs,
    skipped,
    totals,
  }
}

/** 按服务器时区把一个时刻切成小时 / 天 / ISO 周三个桶（spec §8.1）。 */
export function zoneOf(at: number, timeZone: string): { hour: string; day: string; week: string } {
  // en-CA 的日期段天然是 `YYYY-MM-DD`（与 ISO 同形）；h23 让午夜是 `00` 而不是 `24`。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  const day = `${pick("year")}-${pick("month")}-${pick("day")}`
  // 周桶按 ISO 周（周一为首日）。日期算术放在 UTC 里做，避开本机时区与夏令时。
  const date = new Date(`${day}T00:00:00Z`)
  const 周一 = new Date(date)
  const 星期 = (date.getUTCDay() + 6) % 7 // 周一＝0
  周一.setUTCDate(date.getUTCDate() - 星期)
  const 周一串 = 周一.toISOString().slice(0, 10)
  return { hour: `${day}T${pick("hour")}`, day, week: 周一串 }
}

const 二十四小时 = 24 * 3600_000
const 三十天 = 30 * 86400_000
const 八十四天 = 84 * 86400_000

/**
 * 分级保留（spec §8.1），只作用于 `kind: "auto"`：
 * - 最新自动快照**永远**保留（哪怕超过 84 天，否则长期不用的项目会一张不剩）；
 * - 最近 24 小时按小时桶、1–30 天按天桶、31–84 天按 ISO 周桶，各留最新一条；
 * - 超过 84 天、且不是最新那条 ⇒ 不在保留集里（删）；
 * - 手动快照**不参与**自动删除（A7：用户主动拍的东西不能悄悄没了）。
 *
 * 返回值是「留下的 id」；调用方删掉其余自动快照。容量超限只暂停自动备份，**不**在这里删旧快照。
 */
export function retentionKeepIds(snapshots: readonly SnapshotSummary[], now: number, timeZone: string): Set<string> {
  const kept = new Set<string>()
  // 降序：同一个桶里先遇到的就是最新那条；「最新自动快照」的兜底也取第一条。
  const autos = snapshots
    .filter((snapshot) => snapshot.kind === "auto")
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
  const 最新 = autos[0]
  if (最新) kept.add(最新.id)

  const hours = new Set<string>()
  const days = new Set<string>()
  const weeks = new Set<string>()
  for (const snapshot of autos) {
    const age = now - snapshot.createdAt
    if (age > 八十四天) break // 已降序：更老的不必再看
    const zone = zoneOf(snapshot.createdAt, timeZone)
    // 三档按**年龄**分层，每档只在自己的桶里留最新一条。同一小时里的第二条不能再掉进
    // 「天」桶复活——否则「每小时留一张」名不副实，24 小时内的快照会被两份规则各留一遍。
    if (age <= 二十四小时) {
      if (hours.has(zone.hour)) continue
      hours.add(zone.hour)
      kept.add(snapshot.id)
      continue
    }
    if (age <= 三十天) {
      if (days.has(zone.day)) continue
      days.add(zone.day)
      kept.add(snapshot.id)
      continue
    }
    if (weeks.has(zone.week)) continue
    weeks.add(zone.week)
    kept.add(snapshot.id)
  }

  for (const snapshot of snapshots) if (snapshot.kind === "manual") kept.add(snapshot.id)
  return kept
}

/** 全部 manifest 引用到的 blob 哈希（GC 的唯一「谁还在用」判据，spec §8.4）。 */
export function referencedHashes(manifests: readonly Manifest[]): Set<string> {
  const hashes = new Set<string>()
  for (const manifest of manifests) for (const file of manifest.files) hashes.add(file.hash)
  return hashes
}
