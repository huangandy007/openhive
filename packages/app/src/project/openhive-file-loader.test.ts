/**
 * `LOAD_PROJECT_FILE` 的两条判据：**有当前项目**时按项目取数；**没有当前项目**时一个请求都不发。
 *
 * ⚠️ `currentProject` 是**模块级信号**（`@/project/current-project`）——本文件是独立进程内的
 * 独立全局域（`LEARNINGS #004-11`），但同一文件里的用例会互相串 ⇒ `afterEach` 必须
 * 把当前项目还原（`setCurrentProject(undefined)`），否则下一条用例拿到上一条留下的项目。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { setCurrentProject } from "./current-project"
import { createLoadProjectFile } from "./openhive-file-loader"
import type { ProjectFilesFetch } from "./openhive-files"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"

afterEach(() => setCurrentProject(undefined))

describe("createLoadProjectFile", () => {
  function 替身(answer: Response) {
    const 收到: Array<{ url: string; project: string | null }> = []
    const send: ProjectFilesFetch = async (input, init) => {
      收到.push({ url: input, project: new Headers(init?.headers).get("x-openhive-project") })
      return answer
    }
    return { send, 收到 }
  }

  test("当前项目在场 ⇒ 走项目的读出口，带项目头", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send, 收到 } = 替身(
      new Response('{"type":"text","content":"甲的正文"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const load = createLoadProjectFile(send)
    expect(await load("资料/甲.txt")).toEqual({ type: "text", content: "甲的正文" })
    expect(收到).toHaveLength(1)
    expect(收到[0].url).toBe("/file/content?path=%E8%B5%84%E6%96%99%2F%E7%94%B2.txt")
    expect(收到[0].project).toBe(PROJECT)
  })

  test("没有当前项目 ⇒ undefined，且**一个请求都不发**", async () => {
    const { send, 收到 } = 替身(new Response("{}", { status: 200 }))
    const load = createLoadProjectFile(send)
    expect(await load("资料/甲.txt")).toBeUndefined()
    expect(收到).toHaveLength(0)
  })
})
