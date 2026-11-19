import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import {
  createCaseIngestApi,
  type CaseIngestApi,
  type 扫描范围,
  type 扫描结果,
  type 重跑结果,
  扫描范围们,
} from "./case-ingest-api"

/**
 * 016 T017 · 扫描数量与一键重跑（`GET …/ingest/scan` + `POST …/ingest/rerun`）。
 *
 * 与 `backup-restore-dialog.tsx` 同一取向：**纯受控**——不接 `useDialog()`、自己不发请求以外
 * 不 import 模块级信号；壳由调用方挂。`api` 可注入，测试用真客户端 + 计数替身即可验证
 * 「成员点了也没发请求」。
 *
 * ## 非成员的置灰三件套（`#005-47`）
 *
 * `disabled` 只是外观；关键在**不绑 handler**——否则一次 `dispatchEvent`（真实浏览器里
 * 别的手法也能触发）就会绕过置灰。原因文案必须同屏可见，否则用户以为界面坏了。
 * 服务端仍会 403（前端只是体验，`#005-24`：不替代后端）。
 */
export interface CaseRerunDialogProps {
  readonly projectId: string
  /**
   * 能否一键重跑＝**项目成员**（契约 `ingest-api-contract.md` §3「权限：项目成员」），
   * 不是属主。非成员置灰并显示原因；服务端仍会 403（前端只是体验，`#005-24`）。
   */
  readonly 能重跑: boolean
  readonly api?: CaseIngestApi
  readonly onClose?: () => void
}

export function CaseRerunDialog(props: CaseRerunDialogProps): JSX.Element {
  let 默认api: CaseIngestApi | undefined
  const api = () => props.api ?? (默认api ??= createCaseIngestApi())

  const [扫描, set扫描] = createSignal<扫描结果>()
  const [扫描错误, set扫描错误] = createSignal<string>()
  const [重跑, set重跑] = createSignal<重跑结果>()
  const [重跑错误, set重跑错误] = createSignal<string>()
  const [忙, set忙] = createSignal(false)

  /**
   * 项目代：切项目（effect 重跑）即加一。切走前发出的重跑回包晚到时，
   * 代已变 ⇒ 丢弃，不回写到新项目的界面上（`#010-05`）。
   */
  let 请求代 = 0

  createEffect(() => {
    const 项目 = props.projectId
    const 客户端 = api()
    请求代 += 1
    set扫描(undefined)
    set扫描错误(undefined)
    set重跑(undefined)
    set重跑错误(undefined)
    // 切项目必须复位「忙」：旧项目的重跑还在途时切走，新项目的按钮不能被它拖成
    // 「正在重跑…」置灰（B5）。回包本身由 `请求代` 丢弃，复位只是界面状态。
    set忙(false)
    let 作废 = false
    // `createEffect` 不执行返回值，清理必须挂 `onCleanup`（`#005-03`）。
    onCleanup(() => {
      作废 = true
    })
    void 客户端
      .scan(项目)
      .then((结果) => {
        if (作废) return
        if (结果.kind === "error") {
          set扫描错误(结果.message)
          return
        }
        set扫描(结果.value)
      })
      // 注入的 api 若**抛**（不是回 `{kind:"error"}`），不接住会留下 unhandled rejection。
      .catch(() => {
        if (!作废) set扫描错误("扫描失败，请重试")
      })
  })

  /** 一键重跑的范围 = 扫描里非空的类（空类不提交，服务端也不必为它跑一趟）。 */
  const 范围 = createMemo<扫描范围[]>(() => {
    const 值 = 扫描()
    if (值 === undefined) return []
    return 扫描范围们.filter((类) => 值.候选[类].length > 0)
  })

  async function 执行重跑() {
    // 权限闸在**绑定处**（成员分支根本没有 handler），这里只防重入。
    if (忙()) return
    const 代 = 请求代
    const 项目 = props.projectId
    set忙(true)
    set重跑错误(undefined)
    try {
      const 结果 = await api().rerun({ projectId: 项目, 范围: 范围() })
      // 切走前发出的请求：代一变就丢弃回包，不把旧项目的结果写进新项目（`#010-05`）。
      if (代 !== 请求代) return
      if (结果.kind === "ok") {
        set重跑(结果.value)
        return
      }
      set重跑错误(结果.message)
    } catch {
      // 注入的 api 不该抛；兜底成一句话，不把异常抛回事件系统。
      if (代 === 请求代) set重跑错误("操作没办成，请重试")
    } finally {
      // 只复位自己那一代：旧项目的重跑 finally 不能清掉新项目刚置上的「忙」（B5）。
      if (代 === 请求代) set忙(false)
    }
  }

  return (
    <div
      data-slot="case-rerun-dialog"
      class="flex w-full flex-col gap-2 rounded-[6px] border border-v2-border-border-muted p-3 text-[13px] text-v2-text-text-base"
    >
      <h3 class="text-[14px] font-semibold">扫描与重跑</h3>

      <Show when={扫描错误()}>{(话) => <p class="text-v2-state-fg-danger">{话()}</p>}</Show>

      <Show when={扫描()}>
        {(值) => (
          <>
            <p data-slot="case-rerun-total">合计 {值().合计} 个候选</p>
            <p data-slot="case-rerun-counts" class="text-v2-text-text-muted">
              目录独有 {值().候选.目录独有.length} · 未入队 {值().候选.未入队.length} · 未识别{" "}
              {值().候选.未识别.length}
            </p>
            <Show when={值().截断}>
              <p data-slot="case-rerun-truncated" class="text-v2-state-fg-warning">
                候选过多，只扫描了前一批（合计 {值().合计} 个）；重跑后请再扫一次
              </p>
            </Show>
          </>
        )}
      </Show>

      <Show when={!props.能重跑}>
        <p data-slot="case-rerun-reason" class="text-v2-text-text-muted">
          需要项目成员才能一键重跑
        </p>
      </Show>

      <div class="flex items-center gap-2">
        <button
          type="button"
          data-slot="case-rerun-run"
          class="flex h-6 items-center rounded-[4px] bg-v2-button-primary-background px-2 text-[13px] text-v2-button-primary-foreground hover:bg-v2-button-primary-background-hover disabled:cursor-default disabled:opacity-50"
          disabled={!props.能重跑 || 忙() || 范围().length === 0}
          {...(props.能重跑 ? { onClick: () => void 执行重跑() } : {})}
        >
          {忙() ? "正在重跑…" : "一键重跑"}
        </button>
        <Show when={props.onClose}>
          <button
            type="button"
            data-slot="case-rerun-close"
            class="flex h-6 items-center rounded-[4px] px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => props.onClose?.()}
          >
            关闭
          </button>
        </Show>
      </div>

      <Show when={重跑错误()}>{(话) => <p class="text-v2-state-fg-danger">{话()}</p>}</Show>
      <Show when={重跑()}>
        {(值) => (
          <div data-slot="case-rerun-result" class="flex flex-col gap-1">
            <p>
              已入队 {值().已入队} · 跳过 {值().跳过.length} · 失败 {值().失败.length}
            </p>
            <Show when={值().跳过.length > 0}>
              <ul class="text-v2-text-text-muted">
                {值().跳过.map((项) => (
                  <li>
                    {项.path}：{项.原因}
                  </li>
                ))}
              </ul>
            </Show>
            <Show when={值().失败.length > 0}>
              <ul class="text-v2-state-fg-danger">
                {值().失败.map((项) => (
                  <li>
                    {项.path}：{项.原因}
                  </li>
                ))}
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
