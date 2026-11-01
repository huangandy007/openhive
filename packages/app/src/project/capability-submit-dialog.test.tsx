import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import type { AssetCategoryRow } from "@/ai-assets/category-api"
import type { 入库入参 } from "./capability-action-api"
import type { 自带条目 } from "./capability-source"
import { CapabilitySubmitDialog } from "./capability-submit-dialog"

/**
 * 入库表单（2026-11-01，设计 §4.3）。
 *
 * 本文件钉的是**表单自己那一半**：哪些字段必填、空描述根本交不出去、交出去的是 trim 后的值。
 * 「点了以后发什么请求」在 `capability-action-api.test.ts`；「行上什么时候出现按钮」在
 * `capability-panel.test.tsx`。三件事分开，红了才看得出是哪一半。
 *
 * ⚠️ 功能描述必须非空：`auth.asset` 有 `CHECK (btrim(description) <> '')`，空串在真库上存不进去
 * （2026-11-01 实现期裁定）。这条不是洁癖，是接口层的硬约束。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface 剧本 {
  条?: 自带条目
  onConfirm?: (输入: 入库入参) => string | undefined | Promise<string | undefined>
  /** 分类行；省略 = 两条夹具。要测「空 / 读不到」时显式传 `[]`。 */
  categories?: readonly AssetCategoryRow[]
  /** 分类接口最近一次失败的那句话；省略 = 没有错。 */
  categoriesError?: string
  /** 分类是否已经读完（首屏未回来时为 `false`）；省略 = 已读完。 */
  categoriesLoaded?: boolean
  onRetryCategories?: () => void
}

async function 打开(剧本: 剧本 = {}): Promise<入库入参[]> {
  const 收到: 入库入参[] = []
  const 条: 自带条目 = 剧本.条 ?? { kind: "local", name: "话单分析", skillPath: ".opencode/skill/话单分析" }
  const trigger = (): JSX.Element => {
    const dialog = useDialog()
    return (
      <button
        data-slot="open"
        onClick={() =>
          dialog.show(() => (
            <CapabilitySubmitDialog
              条={条}
              projectId="p1"
              categories={
                剧本.categories ?? [
                  { id: "intelligence", name: "情报研判" },
                  { id: "case-handling", name: "案件办理" },
                ]
              }
              categoriesError={剧本.categoriesError}
              categoriesLoaded={剧本.categoriesLoaded}
              onRetryCategories={剧本.onRetryCategories}
              onConfirm={(输入) => {
                收到.push(输入)
                return 剧本.onConfirm?.(输入)
              }}
            />
          ))
        }
      >
        开
      </button>
    )
  }
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{trigger()}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return 收到
}

function 框<T extends Element>(selector: string, 构造: new () => T): T {
  const el = document.body.querySelector(selector)
  if (!(el instanceof 构造)) throw new Error(`弹窗里找不到 ${selector}——这条用例的前提不成立`)
  return el
}

const 名称 = () => 框("input[name='capability-submit-name']", HTMLInputElement)
const 描述 = () => 框("textarea[name='capability-submit-description']", HTMLTextAreaElement)
const 分类 = () => 框("[data-slot='capability-submit-category']", HTMLSelectElement)
const 可见 = () => 框("[data-slot='capability-submit-visibility']", HTMLSelectElement)
const 确定 = () => 框("[data-slot='capability-submit-ok']", HTMLButtonElement)

