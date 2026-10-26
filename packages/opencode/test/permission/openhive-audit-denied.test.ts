/**
 * 010 T010 · 工具越权的审计写入（FR-009「全部拒绝留痕」）。
 *
 * 判据三件事：
 * ① **目录 → 用户** 的解析对四种形态都对（用户目录 / 项目子目录 / 根 / 根外）；
 * ② 写得进去时**一行不差**（操作人快照、对象是会话、detail 带权限键与 patterns）；
 * ③ **拿不到可信操作人就一行不写**（目录段不是账号 / 没有目录 / PG 没配），且**永不抛**。
 *
 * ⚠️ 本文件**不验** `Permission.ask` 的接线（那需要整个实例栈 ＋ 一条真实被拒的工具调用）。
 * 接线是一行调用，未覆盖的部分如实记在 `state.md`。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 记工具拒绝, 目录用户 } from "../../src/permission/openhive-audit-denied"

const 用户 = "11111111-1111-4111-8111-111111111111"

const 根 = mkdtempSync(join(tmpdir(), "openhive-audit-denied-"))
mkdirSync(join(根, 用户, "项目甲"), { recursive: true })
// ⚠️ 这个目录**必须真的存在**：不存在时 `FSUtil.resolve` 解析不出 win32 的 8.3 短名
// （父目录 `ADMINI~1` vs `Administrator`），比较会在「不在沙箱内」就失败——用例会因为
// 错误的原因变绿，而那条分支（目录段不是账号）一次都没跑到。
mkdirSync(join(根, "not-a-user"), { recursive: true })
const restoreRoot = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 根 })

afterAll(() => {
  restoreRoot()
  rmSync(根, { recursive: true, force: true })
})

describe("目录用户：实例目录 → 操作人", () => {
  test("沙箱根下的用户目录 ⇒ userId", () => {
    expect(目录用户(join(根, 用户))).toBe(用户)
  })

  test("项目目录（深一层）⇒ 仍是第一段", () => {
    expect(目录用户(join(根, 用户, "项目甲"))).toBe(用户)
  })

  test("根下不是账号的目录段 ⇒ 仍解析成那段（写入口再按 auth.user 拒绝）", () => {
    // 这一条与下面「目录段不是已录入账号 ⇒ 不写」配对：只有解析出了 `not-a-user`，
    // 那条用例才真的走到「查无此人」这个分支，而不是在「不在沙箱内」就提前返回。
    expect(目录用户(join(根, "not-a-user"))).toBe("not-a-user")
  })

  test("沙箱根本身 ⇒ undefined（根不是任何人的目录）", () => {
    expect(目录用户(根)).toBeUndefined()
  })

  test("根外 ⇒ undefined（本机 dev / 自定义目录不猜）", () => {
    expect(目录用户(tmpdir())).toBeUndefined()
  })
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${用户}, '930001', '被拒民警', 'x', 'x', '审计单位', '审计部门', '审计科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await pg?.stop()
})

const 审计行 = async () => {
  if (!pg) throw new Error("真库没起来")
  return rowsOf(
    await pg.db.execute(
      sql`select actor_id, actor_name, actor_police_no, board, action, target_type, target_id, result, detail
          from auth.audit_event order by id asc`,
    ),
  )
}

describe("记工具拒绝：写入", () => {
  test("写一行：操作人快照 ＋ 对象是会话 ＋ detail 带权限键与 patterns", async () => {
    const before = (await 审计行()).length
    await 记工具拒绝({
      directory: join(根, 用户, "项目甲"),
      sessionID: "ses_audit_denied_1",
      permission: "bash",
      patterns: ["rm -rf *"],
      messageID: "msg_1",
      callID: "call_1",
    })

    const rows = await 审计行()
    expect(rows).toHaveLength(before + 1)
    const row = rows[rows.length - 1]
    expect(row).toMatchObject({
      actor_id: 用户,
      actor_name: "被拒民警",
      actor_police_no: "930001",
      board: null,
      action: "tool.denied",
      target_type: "session",
      target_id: "ses_audit_denied_1",
      result: "denied",
    })
    expect(JSON.parse(String(row.detail))).toEqual({
      permission: "bash",
      patterns: ["rm -rf *"],
      messageID: "msg_1",
      callID: "call_1",
    })
  })
})

describe("记工具拒绝：不可信就一行不写（且不抛）", () => {
  test("目录段不是已录入账号 ⇒ 不写", async () => {
    const before = (await 审计行()).length
    await 记工具拒绝({
      directory: join(根, "not-a-user"),
      sessionID: "ses_audit_denied_2",
      permission: "edit",
      patterns: ["*"],
    })
    expect((await 审计行()).length).toBe(before)
  })

  test("没有实例目录 ⇒ 不写", async () => {
    const before = (await 审计行()).length
    await 记工具拒绝({
      directory: undefined,
      sessionID: "ses_audit_denied_3",
      permission: "edit",
      patterns: ["*"],
    })
    expect((await 审计行()).length).toBe(before)
  })

  test("PG 没配 ⇒ 不写、不抛", async () => {
    const keys = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const
    const 原值 = keys.map((key) => [key, process.env[key]] as const)
    for (const key of keys) delete process.env[key]
    try {
      const before = (await 审计行()).length
      await 记工具拒绝({
        directory: join(根, 用户),
        sessionID: "ses_audit_denied_4",
        permission: "bash",
        patterns: ["*"],
      })
      expect((await 审计行()).length).toBe(before)
    } finally {
      for (const [key, value] of 原值) if (value !== undefined) process.env[key] = value
    }
  })
})
