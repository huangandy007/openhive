/**
 * 「把技能卡片拖到右栏输入框」的载荷与文案（2026-10-29 用户提出）。
 *
 * 用户原话：鼠标拖技能卡片到会话输入框，在**松手那一点**插入「请使用“X”技能帮我」。
 * 2026-10-29 追加：句末带一个全角冒号「帮我：」——用户接着就在后面写要它干什么。
 *
 * ## 为什么另起一个 MIME 型，不复用 `text/plain`
 *
 * `drop-reference.ts` 那条链只认 `text/plain`：`file:` 开头当引用，其余非空文本当正文。
 * 技能句子走那条**也**能插进去，但收货方就只能靠句子形状去猜「这是技能还是剪贴板文字」——
 * 猜错了就是把用户随手拖进来的话当成技能指令。自定义型让收货方一眼认出，不必猜。
 *
 * ## 文案与载荷只有一个来源
 *
 * 起拖方（能力面板）与收货方（会话框）都从本文件取，不各写一份：
 * 两边各写一份，改一处漏一处既不报错也不变红（`#002-06`）。
 */

/** 技能卡片的拖拽载荷型。跨栏契约，两边必须写同一个。 */
export const 技能载荷型 = "application/x-openhive-skill"

/**
 * `text/plain` 上的兜底前缀。
 *
 * 为什么要兜底：历史 Chromium / 某些拖拽发起方只肯带 `text/plain`；只带自定义型的载荷
 * 在那些地方会变成「什么都没拖」的哑拖。两个都写，收货方先认自定义型、再认前缀。
 */
const 前缀 = "skill:"

/** 用户在输入框里看到的那句话。名字原样嵌进去，不 trim、不补空格。 */
export function 技能句子(名字: string): string {
  return `请使用“${名字}”技能帮我：`
}

export function 技能载荷(名字: string): string {
  return `${前缀}${名字}`
}

/**
 * 从拖拽载荷里认出一个技能名。
 *
 * `undefined` = 这不是技能载荷（文件引用、普通正文、空载荷都算）。
 * 空名字当没拖：插一句「请使用“”技能帮我：」比什么都不插更糟。
 */
export function 拖入技能(载荷: string | undefined): string | undefined {
  if (载荷 === undefined || !载荷.startsWith(前缀)) return undefined
  const 名字 = 载荷.slice(前缀.length)
  return 名字.trim() === "" ? undefined : 名字
}

/** 松手那一点落在输入框里的**字符偏移**（换行算一个字符，与 store 的 `cursor` 同一口径）。
 *
 * 用户裁定（2026-10-29）：插在**松手那一点**，不是插入前光标所在处——拖到句子中间再松手，
 * 句子就该从那中间插进去。
 *
 * ## 为什么不用 `window.getSelection()`
 *
 * 拖拽期间选区是「已被拖走的那段」或者干脆没有，不是松手点；像素→位置这一步只能问浏览器：
 * 标准是 `caretPositionFromPoint`，Chromium/Safari 老名字是 `caretRangeFromPoint`。两个都试。
 *
 * ## `undefined` 的三种来路，调用方一律退回原光标
 *
 * 量不到坐标（happy-dom 没这两个 API）、松手点根本没落在输入框里（覆盖层 / 发送按钮那一带）、
 * 或者量出来的节点不在输入框内。这一支**测不了真值**：happy-dom 里没有像素→位置，
 * 真浏览器行为要有真栈用例才验得了（已记为缺口，见计划文档）。
 */
export function 松手偏移(事件: DragEvent): number | undefined {
  const 表单 = 事件.currentTarget
  if (!(表单 instanceof HTMLElement)) return undefined
  const 编辑器 = 表单.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!编辑器) return undefined

  const 范围 = 落点范围(事件.clientX, 事件.clientY)
  if (!范围 || !编辑器.contains(范围.startContainer)) return undefined

  // 与 `session-ui` 的 `editorCursor` 同一把尺（`range.toString().length`）：同一份偏移，
  // 这里量出来的数与 store 里 `cursor` 的口径必须一致，否则插错位置。
  const 量 = document.createRange()
  量.selectNodeContents(编辑器)
  量.setEnd(范围.startContainer, 范围.startOffset)
  return 量.toString().length
}

function 落点范围(x: number, y: number): Range | undefined {
  const 文 = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof 文.caretRangeFromPoint === "function") return 文.caretRangeFromPoint(x, y) ?? undefined
  const 位 = 文.caretPositionFromPoint?.(x, y)
  if (!位) return undefined
  const 范围 = document.createRange()
  范围.setStart(位.offsetNode, 位.offset)
  范围.collapse(true)
  return 范围
}
