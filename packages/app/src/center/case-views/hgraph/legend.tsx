/**
 * `.hgraph` 图例（012 · T018 / 设计 08 §5.6、§8、§5.14）。
 *
 * ## 为什么放在 `<svg>` 里
 *
 * 导出（T015 / R64）只序列化 `[data-slot="hgraph-svg"]` 这一棵。图例放在 svg 外虽然
 * 画面上也看得见，但导出会丢；设计 §8 要求导出图**含图例**。所以图例是 svg 的
 * **直接子节点、viewport 之后**——固定屏幕坐标 `(12,48)`，不吃缩放/平移。纵坐标 48 是
 * R108 裁定：编辑态左上角 HTML chrome（模式/工具栏，约 y8–34）会挡住 `(12,12)` 的标题行
 * 与折叠入口，图例下移到它下方；导出不受影响（chrome 是 svg 外的 HTML）。
 *
 * ## 折叠是本地 UI 态
 *
 * 不写文件、不进撤销栈、不调动作表。`初始收起` 由外壳传入：编辑器在演示态传 `true`
 * （设计 §5.14 演示态隐藏图例），T015 的隐藏只读渲染不传 ⇒ 导出永远含**展开**图例。
 * 同一个画布实例会随演示切换保持挂载，所以 prop 变化时跟随（不是只有挂载那一次）。
 *
 * ## T013：编辑态搬到画布条
 *
 * 编辑态图例不再放画布内（FR-057），由 `editor.tsx` 的画布条渲染：外壳传 `外置`
 * 去掉 `(12,48)` 偏移，并用受控 `收起`/`收起变化` 按画布条宽（<900 折叠）驱动。
 * 导出仍走画布内嵌渲染（不传 `外置`），坐标 `(12,48)` 与文案都不变。
 */
import { Show, createEffect, createSignal, type JSX } from "solid-js"

export interface 图例Props {
  /** 初始是否收起；演示态传 `true`。后续变化也跟随（同一画布实例不重挂）。 */
  readonly 初始收起?: boolean
  /**
   * 受控收起态（T013 编辑态画布条）：给出时由外壳按画布条宽驱动，内部不再自己管开关；
   * 点击折叠/展开仍经 `收起变化` 交回外壳。省略 = 现状（自管，导出/演示沿用）。
   */
  readonly 收起?: boolean
  readonly 收起变化?: (收起: boolean) => void
  /**
   * 外置到 HTML 容器（编辑态画布条）：去掉编辑态下移 48 的偏移——那是为了避开画布内
   * 左上角 chrome，放在自带布局的条里不需要。省略 = 现状（导出仍用 `(12,48)`，R108）。
   */
  readonly 外置?: boolean
}

const 宽 = 196
const 高 = 108
const 底色 = "var(--v2-background-bg-layer-01)"
const 框色 = "var(--v2-border-border-muted)"
const 字色 = "var(--v2-text-text-base)"
const 样色 = "var(--v2-text-text-muted)"


/** 四条说明的固定顺序与文案（设计 §5.6 逐字）。 */
const 文案们 = ["线粗 = 关系强弱", "环粗 = 连接多少", "实线 = 事实，虚线 = 推断", "箭头 = 方向"]

export function 图例(props: 图例Props): JSX.Element {
  const [内部收起, set内部收起] = createSignal(props.初始收起 === true)
  // 受控时（`收起` 给出）内部状态不跟 `初始收起` 走，避免外壳的阈值被演示态信号覆盖。
  createEffect(() => {
    if (props.收起 !== undefined) return
    set内部收起(props.初始收起 === true)
  })
  const 收起 = () => props.收起 ?? 内部收起()
  const 设收起 = (值: boolean) => {
    if (props.收起 === undefined) set内部收起(值)
    props.收起变化?.(值)
  }

  return (
    <g data-slot="hgraph-legend" transform={props.外置 === true ? undefined : "translate(12 48)"}>
      <Show
        when={收起()}
        fallback={
          <>
            <rect x="0" y="0" width={宽} height={高} rx="4" fill={底色} stroke={框色} />
            <text x="10" y="17" font-size="12" fill={字色}>
              图例
            </text>
            {/* 折叠入口（纯 SVG：`<button>` 在 svg 命名空间里不合法）。 */}
            <g
              data-slot="hgraph-legend-toggle"
              role="button"
              aria-label="收起图例"
              class="cursor-pointer"
              onClick={() => 设收起(true)}
            >
              <rect x="160" y="6" width="28" height="16" rx="3" fill="transparent" />
              <text x="163" y="17" font-size="11" fill={样色}>
                收起
              </text>
            </g>

            {/* ① 线粗 = 关系强弱：1 / 2 / 4px 三条线。 */}
            <g data-slot="hgraph-legend-item">
              <line x1="10" y1="34" x2="24" y2="34" stroke={样色} stroke-width="1" />
              <line x1="28" y1="34" x2="44" y2="34" stroke={样色} stroke-width="2" />
              <line x1="48" y1="34" x2="66" y2="34" stroke={样色} stroke-width="4" />
              <text x="74" y="38" font-size="11" fill={字色}>
                {文案们[0]}
              </text>
            </g>

            {/* ② 环粗 = 连接多少：1 / 2 / 4px 三个环。 */}
            <g data-slot="hgraph-legend-item">
              <circle cx="16" cy="56" r="5" fill="none" stroke={样色} stroke-width="1" />
              <circle cx="36" cy="56" r="5" fill="none" stroke={样色} stroke-width="2" />
              <circle cx="56" cy="56" r="5" fill="none" stroke={样色} stroke-width="4" />
              <text x="74" y="60" font-size="11" fill={字色}>
                {文案们[1]}
              </text>
            </g>

            {/* ③ 实线 = 事实，虚线 = 推断。 */}
            <g data-slot="hgraph-legend-item">
              <line x1="10" y1="78" x2="28" y2="78" stroke={样色} stroke-width="2" />
              <line
                x1="34"
                y1="78"
                x2="60"
                y2="78"
                stroke={样色}
                stroke-width="2"
                stroke-dasharray="4 3"
               
              />
              <text x="74" y="82" font-size="11" fill={字色}>
                {文案们[2]}
              </text>
            </g>

            {/* ④ 箭头 = 方向。 */}
            <g data-slot="hgraph-legend-item">
              <line x1="10" y1="100" x2="52" y2="100" stroke={样色} stroke-width="2" />
              <polygon data-slot="hgraph-legend-arrow" points="60,100 52,96 52,104" fill={样色} />
              <text x="74" y="104" font-size="11" fill={字色}>
                {文案们[3]}
              </text>
            </g>
          </>
        }
      >
        <g
          data-slot="hgraph-legend-collapsed"
          role="button"
          aria-label="展开图例"
          class="cursor-pointer"
          onClick={() => 设收起(false)}
        >
          <rect x="0" y="0" width="52" height="22" rx="4" fill={底色} stroke={框色} />
          <text x="10" y="15" font-size="12" fill={字色}>
            图例
          </text>
        </g>
      </Show>
    </g>
  )
}
