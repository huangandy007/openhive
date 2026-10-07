import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { For, Show, type JSX } from "solid-js"
import type { SkillGroup } from "./projection"

/**
 * 「更多 skill」抽屉（FR-004 / US3 场景 1 / DESIGN §4.7.3）。
 *
 * **本组件只做「按 skill 分组」这一件事**（2026-10-07 裁定 U8：「最近使用」/「收藏加权」本轮不做，
 * 挂 009）。它是**受控面板**——`open` / `groups` / `onClose` 全从外面来：
 * 组从哪来（`projectCapabilities(...).drawer`）、什么时候开（入口那颗 ▸ 按钮），都不归它管。
 *
 * ## 为什么没有入口按钮
 *
 * 「▸ 更多 skill」那颗钮归 **T008**（`session-panel.tsx`）：design-v2 §8.2 与
 * `docs/superpowers/specs/2026-09-12-AI资产-design.md` 都把它画在**输入框旁边**，
 * 而输入框是 §4.7.5 的 Hero 输入 —— 也就是说，钮的位置由**容器**决定，不是由面板决定。
 * 本文件里放一颗钮就等于替 T008 提前钉死了它坐在哪。
 *
 * ## 尺寸与浮层那几格（§4.7.3）
 *
 * `absolute inset-0` 盖上的是**右栏那个容器**（§4.7.3 要求右栏 `relative`）——**不是**全屏遮罩：
 * 带 scrim 的 modal 会把中栏盖住，而民警开抽屉多半正是在看着中栏里选中的东西。
 * 圆角 10px 是「右栏内浮层唯一的一档」（§4.7.3 末条），与 §3.1「弹窗 16px」不是一档，别混。
 *
 * ⚠️ `shadow-` / `bg-` 这两处走**任意值**写法（`shadow-[…]` / `bg-[…]`）：`--v2-elevation-*` 与
 * `--v2-background-bg-accent-soft` 都**没有 Tailwind 孪生**（§4.7.0 那张表）。**把工具类前缀
 * 直接接上这两个名字**（`shadow-` ＋ 前者、`bg-` ＋ 后者）会被 `workspace/design-token-refs.test.ts`
 * 判红——那条测试扫的是**文件全文**，下面这句注释里也不能出现那种形态（`instruction-cards.tsx` 同因）。
 *
 * ⚠️ 为什么**没有**用 `app/src/components/ui/drawer.tsx`：§4.7.3 明写不采用——那套是**应用级**
 * 抽屉（自带遮罩 / 全屏 / 侧滑动画），与本组件「右栏内浮层」的定位差一个层级。
 */

export interface SkillDrawerProps {
  /** 分组后的 skill（`projectCapabilities(...).drawer`）。**顺序就是渲染顺序**，本组件不排序。 */
  groups: readonly SkillGroup[]
  open: boolean
  /** 关闭钮、以及将来 Esc / 点外部关闭的**唯一**出口——状态在调用方手里。 */
  onClose?: () => void
}

export function SkillDrawer(props: SkillDrawerProps): JSX.Element {
  return (
    <Show when={props.open}>
      <div
        data-slot="skill-drawer"
        class="absolute inset-0 flex flex-col rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
      >
        {/*
         * 头部这一行对齐原生右栏抽屉（`components/help-button.tsx`）：40px 高、底部一条
         * `border-v2-border-border-muted`、`px-4`；关闭钮是同一颗 `IconButtonV2` ＋ `xmark-small`。
         * 原生长什么样就长什么样，省掉一次「这个面板是不是野生的」的判断。
         */}
        <div class="flex h-[40px] shrink-0 items-center gap-4 border-b border-v2-border-border-muted px-4">
          <div class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted">更多 skill</div>
          <IconButtonV2
            type="button"
            size="small"
            variant="ghost-muted"
            aria-label="关闭更多 skill"
            icon={<IconV2 name="xmark-small" />}
            onClick={() => props.onClose?.()}
          />
        </div>
        <div class="relative flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-3">
          <For each={props.groups}>
            {(组) => (
              <div data-slot="skill-group" class="flex w-full flex-col gap-1">
                {/*
                 * 组标题与卡行标题（`instruction-cards.tsx` 的 `card-row-title`）是**同一档**
                 * ——§4.7.2 / §4.7.3 都写 11px muted。两处各写一份字面量是目前唯一的选择：
                 * 提成共享常量要动已经交付并审过的 T004 那个文件，而**两处今天各自都有断言钉着**
                 * ——卡行标题那侧有 `common-cards.test.tsx`（「11px 的 muted」）与
                 * `context-cards.test.tsx`（断 className 那处）两条，本侧有 `skill-drawer.test.tsx`
                 * 一条 ⇒ 改一处会红另外那几条，**不是静默可漂的镜像**
                 * （`LEARNINGS #004-02` / `#003-05`；靠的是「两侧都有断言」，**不是**靠共享常量）。
                 */}
                <div data-slot="group-title" class="text-[11px] text-v2-text-text-muted">
                  {组.group}
                </div>
                <ul class="flex w-full flex-col">
                  <For each={组.skills}>
                    {(条) => (
                      /*
                       * 条目是**两行文字、没有图标**（§4.7.3）：skill 的图标今天没有客观来源
                       * （`capabilities.ts` 的元数据里就没有这一项），配图标就是造数据。
                       * `min-h-10` = 40px，即 §4.7.3 的「行高 ≥ 40px」——**靠类名落，不靠量**：
                       * happy-dom 没有 CSS 引擎，量出来的高度恒为 0（`LEARNINGS #005-07`）。
                       */
                      <li
                        data-slot="skill-entry"
                        class="flex min-h-10 w-full flex-col justify-center gap-0.5 px-2 py-1"
                      >
                        <span data-slot="skill-entry-name" class="w-full truncate text-[13px] text-v2-text-text-base">
                          {条.name}
                        </span>
                        <span
                          data-slot="skill-entry-description"
                          class="w-full truncate text-[11px] text-v2-text-text-muted"
                        >
                          {条.description}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
