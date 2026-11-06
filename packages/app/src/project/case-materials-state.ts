import { createEffect, createRoot, createSignal, getOwner, onCleanup, runWithOwner, untrack } from "solid-js"
import {
  createCaseMaterialsApi,
  type CaseMaterialsApi,
  type 解析状态,
  type 材料视图,
  type 解析结果,
} from "./case-materials-api"

/**
 * 「当前项目的材料解析状态」的唯一读取点（计划 3）。
 *
 * ## 服务端权威
 *
 * 行标记、菜单亮度、目录汇总全部读 `rows()`；操作成功后只 `reload()`，**不本地改状态**。
 * 状态机的落点（排队中取消回未入队、解析中取消落有问题）只有服务端知道，前端猜一次就会漂。
 *
 * ## 旧回包按「项目 + 代次」丢弃
 *
 * 同 `enable-state.ts`：连点两次、或两个项目间来回切，回包顺序不保证。`#008-03`。
 *
 * ## 只在有活的时候轮询
 *
 * 队列是单 worker、2 秒一拍；前端 3 秒拉一次够用。没有「排队中 / 解析中」就**不排下一拍**
 * ——空闲项目不该每 3 秒发一条请求。`轮询器` 可注入：测试用手动轮询，产品用 `setTimeout`。
 */
export interface 轮询器 {
  /** 安排一次；返回取消函数。 */
  安排: (fn: () => void, ms: number) => () => void
}

const 默认轮询器: 轮询器 = {
  安排(fn, ms) {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

export interface CaseMaterialsOptions {
  readonly 轮询间隔ms?: number
  readonly 轮询器?: 轮询器
}

export interface CaseMaterials {
  readonly projectId: () => string | undefined
  readonly rows: () => readonly 材料视图[]
  readonly parseableExtensions: () => readonly string[]
  readonly loaded: () => boolean
  readonly error: () => string | undefined
  readonly bind: (读: () => string | undefined) => void
  readonly parse: (path: string, action: "入队" | "重新解析" | "取消" | "跳过") => Promise<解析结果>
  readonly reload: () => void
}

const 运行中 = (status: 解析状态) => status === "排队中" || status === "解析中"

export function createCaseMaterials(
  api: CaseMaterialsApi = createCaseMaterialsApi(),
  options: CaseMaterialsOptions = {},
): CaseMaterials {
  const 轮询器 = options.轮询器 ?? 默认轮询器
  const 间隔 = options.轮询间隔ms ?? 3000

  const [项目, set项目] = createSignal<string | undefined>()
  const [行们, set行们] = createSignal<readonly 材料视图[]>([])
  const [扩展名们, set扩展名们] = createSignal<readonly string[]>([])
  const [已读, set已读] = createSignal(false)
  const [错误, set错误] = createSignal<string | undefined>()

  let 代次 = 0
  let 停轮询: (() => void) | undefined

  const 停掉轮询 = () => {
    停轮询?.()
    停轮询 = undefined
  }

  const 清空 = () => {
    代次 += 1
    停掉轮询()
    set行们([])
    set扩展名们([])
    set已读(false)
    set错误(undefined)
  }

  const 排下一拍 = (projectId: string) => {
    停掉轮询()
    if (!行们().some((row) => 运行中(row.status))) return
    停轮询 = 轮询器.安排(() => {
      if (项目() !== projectId) return
      拉(projectId)
    }, 间隔)
  }

  /**
   * 拉一次。
   *
   * `保留错误 = true`：失败后补的那次重拉用它——刚发生的那条操作错误不能被一次成功重拉
   * 抹掉（用户还在看它），也不能被重拉自己的失败盖住（同 `enable-state.ts`）。
   */
  const 拉 = (projectId: string, 保留错误 = false) => {
    const 本次 = ++代次
    停掉轮询()
    void api
      .read(projectId)
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== projectId) return
        set已读(true)
        if (结果.kind === "ok") {
          set行们(结果.value.materials)
          set扩展名们(结果.value.parseableExtensions)
          if (!保留错误) set错误(undefined)
          排下一拍(projectId)
          return
        }
        if (!保留错误) set错误(结果.message)
      })
      .catch(() => {
        if (本次 !== 代次 || 项目() !== projectId) return
        set已读(true)
        if (!保留错误) set错误("加载解析状态失败")
      })
  }

  let 停旧: (() => void) | undefined

  const bind = (读: () => string | undefined) => {
    停旧?.()
    // 同 `enable-state.ts`：`createRoot` 会把 effect 从调用方 owner 上摘下来，必须在调用方
    // owner 上再登记一次清理，组件卸载时才拆得掉。
    const 上级 = getOwner()
    const 拆 = createRoot((dispose) => {
      // 轮询的 `setTimeout` 不在 effect 的清理域里：不显式挂一笔，组件卸载后它还会醒一次、
      // 对着已销毁的 owner 发请求。挂在**内层 root** 上，`bind` 重绑与组件卸载都会走到。
      onCleanup(停掉轮询)
      createEffect(() => {
        const 当前 = 读()
        const 换了项目 = 当前 !== untrack(项目)
        set项目(当前)
        // 换项目必须整体复位：跨项目沿用旧行会让界面把甲的状态画在乙的文件上。
        if (换了项目) 清空()
        if (当前 === undefined) return
        拉(当前)
      })
      return dispose
    })
    停旧 = 拆
    if (上级 !== null) runWithOwner(上级, () => onCleanup(拆))
  }

  const 解析 = async (path: string, action: "入队" | "重新解析" | "取消" | "跳过"): Promise<解析结果> => {
    const projectId = 项目()
    if (projectId === undefined) return { kind: "error", message: "还没有选项目" }
    return api.parse({ projectId, path, action })
  }

  const reload = () => {
    const projectId = 项目()
    if (projectId === undefined) return
    拉(projectId)
  }

  return {
    projectId: 项目,
    rows: 行们,
    parseableExtensions: 扩展名们,
    loaded: 已读,
    error: 错误,
    bind,
    parse: 解析,
    reload,
  }
}
