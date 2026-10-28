import { createSignal, For, Show, type JSX } from "solid-js"
import type { 内核技能, 被覆盖技能 } from "@/ai-assets/enable-api"
import { 合并能力, 计数, type 能力条目, type 库内条目, type 自带条目 } from "./capability-source"

/**
 * 项目「能力」面板（`2026-10-27-项目能力面板-design.md`）。
 *
 * ## 三档手风琴
 *
 * 永远恰好一组展开。展开组**之前**的组收在顶部，**之后**的组贴底。
 * 点已展开的组头 ⇒ 收起自己、回到「技能」展开——这条是兜底，否则会出现三组全收起的空面板。
 *
 * ## 组头形态借自 MinIO 条（`minio-bar.tsx:130-154`）
 *
 * 13px、`muted → base` 的 hover、右侧箭头说明「再点一下会怎样」。**不借**它的默认收起：
 * 用户点这个 tab 就是来看内容的。
 *
 * ## 知识库永远不写数字
 *
 * 它不是「0 个」，是这个功能还没做——内核连它的工具映射都没有（`rbac.ts:117`）。
 * 写 `0` 等于替后端回答一个它回答不了的问题（`#002-02`）。
 *
 * ## 技能组的数字在没数时不写
 *
 * `计数()` 不区分「不知道」与 0，所以 `skills()` 为 `undefined`（从未读到 / 换过项目）时
 * 整段计数**不渲染**——兜底成 `计数(条目() ?? [])` 会把「读不到」画成「0 个」（`#002-02`）。
 */
export type 能力组 = "skill" | "knowledge" | "mcp"

const 组序: readonly 能力组[] = ["skill", "knowledge", "mcp"]
const 组名: Record<能力组, string> = { skill: "技能", knowledge: "知识库", mcp: "MCP" }

const 槽名: Record<能力组, string> = {
  skill: "capability-group-skill",
  knowledge: "capability-group-knowledge",
  mcp: "capability-group-mcp",
}

export interface CapabilityPanelProps {
  readonly hasProject: () => boolean
  readonly enabled: () => ReadonlySet<string>
  /** 项目真相（含我看不见的）。与 `enabled().size` 不等时补一行说明（设计 §6）。 */
  readonly enabledCount: () => number
  readonly skills: () => readonly 内核技能[] | undefined
  /** 服务端点名的「已启用却被同名技能盖掉」的资产；`undefined` = 这次没这个结论。 */
  readonly shadowed: () => readonly 被覆盖技能[] | undefined
  /**
   * 「这个项目的这次读到底了」（成功或失败都算）。
   *
   * 只靠 `skills()` 的 `undefined` 分不清「还在读」与「读完了但读不到」：前者该说「正在读取…」，
   * 后者必须给重试——否则面板会永远停在「正在读取」，而 `reload()` 在面板上没有第二个入口
   * （终审 I2）。
   */
  readonly readDone: () => boolean
  readonly error: () => string | undefined
  readonly busy: () => string | undefined
  readonly onToggle: (assetId: string) => void
  readonly onRetry: () => void
}

const 头 =
  "flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
const 贴底头 = `border-t border-v2-border-border-muted ${头}`
const 条目框 = "rounded-[6px] border border-v2-border-border-muted px-2 py-1.5"
const 小钮 =
  "cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

