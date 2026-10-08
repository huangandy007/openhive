import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { ThreePane } from "./three-pane"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

describe("ThreePane 三栏骨架", () => {
  test("左右槽位有内容时渲染三栏，宽度按 DESIGN.md §4.1", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))

    const left = host.querySelector<HTMLElement>('[data-slot="three-pane-left"]')
    const center = host.querySelector('[data-slot="three-pane-center"]')
    const right = host.querySelector<HTMLElement>('[data-slot="three-pane-right"]')

    expect(left?.style.width).toBe("280px")
    expect(right?.style.width).toBe("360px")
    expect(center).not.toBeNull()
  })

  test("未提供左右槽位时只渲染中栏", () => {
    const host = mount(() => (
      <ThreePane>
        <div>中栏</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')).toBeNull()
    expect(host.querySelector('[data-slot="three-pane-right"]')).toBeNull()
    expect(host.querySelector('[data-slot="three-pane-center"]')).not.toBeNull()
  })

  test("拖动左栏手柄改宽度，并夹在 160px ~ 视口 50%（DESIGN.md §4.1）", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const handle = host.querySelector('[data-component="resize-handle"]')!
    const width = () => host.querySelector<HTMLElement>('[data-slot="three-pane-left"]')!.style.width

    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }))
    expect(width()).toBe("380px") // 280 + 100

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }))
    expect(width()).toBe("160px") // 夹下限

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000 }))
    expect(width()).toBe(`${Math.round(window.innerWidth * 0.5)}px`) // 夹上限 = 视口 50%

    document.dispatchEvent(new MouseEvent("mouseup"))
  })

  test("拖动右栏手柄改宽度，并夹在 240px ~ 视口 2/3（DESIGN.md §4.1）", () => {
    const host = mount(() => (
      <ThreePane right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const handle = host.querySelector('[data-component="resize-handle"]')!
    const width = () => host.querySelector<HTMLElement>('[data-slot="three-pane-right"]')!.style.width

    // 右栏手柄在其左沿：向左拖 = 变宽
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 500, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }))
    expect(width()).toBe("460px") // 360 + 100

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000 }))
    expect(width()).toBe("240px") // 夹下限

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -5000 }))
    expect(width()).toBe(`${Math.round((window.innerWidth * 2) / 3)}px`) // 夹上限 = 视口 2/3

    document.dispatchEvent(new MouseEvent("mouseup"))
  })

  // 注：本条不是 RED 驱动的，是事后补的「测试强度」断言——上面几条只验证栏的存在与宽度，
  // 若左右接线互换也照样全绿。槽位归属必须自己钉住。
  test("槽位内容各归其位：left → 左栏，children → 中栏，right → 右栏", () => {
    const host = mount(() => (
      <ThreePane left={<div>左内容</div>} right={<div>右内容</div>}>
        <div>中内容</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')?.textContent).toBe("左内容")
    expect(host.querySelector('[data-slot="three-pane-center"]')?.textContent).toBe("中内容")
    expect(host.querySelector('[data-slot="three-pane-right"]')?.textContent).toBe("右内容")
  })

  test("折叠某栏时该栏与其手柄一起让位，不影响另一栏", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>} leftCollapsed>
        <div>中栏</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')).toBeNull()
    expect(host.querySelectorAll('[data-component="resize-handle"]')).toHaveLength(1)
    expect(host.querySelector('[data-slot="three-pane-right"]')).not.toBeNull()
    expect(host.querySelector('[data-slot="three-pane-center"]')).not.toBeNull()
  })

  /**
   * 手柄的定位祖先**只能是它拖的那一栏**，不能是整个三栏容器。
   *
   * `resize-handle.css` 给手柄写死 `position: absolute`，而且只用**包含块的边缘**定位
   * （`inset-inline-end: 0`；`[data-edge="start"]` 时换成 `inset-inline-start: 0`）——
   * 手柄自己**不按 `size` 做偏移**（`size` 只参与拖拽算数，见 `resize-handle.tsx`）。
   * 所以「手柄落在哪条线上」完全由包含块决定：包含块若是整具三栏容器，左栏手柄会跑到容器
   * **最右边**、右栏手柄跑到**最左边**（压住图标栏）——手柄与它要拖的那条缝分家，
   * 用户在缝上按下去拖不动。
   *
   * happy-dom 没有 CSS 引擎、量不到几何，故只能钉住这条**结构不变量**：手柄与它拖的那一栏
   * **共处一个带定位的包裹**，且那个包裹里**没有别栏**——于是包裹的边界就是那一栏的边界。
   *
   * ⚠️ **这条挡的是「形状」，不是「像素」**——别把它当「手柄位置已验证」。②那条尤其脆：
   * 把 `class="relative"` 换成 `style={{ position: "relative" }}`、或改用 `layout.tsx` 那种
   * 零宽包裹层，功能**一样对**、这条却会红（happy-dom 读不到 computed style，没有更好的写法）。
   * 反过来，真正会把功能弄坏的那个改法（`relative` 加回整具容器 + 手柄直接挂容器）会被
   * **③ 与 ④ 同时抓住**——那两条才是不变量的牙齿。像素级结论只能靠真实浏览器，见 state.md
   * 的「浏览器核对」欠账。
   */
  test("拖拽手柄的定位祖先只能是它拖的那一栏，不能是整个三栏容器", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const 左栏 = host.querySelector('[data-slot="three-pane-left"]')!
    const 右栏 = host.querySelector('[data-slot="three-pane-right"]')!
    const 手柄 = [...host.querySelectorAll<HTMLElement>('[data-component="resize-handle"]')]
    const 左柄 = 手柄.find((柄) => 柄.getAttribute("data-edge") === "end")!
    const 右柄 = 手柄.find((柄) => 柄.getAttribute("data-edge") === "start")!
    const 包裹 = (栏: Element) => 栏.parentElement!

    // ① 手柄与它拖的那一栏同处一个包裹（手柄是绝对定位的，不是 flex 子项，不影响包裹宽度）
    expect(左柄.parentElement === 包裹(左栏)).toBe(true)
    expect(右柄.parentElement === 包裹(右栏)).toBe(true)
    // ② 包裹必须是定位祖先，否则绝对定位的手柄会继续上溯到更外层的包含块
    expect(包裹(左栏).className).toContain("relative")
    expect(包裹(右栏).className).toContain("relative")
    // ③ 包裹里只有这一栏——掺进中栏，包裹的边界就不再是那一栏的边界了
    expect(包裹(左栏).querySelector('[data-slot="three-pane-center"]') != null).toBe(false)
    expect(包裹(右栏).querySelector('[data-slot="three-pane-center"]') != null).toBe(false)
    // ④ 两栏各用各的包裹；共用一个就等于又回到了「整具容器当祖先」
    expect(包裹(左栏) !== 包裹(右栏)).toBe(true)
  })
})

