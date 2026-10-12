import { createSignal } from "solid-js"

/**
 * 中栏文档的**正文档位**（2026-10-12 用户实报：「目前打开的文档，显示的文字字号较小，不适合阅读，
 * 不适合不同年龄阶段的用户阅读」）。
 *
 * 真栈实测的**改前基线**：`.md` 与 `.txt` 的正文都是 **13px ／ 行距 24px**。这 13px 不是中栏自己
 * 铺的——真栈里从正文往根上走一遍（2026-10-12 实测的链条）：`p` / `[data-component=richtext-view]`
 * 往下承的是**壳层**的 `body`（`font-size: 13px`、行距 24px），中栏那几层
 * （`[data-slot=center-pane]` / `center-split` / `three-pane`）全是**继承**。
 * 对一份要逐字读的卷宗 13px 偏小 ⇒ 这里只把「文档正文」这一档单独抬出来，默认 16px。
 *
 * ## 为什么**自成一份**，不接上游那个 `appearance.fontSize`
 *
 * 上游 `context/settings.tsx` 里有 `appearance.fontSize`（默认 14），但全仓**零读取者**——
 * 是个还没接线的空壳。挂上去等于借一个没人用的名字：将来上游给它接上真正的读取者时，
 * 我们这条会被**静默改掉**（`LEARNINGS #006-10`：一个配置项被两个用途抢占）。故开自己的档位、自己的键。
 *
 * ## 为什么自己读 localStorage，不走 `utils/persist.ts` 的 `persisted()`
 *
 * `persisted()` 要 `usePlatform()`（`utils/persist.ts:573`），而中栏视图的组件测试是**裸挂**的
 * （不挂 Provider）⇒ 用它就得给那一串用例每条加一道 provider 前提（`LEARNINGS #005-27`）。
 * 一个整数档位不值得那份耦合，故这里直接认 localStorage，缺了它也不炸
 * （与 `context/language.tsx:141` 同一个写法）。
 */

/** 五档。**有序**：`步进` 靠它找上/下一档。 */
export const 档位 = [14, 16, 18, 20, 22] as const

/**
 * 默认档 16px。挑它的两个理由：① 正文可读的通用值；② 与上游 `base.css:394` 那条
 * 「输入框小于 16px 会触发 iOS 自动缩放」同值 —— 编辑框落在这个档上，那条兜底就不再需要出手。
 */
export const 默认字号 = 16

export const 最小字号 = 档位[0]
export const 最大字号 = 档位[档位.length - 1]

/**
 * `档位` 的**数**视图：那个 `as const` 元组在 `.includes` / `.indexOf` 上会把参数收窄成字面量联合
 * （`14 | 16 | …`），于是「查一个运行时的数」就必须写类型断言。放宽成 `readonly number[]` 之后
 * 调用处干净，表本身还是同一份、顺序也还是那个顺序。
 */
const 档位表: readonly number[] = 档位

/**
 * 只认档位表里的值。盘上被人手改过 / 是上一版留下的数，就在这一层掉回默认——
 * 别把怪值铺到正文上（也**不抛**：一个存坏了的大小不该让整个视图打不开）。
 */
export function 收档(值: unknown): number {
  return typeof 值 === "number" && 档位表.includes(值) ? 值 : 默认字号
}

/**
 * 上/下一档。**到端点就停在端点**——钳制写在这里、不写在按钮上：按钮哪天被拆掉或换成快捷键，
 * 这条性质依然为真（`LEARNINGS #006-16` 的反面：守卫要能被走到，也要**不靠那个钮**才成立）。
 */
export function 步进(当前: number, 方向: -1 | 1): number {
  const 第几档 = 档位表.indexOf(收档(当前))
  const 下一档 = Math.min(Math.max(第几档 + 方向, 0), 档位表.length - 1)
  return 档位表[下一档]
}

/** 盘上那个键。**换语义就换号**，否则老值会被新语义读走。 */
const 键 = "openhive.reading-size.v1"

function 读盘(): number {
  try {
    return 收档(Number(typeof localStorage === "object" ? localStorage.getItem(键) : null))
  } catch {
    return 默认字号
  }
}

const [字号, 写字号] = createSignal(读盘())

/**
 * 此刻的档位。**全局一份**：文档的两个面（预览／编辑框）与中栏两栏共用同一个值——
 * 民警调的是「我读着舒服的字号」，不是「这一篇多大」。
 *
 * ⚠️ 模块级的 `createSignal` 没有 owner（不会被回收），与 `project/current-project.ts` 同一个写法：
 * 它活到页面卸载为止，而它本就该是这一个。
 *
 * ⚠️ 组件测试注意：这一份**跨用例活着** ⇒ 点过 `A+` 的用例必须把它还原（用 `设阅读字号(默认字号)`，
 * 盘上那份也会一起还原），否则下一条用例一进来就站在别的档位上。
 */
export const 阅读字号 = 字号

/** 设档（越界先收档）。存不上只影响**下次开界面**（隐私模式 / 配额满），本次照样生效。 */
export function 设阅读字号(值: number): void {
  const 下一 = 收档(值)
  写字号(下一)
  try {
    localStorage.setItem(键, String(下一))
  } catch {
    // 见上：存不住不是「这次没生效」，只是下次开界面会回到默认。
  }
}
