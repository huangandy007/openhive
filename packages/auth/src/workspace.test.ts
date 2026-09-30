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

  /**
   * T007 出参之一：「`/workspaces/{userId}/` 以 `0700` 建出」（`isolation-scheme.md` §4）。
   *
   * ⚠️ **本机（win32）跑不到**：`mkdir` 的 `mode` 在 Windows 上被**完全忽略**，
   * 实测 `mkdir({mode:0o700})` / 不传 mode / 建后 `chmod(0o700)` 三者都得到 `666`。
   * 所以这里**显式 skip**，而不是写一条在 Windows 上永远绿的假断言。
   *
   * ⚠️ 而且**本包的测试根本没进 CI**：`turbo.json` 只为 `opencode` / `@opencode-ai/core` /
   * `function` / `app` / `ui` / `session-ui` 声明了 `test`，**没有 `@opencode-ai/auth#test`**，
   * 而 CI 跑的是 `bun turbo test`。于是这条在 win32 被 skip、在 Linux 上也**没人跑**——
   * 按 `LEARNINGS #002-02`，这是**缺口，不是覆盖**（已在 `state.md` 登记）。
   * 留在文件里的理由：契约写下来，本机 Linux / 修好 turbo 之后立刻生效。
   *
   * 📌 「0700 挡的是谁」：按 §5 裁定**乙**，单进程下它**不挡**容器内的用户 A vs 用户 B
   * （一个进程 = 一个 OS 主体），挡的是**容器外**（同主机其他容器 / 系统用户）。
   * 用户间隔离由每用户独立 db + 应用层锚定承担，**不得**拿这条当「已隔离」的证据。
   */
  test.skipIf(process.platform === "win32")("以 0700 建出（T007）", async () => {
    const path = await createWorkspace(root, USER_ID)

    expect((await stat(path)).mode & 0o777).toBe(0o700)
  })
})
