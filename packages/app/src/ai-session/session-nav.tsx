import { For, Show, createSignal } from "solid-js"
import { 索引标签, 预览文本, type 可读片段 } from "./session-nav-text"

/**
 * AI 会话的**用户输入索引 / 快速跳转**（2026-10-14，用户点名照 DeepSeek 的做法）：
 *
 * ① 右缘一列短横，**最下面那枚**＝最近的一轮（用户与模型的来回算一轮）；
 * ② 鼠标移到这一列上 ⇒ 左边弹出**索引面板**，一行一轮、写那一轮的第一句；
 * ③ 鼠标停在面板的某一行上 ⇒ 再往左弹出**那一轮的正文预览**（超出截断 ＋「…」）；
 * ④ 点某一行（或某一枚短横）⇒ 那一轮成为「当前」（短横与那一行都变强调色）并跳过去。
 *
 * ## 为什么不是复用上游那件 `MessageNav`
 *
 * `packages/session-ui/src/components/message-nav.tsx` 是个**现成的同类件**（compact 一列 tick ＋
 * hover 列表），全仓唯一调用点在 `enterprise/routes/share/[shareID].tsx`。没复用的**唯一**理由：
 * 用户要的 ③（**每一行**悬停预览）上游没有，而给它加这一条就得改上游文件——本仓第一号约束是
 * 「每次改动都要以最小化与官方合并冲突为前提」，改 `session-ui` 的核心件正是最坏的那一类。
 * ⇒ 自建一份放在 app 里，上游一个字节都不动。**取舍**：上游那份将来若改进了（比如加了预览），
 * 这里不会自动跟上，要人工对一次。
 *
 * 除此之外的两处**有意不同**：上游的 tick 是「一枚钮 24×12」，本件是「一枚钮撑满它那等分的高度」
 * （短横本身仍是一条线，但**可点/可悬停的区域是一整格**——1px 的线当热区是点不中的）；上游的
 * 高亮色是 `--icon-strong-base`（近黑），本件用**品牌强调色**（用户要「最下面那枚是蓝色」的那个
 * 「蓝色」，在本产品的设计系统里就是品牌金，见 `theme.css` 的 `--v2-background-bg-accent`）。
 *
 * ## 几何：单测断不了，判据在真栈
 *
 * 「轨有没有压住滚动条」「点一下真滚到那一轮」「轨道间距是多少」都是几何 ⇒ happy-dom 没有布局
 * 引擎（`LEARNINGS #005-07`），`session-nav.test.tsx` 只断**结构**（谁画出来了、作用对象是谁）。
 * 真判据在 `e2e/real-stack/session-nav-real.spec.ts`。
 */

/**
 * 要索引的一轮**只需要一个 id**（`#004-07`：按被调方的实际读取面把参数收窄，不搬整份 `Message`）。
 * 结构兼容 ⇒ 生产直接把 `轮次()`（`Message[]`）喂进来即可。
 */
export interface 可索引的一轮 {
  readonly id: string
}

/**
 * 那一轮没留下任何文字（只有工具块 / 文件块）时，索引行上写什么。
 *
 * 用**字面量常量**而不是 i18n 键：本仓 app 层的中文界面字面量就是这么放的（`project/project-anchor.tsx`
 * 的 `EMPTY_LABEL = "未选择项目"`）。⚠️ 这一行**不能省**——没字的那一轮仍然是个能跳过去的目标，
 * 少一行的话索引里的行号与轮次就对不上了（用户点「第 3 行」跳到了第 4 轮）。
 */
const 无文字 = "（没有文字）"

/**
 * 一枚短横占多高（px）。**这一列的总高 = 它 × 轮数**，上限是容器高的 60%（见下面 `轨高`）。
 *
 * 数是从用户给的 DeepSeek 截图里量的（那一列 5 枚刻度跨约 155px ⇒ 每枚约 28px）。**它不是
 * 布局值、是观感值**：大了那一列会稀稀拉拉，小了短横会连成一条虚线。
 */
const 每格高 = 28

