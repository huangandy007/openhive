import { describe, expect, test } from "bun:test"
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

  test("userId 里带分隔符 ⇒ identity_required", () => {
    expect(() =>
      解析调用身份({ workspaceRoot: 根, meta: { "openhive/user": "../u2", "openhive/directory": "/workspaces/u2/p" } }),
    ).toThrow(expect.objectContaining({ code: "identity_required" }))
  })
})
