import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import { ModelSelectorPopoverV2 } from "@/components/dialog-select-model"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"

/**
 * 右栏底栏那一颗模型选择器——**原生那颗**（`ModelSelectorPopoverV2`）。
 *
 * ## 为什么是「搬过来的」，不是「新造的」
 *
 * 它是上游 `components/prompt-input-v2.tsx:471` 那个 `PromptInputV2ModelControl`（**没导出**）
 * 的**平抄**，只做两处减法/替换，逐条写在下面。用户裁定（2026-10-11）原话是「我希望的是复用
 * （不重复造轮子）opencode 的原生功能」——所以候选列表 / 搜索 / 按 provider 分组 / 滚动 /
 * 「管理模型」这几件事**一行都没有在本仓库重写**，全部来自 `ModelSelectorPopoverV2`
 * （`components/dialog-select-model.tsx:225`）。
 *
 * ⚠️ 上游那个**非导出**函数为什么不直接复用：它的 `paid` 那一支要把未付费用户导去
 * `DialogSelectModelUnpaidV2`，而右栏这一颗是**产品自己的底栏**，没有「未付费」这个概念
 * （用户付不付费由上游那套 UI 在中栏自己管）。参数化它 = 往上游文件里加开关，那是「改」不是
 * 「加」（`CLAUDE.md` 的定制化三原则 ①）。所以：**平抄这一份到 fork 侧**，上游改那边时这一份
 * 至少要人读一遍才同步——这是刻意付的代价，换来的是**上游文件一个字不动**。
 * 另一处差别：那把 `TooltipV2` 的文案 / 快捷键（`command.model.choose`）**在右栏现取**，
 * 上游是父组件算好传进来的。
 *
 * ## 为什么搬到右栏就能用（这是本文件存在的**唯一**前提）
 *
 * `ModelSelectorPopoverV2` 不传 `model` 时效法 `useLocal().model`
 * （`dialog-select-model.tsx:280` 的 `input.model ?? useLocal().model`），而 `useLocal()` 要
 * 一整套 context。右栏原本**挂不到**它（那是设计文档 §3.2 记的「实测否决」）——把
 * `SDKProvider` ＋ `LocalProvider` 挂进右栏之后就能挂了，接线在 `ai-session-slot.tsx`。
 *
 * ⚠️ **`useLocal()` 的 `id()` 取的是 `useParams().id`**（`context/local.tsx:70`），所以
 * 「当前是哪一场会话」由**路由参数**决定；右栏虽然在 shell 层，但 `useParams()` 读的是
 * **路由器全局**的那份 params（`@solidjs/router` 0.15.4：`useParams = () => useRouter().params`，
 * 不是最近的那一层 `<Route>`）——右栏今天已经在用同一个 `useRouter()` 上的 `useLocation()`。
 * ⇒ 选中写进的是 `saved.session[<本场 id>]`，**按会话记、且落 localStorage**
 * （`context/local.tsx:264-276` 的 `write()`），正是用户裁定的「管这场会话，且记住」。
 *
 * ## 它显示什么
 *
 * `local.model.current()` 是**上游唯一那处**「该显示哪个模型」的判断
 * （`context/local.tsx:233`：本场选的 → 本场 agent 默认 → 配置/最近用过/默认）——本文件
 * **不重算**它，只把它画出来（`#002-06`：同一个判断不要两处各写一份）。
 *
 * ⚠️ 本文件**没有单测**（同 `ai-session-slot.tsx` 的口径）：`useLocal()` 要一整套目录作用域
 * context ＋ 一个活服务器才建得起来，`bun test` 里挂不起来 ⇒ 按 `#002-02` 记进缺口表
 * （`docs/superpowers/specs/006-ai-session/state.md`），判据落在真栈
 * （`e2e/real-stack/right-pane-slash-and-model-real.spec.ts` 的 T3–T7：搜索框在不在、
 * 过滤得动、列表滚得动、管理模型点得开、选中当场变 ＋ 重开页面还在）。
 */
export function 右栏模型控件(): JSX.Element {
  const local = useLocal()
  const language = useLanguage()
  const command = useCommand()

  /** 当前模型项。**在读它的地方现读**（`Show` / 正文各读一次），不先取成值冻住。 */
  const 当前 = () => local.model.current()

  return (
    <TooltipV2
      placement="top"
      gutter={4}
      value={
        <>
          {language.t("command.model.choose")}
          <KeybindV2 keys={command.keybindParts("model.choose")} variant="neutral" />
        </>
      }
    >
      <ModelSelectorPopoverV2
        model={local.model}
        trigger={(触发属性) => (
          <ButtonV2
            {...触发属性}
            variant="ghost-muted"
            size="normal"
            style={{ height: "28px" }}
            // 这几个类与上游那一颗**逐字相同**：右栏底栏与中栏底栏看起来要是同一颗钮
            // （宽窄 / 字重 / 图标透明度 / hover 时机）。
            class="min-w-0 max-w-[220px] justify-start ![font-weight:440] group"
            data-action="prompt-model"
            data-control-type="popover"
          >
            <Show when={当前()?.provider?.id}>
              {(提供方) => (
                <ProviderIcon
                  id={提供方()}
                  class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                  style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                />
              )}
            </Show>
            <span class="truncate leading-4">{当前()?.name ?? language.t("dialog.model.select.title")}</span>
            <span class="-ml-0.5 -mr-1 flex shrink-0">
              <Icon name="chevron-down" />
            </span>
          </ButtonV2>
        )}
      />
    </TooltipV2>
  )
}