export function CapabilityPanel(props: CapabilityPanelProps): JSX.Element {
  const [展开, set展开] = createSignal<能力组>("skill")

  const 条目 = () => 合并能力({ enabled: props.enabled(), skills: props.skills(), shadowed: props.shadowed() })
  const 前面 = () => 组序.filter((组) => 组序.indexOf(组) < 组序.indexOf(展开()))
  const 后面 = () => 组序.filter((组) => 组序.indexOf(组) > 组序.indexOf(展开()))
  const 数不到 = () => props.enabledCount() - props.enabled().size

  const 点组 = (组: 能力组) => {
    // 点已展开的组 ⇒ 回技能（设计 §3 规则 3）。点别的组 ⇒ 换它展开。
    set展开(组 === 展开() ? "skill" : 组)
  }

  // `清单` 只从「已经数过」的分支传进来——这个函数不负责分辨「不知道」与 0（`#002-02`）。
  // ⚠️ 收的是 **accessor**，不是数组：数组字面值在这里是「烧死的快照」，数据一变就永远停在旧值
  //（终审 C1 实测：`setEnabled(new Set())` 后组头仍写「· 1 个」）。JSX 里的 `清单()` 会被编译器
  // 包成 getter，所以读它就是订阅。
  const 组头 = (组: 能力组, 贴底: boolean, 清单: () => readonly 能力条目[]) => (
    <button
      type="button"
      data-slot={槽名[组]}
      aria-expanded={展开() === 组}
      class={贴底 ? 贴底头 : 头}
      onClick={() => 点组(组)}
    >
      <span aria-hidden="true">◆</span>
      <span class="font-semibold">{组名[组]}</span>
      <Show when={组 === "skill"}>
        <span data-slot="capability-count-skill" class="text-v2-text-text-muted">
          · {计数(清单())} 个
        </span>
      </Show>
      <Show when={组 === "mcp"}>
        <span data-slot="capability-count-mcp" class="text-v2-text-text-muted">
          · 0 个
        </span>
      </Show>
      {/* 知识库不写数字：内核报不出它，0 是我们编的（设计 §3、`#002-02`）。 */}
      <Show when={组 === "knowledge"}>
        <span class="text-v2-text-text-muted">即将支持</span>
      </Show>
      <span class="ml-auto" aria-hidden="true">
        {展开() === 组 ? "⌄" : "›"}
      </span>
    </button>
  )

  const 自带 = (条: 自带条目) => (
    <div data-slot="capability-item-local" class={条目框}>
      <div class="flex items-center gap-1.5">
        <span aria-hidden="true">●</span>
        <span class="font-semibold">{条.name}</span>
        <span class="ml-auto text-[11px] text-v2-text-text-muted">📝 本项目自带</span>
      </div>
      <Show when={条.description}>{(说) => <p class="pl-3 text-[11px] text-v2-text-text-muted">{说()}</p>}</Show>
    </div>
  )

  const 库内 = (条: 库内条目) => (
    <div data-slot={条.loaded ? "capability-item-loaded" : "capability-item-stale"} class={条目框}>
      <div class="flex items-center gap-1.5">
        <span aria-hidden="true">{条.loaded ? "●" : "▲"}</span>
        <span class="font-semibold">{条.name}</span>
        <span class="ml-auto text-[11px] text-v2-text-text-muted">📦 资产库</span>
      </div>
      <Show
        when={条.loaded}
        fallback={
          // ② 有两种成因，说反了就是在假故障上劝用户停用（2026-10-28 真栈现场）：
          // 链接真丢了 vs 被同名技能盖掉（链接完好，内核去重时留了另一份）。
          // 槽名分开，两种文案不互相顶替，测试也断得出是哪一种。
          <Show
            when={条.覆盖者}
            fallback={
              <p data-slot="capability-stale-reason" class="pl-3 text-[11px]">
                已启用，但 AI 没加载到——项目里的快捷方式可能丢了。停用后可在资产中心重新启用。
              </p>
            }
          >
            {(盖) => (
              <p data-slot="capability-shadowed-reason" class="pl-3 text-[11px]">
                已启用，但被一份同名技能「{盖().name}」盖住了，AI 现在用的是那一份。改名或移走那份同名技能后重试。
              </p>
            )}
          </Show>
        }
      >
        <Show when={条.description}>{(说) => <p class="pl-3 text-[11px] text-v2-text-text-muted">{说()}</p>}</Show>
      </Show>
      <div class="pl-3 pt-1">
        <button
          type="button"
          data-slot="capability-disable"
          disabled={props.busy() === 条.assetId}
          class={小钮}
          onClick={() => props.onToggle(条.assetId)}
        >
          停用
        </button>
      </div>
    </div>
  )

  // ③ 自带条目**没有**操作按钮：它不是装来的，点了等于删用户的文件（设计 §4）。
  const 一条 = (条: 能力条目) => (条.kind === "local" ? 自带(条) : 库内(条))

  // 只有「真的数过」才进得来：`清单()` 一定是有值的数组，组头/条目/计数才允许出现。
  // ⚠️ 形参是 **accessor**：`Show` 的非 keyed 回调只在真假翻转时重跑，把 `清单()` 当场求值再传下去
  // 等于把数组焊死在那一刻（终审 C1）。JSX 里的 `清单()` / `<For each={清单()}>` 才是订阅点。
  const 手风琴 = (清单: () => readonly 能力条目[]) => (
    <>
      <For each={前面()}>{(组) => 组头(组, false, 清单)}</For>
      {组头(展开(), false, 清单)}

      <div class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <Show when={展开() === "skill"}>
          <Show when={数不到() > 0}>
            <p data-slot="capability-out-of-scope" class="px-1 pb-1 text-[11px] text-v2-text-text-muted">
              项目共启用 {props.enabledCount()} 个，其中 {数不到()} 个不在你的授权范围。
            </p>
          </Show>
          <Show
            when={清单().length > 0}
            fallback={<p class="px-1 py-2 text-[12px] text-v2-text-text-muted">这个项目还没有装任何技能。</p>}
          >
            <div class="flex flex-col gap-1.5">
              <For each={清单()}>{(条) => 一条(条)}</For>
            </div>
          </Show>
        </Show>

        <Show when={展开() === "knowledge"}>
          <p class="px-1 py-2 text-[12px] text-v2-text-text-muted">知识库还没有接入，接入后会出现在这里。</p>
        </Show>

        <Show when={展开() === "mcp"}>
          <p class="px-1 py-2 text-[12px] text-v2-text-text-muted">
            这个项目还没有连任何 MCP。MCP 要由管理员在治理后台登记、授权给你，才会出现在这里。
          </p>
        </Show>
      </div>

      <For each={后面()}>{(组) => 组头(组, true, 清单)}</For>
    </>
  )

  return (
    <div data-component="capability-panel" class="flex min-h-0 w-full flex-1 flex-col">
      <Show
        when={props.hasProject()}
        fallback={
          <p data-slot="capability-no-project" class="px-2 py-3 text-[13px] text-v2-text-text-muted">
            先选一个项目
          </p>
        }
      >
        {/*
          失败 ⇒ 整块只剩重试（设计 §8）。**旧数据也必须一起藏掉**：`error` 有值时
          `skills()` 可能还留着上次成功的值，而库侧这次没读到——三态判断不成立，
          照画会把每条已装技能误判成 ③「本项目自带」，组头还会写 `· 0 个`。
        */}
        {/* 判据是 `!== undefined`，不是真值：`error()` 为空串也是「有错」（设计口径），
            用真值会让 `""` 落回 fallback——旧 skills 还在时 §8 违规复活。

            「读完了但没读到」也走这一块（终审 I2）：`readDone()` 为真而 `条目()` 仍缺席，
            说明这次读有结论了——结论是「不知道」。停在「正在读取…」是没有出口的，
            面板上唯一能拨重试的地方就是下面这颗钮。 */}
        <Show
          when={props.error() !== undefined || (props.readDone() && 条目() === undefined)}
          fallback={
            // 从没读到 / 换过项目 / 正在读：一行「正在读取」，不画组头、计数、条目、重试。
            <Show
              when={条目()}
              fallback={
                <p data-slot="capability-loading" class="px-2 py-3 text-[13px] text-v2-text-text-muted">
                  正在读取…
                </p>
              }
            >
              {/* `Show` 的回调参数**本来就是** accessor：直接透传，别再 `()` 一次
                  （求了值就又把它烧成数组，C1 会原地复活）。 */}
              {(清单) => 手风琴(清单)}
            </Show>
          }
        >
          {/* 不用 children 回调：`when` 现在是布尔，回调拿到的是 `true` 而不是那句人话。 */}
          <div data-slot="capability-unreadable" class="px-2 py-2 text-[12px] text-v2-text-text-muted">
            <Show when={props.error() !== undefined}>
              <p data-slot="capability-error" class="text-v2-state-fg-danger">
                {props.error()}
              </p>
            </Show>
            <p>
              暂时读不到这个项目的技能。
              <button type="button" data-slot="capability-retry" class={小钮} onClick={() => props.onRetry()}>
                重试
              </button>
            </p>
          </div>
        </Show>
      </Show>
    </div>
  )
}