/**
 * 三栏的**视觉分层**：栏底灰（`layer-02`）、栏内一张白卡（`bg-base`）。
 *
 * 用户的要求原话是「左栏、中栏、右栏的背景色为 F2F2F2；各自的容器颜色为 FFFFFF；这样可以让
 * 左栏、中栏、右栏更好区分」。两个取值都是**既有语义 token**，不是新增：
 * - `background-bg-layer-02` 在浅色下 = `--v2-grey-200` = **#F2F2F2**（逐字相同）
 * - `background-bg-base` = **#FCFCFC**（与 #FFFFFF 差 3/255，肉眼分辨不出；换来的是**零新增
 *   token**——字面 #FFFFFF 要动 `theme.css` 两处 ＋ 重跑两个生成物，那是白给的合并面）
 * 为什么「内缩」是这条需求**成立的前提**：三栏原是紧贴的，容器满铺就 100% 盖掉栏底灰 ⇒
 * 灰一点都看不见、「更好区分」等于没做。所以内缩与卡片是**同一件事的两半**，不能只改一半。
 * （内缩原先四边各 8px，2026-10-08 第二次裁定改成**分侧**：外侧仍 8px、栏间缩到 2.5px，
 * 见下面那段注释。）
 *
 * ⚠️ happy-dom 不跑布局、也不解析 Tailwind（`LEARNINGS #005-07`）⇒ 本组能钉的**只有 class 串**：
 * 「这条类写上了」≠「这条类真的生成出来了」，更 ≠「浏览器算出来是这个色」。真颜色/真几何只能靠
 * 真浏览器（`e2e/real-stack/`）。本组是那条观测面的**形状哨兵**，不是它的替代。
 */
