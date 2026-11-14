import { For, Show, type JSX } from "solid-js"
import type { 预览输出 } from "../../project/case-template-api"
import { 金额文本, 时间文本 } from "./format"

/**
 * 预览结果区（设计 §6.1）：汇总条 → 按工作表回执 → 卡片表。
 *
 * **只画服务端给的**：不重读原始行、不改写原因串——
 * 原因串就是民警调字段时的唯一线索（`#012-02`：汇总按可报告事实，别顺手对齐）。
 */
export function CardTemplatePreview(props: { readonly 结果: 预览输出; readonly 过期?: boolean }): JSX.Element {
  const 跳过项 = () => Object.entries(props.结果.跳过)
  const 跳过合计 = () => 跳过项().reduce((和, [, 数]) => 和 + 数, 0)
  return (
    <section
      data-slot="card-template-preview"
      data-expired={props.过期 === true ? "" : undefined}
      class="mt-3 flex flex-col gap-2"
      classList={{ "opacity-50": props.过期 === true }}
    >
      <p data-slot="card-template-preview-summary" class="text-[13px] text-v2-text-text-base">
        产出 <b>{props.结果.卡片数}</b> 张卡片 · 跳过 <b>{跳过合计()}</b> 行
        <Show when={跳过项().length > 0}>
          <span class="text-v2-text-text-muted">
            （{跳过项().map(([原因, 数]) => `${原因} ${数}`).join(" · ")}）
          </span>
        </Show>
      </p>
      <Show when={props.过期 === true}>
        <p data-slot="card-template-preview-expired" class="text-[12px] text-v2-state-fg-danger">
          内容已变，需重新预览
        </p>
      </Show>
      <p data-slot="card-template-preview-sheets" class="text-[12px] text-v2-text-text-muted">
        {props.结果.工作表们
          .map((表) => `${表.sheet}：${表.卡片数} 卡 · 跳过 ${Object.values(表.跳过).reduce((和, 数) => 和 + 数, 0)}`)
          .join("　｜　")}
        <span class="ml-2">每张工作表最多取前 20 行</span>
      </p>
      <div class="overflow-x-auto rounded-xl border border-v2-border-border-muted">
        <table data-slot="card-template-preview-cards" class="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr class="h-9 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-text-text-muted">
              <th class="px-3 font-semibold">摘要</th>
              <th class="px-3 font-semibold">时间</th>
              <th class="px-3 font-semibold">参与者</th>
              <th class="px-3 font-semibold">金额</th>
              <th class="px-3 font-semibold">来源</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.结果.卡片们}>
              {(卡) => (
                <tr data-slot="card-template-preview-card" class="border-b border-v2-border-border-muted last:border-b-0">
                  <td class="px-3 py-1.5">{卡.摘要}</td>
                  <td class="px-3 py-1.5 font-mono whitespace-nowrap">{时间文本(卡.occurredAt)}</td>
                  <td class="px-3 py-1.5">{卡.参与者们.map((人) => `${人.角色}：${人.提及}`).join(" · ")}</td>
                  <td class="px-3 py-1.5">{金额文本(卡.amount)}</td>
                  <td class="px-3 py-1.5 text-v2-text-text-muted">{`${卡.出处.sheet}#${卡.出处.rowNo}`}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  )
}
