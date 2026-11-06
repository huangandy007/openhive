import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { 解析调用身份 } from "../../src/server/openhive/case-mcp-identity"

const 根 = "/workspaces"

describe("解析调用身份", () => {
  test("正常：沙箱根/userId/projectId ⇒ 两段都解出来", () => {
    expect(
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces/u1/p-甲" } }),
    ).toEqual({ userId: "u1", projectId: "p-甲" })
  })

  test("缺 openhive/user ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/directory": "/workspaces/u1/p" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("缺 openhive/directory ⇒ identity_required", () => {
    expect(() => 解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1" } })).toThrow(
      expect.objectContaining({ code: "identity_required" }),
    )
  })

  test("目录停在沙箱根（只有 userId 一段）⇒ identity_required，不猜项目", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces/u1" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("目录停在沙箱根上一级 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("目录多一层 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces/u1/p/子目录" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("目录在别人的沙箱里 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces/u2/p-甲" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("目录用 .. 逃出沙箱根 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "u1", "openhive/directory": "/workspaces/u1/../../etc" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("userId 是 . ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": ".", "openhive/directory": "/workspaces/p" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("userId 里带分隔符 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "../u2", "openhive/directory": "/workspaces/u2/p" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })

  test("配置侧根是 8.3 短名、内核侧目录是规范长名 ⇒ 仍解析出同一个项目", () => {
    // 真栈默认根 `%TEMP%\openhive-real-stack-state\workspaces` 是短名形态
    // （本机 `%TEMP%` = `C:\Users\ADMINI~1\…`），而 `_meta.directory` 由内核经
    // `WorkspaceRoot.canonicalRoot` 交给模型，是长名。两侧不归一化 ⇒ `relative` 得到
    // `..\..\Administrator\…` ⇒ 每次调用 identity_required。
    const 短根 = mkdtempSync(path.join(os.tmpdir(), "openhive-identity-"))
    try {
      const 规范根 = WorkspaceRoot.canonicalRoot(短根)
      if (规范根 === 短根) {
        // 该卷没有 8.3 短名（或不是 win32）⇒ 造不出「两种写法指同一目录」的输入。
        // 如实跳过：这条在本平台没有判别力，不许假装覆盖。
        expect(规范根).toBe(短根)
        return
      }
      const userId = "u-短名"
      const projectId = "p-短名"
      mkdirSync(path.join(短根, userId, projectId), { recursive: true })
      expect(
        解析调用身份({
          workspaceRoot: 短根,
          // 内核侧形态：长名。
          meta: { "openhive/user": userId, "openhive/directory": path.join(规范根, userId, projectId) },
        }),
      ).toEqual({ userId, projectId })
      // 反方向：入口给的是规范根（in-process / 已归一化的 deps），目录却是短名形态。
      expect(
        解析调用身份({
          workspaceRoot: 规范根,
          meta: { "openhive/user": userId, "openhive/directory": path.join(短根, userId, projectId) },
        }),
      ).toEqual({ userId, projectId })
    } finally {
      rmSync(短根, { recursive: true, force: true })
    }
  })
})