const 栏底灰 = "bg-v2-background-bg-layer-02"
const 卡面白 = "bg-v2-background-bg-base"
const 圆角 = "rounded-[10px]"
const 三栏 = ["left", "center", "right"] as const

/** 栏底的**纵向**内缩（上下各 8px）。用户两次裁定都没提上下，保持原值。 */
const 纵向内缩 = "py-2"

/**
 * 栏底的**分侧**内缩（2026-10-08 用户第二次裁定）。
 *
 * 要求原话：「左栏、中栏、右栏之间的间隔缩小 2/3」＋「外侧保持 8px」。原状四边各 8px
 * ⇒ 栏与栏之间 16px、外侧也是 8px。改后：
 * - **栏与栏之间**：2.5px ＋ 2.5px ≈ **5px**（16px 缩掉 2/3 剩下 1/3，与用户选定的
 *   「缩到约 5px（每侧内缩 2.5px）」逐字吻合）
 * - **外侧**（左栏贴图标栏、右栏贴窗口边）：**不缩**，仍 8px
 *
 * ⇒ 四边同值的 `p-2` 做不出这条，内缩必须分侧写。
 *
 * ⚠️ 四个类名必须**字面写全**（`pl-[8px]` 而不是 `` `pl-[${值}]` ``）：Tailwind 是**扫源码
 * 文本**找候选类的，拼出来的字符串它看不见 ⇒ 类不会生成、内缩静默消失（不报错、不变红）。
 */
const 外缝左 = "pl-[8px]"
const 外缝右 = "pr-[8px]"
const 内缝左 = "pl-[2.5px]"
const 内缝右 = "pr-[2.5px]"

/** 三栏都在时，每一栏该是哪一对缝：外侧贴边（图标栏 / 窗口边）、内侧贴邻居。 */
const 该有的缝 = {
  left: { 左: 外缝左, 右: 内缝右 },
  center: { 左: 内缝左, 右: 内缝右 },
  right: { 左: 内缝左, 右: 外缝右 },
} as const

/**
 * 手柄的**悬停反馈**（2026-10-08 用户裁定：「当鼠标移动到两栏之间的时候，除鼠标形状变化外，
 * 中间也需要有颜色的变化，让用户知道此时按下鼠标可以进行拖动」）。
 *
 * ⚠️ 上游 `resize-handle.css` 那条 `::after`（3px 条，hover 时 `opacity: 0 → 1`）**没有
 * `background`** ⇒ 不透明度拉满也是全透明。这正是「除了光标形状什么都没有」的成因。
 *
 * 修法**不动上游 CSS**（本项目第一号约束：最小化与官方的合并面）：`ResizeHandle` 透传
 * `class` / `classList`（`resize-handle.tsx` 的 `splitProps`），所以颜色从 `three-pane.tsx`
 * 这一侧给。
 *
 * 取 `border-strong`（中性灰、比上游 `session-review-v2.css` 那条先例的 `border-muted` 强一档）
 * 的理由：① `DESIGN.md` 把品牌金限定在 logo / 图标 / 高亮 / 链接 / **选中态**，hover 走中性；
 * ② 先例那条铺在**白面**上，这条铺在我们新加的 **#F2F2F2 灰缝**上——同一个 alpha 在更深的底上
 * 更看不见，而这条需求的目的恰恰是「让用户知道可以拖」。
 *
 * ⚠️ happy-dom 不解析 Tailwind ⇒ 此处只能断 class 串，**「真的有色」要真浏览器**（E2E 那条）。
 */