const 填 = (el: HTMLInputElement | HTMLTextAreaElement, 值: string) => {
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

const 选 = (el: HTMLSelectElement, 值: string) => {
  el.value = 值
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

/** `ButtonV2 type="submit"` 在 happy-dom 里点不出一条 `submit`，直接派发（同 `file-create-dialog.test.tsx`）。 */
const 提交 = () => {
  框("form[data-slot='capability-submit-dialog']", HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  )
}

const 文案 = (slot: string) => document.body.querySelector(`[data-slot='${slot}']`)?.textContent?.trim() ?? ""

async function 填齐() {
  填(描述(), "把话单按时间段切片并统计")
  选(分类(), "intelligence")
  选(可见(), "personal")
}

describe("入库表单（CapabilitySubmitDialog）", () => {
  test("功能描述为空 ⇒ 「确定」禁用，并有一句必填提示", async () => {
    await 打开()

    expect(确定().disabled).toBe(true)
    expect(文案("capability-submit-description-hint")).toContain("必填")
  })

  test("只填描述、没选分类与可见范围 ⇒ 仍禁用（三个必填各自把门）", async () => {
    await 打开()

    填(描述(), "有描述了")
    expect(确定().disabled).toBe(true)

    选(分类(), "intelligence")
    expect(确定().disabled).toBe(true)

    选(可见(), "personal")
    expect(确定().disabled).toBe(false)
  })

  test("描述只有空白 ⇒ 禁用，并在字段下说「不能为空」", async () => {
    await 打开()

    填(描述(), "   ")
    选(分类(), "intelligence")
    选(可见(), "personal")

    expect(确定().disabled).toBe(true)
    expect(文案("capability-submit-description-error")).toContain("不能为空")
  })

  test("提交 ⇒ 交出 trim 后的非空描述与条目自带的 skillPath（不从 location 反推）", async () => {
    const 收到 = await 打开({ 条: { kind: "local", name: "话单分析", skillPath: ".opencode/skill/话单分析" } })

    填(描述(), "  把话单按时间段切片并统计  ")
    选(分类(), "intelligence")
    选(可见(), "personal")
    提交()
    await flush()
    await flush()

    expect(收到).toHaveLength(1)
    expect(收到[0]).toEqual({
      projectId: "p1",
      skillPath: ".opencode/skill/话单分析",
      name: "话单分析",
      description: "把话单按时间段切片并统计",
      category: "intelligence",
      visibility: "personal",
    })
  })

  test("名称预填自条目，且可改", async () => {
    const 收到 = await 打开({ 条: { kind: "local", name: "原名", skillPath: "x" } })

    expect(名称().value).toBe("原名")
    填(名称(), "改过的名字")
    await 填齐()
    提交()
    await flush()
    await flush()

    expect(收到[0]?.name).toBe("改过的名字")
  })

  /**
   * 服务端算不出 `skillPath` 时（Task 6.5 的「缺席」），表单**不能假装能提交**：
   * 路径是接口必填，猜一个等于替服务端编落点。
   */
  test("没有 skillPath ⇒ 说清楚为什么不能提交，且禁用确定", async () => {
    await 打开({ 条: { kind: "local", name: "没路径的" } })

    填(描述(), "有描述")
    选(分类(), "intelligence")
    选(可见(), "personal")

    expect(确定().disabled).toBe(true)
    expect(文案("capability-submit-no-path")).toContain("目录")
  })

  /**
   * 「谁能用 = 部门」不是这个表单能填的：端点不读 `body.department`，部门取登录者档案
   * （`auth.user.dept`）。给一句只读说明，**不放**可编辑的部门输入框——那是个改了也没用的假控件。
   */
  test("可见范围选「部门」⇒ 只读提示部门取账号档案，没有部门输入框", async () => {
    await 打开()

    expect(文案("capability-submit-department-note")).toBe("")
    选(可见(), "department")

    expect(文案("capability-submit-department-note")).toContain("账号档案中的部门")
    expect(文案("capability-submit-department-note")).toContain("被拒绝")
    expect(
      document.body.querySelector("input[name='capability-submit-department'], input[name='department']"),
      "部门不可编辑，不该有输入框",
    ).toBeNull()

    // 换回别的可见范围 ⇒ 提示收掉（只在部门那一档成立）。
    选(可见(), "personal")
    expect(文案("capability-submit-department-note")).toBe("")
  })

  /**
   * 分类的三种「下拉里没有选项」形状必须分开（2026-11-01 最终修复轮）。
   *
   * `AssetCategories.rows()` 在首成功前恒 `[]`、失败也 `[]`；只看数组长度，会把
   * 「接口 500 / 断网 / 首屏还没回来」全都画成「还没有可选的分类；请联系管理员…」——
   * 把故障说成配置问题，还把人引去找管理员。三态：加载中 / 读不到（可重试）/ 真的为空。
   */
  test("分类暂时读不到 ⇒ 说「暂时读不到」并给重试，不催用户找管理员", async () => {
    let 重试 = 0
    await 打开({
      categories: [],
      categoriesError: "连接服务失败，请检查网络后重试",
      categoriesLoaded: true,
      onRetryCategories: () => {
        重试 += 1
      },
    })

    expect(文案("capability-submit-category-error")).toContain("暂时读不到")
    expect(文案("capability-submit-category-error")).toContain("连接服务失败")
    // 故障不是配置问题：不许出现「没有分类 / 联系管理员启用」那套话。
    expect(文案("capability-submit-no-category")).toBe("")
    expect(document.body.textContent ?? "").not.toContain("联系管理员启用分类")

    框("[data-slot='capability-submit-category-retry']", HTMLButtonElement).click()
    expect(重试).toBe(1)
  })

  test("分类确实为空（读到了，只是没有启用项）⇒ 仍是原来的「联系管理员」文案", async () => {
    await 打开({ categories: [], categoriesLoaded: true })

    expect(文案("capability-submit-no-category")).toContain("联系管理员")
    expect(文案("capability-submit-category-error")).toBe("")
  })

  test("分类还在读（首屏未回来）⇒ 说「正在读取」，不判成空也不催管理员", async () => {
    await 打开({ categories: [], categoriesLoaded: false })

    expect(文案("capability-submit-category-loading")).toContain("正在读取")
    expect(文案("capability-submit-no-category")).toBe("")
    expect(document.body.textContent ?? "").not.toContain("联系管理员启用分类")
  })

  test("接口回一句失败 ⇒ 弹窗不关、话就地在弹窗里", async () => {
    await 打开({ onConfirm: () => "源目录不存在或不是目录" })

    await 填齐()
    提交()
    await flush()
    await flush()

    expect(文案("capability-submit-error")).toContain("源目录不存在或不是目录")
    expect(document.body.querySelector("[data-slot='capability-submit-dialog']") !== null).toBe(true)
  })
})
