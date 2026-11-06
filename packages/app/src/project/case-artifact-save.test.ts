import { describe, expect, test } from "bun:test"
import { createCaseArtifactSave } from "./case-artifact-save"

const 回包 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const 成了 = async () => ({ ok: true as const, base: "底本" })

describe("存盘后登记引用", () => {
  test("带标记：先存盘、再登记，登记体里是刚落盘的那份正文", async () => {
    const 顺序: string[] = []
    let 体: Record<string, unknown> | undefined
    const save = createCaseArtifactSave(
      async () => {
        顺序.push("save")
        return 成了()
      },
      async (_url, init) => {
        顺序.push("register")
        体 = JSON.parse(String(init?.body))
        return 回包({ 登记: 1, 删除: 0, 跳过: [], 材料id: "mat-1" })
      },
      () => "p-1",
    )
    const 结论 = await save("报告/分析.md", "见 [[fact:entity:e-张]]", "旧底本")
    expect(顺序).toEqual(["save", "register"])
    expect(体).toEqual({ projectId: "p-1", path: "报告/分析.md", content: "见 [[fact:entity:e-张]]" })
    expect(结论).toEqual({ ok: true, base: "底本" })
  })

  test("存盘失败 ⇒ 一次登记都不发（没落盘的内容不许登记成引用）", async () => {
    let 发过 = 0
    const save = createCaseArtifactSave(
      async () => ({ ok: false, message: "这份文件被改过", code: "STALE" }),
      async () => {
        发过 += 1
        return 回包({})
      },
      () => "p-1",
    )
    expect(await save("a.md", "[[fact:entity:e-张]]", "旧")).toEqual({
      ok: false,
      message: "这份文件被改过",
      code: "STALE",
    })
    expect(发过).toBe(0)
  })

  test("没有标记 ⇒ 不登记（不往材料库塞无关文件）", async () => {
    let 发过 = 0
    const save = createCaseArtifactSave(
      async () => 成了(),
      async () => {
        发过 += 1
        return 回包({})
      },
      () => "p-1",
    )
    await save("a.md", "普通正文", "旧")
    expect(发过).toBe(0)
  })

  test("登记失败不改变存盘结论（文件已经在盘上了）", async () => {
    const save = createCaseArtifactSave(
      async () => 成了(),
      async () => 回包({ error: "炸了" }, 500),
      () => "p-1",
    )
    expect(await save("a.md", "[[fact:entity:e-张]]", "旧")).toEqual({ ok: true, base: "底本" })
  })

  test("存盘期间切了项目 ⇒ 登记仍发给存盘那一刻的项目（入口取快照，不读晚到的当前项目）", async () => {
    let 当前 = "p-1"
    let 放行: () => void = () => {}
    let 体: Record<string, unknown> | undefined
    const save = createCaseArtifactSave(
      async () => {
        await new Promise<void>((resolve) => {
          放行 = resolve
        })
        return 成了()
      },
      async (_url, init) => {
        体 = JSON.parse(String(init?.body))
        return 回包({ 登记: 1, 删除: 0, 跳过: [], 材料id: "mat-1" })
      },
      () => 当前,
    )
    const 存 = save("报告/分析.md", "见 [[fact:entity:e-张]]", "旧底本")
    // 存盘还悬着时切到另一个项目——回包回来后不许按「当前项目」登记（`LEARNINGS #008-03`）。
    当前 = "p-2"
    放行()
    await 存
    expect(体?.projectId).toBe("p-1")
  })

  test("没有当前项目 ⇒ 不登记（带空项目 id 会写到沙箱根）", async () => {
    let 发过 = 0
    const save = createCaseArtifactSave(
      async () => 成了(),
      async () => {
        发过 += 1
        return 回包({})
      },
      () => undefined,
    )
    await save("a.md", "[[fact:entity:e-张]]", "旧")
    expect(发过).toBe(0)
  })

  test("登记请求直接抛也不改变存盘结论（网络异常不许把存盘报成失败）", async () => {
    const save = createCaseArtifactSave(
      async () => 成了(),
      async () => {
        throw new Error("连不上")
      },
      () => "p-1",
    )
    expect(await save("a.md", "[[fact:entity:e-张]]", "旧")).toEqual({ ok: true, base: "底本" })
  })
})