const 手柄悬停色 = "after:bg-v2-border-border-strong"

/** 取某个方向的手柄（`data-edge` = 它拖的那条缝在栏的哪一侧）。找不到**当场抛**，红会点名方向。 */
function 取手柄(宿主: HTMLElement, 边: "start" | "end") {
  const 找 = [...宿主.querySelectorAll<HTMLElement>('[data-component="resize-handle"]')].find(
    (节点) => 节点.getAttribute("data-edge") === 边,
  )
  if (!找) throw new Error(`找不到 edge=${边} 的拖拽手柄`)
  return 找
}

/** 取某条栏的「栏底」与「栏内白卡」两层。卡片缺失时**当场抛**——红会点名是哪一栏。 */
function 分层(宿主: HTMLElement, 槽: (typeof 三栏)[number]) {
  const 栏 = 宿主.querySelector<HTMLElement>(`[data-slot="three-pane-${槽}"]`)
  const 卡 = 宿主.querySelector<HTMLElement>(`[data-slot="three-pane-${槽}-card"]`)
  if (!栏) throw new Error(`找不到栏底 three-pane-${槽}`)
  if (!卡) throw new Error(`找不到 three-pane-${槽} 的栏内白卡`)
  return { 栏, 卡 }
}

/** 三栏都挂上的标准夹具（与上面「槽位内容各归其位」同形，便于对照）。 */
function 挂三栏() {
  return mount(() => (
    <ThreePane left={<div>左内容</div>} right={<div>右内容</div>}>
      <div>中内容</div>
    </ThreePane>
  ))
}

