export * as OpenhiveCaseRerunScan from "./case-rerun-scan"

/**
 * 重跑扫描与批量入队（016 T015 · N5）。
 *
 * 给 T016 的「重跑」出口供数：**三类候选**（目录独有 / 未入队 / 未识别）、
 * 按内容 sha256 对已有材料去重、`truncated` 如实上报、逐份串行入队。
 *
 * ## 为什么目录独有要按 sha256 去重（R9）
 *
 * `createMaterial` 在 `on conflict (project_id, fingerprint)` 时会把老行的 `path`
 * **改写成新路径**（`case-store.ts:96-111`）。只按路径判「盘上有、库里没有」的话，
 * 一份被改过名的材料会在新旧两个文件名之间来回振荡：每次扫描都报「目录独有」，
 * 每次批量入队又只把它改名。判据必须是**内容**，不是路径。
 *
 * ## 取数各一条语句，不逐条查
 *
 * - 全量 fingerprint（**不是最新行**）：已有材料的去重集合；
 * - 候选来源行一条：`distinct on (path)` 取最新一行（与材料视图 / 未解析份数同口径），
 *   并排除 `kind='产物'`（它们的 `parse_status` 被约束钉死为「未入队」，不排除就会绕过
 *   产物硬边界）；
 * - 最近作业一条（`distinct on (material_id)`，与 `材料视图` 同一取「最近」口径）。
 *
 * 最近作业**必须排除 `已取消`**（Ruling W）：置顶会把新作业的 `queued_at` 回填成更小值，
 * 不排除的话，那条取消掉的旧行（原因码为空）会遮蔽新作业，「未识别」永远筛不出来。
 *
 * ## 批量入队逐份串行
 *
 * FR-041：一个请求内逐份调 `enqueueMaterial`，不并发——本机实测逐条语句已是瓶颈，
 * 并发只会把库打满。单份失败进 `失败`，继续下一份，不整批失败。
 */

import { sql } from "drizzle-orm"
import { basename, dirname, join, sep } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 可解析材料, 材料目录名 } from "./case-parseable"
import { enqueueMaterial } from "./case-ingest"
import { getMaterial, type Queryable } from "./case-store"
import { 扫树, type 读目录 } from "./project-tree-scan"

export type 扫描范围 = "目录独有" | "未入队" | "未识别"

export interface 扫描依赖 {
  /** 项目根（生产由 `作业项目目录` 得到；测试用临时目录）。 */
  根目录: string
  /** 项目树读取（生产由 `建项目读目录` 提供；测试注入内存读）。 */
  读目录?: 读目录
  /** 读文件字节（生产 `Bun.file(join(根目录, path)).arrayBuffer()`；测试注入内存 Map）。 */
  读文件字节?: (绝对路径: string) => Promise<Uint8Array | undefined>
  /**
   * 沙箱前缀（Ruling AQ）：`{userId}/{projectId}`，与 `file.ts:800` 的 `sourcePath` 同口径。
   * 缺省按 `根目录` 末两段推导——T016 会显式传，测试显式传或走推导。
   */
  沙箱前缀?: string
}

export interface 扫描结果 {
  合计: number
  候选: {
    目录独有: { path: string }[]
    未入队: { materialId: string; path: string }[]
    未识别: { materialId: string; path: string; 原因码: string }[]
  }
  /** 前 5 条路径（跨三类，按 目录独有 → 未入队 → 未识别 的顺序）。 */
  样本: string[]
  截断: boolean
}

export interface 批量入队结果 {
  已入队: number
  跳过: { path: string; 原因: string }[]
  失败: { path: string; 原因: string }[]
}

interface 内部候选 {
  目录独有: { path: string; fingerprint: string }[]
  未入队: { materialId: string; path: string; fingerprint: string }[]
  未识别: { materialId: string; path: string; fingerprint: string; 原因码: string }[]
}

/**
 * `材料/` 前缀判据。两种分隔符都认——`扫树` 的路径在 win32 上可能是 `\`，
 * 不依赖运行平台。
 */
function 在材料目录(p: string): boolean {
  return p === 材料目录名 || p.startsWith(`${材料目录名}/`) || p.startsWith(`${材料目录名}\\`)
}