export interface SessionNavProps {
  /** 要索引的轮（**用户消息**，按时间升序）。生产喂 `session-panel.tsx` 的 `轮次()`。 */
  轮次: readonly 可索引的一轮[]
  /**
   * 此刻算「当前」的那一轮的 id（短横与那一行都变强调色）。
   *
   * ⚠️ 传 **id 而不是消息对象**：对象要靠引用相等来比，而「当前轮」的算法里有一次
   * `?? 轮次().at(-1)` 的兜底——一旦哪天上游改成每帧新造消息对象，引用相等就**静默**失效
   * （界面上表现为「当前那枚永远不是最下面那枚」，不报错、不变红）。id 是稳的。
   */
  当前轮id: string | undefined
  /** 取某一轮的正文片段（生产喂 `props.data.part[消息.id]`）。**是 getter**：Solid 要读进依赖图。 */
  片段: (消息: 可索引的一轮) => readonly 可读片段[] | undefined
  /**
   * 这一列离**容器右缘**多远（px）。生产传「滚动条宽度 ＋ 一点缝」，宽度是**真栈实量**的
   * （`session-panel.tsx` 的 `滚动条宽`，`offsetWidth - clientWidth`）。
   *
   * ⚠️ **不能拍一个数**：这个偏移的整个用途就是「浮在滚动条**内侧**，不跟滚动条打架」，而
   * 滚动条的宽度是浏览器/系统的属性（win32 的 Chrome 经典滚动条约 15px，换个缩放或换套主题
   * 就不是这个数）。拍错了的表现是「短横压在滚动条上」——不报错、不变红，量了才知道
   * （`LEARNINGS #006-23` 那一族）。
   */
  右偏移: number
  /** 点某一枚短横或某一行 ⇒ 调用方负责跳过去（本件只管说「点了谁」）。 */
  on选择: (消息: 可索引的一轮) => void
}

/**
 * 一条短横。**可点区域是整格**（见文件头），线只是它中间那一条。
 *
 * ⚠️ 尺寸是**用户 2026-10-14 当场定的**（原：活跃 14×2、非活跃 12×1）：**长缩到 2/3、厚各 ＋1px**
 * ⇒ 活跃 **9×3**、非活跃 **8×2**。（14 × ⅔ ≈ 9.33，取 9——它不在 Tailwind 标度上，故两条宽度都走
 * 字面值 `w-[9px]` / `w-[8px]`；厚度 3px 同理走 `h-[3px]`，非活跃的 2px 正好是 `h-0.5`。）
 *
 * ⚠️ 宽度**不是随手取的**：右栏内容区右侧留白是 `session-panel.tsx` 的 `pr-7`（**28px**，
 * 2026-10-14 由 16px 加上来的），索引轨整列都落在这条留白里 —— 「短横压不压到正文」的判据就是
 * **它比留白窄**。两个数合起来给出**恒 17px** 的空隙（算法见 `session-panel.tsx` 的同类注释与
 * 真栈判据 ①b）。⚠️ 留白与长度是**一件事的两半**：改一处必须连另一处一起核（`#003-05`）。
 */
function 短横(props: { 活跃: boolean }) {
  return (
    <span
      data-slot="session-nav-tick-line"
      class="block rounded-full"
      classList={{
        "h-[3px] w-[9px] bg-v2-background-bg-accent": props.活跃,
        "h-0.5 w-[8px] bg-v2-icon-icon-muted": !props.活跃,
      }}
    />
  )
}