describe("ThreePane 视觉分层：栏底灰、栏内白卡", () => {
  /**
   * 逐栏各写一条（`#005-12`：同一个修法落在 N 处就写 N 条用例）。
   * 合成一条「三条栏都过一遍」时，只有中栏改了而左右没改，也会红在**别处**——
   * 读到的证据就不再是「哪一栏漏了」。
   */
  for (const 槽 of 三栏) {
    test(`${槽} 栏：栏底是 layer-02 灰底 ＋ 分侧内缩（外侧 8px / 内侧 2.5px），内容落在一张 bg-base 白卡里`, () => {
      const 宿主 = 挂三栏()
      const { 栏, 卡 } = 分层(宿主, 槽)
      const 缝 = 该有的缝[槽]

      expect(栏.className).toContain(栏底灰)
      expect(栏.className).toContain(纵向内缩)
      expect(栏.className).toContain(缝.左)
      expect(栏.className).toContain(缝.右)
      expect(卡.className).toContain(卡面白)
      expect(卡.className).toContain(圆角)
      // 圆角要真的裁得住：卡片里坐着的是上游/自有组件（tab 栏的灰底、会话列表的行底），
      // 不裁的话它们的方角会顶穿卡片的圆角，露出四个尖。
      expect(卡.className).toContain("overflow-hidden")
    })
  }

  /**
   * 对照：**两侧都有邻居**的中栏，两侧都必须是内缝（2.5px），一个外缝都不许有。
   *
   * 只写上面那三条正向断言时，一个「三栏四边全写死 `pl-[8px]`」的实现照样全绿——
   * 而那样栏间缝一点没缩，「缩小 2/3」静默落空。这条就是那个对照。
   */
  test("对照：两侧都有邻居时，中栏两侧都是内缝，没有一侧是外缝", () => {
    const 中 = 分层(挂三栏(), "center").栏
    expect(中.className).not.toContain(外缝左)
    expect(中.className).not.toContain(外缝右)
  })

  /**
   * 邻居**不在了**的那一侧就成了外侧 ⇒ 回到 8px（用户裁定「外侧保持 8px」）。
   *
   * 「左栏、中栏、右栏**之间**的间隔」——左栏折叠后，中栏左边就不再是「之间」、而是贴着图标栏的
   * 外侧。两条各写一条（`#005-12`：同一个判据落在两个落点上，别折成一条「两侧都过一遍」
   * ——那样一个方向漏了、红会落在别处，读到的证据不再是「哪一侧错了」）。
   */
  test("左栏折叠 ⇒ 中栏左侧回到外侧 8px（那一侧不再是「栏之间」）", () => {
    const 宿主 = mount(() => (
      <ThreePane left={<div>左</div>} leftCollapsed right={<div>右</div>}>
        <div>中</div>
      </ThreePane>
    ))
    const 中 = 分层(宿主, "center").栏
    expect(中.className).toContain(外缝左)
    expect(中.className).not.toContain(内缝左)
  })

  test("右栏折叠 ⇒ 中栏右侧回到外侧 8px（那一侧不再是「栏之间」）", () => {
    const 宿主 = mount(() => (
      <ThreePane left={<div>左</div>} right={<div>右</div>} rightCollapsed>
        <div>中</div>
      </ThreePane>
    ))
    const 中 = 分层(宿主, "center").栏
    expect(中.className).toContain(外缝右)
    expect(中.className).not.toContain(内缝右)
  })

  /**
   * 手柄的悬停反馈：**两条各写一条**（左右各一个手柄，是两个落点）。上游那条 `::after` 没有
   * 背景色，所以「有没有给颜色」只能从这一侧给；颜色类写在哪一侧、写没写全，两条分别钉住。
   */
  test("左栏手柄悬停有颜色反馈（上游 `::after` 无背景，颜色由本侧给）", () => {
    const 宿主 = mount(() => (
      <ThreePane left={<div>左</div>}>
        <div>中</div>
      </ThreePane>
    ))
    expect(取手柄(宿主, "end").className).toContain(手柄悬停色)
  })

  test("右栏手柄悬停有颜色反馈（上游 `::after` 无背景，颜色由本侧给）", () => {
    const 宿主 = mount(() => (
      <ThreePane right={<div>右</div>}>
        <div>中</div>
      </ThreePane>
    ))
    expect(取手柄(宿主, "start").className).toContain(手柄悬停色)
  })

  /**
   * 对照条（`#005-07` 第 ② 条）：把「各就各位」与「整条栏糊成一层」分开。
   *
   * 只写上面那三条正向断言时，一个**同时**把灰底与白卡铺在栏底上的改法照样全绿——
   * 而那种改法下灰底被白卡盖住，「更好区分」一点没做到。这两条反向断言就是那个对照。
   */
  test("对照：灰底与白卡各就各位——灰底不许铺在卡片上，白卡不许铺在栏底上", () => {
    const 宿主 = 挂三栏()
    for (const 槽 of 三栏) {
      const { 栏, 卡 } = 分层(宿主, 槽)
      expect(栏.className.includes(卡面白)).toBe(false)
      expect(卡.className.includes(栏底灰)).toBe(false)
    }
  })

  /**
   * 结构不变量：卡片是**栏底的直接子节点**，内容在卡片**里面**。
   *
   * 若卡片只是挂在栏底之下某处、或内容留在卡片外面，两层的底色会各自成立却互不覆盖——
   * class 串全对、画面全错。happy-dom 量不到盒子，所以这里钉的是**父子关系**这一层。
   */
  test("卡片是栏底的直接子节点；三栏的内容都落在各自卡片里", () => {
    const 宿主 = 挂三栏()
    for (const 槽 of 三栏) {
      const { 栏, 卡 } = 分层(宿主, 槽)
      expect(卡.parentElement === 栏).toBe(true)
    }
    expect(分层(宿主, "left").卡.textContent).toBe("左内容")
    expect(分层(宿主, "center").卡.textContent).toBe("中内容")
    expect(分层(宿主, "right").卡.textContent).toBe("右内容")
  })
})