/** 单段文件名（两种分隔符）。 */
function 末段(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/**
 * 读字节：注入优先；缺省读盘。读不到（丢文件 / 无权限）⇒ `undefined`，由调用方跳过。
 * 这是**歧义裁定 2**：目录独有只收真读得到的文件，读不到不报失败。
 */
function 读字节器(依赖: 扫描依赖): (绝对路径: string) => Promise<Uint8Array | undefined> {
  if (依赖.读文件字节 !== undefined) return 依赖.读文件字节
  return async (绝对路径) => {
    try {
      return new Uint8Array(await Bun.file(绝对路径).arrayBuffer())
    } catch {
      // 读不到就是读不到：跳过（不报失败），与注入实现的 `undefined` 同义。
      return undefined
    }
  }
}

async function 算候选(
  db: Queryable,
  输入: { projectId: string; 范围: readonly 扫描范围[]; 依赖: 扫描依赖 },
): Promise<{ 候选: 内部候选; 截断: boolean }> {
  const { projectId, 范围, 依赖 } = 输入

  // ① 已有材料的 fingerprint 集合：**全量行**（`#002-06`：两个问题、两份取数）。
  // 幂等键是 `(project_id, fingerprint)`，同内容只会有一行；包括历史行与产物——任何一行
  // 占着这个指纹，`createMaterial` 就会改写它的 `path`，扫描不该再报「目录独有」。
  const 指纹行 = rowsOf(
    await db.execute(sql`
      select fingerprint
        from auth.case_material
       where project_id = ${projectId}
    `),
  )
  const 已有指纹 = new Set(指纹行.map((行) => String(行.fingerprint)))

  // ② 候选来源行（一条语句）。**先于**扫树读：批量入队的安全性依赖「候选快照早于入队」——
  // 扫描期间材料若被并发改成「已解析」，第二道防线（见下）才拦得住。
  //
  // - `distinct on (path)` 取**最新一行**，与材料视图 / `未解析材料份数`
  //   （`case-row-query.ts:335-343`）同口径：内容变了会另建一行、旧行留着，界面上那份文件
  //   只认最新行；直接扫全部历史行会让旧的「未入队」重复进候选。
  // - `kind <> '产物'`（I1）：0031 的 `case_material_parsed_source` 把产物的 `parse_status`
  //   钉死为「未入队」，不排除则每份产物（含每个历史版本）都会进候选，批量入队再另建一行
  //   `kind='其他'` 并排队，绕过设计 §5.5 的产物硬边界。同族口径见 `case-row-query.ts:335-355`。
  const 材料行 = rowsOf(
    await db.execute(sql`
      with latest as (
        select distinct on (path) id, path, kind, parse_status, fingerprint
          from auth.case_material
         where project_id = ${projectId}
         order by path, created_at desc, id desc
      )
      select id, path, parse_status, fingerprint
        from latest
       where kind <> '产物'
       order by path, id
    `),
  )

  const 未入队 = 范围.includes("未入队")
    ? 材料行
        .filter((行) => String(行.parse_status) === "未入队")
        .map((行) => ({
          materialId: String(行.id),
          path: String(行.path),
          fingerprint: String(行.fingerprint),
        }))
    : []

  let 未识别: 内部候选["未识别"] = []
  if (范围.includes("未识别")) {
    // ② 最近作业（一条语句，`distinct on`；排除已取消，理由见文件头 Ruling W）。
    const 作业行 = rowsOf(
      await db.execute(sql`
        select distinct on (material_id) material_id, reason_code
          from auth.case_ingest_job
         where project_id = ${projectId} and status <> '已取消'
         order by material_id, queued_at desc, id desc
      `),
    )
    const 原因码表 = new Map(
      作业行.map((行) => [
        String(行.material_id),
        typeof 行.reason_code === "string" ? 行.reason_code : undefined,
      ]),
    )
    未识别 = 材料行
      .filter((行) => String(行.parse_status) === "有问题")
      .flatMap((行) => {
        const 原因码 = 原因码表.get(String(行.id))
        if (原因码 === undefined || !原因码.startsWith("未识别:")) return []
        return [
          {
            materialId: String(行.id),
            path: String(行.path),
            fingerprint: String(行.fingerprint),
            原因码,
          },
        ]
      })
  }

  let 目录独有: 内部候选["目录独有"] = []
  let 截断 = false
  if (范围.includes("目录独有")) {
    const 读 = 依赖.读目录
    if (读 === undefined) throw new Error("读取文件树失败：没有提供读目录")
    const 结果 = await 扫树(读)
    if (结果 === undefined) throw new Error("读取文件树失败")
    截断 = 结果.truncated

    const 读文件 = 读字节器(依赖)
    const 本扫指纹 = new Set<string>()
    for (const p of 结果.paths) {
      if (!在材料目录(p)) continue
      if (!可解析材料(p)) continue
      const bytes = await 读文件(join(依赖.根目录, p)).catch(() => undefined)
      if (bytes === undefined) continue
      const sha = Hash.sha256(Buffer.from(bytes))
      // R9：已有材料按**内容**判，不按路径——否则改名会让同一份文件来回振荡。
      if (已有指纹.has(sha)) continue
      // 单次扫描内同一内容只收一条（同一文件的两份副本）。
      if (本扫指纹.has(sha)) continue
      本扫指纹.add(sha)
      目录独有.push({ path: p, fingerprint: sha })
    }
  }

  return { 候选: { 目录独有, 未入队, 未识别 }, 截断 }
}

export async function 扫候选(
  db: Queryable,
  输入: { projectId: string; 范围: readonly 扫描范围[]; 依赖: 扫描依赖 },
): Promise<扫描结果> {
  const { 候选, 截断 } = await 算候选(db, 输入)
  const 样本 = [
    ...候选.目录独有.map((项) => 项.path),
    ...候选.未入队.map((项) => 项.path),
    ...候选.未识别.map((项) => 项.path),
  ].slice(0, 5)
  return {
    合计: 候选.目录独有.length + 候选.未入队.length + 候选.未识别.length,
    候选: {
      目录独有: 候选.目录独有.map((项) => ({ path: 项.path })),
      未入队: 候选.未入队.map((项) => ({ materialId: 项.materialId, path: 项.path })),
      未识别: 候选.未识别.map((项) => ({ materialId: 项.materialId, path: 项.path, 原因码: 项.原因码 })),
    },
    样本,
    截断,
  }
}

export async function 批量入队(
  db: Queryable,
  输入: { projectId: string; 范围: readonly 扫描范围[]; userId: string; 依赖: 扫描依赖 },
): Promise<批量入队结果> {
  const { 候选 } = await 算候选(db, 输入)
  const 前缀 =
    输入.依赖.沙箱前缀 ??
    `${basename(dirname(输入.依赖.根目录))}/${basename(输入.依赖.根目录)}`

  let 已入队 = 0
  const 跳过: 批量入队结果["跳过"] = []
  const 失败: 批量入队结果["失败"] = []

  const 处理一份 = async (path: string, fingerprint: string) => {
    // 上传链路（`file.ts` 的 `relativePath`）恒写 `/`；`扫树` 在 win32 上给 `\`。
    // 不归一，库内同一项目会混两种分隔符（`case_material.path` / `source_path` 都是 `/` 口径）。
    // 只换**平台分隔符**，不用 `replaceAll("\\", "/")`：POSIX 上 `\` 是正文字符（`file.ts:475-482`）。
    const 归一 = path.split(sep).join("/")
    const 结果 = await enqueueMaterial(db, {
      projectId: 输入.projectId,
      path: 归一,
      // 作业靠它读盘：`/` 分隔（与 `file.ts:800` 同口径）。
      sourcePath: `${前缀}/${归一}`,
      fileName: 末段(path),
      fingerprint,
      by: 输入.userId,
    })
    if (结果.enqueued) {
      已入队 += 1
      return
    }
    // 第二道防线：候选理论上不含「已解析」，但扫描与入队之间可能被并发改状态。
    const 材料 = await getMaterial(db, 输入.projectId, 结果.materialId)
    const 状态 = 材料?.parseStatus
    跳过.push({ path, 原因: 状态 ?? "未知状态" })
  }

  for (const 项 of 候选.目录独有) {
    try {
      await 处理一份(项.path, 项.fingerprint)
    } catch (error) {
      失败.push({ path: 项.path, 原因: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const 项 of 候选.未入队) {
    try {
      await 处理一份(项.path, 项.fingerprint)
    } catch (error) {
      失败.push({ path: 项.path, 原因: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const 项 of 候选.未识别) {
    try {
      await 处理一份(项.path, 项.fingerprint)
    } catch (error) {
      失败.push({ path: 项.path, 原因: error instanceof Error ? error.message : String(error) })
    }
  }

  return { 已入队, 跳过, 失败 }
}
