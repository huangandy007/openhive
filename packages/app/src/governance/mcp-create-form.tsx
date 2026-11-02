/**
 * 新建 MCP 资产的表单（2026-11-02 设计 §5.3）。
 *
 * 与 `capability-submit-dialog.tsx` 同一条分工：表单只问清楚、校验、交出去；
 * 请求与成功后刷新列表由治理页决定（表单不碰 `fetch`，组件测试离线可跑）。
 *
 * ## 为什么命令一行一个参数
 *
 * 用空格切会破坏带空格的参数（`--name=my server`）；shell 引号解析又会引入一套
 * 平台相关的规则。一行一个参数是最不容易错、也最好解释的约定。
 *
 * ## 为什么可见范围没有「仅作者」
 *
 * MCP 的 `personal` 发布在批次 3 才放开（设计 §3.2.2）。现在摆出来，管理员会建出
 * 一份**发不出去**的草稿；不摆，服务端仍接受（API 与其它入口不受影响）。
 */
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createSignal, type JSX } from "solid-js"
import type { CategoryAdminRow } from "./category-api"
import type { CreateMcpDraftInput, McpConnectionInput } from "./asset-api"

export type { CreateMcpDraftInput }

export interface McpCreateFormProps {
  readonly categories: readonly CategoryAdminRow[]
  /** 分类是否已经有过一次结论；省略 = 已读完。 */
  readonly categoriesLoaded?: boolean
  /** 分类接口最近一次失败的那句话；省略 = 没有错。 */
  readonly categoriesError?: string
  /** 回话约定：返回字符串 = 没办成（就地显示），`undefined` = 收工（父组件负责关框）。 */
  readonly onCreate: (input: CreateMcpDraftInput) => string | undefined | Promise<string | undefined>
  readonly onCancel: () => void
}

/** 一行一个参数；空行丢掉，参数内的空格原样保留。 */
export function 解析命令(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
}

const 可见选项: readonly { readonly value: CreateMcpDraftInput["visibility"]; readonly label: string }[] = [
  { value: "targeted", label: "指定人员（推荐）" },
  { value: "department", label: "本部门" },
  { value: "global", label: "全单位" },
]

