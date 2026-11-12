import { For, Show, createMemo } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { BasicTool, GenericTool } from "./basic-tool"
// 解析层在 `envelope-parse.ts`：两个模块若同名（`envelope-tool.ts` / `envelope-tool.tsx`），
// bun 的无扩展名解析偏好 `.tsx`、vite/tsc 偏好 `.ts`，同一个 import 会随运行时而漂。
import { 数据字节数, 数据行数, 解析工具输出, 是信封工具键 } from "./envelope-parse"

/** 渲染器收到的 props（`message-part.tsx` 的 `Dynamic` 传参）。 */
export interface 信封卡属性 {
  tool: string
  input?: Record<string, unknown>
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** `ui.envelopeTool.tool.<工具名>` 有译文就用；没有时 i18n 回退返回 key 本身（context/i18n.tsx:53），这时显示原名。 */
const 工具名文本 = (t: (键: string) => string, 工具: string) => {
  const 键 = `ui.envelopeTool.tool.${工具}`
  const 文本 = t(键)
  return 文本 === 键 ? 工具 : 文本
}

/** 触发器副标题：只挑几个民警看得懂的入参，不是整包 JSON。 */
function 入参摘要(input: Record<string, unknown> | undefined): string[] {
  if (!input) return []
  const 键序 = ["材料", "账户", "实体", "名称", "类型", "方向", "金额起", "金额止"]
  return 键序
    .filter((键) => input[键] !== undefined && input[键] !== null && input[键] !== "")
    .slice(0, 3)
    .map((键) => `${键}=${String(input[键])}`)
}

export function EnvelopeTool(props: 信封卡属性) {
  const i18n = useI18n()
  const 解析 = createMemo(() => 解析工具输出(props.output))
  const 信封数据 = () => {
    const 结果 = 解析()
    return 结果.种类 === "信封" ? 结果.信封 : undefined
  }

  // 错误态不在这里：`status:"error"` 的 part 由 `message-part.tsx` 的 Match 先接走（`信封错误卡`），
  // `Dynamic` 只会在非 error 时渲染本组件，此时 `props.output` 一定有值。
  return (
    <Show
      when={信封数据()}
      fallback={
        <GenericTool tool={props.tool} status={props.status} input={props.input} hideDetails={props.hideDetails} />
      }
    >
      {(信封) => (
          <BasicTool
            icon="mcp"
            status={props.status}
            hideDetails={props.hideDetails}
            defaultOpen={props.defaultOpen}
            open={props.open}
            onOpenChange={props.onOpenChange}
            trigger={{
              title: 信封().摘要,
              subtitle: 工具名文本(i18n.t, props.tool),
              args: 入参摘要(props.input),
            }}
          >
            <div data-component="envelope-tool" class="flex flex-col gap-2 px-1 pb-1">
              <Show when={信封().口径}>
                {(口径) => (
                  <div data-slot="envelope-scope" class="text-12-regular text-text-weak">
                    {i18n.t("ui.envelopeTool.scope")}：{口径()}
                  </div>
                )}
              </Show>

              <Show when={信封().空原因}>
                {(空原因) => (
                  <div
                    data-slot="envelope-empty"
                    class="rounded-[6px] border border-border-warning-base bg-surface-warning-weak px-2 py-1.5 text-13-regular text-text-base"
                  >
                    <div>
                      {i18n.t("ui.envelopeTool.emptyReason")}：{空原因()}
                    </div>
                    <Show when={信封().下一步[0]?.为什么}>
                      {(为什么) => <div class="mt-0.5 text-12-regular text-text-weak">{为什么()}</div>}
                    </Show>
                  </div>
                )}
              </Show>

              <Show when={信封().缺口.length > 0}>
                <div
                  data-slot="envelope-gaps"
                  class="rounded-[6px] border border-border-warning-base bg-surface-warning-weak px-2 py-1.5"
                >
                  <div class="text-12-regular text-text-weak">{i18n.t("ui.envelopeTool.gap")}</div>
                  <ul class="mt-0.5 flex list-disc flex-col gap-0.5 pl-4 text-13-regular text-text-base">
                    <For each={信封().缺口}>{(缺口) => <li>{缺口}</li>}</For>
                  </ul>
                </div>
              </Show>

              <div data-slot="envelope-data" class="text-12-regular text-text-weak">
                {数据行数(信封().数据) === null
                  ? i18n.t("ui.envelopeTool.object")
                  : i18n.t("ui.envelopeTool.rows", { count: 数据行数(信封().数据) as number })}
                {" · "}
                {数据字节数(信封().数据)} B
              </div>

              <Show when={信封().出处.length > 0}>
                <div data-slot="envelope-sources">
                  <div class="text-12-regular text-text-weak">{i18n.t("ui.envelopeTool.source")}</div>
                  <ul class="mt-0.5 flex flex-col gap-0.5">
                    <For each={信封().出处}>
                      {(条) => (
                        <li class="text-13-regular text-text-base">
                          {条.事实}
                          <Show when={条.代表}>
                            {(代表) => <span class="ml-1 text-12-regular text-text-weak">{代表()}</span>}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              <Show when={信封().下一步.length > 0}>
                <div data-slot="envelope-next">
                  <div class="text-12-regular text-text-weak">{i18n.t("ui.envelopeTool.next")}</div>
                  <ul class="mt-0.5 flex flex-col gap-0.5">
                    <For each={信封().下一步}>
                      {(条) => (
                        <li class="text-13-regular text-text-base">
                          {工具名文本(i18n.t, 条.工具)}
                          <Show when={条.为什么}>
                            {(为什么) => <span class="ml-1 text-12-regular text-text-weak">{为什么()}</span>}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              {/* 原始 JSON 用原生 details：键盘可展开，不需要额外组件 API，也不与 BasicTool 的 Collapsible 嵌套 */}
              <details data-slot="envelope-raw">
                <summary class="cursor-pointer text-12-regular text-text-weak">{i18n.t("ui.envelopeTool.raw")}</summary>
                <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-12-regular text-text-base">
                  {JSON.stringify(信封(), null, 2)}
                </pre>
              </details>
            </div>
          </BasicTool>
        )}
    </Show>
  )
}

export interface 错误卡属性 {
  tool: string
  /** `part().state.error`：服务端失败信封被 `convertTool` 原样 `throw` 成 Error 后的 message。 */
  文本: string
  status?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * 工具失败卡：接住 `status:"error"` 的 part（见计划「已核实的事实」里那条链路）。
 * 文本能解析成 `{error,message}` 就分「错误码 + 人话原因」显示；解析不了（传输层错误等）就原样显示。
 */
export function 信封错误卡(props: 错误卡属性) {
  const i18n = useI18n()
  const 解析 = createMemo(() => 解析工具输出(props.文本))
  const 错误 = () => {
    const 结果 = 解析()
    return 结果.种类 === "工具错误" ? 结果 : undefined
  }
  return (
    <BasicTool
      icon="warning"
      status={props.status}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={{ title: i18n.t("ui.envelopeTool.error"), subtitle: 工具名文本(i18n.t, props.tool) }}
    >
      <div
        data-slot="envelope-error"
        class="rounded-[6px] border border-border-warning-base bg-surface-warning-weak px-2 py-1.5 text-13-regular text-text-base"
      >
        <Show when={错误()}>
          {(值) => (
            <div>
              <span class="text-text-weak">{i18n.t("ui.envelopeTool.errorCode")}：</span>
              <span>{值().错误码}</span>
              <div class="mt-0.5 whitespace-pre-wrap">{值().消息}</div>
            </div>
          )}
        </Show>
        <Show when={!错误()}>
          <div class="whitespace-pre-wrap">{props.文本}</div>
        </Show>
      </div>
    </BasicTool>
  )
}

/** 接线用：`openhive-case_*` 返回信封卡，其余 `undefined`（交给 ToolRegistry / GenericTool）。 */
export function 信封渲染兜底(工具键: string) {
  return 是信封工具键(工具键) ? EnvelopeTool : undefined
}
