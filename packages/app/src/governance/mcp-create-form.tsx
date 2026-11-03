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
import type { AssetApi, AssetReader, CreateMcpDraftInput, McpConnectionInput } from "./asset-api"
import { AssetReaderPicker } from "./asset-reader-picker"

export type { CreateMcpDraftInput }

export interface McpCreateFormProps {
  readonly categories: readonly CategoryAdminRow[]
  /** 分类是否已经有过一次结论；省略 = 已读完。 */
  readonly categoriesLoaded?: boolean
  /** 分类接口最近一次失败的那句话；省略 = 没有错。 */
  readonly categoriesError?: string
  /** 「指定人员」选择器要用的两个读口（组清单 / 按人搜索）。 */
  readonly readerApi: Pick<AssetApi, "listGroups" | "searchReaders">
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

/** 下拉给的是裸字符串；闭集外的值不落进信号（不靠 `as` 收窄）。 */
const 是可见 = (value: string): value is CreateMcpDraftInput["visibility"] =>
  可见选项.some((项) => 项.value === value)

export function McpCreateForm(props: McpCreateFormProps): JSX.Element {
  const [名称, 设名称] = createSignal("")
  const [描述, 设描述] = createSignal("")
  const [分类, 设分类] = createSignal("")
  const [可见, 设可见] = createSignal<CreateMcpDraftInput["visibility"]>("targeted")
  const [传输, 设传输] = createSignal<"local" | "remote">("remote")
  const [地址, 设地址] = createSignal("")
  const [命令, 设命令] = createSignal("")
  const [目录, 设目录] = createSignal("")
  /**
   * 「指定人员」的授权对象（设计 §3.2.4）：MCP 能直接取数，默认就要选到人。
   *
   * 状态放在表单里、随创建一起交出去：服务端落成 `role_resource` 的 `read` 行，
   * 发布弹窗再据此预填。只把选择留在表单内存里，换个发布人就会全部丢失。
   */
  const [已选组, 设已选组] = createSignal<readonly string[]>([])
  const [已选人, 设已选人] = createSignal<readonly AssetReader[]>([])
  /**
   * 远程连接的请求头（`Authorization` 等）。逐行编辑而不是一个 JSON 输入框：
   * 民警不是开发者，键名与值分开填才不会多一层引号 / 逗号的语法。
   */
  const [请求头, 设请求头] = createSignal<readonly { readonly key: string; readonly value: string }[]>([
    { key: "", value: "" },
  ])
  const [失败话, 设失败话] = createSignal<string>()
  const [忙, 设忙] = createSignal(false)

  const 分类已读 = () => props.categoriesLoaded ?? true
  const 分类读不到 = () => props.categories.length === 0 && props.categoriesError !== undefined
  const 分类加载中 = () => props.categories.length === 0 && !分类读不到() && !分类已读()
  const 没有分类 = () => props.categories.length === 0 && !分类读不到() && !分类加载中()

  const 清错误 = () => 设失败话(undefined)

  function 切组(id: string, 选上: boolean) {
    清错误()
    设已选组((当前) => (选上 ? (当前.includes(id) ? 当前 : [...当前, id]) : 当前.filter((item) => item !== id)))
  }

  function 切人(人: AssetReader, 选上: boolean) {
    清错误()
    // 重复搜索会把同一个人以新对象再勾一次：按 id 去重，避免提交重复 id。
    设已选人((当前) =>
      选上
        ? 当前.some((item) => item.id === 人.id)
          ? 当前
          : [...当前, 人]
        : 当前.filter((item) => item.id !== 人.id),
    )
  }

  function 改请求头(index: number, 字段: "key" | "value", value: string) {
    设请求头((当前) => 当前.map((行, i) => (i === index ? { ...行, [字段]: value } : 行)))
    清错误()
  }

  function 加请求头() {
    设请求头((当前) => [...当前, { key: "", value: "" }])
  }

  function 删请求头(index: number) {
    设请求头((当前) => 当前.filter((_, i) => i !== index))
    清错误()
  }

  /** 键值表格 → 请求头对象；空行丢掉，半截行 / 重复键当场拒。 */
  function 请求头表(): Record<string, string> | string {
    const out: Record<string, string> = {}
    for (const 行 of 请求头()) {
      const key = 行.key.trim()
      const value = 行.value.trim()
      if (key === "" && value === "") continue
      if (key === "") return "请求头的键名不能为空"
      if (Object.hasOwn(out, key)) return `请求头「${key}」重复了`
      out[key] = value
    }
    return out
  }

  /** 返回连接规格或一句错误——两种传输方式共用一个出口，避免提交时两处判断漂。 */
  function 连接规格(): McpConnectionInput | string {
    if (传输() === "remote") {
      const url = 地址().trim()
      if (url === "") return "请填写服务地址"
      const headers = 请求头表()
      if (typeof headers === "string") return headers
      return { transport: "remote", url, ...(Object.keys(headers).length === 0 ? {} : { headers }) }
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
    // 「指定人员」等于「谁都不给」是不可提交的状态：与发布弹窗同一条门槛（至少一个组或一个人）。
    if (可见() === "targeted" && 已选组().length === 0 && 已选人().length === 0) {
      设失败话("请选择至少一个授权组或一名人员")
      return
    }
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
        ...(可见() === "targeted" && 已选组().length > 0 ? { groupIds: 已选组() } : {}),
        ...(可见() === "targeted" && 已选人().length > 0
          ? { userIds: 已选人().map((item) => item.id) }
          : {}),
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
            if (是可见(event.currentTarget.value)) 设可见(event.currentTarget.value)
            清错误()
          }}
          class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
        >
          <For each={可见选项}>{(项) => <option value={项.value}>{项.label}</option>}</For>
        </select>
      </label>

      <Show when={可见() === "targeted"}>
        <fieldset
          data-slot="mcp-create-readers"
          class="flex flex-col gap-2 rounded-lg border border-v2-border-border-muted px-3 py-2"
        >
          <legend class="px-1 text-[12px] text-v2-text-text-muted">授权对象（至少选一个组或一名人员）</legend>
          <AssetReaderPicker
            api={props.readerApi}
            slotPrefix="mcp-create"
            selectedGroupIds={已选组()}
            selectedUsers={已选人()}
            disabled={忙()}
            onToggleGroup={切组}
            onToggleUser={切人}
          />
        </fieldset>
      </Show>

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

        <fieldset data-slot="mcp-create-headers" class="flex flex-col gap-2">
          <legend class="text-[12px] text-v2-text-text-muted">请求头（可选）</legend>
          <p class="text-[11px] text-v2-text-text-muted">
            服务器要求鉴权时，通常填 Authorization，值形如「Bearer 令牌」。
          </p>
          <For each={请求头()}>
            {(行, index) => (
              <div class="flex items-center gap-2">
                <TextInputV2
                  class="!w-40"
                  name={`mcp-create-header-key-${index()}`}
                  aria-label="请求头名称"
                  placeholder="Authorization"
                  value={行.key}
                  onInput={(event) => 改请求头(index(), "key", event.currentTarget.value)}
                />
                <TextInputV2
                  class="!flex-1"
                  name={`mcp-create-header-value-${index()}`}
                  aria-label="请求头值"
                  placeholder="Bearer 令牌"
                  type="password"
                  value={行.value}
                  onInput={(event) => 改请求头(index(), "value", event.currentTarget.value)}
                />
                <ButtonV2
                  data-slot={`mcp-create-header-remove-${index()}`}
                  type="button"
                  variant="neutral"
                  size="small"
                  disabled={忙()}
                  onClick={() => 删请求头(index())}
                >
                  删除
                </ButtonV2>
              </div>
            )}
          </For>
          <ButtonV2
            data-slot="mcp-create-header-add"
            type="button"
            variant="neutral"
            size="small"
            disabled={忙()}
            onClick={加请求头}
          >
            添加请求头
          </ButtonV2>
        </fieldset>
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