export function McpCreateForm(props: McpCreateFormProps): JSX.Element {
  const [名称, 设名称] = createSignal("")
  const [描述, 设描述] = createSignal("")
  const [分类, 设分类] = createSignal("")
  const [可见, 设可见] = createSignal<CreateMcpDraftInput["visibility"]>("targeted")
  const [传输, 设传输] = createSignal<"local" | "remote">("remote")
  const [地址, 设地址] = createSignal("")
  const [命令, 设命令] = createSignal("")
  const [目录, 设目录] = createSignal("")
  const [失败话, 设失败话] = createSignal<string>()
  const [忙, 设忙] = createSignal(false)

  const 分类已读 = () => props.categoriesLoaded ?? true
  const 分类读不到 = () => props.categories.length === 0 && props.categoriesError !== undefined
  const 分类加载中 = () => props.categories.length === 0 && !分类读不到() && !分类已读()
  const 没有分类 = () => props.categories.length === 0 && !分类读不到() && !分类加载中()

  const 清错误 = () => 设失败话(undefined)

  /** 返回连接规格或一句错误——两种传输方式共用一个出口，避免提交时两处判断漂。 */
  function 连接规格(): McpConnectionInput | string {
    if (传输() === "remote") {
      const url = 地址().trim()
      if (url === "") return "请填写服务地址"
      return { transport: "remote", url }
    }
    const command = 解析命令(命令())
    if (command.length === 0) return "请填写启动命令"
    const cwd = 目录().trim()
    return { transport: "local", command, ...(cwd === "" ? {} : { cwd }) }
  }

  const 能交 = () =>
    名称().trim() !== "" &&
    描述().trim() !== "" &&
    分类() !== "" &&
    !忙() &&
    !分类加载中() &&
    props.categories.length > 0

  async function 提交() {
    if (!能交()) return
    const 连接 = 连接规格()
    if (typeof 连接 === "string") {
      设失败话(连接)
      return
    }
    设忙(true)
    设失败话(undefined)
    let 回话: string | undefined
    try {
      回话 = await props.onCreate({
        name: 名称().trim(),
        description: 描述().trim(),
        category: 分类(),
        visibility: 可见(),
        connection: 连接,
      })
    } finally {
      设忙(false)
    }
    if (typeof 回话 === "string") 设失败话(回话)
  }

  return (
    <form
      data-slot="mcp-create-form"
      class="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void 提交()
      }}
    >
      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-v2-text-text-muted">名称</span>
        <TextInputV2
          autofocus
          appearance="large"
          class="!w-full"
          name="mcp-create-name"
          aria-label="MCP 名称"
          value={名称()}
          onInput={(event) => {
            设名称(event.currentTarget.value)
            清错误()
          }}
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-v2-text-text-muted">功能描述（必填）</span>
        <TextareaV2
          class="!w-full"
          name="mcp-create-description"
          aria-label="功能描述"
          rows={2}
          value={描述()}
          onInput={(event) => {
            设描述(event.currentTarget.value)
            清错误()
          }}
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-v2-text-text-muted">分类</span>
        <select
          data-slot="mcp-create-category"
          name="mcp-create-category"
          aria-label="分类"
          disabled={忙()}
          value={分类()}
          onChange={(event) => {
            设分类(event.currentTarget.value)
            清错误()
          }}
          class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
        >
          <option value="">请选择分类</option>
          <For each={props.categories}>{(行) => <option value={行.id}>{行.name}</option>}</For>
        </select>
        <Show when={分类读不到()}>
          <p data-slot="mcp-create-category-error" class="text-[11px] text-v2-state-fg-warning">
            暂时读不到分类：{props.categoriesError}
          </p>
        </Show>
        <Show when={分类加载中()}>
          <p data-slot="mcp-create-category-loading" class="text-[11px] text-v2-text-text-muted">
            正在读取分类…
          </p>
        </Show>
        <Show when={没有分类()}>
          <p data-slot="mcp-create-no-category" class="text-[11px] text-v2-text-text-muted">
            还没有可选的分类；请先在分类管理里启用至少一个分类。
          </p>
        </Show>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-v2-text-text-muted">可见范围</span>
        <select
          data-slot="mcp-create-visibility"
          name="mcp-create-visibility"
          aria-label="可见范围"
          disabled={忙()}
          value={可见()}
          onChange={(event) => {
            设可见(event.currentTarget.value as CreateMcpDraftInput["visibility"])
            清错误()
          }}
          class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
        >
          <For each={可见选项}>{(项) => <option value={项.value}>{项.label}</option>}</For>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-v2-text-text-muted">传输方式</span>
        <select
          data-slot="mcp-create-transport"
          name="mcp-create-transport"
          aria-label="传输方式"
          disabled={忙()}
          value={传输()}
          onChange={(event) => {
            设传输(event.currentTarget.value === "local" ? "local" : "remote")
            清错误()
          }}
          class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
        >
          <option value="remote">远程服务</option>
          <option value="local">本机命令</option>
        </select>
      </label>

      <Show when={传输() === "remote"}>
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-v2-text-text-muted">服务地址</span>
          <TextInputV2
            class="!w-full"
            name="mcp-create-url"
            aria-label="服务地址"
            placeholder="https://"
            value={地址()}
            onInput={(event) => {
              设地址(event.currentTarget.value)
              清错误()
            }}
          />
        </label>
      </Show>

      <Show when={传输() === "local"}>
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-v2-text-text-muted">启动命令（一行一个参数）</span>
          <TextareaV2
            class="!w-full"
            name="mcp-create-command"
            aria-label="启动命令"
            rows={3}
            placeholder={"bun\nrun\nserver.ts"}
            value={命令()}
            onInput={(event) => {
              设命令(event.currentTarget.value)
              清错误()
            }}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-v2-text-text-muted">工作目录（可选）</span>
          <TextInputV2
            class="!w-full"
            name="mcp-create-cwd"
            aria-label="工作目录"
            value={目录()}
            onInput={(event) => {
              设目录(event.currentTarget.value)
              清错误()
            }}
          />
        </label>
      </Show>

      <Show when={失败话()}>
        {(message) => (
          <p data-slot="mcp-create-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
            {message()}
          </p>
        )}
      </Show>

      <div class="flex justify-end gap-2">
        <ButtonV2 type="button" variant="neutral" disabled={忙()} onClick={() => props.onCancel()}>
          取消
        </ButtonV2>
        <ButtonV2 data-slot="mcp-create-submit" type="submit" variant="contrast" disabled={!能交()}>
          {忙() ? "正在创建…" : "创建"}
        </ButtonV2>
      </div>
    </form>
  )
}
