import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import type { Component } from "solid-js"

/**
 * 「看不了」的原因——**五种必须分开说**。
 *
 * 「这种格式没有预览」与「这个文件打不开」对民警是两件事：前者要换个工具打开，后者要怀疑文件本身；
 * 「文件是加密的」又是第三件——文件好好的，缺的只是密码，动作是去要密码；而「预览功能没加载出来」
 * 是**我们**这边的问题，更不该赖到文件头上。用一句「出错了」糊过去等于什么都没说
 * （US3 AC3 要的是「可提示」，不是「有个提示」）。
 *
 * 取值的视觉规范见 `openhive-DESIGN.md` §4.6（图标 / 标题 / 说明模板）。
 */
export type DegradedReason = "unsupported" | "empty" | "encrypted" | "error" | "load-failed"

interface 降级说法 {
  icon: IconProps["name"]
  title: string
  /** 说明里带上是哪个文件——民警一眼要认出「是它看不了」。 */
  detail: (name: string) => string
}

const 说法: Record<DegradedReason, 降级说法> = {
  unsupported: {
    icon: "circle-ban-sign",
    title: "这种格式暂时看不了",
    detail: (name) => `「${name}」还没有对应的预览视图。`,
  },
  empty: {
    icon: "dash",
    title: "没有取到这个文件的内容",
    detail: (name) => `没有取到「${name}」的内容。`,
  },
  encrypted: {
    // 原生图标集里没有 lock/key 一档，`shield` 是同一风险语义里最贴的一个。
    icon: "shield",
    title: "这个文件是加密的",
    detail: (name) => `「${name}」需要密码才能预览。`,
  },
  error: {
    icon: "warning",
    title: "这个文件打不开",
    detail: (name) => `「${name}」的内容读不出来，可能已经损坏。`,
  },
  "load-failed": {
    icon: "warning",
    title: "这次没能打开预览",
    detail: (name) => `打开「${name}」要用的预览功能没有加载成功，重新打开这张标签试试。`,
  },
}

export interface DegradedViewProps {
  reason: DegradedReason
  /**
   * 调用方手上认得出这份内容的那个标识——**只为让人认出「是哪个文件」**。
   * 两个调用点给的都是**末段文件名**：中栏给 tab 标题（本来就是文件名），
   * 字节型视图把自己拿到的 `path` 切出末段（`binary-view.tsx` 的 `文件名()`）——
   * 一整条路径塞进那句话只让人更看不出它说的是哪份。
   */
  name: string
}

/**
 * 降级呈现：中栏认不出格式 / 取不到内容 / 渲染失败时，替内容区说的那句话（FR-007 / US3 AC3）。
 *
 * 「不白屏」是硬要求——这一刻内容区必须说话，且要说得**是哪种**看不了。
 * 三件套是图标 + 标题 + 说明（DESIGN §4.3「状态提示配图标/文字，不只靠颜色」）。
 */
export const DegradedView: Component<DegradedViewProps> = (props) => {
  const 本次 = () => 说法[props.reason]

  return (
    <div
      data-component="degraded-view"
      data-reason={props.reason}
      class="flex min-h-40 w-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      {/* Icon 的颜色来自**祖先**提供的 `--icon-base`：`icon.css` 给图标自身写了
          `color: var(--icon-base)`，父级的 `text-v2-*` 到不了它（T009 查实，见 tab-bar 的同一做法）。 */}
      <span
        data-slot="degraded-icon"
        class="mb-1 flex items-center"
        style={{ "--icon-base": "var(--v2-icon-icon-muted)" }}
      >
        <Icon name={本次().icon} />
      </span>
      <p data-slot="degraded-title" class="text-[14px] font-[530] text-v2-text-text-base">
        {本次().title}
      </p>
      {/* 文件名是**不可信输入**（来自文件名/内容键）：走 `textContent`，永不进 HTML */}
      <p data-slot="degraded-detail" class="text-[13px] font-[440] text-v2-text-text-muted">
        {本次().detail(props.name)}
      </p>
    </div>
  )
}
