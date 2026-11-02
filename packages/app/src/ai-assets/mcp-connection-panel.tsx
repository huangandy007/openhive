import type { McpConnectionView } from "@opencode-ai/asset-service/mcp-connection"
import { Show, type JSX } from "solid-js"

/**
 * 详情页的 MCP 连接只读面板（2026-11-02 设计 §3.1.2）。
 *
 * **只显示键名，不显示值**：服务端已经把值换成 `MASKED_VALUE`；这里再渲染值就等于
 * 给了未来某次「忘记遮罩」的改动一个展示位。工具数与试连结果是两件事：
 * 「试连成功但工具数是 0」是合法状态，不能合并成一句话。
 */
export interface McpConnectionPanelProps {
  readonly view?: McpConnectionView
  readonly loading: boolean
  readonly error?: string
}

function 试连文案(view: McpConnectionView): string {
  if (view.checkOk === null) return "尚未试连"
  if (view.checkOk) return "成功"
  return view.checkError === "" ? "失败" : `失败：${view.checkError}`
}

function 键名文案(table: Readonly<Record<string, string>>): string {
  const keys = Object.keys(table)
  return keys.length === 0 ? "未配置" : `${keys.length} 个（值已隐藏）：${keys.join("、")}`
}

export function McpConnectionPanel(props: McpConnectionPanelProps): JSX.Element {
  return (
    <section
      data-slot="asset-detail-mcp"
      class="space-y-2 rounded-xl border border-v2-border-border-muted p-3"
    >
      <h3 class="text-[12px] font-semibold text-v2-text-text-faint">连接配置</h3>

      <Show when={props.loading}>
        <p data-slot="asset-detail-mcp-loading" class="text-[13px] text-v2-text-text-muted">
          正在读取连接配置…
        </p>
      </Show>

      {/* 判空条件要回**字符串本身**，不能只回布尔：`Show` 的 children 拿到的是 when 的值，
          传布尔就只能渲染出 `true`（等于把错误原因吞掉）——失败用例实测过这一点。 */}
      <Show when={props.error !== undefined && props.error !== "" ? props.error : undefined}>
        {(message) => (
          <p data-slot="asset-detail-mcp-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {message()}
          </p>
        )}
      </Show>

      <Show when={props.view}>
        {(view) => (
          <dl class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt class="text-v2-text-text-muted">传输方式</dt>
            <dd data-slot="asset-detail-mcp-transport" class="text-v2-text-text-base">
              {view().transport === "remote" ? "远程服务" : "本地命令"}
            </dd>

            <Show when={view().transport === "remote" ? view().url : undefined}>
              {(url) => (
                <>
                  <dt class="text-v2-text-text-muted">服务地址</dt>
                  <dd data-slot="asset-detail-mcp-url" class="break-all text-v2-text-text-base">
                    {url()}
                  </dd>
                </>
              )}
            </Show>

            <Show when={view().transport === "local" ? view().command : undefined}>
              {(command) => (
                <>
                  <dt class="text-v2-text-text-muted">启动命令</dt>
                  <dd data-slot="asset-detail-mcp-command" class="break-all text-v2-text-text-base">
                    {command().join(" ")}
                  </dd>
                </>
              )}
            </Show>

            <Show when={view().cwd}>
              {(cwd) => (
                <>
                  <dt class="text-v2-text-text-muted">工作目录</dt>
                  <dd data-slot="asset-detail-mcp-cwd" class="break-all text-v2-text-text-base">
                    {cwd()}
                  </dd>
                </>
              )}
            </Show>

            <dt class="text-v2-text-text-muted">工具数</dt>
            <dd data-slot="asset-detail-mcp-tool-count" class="text-v2-text-text-base">
              {view().toolCount === null ? "尚未试连" : `${view().toolCount} 个`}
            </dd>

            <dt class="text-v2-text-text-muted">最近试连</dt>
            <dd data-slot="asset-detail-mcp-probe" class="text-v2-text-text-base">
              {试连文案(view())}
            </dd>

            <dt class="text-v2-text-text-muted">请求头</dt>
            <dd data-slot="asset-detail-mcp-headers" class="text-v2-text-text-base">
              {键名文案(view().headers)}
            </dd>

            <dt class="text-v2-text-text-muted">环境变量</dt>
            <dd data-slot="asset-detail-mcp-environment" class="text-v2-text-text-base">
              {键名文案(view().environment)}
            </dd>
          </dl>
        )}
      </Show>
    </section>
  )
}
