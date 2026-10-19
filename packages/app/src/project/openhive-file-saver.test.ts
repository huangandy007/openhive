/**
 * `SAVE_PROJECT_FILE` 的四条判据：有当前项目 ⇒ 按项目写；没有 ⇒ **一个请求都不发**、
 * 当场给一句能读懂的话；服务端拒绝 ⇒ 那句原话交上去；成功 ⇒ `ok`。
 *
 * ⚠️ `currentProject` 是**模块级信号**（`@/project/current-project`）——本文件是独立进程内的
 * 独立全局域（`LEARNINGS #004-11`），但同一文件里的用例会互相串 ⇒ `afterEach` 必须
 * 把当前项目还原（`setCurrentProject(undefined)`），否则下一条用例拿到上一条留下的项目。
 * （与 `openhive-file-loader.test.ts` 同一个形状——那一侧的取数出口。）
 */

import { afterEach, describe, expect, test } from "bun:test"
import { setCurrentProject } from "./current-project"
import { createSaveProjectFile } from "./openhive-file-saver"
import type { ProjectFilesFetch } from "./openhive-files"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"

afterEach(() => setCurrentProject(undefined))

describe("createSaveProjectFile", () => {
  function 替身(answer: Response) {
    const 收到: Array<{ url: string; method: string; project: string | null; body: unknown }> = []
    const send: ProjectFilesFetch = async (input, init) => {
      const headers = init?.headers ? new Headers(init.headers) : undefined
      收到.push({
        url: input,
        method: init?.method ?? "GET",
        project: headers?.get("x-openhive-project") ?? null,
        body: init?.body,
      })
      return answer
    }
    return { send, 收到 }
  }

  test("当前项目在场 ⇒ 走写出口，带项目头，三个字段各就各位", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send, 收到 } = 替身(
      new Response('{"path":"资料/甲.txt","base":"改后的正文"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const save = createSaveProjectFile(send)

    expect(await save("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: true,
      base: "改后的正文",
    })
    expect(收到).toHaveLength(1)
    expect(收到[0].url).toBe("/openhive/file/write")
    expect(收到[0].method).toBe("POST")
    expect(收到[0].project).toBe(PROJECT)
    // ⚠️ `base` 必须**逐字**是调用方给的那份：它是服务端比对「盘上这份变过没有」的依据，
    // 这一层要是顺手 trim 一下或换成 `content`，比对就永远不成立（同 `openhive-file-ops.test.ts`）。
    expect(JSON.parse(String(收到[0].body))).toEqual({ path: "资料/甲.txt", content: "改后的正文", base: "读回来那份" })
  })

  test("回包没带 base（旧内核）⇒ 用 content.trim() 兜底，不把保存判失败", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send } = 替身(
      new Response('{"path":"资料/甲.txt"}', { status: 200, headers: { "content-type": "application/json" } }),
    )

    expect(await createSaveProjectFile(send)("资料/甲.txt", "  改后的正文  ", "读回来那份")).toEqual({
      ok: true,
      base: "改后的正文",
    })
  })

  test("拒绝时把 code 透传给视图", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const { send } = 替身(
      new Response(JSON.stringify({ error: "被改过", code: "STALE" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    )

    expect(await createSaveProjectFile(send)("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: false,
      message: "被改过",
      code: "STALE",
    })
  })

  /**
   * 没有当前项目时**一个请求都不发**：带一个空项目 id 发出去，服务端的工作目录会退回
   * **沙箱根**（所有项目的父目录）——那正是 `x-openhive-project` 那条契约防的同一件事。
   */
  test("没有当前项目 ⇒ 一句话说清，且**一个请求都不发**", async () => {
    const { send, 收到 } = 替身(new Response("{}", { status: 200 }))
    const save = createSaveProjectFile(send)

    expect(await save("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: false,
      message: "现在没有打开的项目，改动没能存回去。",
    })
    expect(收到).toHaveLength(0)
  })

  test("服务端拒绝（陈旧 / 越界 / 已归档）⇒ 那句原话交上去，不换成兜底文案", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const 那句 = "这份文件在你打开之后被改过（可能有人在别处改过）。为避免覆盖别人的改动，请关掉重新打开再改。"
    const { send } = 替身(
      new Response(JSON.stringify({ error: 那句 }), { status: 400, headers: { "content-type": "application/json" } }),
    )

    expect(await createSaveProjectFile(send)("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: false,
      message: 那句,
    })
  })

  test("我们这边坏了（网络断）⇒ 有话说，不静默", async () => {
    setCurrentProject({ id: PROJECT, name: "8·17 案" })
    const send: ProjectFilesFetch = async () => {
      throw new Error("断网了")
    }

    expect(await createSaveProjectFile(send)("资料/甲.txt", "改后的正文", "读回来那份")).toEqual({
      ok: false,
      message: "保存文件失败",
    })
  })
})
