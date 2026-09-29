import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WORKSPACE_ROOT_ENV, createWorkspace, workspaceRoot } from "./workspace"

const USER_ID = "0f9c2a5e-1b3d-4a6f-8c7e-2d4b6a8c0e1f"

async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

describe("workspaceRoot", () => {
  test("从环境变量取沙箱根", () => {
    expect(workspaceRoot({ [WORKSPACE_ROOT_ENV]: "/srv/hive" })).toBe("/srv/hive")
  })

  test("未配置时落到 design-v2 规定的默认路径", () => {
    expect(workspaceRoot({})).toBe("/workspaces")
  })
})

describe("createWorkspace", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openhive-ws-test-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("建出 {root}/{userId} 目录并返回该路径", async () => {
    const path = await createWorkspace(root, USER_ID)

    expect(path).toBe(join(root, USER_ID))
    expect(await isDirectory(path)).toBe(true)
  })

  test("父目录尚不存在时一并建出", async () => {
    const path = await createWorkspace(join(root, "a", "b"), USER_ID)

    expect(await isDirectory(path)).toBe(true)
  })

  test("目录已存在时不报错（重复录入/重试不炸）", async () => {
    await mkdir(join(root, USER_ID), { recursive: true })

    expect(await isDirectory(await createWorkspace(root, USER_ID))).toBe(true)
  })

  test("userId 含路径分隔符时拒绝——它是用户隔离边界，不能被穿越", async () => {
    // design-v2 §5.3：`{userId}` 就是隔离边界，越权必须在这里挡住。
    expect(await failureOf(createWorkspace(root, "../escape"))).toBeInstanceOf(Error)
    expect(await failureOf(createWorkspace(root, "a/b"))).toBeInstanceOf(Error)
    expect(await failureOf(createWorkspace(root, ""))).toBeInstanceOf(Error)
  })
})
