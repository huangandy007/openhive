import { For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

/**
 * 005 T020 · 「把这一项搬到哪个目录」的内联面板——**复制与移动共用**（用户裁定①）。
 *
 * ## 为什么复制 / 移动共用一个选择器，而不是各开一个
 *
 * 两项要挑的都是**同一件东西**（项目里的一个目录），挑法也一模一样；分开写就会出现两个
 * 会各自漂的清单算法（`LEARNINGS #002-06`）。复制与移动的差别只在**动作名**上，而那个差别
 * 由 `mode` 一处翻译成文案——所以它连标题都只有一份写法。
 *
 * ## 为什么是**内联面板**而不是模态
 *
 * 同 T009 的删除确认、T012 的拉回确认：树是用户眼睛已经在的地方，再叠一层跨模块的模态，
 * 还得让人多解释一步「这是在搬哪儿」。本组件因此没有焦点管理、没有 `role="dialog"`。
 *
 * ## 本组件不认识「项目」也不认识 HTTP
 *
 * 它收一份**路径清单**、回一个**目录字符串**（相对项目根，`""` ＝ 项目根）。发不出去那个请求、
 * 目标已存在怎么办，都是**调用方**的事——本组件既不知道有没有权限，也不知道服务端会不会拒。
 * 这条界线的用处是它能在无网络、无数据源的组件测试里离线跑。
 *
 * ## 可搬的目标**只有文件树里已经存在的目录**
 *
 * 服务端只搬单文件，而「往一个还不存在的目录里搬」本来也不成立（目标目录必须已经在那儿，
 * `file.ts` 会 `stat` 它）。所以清单从 `paths` 推、不给人一个「新建目录」的出口。
 */

const ROW =
  "flex h-6 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:pointer-events-none disabled:text-v2-text-text-faint"

/** 项目根那一条的显示名。**不能留空**——空按钮看着像坏了，而不是「搬到项目根」。 */
const ROOT_LABEL = "项目根目录"

export interface TargetPickerProps {
  /** 正在搬运的那一项（树给的路径）。只用来**说清楚搬的是谁**，不参与任何判断。 */
  path: string
  /** 这一次是复制还是移动。**只影响文案**——可选的目标两项完全一样。 */
  mode: "copy" | "move"
  /** 文件树里现有的全部文件路径；`undefined` ＝ 还不知道（⇒ 只剩项目根可选）。 */
  paths?: readonly string[]
  /** 事务进行中：目标与取消全禁用（防止连点发出第二个请求）。 */
  busy?: boolean
  /** 选中一个目标目录（相对项目根，`""` ＝ 项目根）。 */
  onPick: (dir: string) => void
  onCancel: () => void
}

export function TargetPicker(props: TargetPickerProps) {
  return (
    <div
      data-component="target-picker"
      role="group"
      aria-label={`选择${props.mode === "copy" ? "复制" : "移动"}目标`}
      class="flex w-full min-w-0 flex-col gap-0.5 rounded-[4px] bg-v2-background-bg-layer-01 p-0.5"
    >
      <div data-slot="target-picker-title" class="min-w-0 truncate px-1.5 py-0.5 text-[13px] text-v2-text-text-muted">
        把「<span data-slot="target-picker-source">{props.path}</span>」
        {props.mode === "copy" ? "复制到" : "移动到"}：
      </div>

      <div data-slot="target-picker-list" class="flex max-h-48 w-full min-w-0 flex-col overflow-y-auto">
        <For each={目录清单(props.paths)}>
          {(dir) => (
            <button
              data-slot="target-picker-target"
              // `""` 也照写：**选目标靠的就是这个值**，样式里那点空串的别扭换不来什么。
              data-dir={dir}
              type="button"
              class={ROW}
              disabled={props.busy === true}
              onClick={() => props.onPick(dir)}
            >
              <Icon name="folder" size="small" class="shrink-0" />
              <span class="min-w-0 truncate">{dir === "" ? ROOT_LABEL : dir}</span>
            </button>
          )}
        </For>
      </div>

      <button
        data-slot="target-picker-cancel"
        type="button"
        class={ROW}
        disabled={props.busy === true}
        onClick={() => props.onCancel()}
      >
        <Icon name="close" size="small" class="shrink-0" />
        取消
      </button>
    </div>
  )
}

/**
 * 这份清单里有哪些目录——**项目根在最前**，其余按码位序。
 *
 * 从一个文件的路径推出它**每一级**父目录（`资料/8·17/话单.csv` ⇒ `资料`、`资料/8·17`）：
 * 只列直接父目录的话，`资料` 这一级就永远搬不进去，而它在树上是看得见的。
 *
 * 归一成 `/`：清单是服务端**原样**给的（`openhive-files.ts` 刻意不归一化），win32 上是
 * `资料\8·17`。两种写法在服务端都认，但这里要**去重**——不归一会把同一个目录列成两条，
 * 其中一条的写法还跟另一条对不上（`LEARNINGS #003-07`）。
 *
 * ⚠️ 清单里还有一类**不是文件路径**的条目：**空目录**那条（`资料\`，带尾分隔符——它没有子路径
 * 可供反推，是 `openhive-files.ts` 特意补的）。它在这里**碰巧**走通：归一后切出来是
 * `["资料",""]`，`pop()` 掉的是那个**空段**，`资料` 这一级照旧被累积。不用为它加分支，
 * 但 `target-picker.test.tsx` 有一条钉住它——把 `pop()` 拿掉就会红。
 *
 * 排序用 `.sort()` 的码位序、不用 `localeCompare`：后者随机器 locale 变
 * （`file-tree.test.tsx` 实测过本机是拼音序），而这份清单要能跨机比较。
 */
export function 目录清单(paths: readonly string[] | undefined): readonly string[] {
  const 目录 = new Set<string>()
  for (const path of paths ?? []) {
    const 段 = path.replaceAll("\\", "/").split("/")
    段.pop() // 最后一段是文件名，不是目录
    let 累积 = ""
    for (const piece of 段) {
      if (!piece) continue
      累积 = 累积 ? `${累积}/${piece}` : piece
      目录.add(累积)
    }
  }
  return ["", ...[...目录].sort()]
}