export function SessionNav(props: SessionNavProps) {
  const [悬停, set悬停] = createSignal(false)
  const [停在, set停在] = createSignal<string | undefined>()
  const [预览顶, set预览顶] = createSignal(0)

  /** 索引面板（预览盒的定位上下文）。 */
  let 板: HTMLDivElement | undefined

  /**
   * 只有一轮时不出现。判据照抄上游那件现成的（`enterprise/routes/share/[shareID].tsx`：
   * `Show when={messages().length > 1}`）——一轮的会话没有「跳回去」可言。
   */
  const 显示 = () => props.轮次.length > 1

  const 是当前 = (消息: 可索引的一轮) => 消息.id === props.当前轮id

  /** 面板里那一行写什么（`索引标签` 是纯函数，判据在 `session-nav-text.test.ts`）。 */
  const 标签 = (消息: 可索引的一轮) => 索引标签(props.片段(消息)) ?? 无文字

  /**
   * 鼠标此刻停在那一行对应的是**哪一轮**。
   *
   * 存 id 再查回对象（而不是把对象存进信号）：对象要靠引用相等，而轮次数组是外面每次刷新都可能
   * 重造的——存对象的话，一刷新就「停的那一轮不在列表里了」，预览盒会**无声**消失。
   * 查不到（轮次变了 / 那一轮被删了）就 `undefined`，正好等于「没停」。
   */
  const 停的一轮 = () => {
    const id = 停在()
    if (id === undefined) return undefined
    return props.轮次.find((消息) => 消息.id === id)
  }

  /** 预览盒里那段字。没停、或那一轮没留下文字 ⇒ `undefined`（=> 不弹一个空盒）。 */
  const 预览 = () => {
    const 消息 = 停的一轮()
    return 消息 === undefined ? undefined : 预览文本(props.片段(消息))
  }

  /**
   * 这一列多高：`每格高 × 轮数`，**上限容器高的 60%**。
   *
   * 上限不能省：会话长了是几十上百轮，不封顶的话这一列会顶到天上去、短横密成一条虚线。
   * 封顶之后每一枚仍是**等分**（`flex-1`）⇒ 轮数越多每枚越矮，但整列的观感不变。
   * ⚠️ `min()` 里那一项是**百分比**，能这么写的前提是外层（`session-panel.tsx` 新加的那层
   * `relative` 包壳）**高度确定**（`flex-1`）——换成高度 auto 的祖先，百分比会解析成 0、整列消失。
   */
  const 轨高 = () => `min(${每格高 * props.轮次.length}px, 60%)`

  /**
   * 鼠标出去了 ⇒ 面板收掉、行上的停靠也清掉。
   *
   * ⚠️ 挂在**整块**（`session-nav`）上、而面板是它的**后代**：鼠标从短横滑到面板上时
   * `mouseleave` **不会**触发（`mouseleave` 只在离开「自己及全部后代」时才算离开）⇒ 面板不会
   * 在半路上收掉，行点得中。面板要是挪成兄弟节点，滑过去那一刻就收了（`session-nav.test.tsx`
   * 里有一条专门钉这个**包含关系**）。
   */
  const 收起 = () => {
    set悬停(false)
    set停在(undefined)
  }

  /**
   * 把预览盒的纵向位置对到**那一行**的中线上。
   *
   * 量的是**相对面板**的差值（两边的 `getBoundingClientRect()` 都在同一个屏幕坐标系里，
   * 相减即可 —— 面板自己带 `-translate-y-1/2`，而 `getBoundingClientRect` 给的是**变换之后**
   * 的盒子，所以这个差是正确的，不需要再补那个位移）。
   *
   * ⚠️ 为什么非要量：预览盒是**面板**的子节点（不能是行的子节点——行的祖先里有
   * `overflow-y-auto` 的滚动区，`overflow-y` 一旦不是 visible，另一条轴也会被算成 auto
   * （CSS 规范：两轴不能一 auto 一 visible）⇒ 往外弹的预览盒会被**裁掉**）。
   * 而它又必须**对着那一行**（用户要的样子），所以只能算一次位置。
   *
   * happy-dom 里所有 `getBoundingClientRect()` 都是零矩形 ⇒ 量出来恒 0（`LEARNINGS #005-32`：
   * 零矩形是量错了对象/量不出布局，不是产品坏）。所以**对齐这件事的真判据在真栈**。
   */
  function 记预览顶(行: HTMLElement) {
    const 盒 = 板
    if (!盒) return
    const 面板盒 = 盒.getBoundingClientRect()
    const 行盒 = 行.getBoundingClientRect()
    set预览顶(行盒.top - 面板盒.top + 行盒.height / 2)
  }

  return (
    <Show when={显示()}>
      {/*
        ⚠️ `position` 与 `right` 走**行内样式**、不写类名：`right` 那个数是外面传进来的（滚动条
        宽度是量的，见 `右偏移`），两个数是一件事的两半；而类名里的定位在 happy-dom 里断不出来
        （没有样式表 ⇒ 没有布局，`LEARNINGS #005-07`），行内样式当场可断。

        高度用 `min(…)` 的百分比 ⇒ **`session-panel.tsx` 新加的那层包壳必须是 `relative` 且
        高度确定**（`flex-1 min-h-0`），否则整列会塌成 0。

        `my-auto` ＋ 上下都贴 0 ＝ **绝对定位的居中**（不用 `translate`：那一层包壳里还有别的
        绝对定位子节点，少一个变换就少一个要解释的东西）。

        ⚠️ `z-30`（2026-10-14 改；原 `z-10`）——用户实报「索引列表没在最前面一层，输入输出区域的
        内容层叠在上层、有列表数据被遮挡」。**根因不在面板自己写的 `z-20`**：宿主（`session-panel.tsx`
        里那层 `relative` 包壳）与 `session-turns` 是**兄弟**，而 `session-turns` **没有** `z-index`
        ⇒ 面板的 20/30 与外层比的是**这一层**的值；偏巧会话内容里有两处 `position: sticky;
        z-index: 20` 是**对外真 20**（`session-ui` 的 `message-part.css:1221` 工具块折叠头、
        `session-turn.css:104` 改动表头）⇒ 原来写 10，20 > 10，整个面板被那些吸顶条盖住
        （真栈实测 `elementsFromPoint` 最上面是 `collapsible-trigger`）。

        取 **30**：高于会话内容里所有常驻元素，低于真浮层。⑥ 步全仓点过一遍（按后缀筛出 `packages`
        下的样式文件、在其中找 `z-index:`）：会话这一屏里最高是 **20**（上引两处；另有 `session-review-v2.css`
        的 20 / 10），真浮层从 **50** 起（dialog / popover / hover-card 50、context-menu 100、
        menu 与 select 60、toast 与 tooltip 1000）⇒ 30 落在**没人用的那一档**：面板压得住内容、
        压不住弹窗。⚠️ `session-review.css:23` 有一条 **120**，那是**会话审查视图**的浮层，与右栏
        不同屏、不共存（本件这一列只在会话屏），故不以它为界。判据在真栈
        `e2e/real-stack/session-nav-real.spec.ts` 的「不被会话内容里的吸顶条盖住」那条。
      */}
      <div
        data-slot="session-nav"
        class="z-30 my-auto w-4"
        style={{
          position: "absolute",
          right: `${props.右偏移}px`,
          top: "0",
          bottom: "0",
          height: 轨高(),
        }}
        onMouseEnter={() => set悬停(true)}
        onMouseLeave={收起}
      >
        {/* ① 轨：一枚短横一格，从上到下就是时间顺序。 */}
        <div data-slot="session-nav-rail" class="flex h-full w-full flex-col">
          <For each={props.轮次}>
            {(消息) => (
              <button
                type="button"
                data-slot="session-nav-tick"
                data-active={是当前(消息) ? "true" : undefined}
                aria-label={标签(消息)}
                onClick={() => props.on选择(消息)}
                class="flex min-h-0 flex-1 cursor-pointer items-center justify-end border-0 bg-transparent p-0"
              >
                <短横 活跃={是当前(消息)} />
              </button>
            )}
          </For>
        </div>

        {/* ② 索引面板：悬停才出来。右缘与轨对齐 ⇒ 面板里的短横正落在轨上（用户截图里的样子）。 */}
        <Show when={悬停()}>
          <div
            ref={板}
            data-slot="session-nav-panel"
            class="absolute top-1/2 right-0 z-20 w-[280px] -translate-y-1/2 rounded-xl bg-v2-background-bg-layer-01 p-1 pr-0 shadow-[var(--v2-elevation-floating)]"
          >
            <div data-slot="session-nav-rows" class="flex max-h-[min(480px,60vh)] flex-col overflow-y-auto">
              <For each={props.轮次}>
                {(消息) => (
                  <button
                    type="button"
                    data-slot="session-nav-row"
                    data-active={是当前(消息) ? "true" : undefined}
                    onClick={() => props.on选择(消息)}
                    onMouseEnter={(事件) => {
                      set停在(消息.id)
                      记预览顶(事件.currentTarget)
                    }}
                    onMouseLeave={() => set停在((现在) => (现在 === 消息.id ? undefined : 现在))}
                    class="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-2 pl-2 text-left hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    <span
                      data-slot="session-nav-row-label"
                      class="min-w-0 flex-1 truncate text-sm"
                      classList={{
                        "text-v2-text-text-accent": 是当前(消息),
                        "text-v2-text-text-muted": !是当前(消息),
                      }}
                    >
                      {标签(消息)}
                    </span>
                    {/* 这一格 `w-4` ＋ 面板 `pr-0` ⇒ **面板里的短横与轨上的短横同一条 x**（用户给的
                        截图里就是这个样子：面板像从那条轨上展开的）。改这里要连面板的 `pr-0` 一起看。 */}
                    <span class="flex w-4 shrink-0 justify-end">
                      <短横 活跃={是当前(消息)} />
                    </span>
                  </button>
                )}
              </For>
            </div>

            {/* ③ 预览：停在某一行的**正文**（不是它的首行），超出截断 ＋「…」。
                `keyed` ⇒ 子函数拿到的是**那个值**、不是 getter，不必求两次（也免得两次取到不同值）。 */}
            <Show when={预览()} keyed>
              {(文字) => (
                <div
                  data-slot="session-nav-preview"
                  style={{ top: `${预览顶()}px` }}
                  class="absolute right-full z-30 mr-2 w-[200px] -translate-y-1/2 rounded-lg bg-v2-background-bg-layer-01 p-2 text-xs leading-5 whitespace-pre-wrap text-v2-text-text-base shadow-[var(--v2-elevation-floating)]"
                >
                  {文字}
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
