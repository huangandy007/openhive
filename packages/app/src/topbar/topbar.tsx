import { Icon } from "@opencode-ai/ui/icon"
// ⚠️ v2 与 v1 是**两套独立的 sprite**，名字不通用：`grid-plus` 只在 v2 里，v1 的 `Icon` 收到它会
// 画出一个**空的**图标且**不报错**（`icons[name]` 取不到就落到占位）。故这里两个都引。
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createSignal, createUniqueId, For, Show, type JSX } from "solid-js"
import { BRAND_BADGE, BRAND_LOGO, BRAND_NAME } from "./brand"
import { toggleFullscreen } from "./fullscreen"
import { USER_MENU_ITEMS, visibleUserMenuItems } from "./menu"

/** 六边形顶点按 60° 步进程序计算（DESIGN §5.1：禁手写坐标取整）。 */
const HEX_STEPS = [0, 60, 120, 180, 240, 300]

function hexPoints(center: [number, number], radius: number) {
  return HEX_STEPS.map((step) => {
    const rad = ((step - 90) * Math.PI) / 180
    return `${center[0] + radius * Math.cos(rad)},${center[1] + radius * Math.sin(rad)}`
  }).join(" ")
}

// 与 front 的参考件同坐标系（viewBox 100×114），渲染时缩到 DESIGN §5.1 的 24×28。
const CENTER: [number, number] = [50, 57]
const OUTER_RADIUS = 50
const INNER_RADIUS = 25

/**
 * 内置六边形图形标：外等边六边形描边 + 中心实心渐变蜂窝（DESIGN §5.1）。
 *
 * 用**品牌三档金**（`theme.css` 的品牌块）而不是 accent 槽位，好让 logo 与
 * `design-reference/logo-mark.svg` 逐色对应：描边主金、蜂窝浅金→深金。颜色一律写 token，
 * 不写 hex（宪法 §八）。
 */
function BrandMark(props: { width?: number; height?: number }) {
  const gradientId = `openhive-brand-${createUniqueId()}`
  return (
    <svg
      data-slot="topbar-brand-mark"
      viewBox="0 0 100 114"
      width={props.width ?? 24}
      height={props.height ?? 28}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--v2-brand-gold-light)" />
          <stop offset="1" stop-color="var(--v2-brand-gold-deep)" />
        </linearGradient>
      </defs>
      <polygon points={hexPoints(CENTER, OUTER_RADIUS)} stroke="var(--v2-brand-gold)" stroke-width={9} />
      <polygon points={hexPoints(CENTER, INNER_RADIUS)} fill={`url(#${gradientId})`} />
    </svg>
  )
}

/**
 * 品牌图形标：配了图就显示那张图，没配才用内置六边形（宪法 II：换 Logo 不动组件）。
 *
 * 「没配」走的是内置件的**兜底**，不是 `<img src="">`——后者会去请求当前页面地址、
 * 渲染出一个破图；`resolveBrandLogo` 用 `undefined` 把「没配」标出来正是为了这个分岔。
 *
 * 导出 + 可传尺寸是 T015 加的：登录页要同一枚标（DESIGN §5.1 一份图形标），只是更大。
 * 尺寸省略即顶栏原尺寸（24×28），故既有调用方逐字不变。
 */
export function BrandLogo(props: { logo?: string; width?: number; height?: number }) {
  return (
    <Show when={props.logo} fallback={<BrandMark width={props.width} height={props.height} />}>
      {(地址) => (
        <img
          data-slot="topbar-brand-mark"
          src={地址()}
          width={props.width ?? 24}
          height={props.height ?? 28}
          alt=""
        />
      )}
    </Show>
  )
}

export interface TopbarUser {
  name: string
  policeId: string
  /** 仅管理员可见「用户管理」；⚠️ 界面收敛，不是鉴权（宪法 IV）。 */
  isAdmin?: boolean
}

export interface TopbarProps {
  /**
   * 已登录用户；省略 = 身份未就位（001 的常态，F2 落地前无来源），此时不渲染用户区。
   * 品牌/站内信/全屏与身份无关，照常渲染。
   */
  user?: TopbarUser
  /** 站内信未读数；省略 / 0 = 没有未读，不渲染红点。 */
  unreadCount?: number
  /** 用户下拉选中项；带出 `UserMenuItem.id`（不是显示名）。 */
  onSelect?: (id: string) => void
  /** 点站内信图标；站内信本体是新增功能，由调用方决定打开什么。 */
  onOpenMessages?: () => void
  /**
   * 品牌图形标地址；省略 = 读构建期配置 `VITE_OPENHIVE_BRAND_LOGO`（宪法 II）。
   * 两者都没有时用内置六边形。留这个入参是为了让「换 Logo」这条出参可测——
   * 生产侧走配置，不必传。
   */
  logo?: string
  /** 是否已在「主页」视图；为真时主页按钮呈按下态（与上游那颗同语义）。 */
  homeActive?: boolean
  /**
   * 点主页按钮。行为由**调用方**给（`layout-new` 传上游那句 `tabs.toggleHome`）——
   * 组件自己不碰路由，才能在单测里裸挂（同 `onOpenMessages` / `onSelect` 的约定）。
   */
  onOpenHome?: () => void
}

/**
 * 铃铛（站内信图标）：**本产品专有图标，内联在本文件里**，不进设计系统的图标集
 * （`@opencode-ai/ui/icon` 与 `@opencode-ai/ui/v2/icon` 两套都**没有** bell，2026-10-08 实测）。
 * 这么做是为了**不动上游文件**（宪法「最小化与官方合并冲突」）。
 *
 * `stroke="currentColor"`：颜色由外层 `topbar-icon` 那层的 `color` 决定（见 `TopbarIconButton`），
 * 故它跟着 hover 一起提亮，与两套图标集里的图标同一条通道。
 */
function BellIcon() {
  return (
    <svg
      data-slot="topbar-bell"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function TopbarIconButton(props: {
  slot: string
  label: string
  /**
   * 图标本体。收 `JSX.Element` 而不是图标名：三颗按钮分别用 v2 图标 / 内联铃铛 / v1 图标，
   * 一个「名字」入参表达不了这种混用，而且**传错 sprite 是静默的**（名字不通用 ⇒ 空图标）。
   */
  glyph: JSX.Element
  pressed?: boolean
  onClick?: () => void
  children?: JSX.Element
}) {
  return (
    /* 悬停提示：三颗都是「只有一枚图标」的按钮，`aria-label` 鼠标用户看不见。
       文案**就是** `props.label`（与 `aria-label` 同一个值，不再写第二份）。
       ⚠️ `TooltipV2` 会插一层自己的 `<div>`（实测），故 `shrink-0` 要由这层接过去。 */
    <TooltipV2 value={props.label} class="flex shrink-0">
      <button
        type="button"
        data-slot={props.slot}
        aria-label={props.label}
        aria-pressed={props.pressed}
        onClick={() => props.onClick?.()}
        class="group relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-v2-overlay-simple-overlay-hover"
        classList={{ "bg-v2-overlay-simple-overlay-hover": props.pressed === true }}
      >
        {/* 图标颜色必须由这层 wrapper 注入 `--icon-base`（写在按钮上的 `text-*` 到不了图标，
            原因见 `rail.tsx` 同一处注释）。未选中的档位靠类、hover 提亮才有空间。
            ⚠️ 还要**同时**给出 `color`：`--icon-base` 只有 **v1** 的 `Icon`（`[data-component="icon"]`）
            会自己去取，**v2 的 `Icon` 与内联 svg 都不会** ⇒ 少了 `[color:var(--icon-base)]`，
            那两颗会是默认文字色、且 hover 不提亮（静默、不变红）。 */}
        <span
          data-slot="topbar-icon"
          class="flex items-center [--icon-base:var(--v2-icon-icon-muted)] [color:var(--icon-base)] group-hover:[--icon-base:var(--v2-icon-icon-base)]"
        >
          {props.glyph}
        </span>
        {props.children}
      </button>
    </TooltipV2>
  )
}

/**
 * 顶栏（FR-003 / DESIGN §4.4）：品牌组在左，主页 / 站内信 / 全屏 / 用户区在右。
 *
 * 组件本身不关心落在哪——挂载由调用方 `pages/layout-new.tsx` 铺在标题栏那条上。
 *
 * ⚠️ **2026-10-08 起它不再 Portal 进上游的 `#opencode-titlebar-right`**：那一条（`data-slot=
 * "titlebar-v2"` 的整行）已被 openhive 隐掉（换掉上游的标签页 / DEV 徽标 / 主页按钮），投进去
 * 即是投进一个不可见的容器。品牌要跑到**最左**，那个注入点在最右，本来也够不到。
 */
export function Topbar(props: TopbarProps) {
  return (
    /* `data-tauri-drag-region`：本组件现在**顶掉了上游标题栏那条带子**（见 `titlebar-host.ts`），
       桌面窗口的拖拽区得有人接。样式规则在 `packages/ui/src/styles/base.css`：
       `#root *[data-tauri-drag-region] { app-region: drag }`，且**同一条规则把里面的
       `button` / `[role=button]` 等逐类重置成 `no-drag`** ⇒ 空处能拖窗、按钮照旧可点，
       与上游那条 header 的配置逐字同类。 */
    <div
      data-component="topbar"
      data-tauri-drag-region
      class="flex min-w-0 flex-1 items-center justify-between"
    >
      {/* 品牌组在最左：图形标 → 品牌名 → 品牌标签。**内部间距与调整前逐字相同**（`gap-1.5` + `pl-1`）。 */}
      <span data-slot="topbar-brand" class="flex items-center gap-1.5 pl-1">
        <BrandLogo logo={props.logo ?? BRAND_LOGO} />
        <span data-slot="topbar-brand-name" class="text-v2-text-text-base text-sm font-bold">
          {BRAND_NAME}
        </span>
        <span
          data-slot="topbar-brand-badge"
          class="rounded-md bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[11px] font-semibold text-v2-text-text-muted"
        >
          {BRAND_BADGE}
        </span>
      </span>
      {/* 操作区在最右，次序固定：主页 → 站内信 → 全屏 → 用户区。四项之间 14px（`gap-3.5`）。
          `pr-5`（20px）＝ 用户 2026-10-09 下达的「整体往左侧平移 20px」：原先用户区的右缘
          就是顶栏的右缘，四项一起顶着边。加在**这一层**（四项共处的那一层）而不是逐项加
          右间距——加一次即整体左移，`gap-3.5` 与各按钮自身一处不动。 */}
      <span data-slot="topbar-actions" class="flex items-center gap-3.5 pr-5">
        <TopbarIconButton
          slot="topbar-home"
          /* 文案 2026-10-09 按用户下达从「主页」改为「会话搜索」——那颗按钮开的是会话搜索页。
             它是**悬停提示与 `aria-label` 的同一份来源**（`TopbarIconButton` 里 `value={props.label}`
             ＋ `aria-label={props.label}`），故改这一处即两处都对，不另立第二份文案。
             ⚠️ 别去改上游那条标题栏那份（`i18n/zh.ts` 的 `home.title` → `components/titlebar.tsx`）：
             那条带子已被 CSS 隐掉（见本文件头顶那段 ＋ `pages/layout-new.tsx` 的隐藏规则），
             改了用户看不见。 */
          label="会话搜索"
          glyph={<IconV2 name="grid-plus" size="small" />}
          pressed={props.homeActive}
          onClick={() => props.onOpenHome?.()}
        />
        <TopbarIconButton
          slot="topbar-messages"
          label="站内信"
          glyph={<BellIcon />}
          onClick={() => props.onOpenMessages?.()}
        >
          <Show when={props.unreadCount}>
            {(count) => (
              /* 按参考图：**实心红圆 + 白字**，无描边（早先是红边红字）。 */
              <span
                data-slot="topbar-messages-unread"
                class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-v2-state-bg-danger px-1 text-[10px] leading-none font-semibold text-white"
              >
                {count()}
              </span>
            )}
          </Show>
        </TopbarIconButton>
        <TopbarIconButton
          slot="topbar-fullscreen"
          label="全屏"
          glyph={<Icon name="expand" size="small" />}
          onClick={() => void toggleFullscreen()}
        />
        <Show when={props.user} keyed>
          {(user) => <UserMenu user={user} onSelect={props.onSelect} />}
        </Show>
      </span>
    </div>
  )
}

/** 用户区：首字头像 + 姓名 + 警号，点击展开下拉（FR-003）。 */
function UserMenu(props: { user: TopbarUser; onSelect?: (id: string) => void }) {
  const [open, setOpen] = createSignal(false)

  // 不再自带 `ml-1`：它与右侧区另三项的间距现在统一由 `topbar-actions` 的 `gap-3.5` 给。
  return (
    <div class="relative shrink-0">
      {/* 悬停提示：这一颗显示的是**身份**（姓名 + 警号），说不出「点它会开账户菜单」，
          故按「可见内容里没有说明它做什么的词」补一层提示；文案与 `aria-label` 同源。
          `aria-expanded` 就在这颗按钮上 ⇒ 菜单一开，`TooltipV2` 的 `sync()` 会把提示压住，
          不与下拉同屏（想要的正是这条，免得两层浮层打架）。 */}
      <TooltipV2 value={`${props.user.name} 的账户菜单`}>
        <button
          type="button"
          data-slot="topbar-user"
          aria-label={`${props.user.name} 的账户菜单`}
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
          class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg py-0.5 pr-1.5 pl-0.5 transition-colors hover:bg-v2-overlay-simple-overlay-hover"
        >
          <span
            data-slot="topbar-user-avatar"
            class="flex size-6 shrink-0 items-center justify-center rounded-full border border-v2-border-border-base bg-v2-overlay-simple-overlay-hover text-xs font-semibold text-v2-icon-icon-accent"
          >
            {props.user.name.slice(0, 1)}
          </span>
          {/* 姓名与警号**左右一行**（早先是 `flex-col` 上下两行）；两段字号不同，靠 `items-center` 对齐。 */}
          <span data-slot="topbar-user-text" class="flex items-center gap-1.5">
            <span data-slot="topbar-user-name" class="text-xs font-semibold text-v2-text-text-base">
              {props.user.name}
            </span>
            <span data-slot="topbar-user-police-id" class="text-[10px] text-v2-text-text-muted">
              警号: {props.user.policeId}
            </span>
          </span>
        </button>
      </TooltipV2>
      <Show when={open()}>
        <div
          data-slot="topbar-user-menu"
          /* 下拉整体退出拖拽区：`base.css` 只把 `button` 等逐类重置成 `no-drag`，
             而这一层是 `div`——不显式退出的话，它的 `py-1` 内边距会把点按变成拖窗。 */
          class="absolute top-full right-0 z-50 mt-1 flex min-w-32 flex-col rounded-xl border border-v2-border-border-base bg-v2-background-bg-base py-1 shadow-lg [app-region:no-drag]"
        >
          <For each={visibleUserMenuItems(USER_MENU_ITEMS, props.user.isAdmin)}>
            {(item) => (
              <button
                type="button"
                data-slot="topbar-menu-item"
                onClick={() => {
                  setOpen(false)
                  props.onSelect?.(item.id)
                }}
                class="cursor-pointer px-3 py-1.5 text-left text-xs transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                classList={{
                  "text-v2-state-fg-danger": item.danger === true,
                  "text-v2-text-text-base": item.danger !== true,
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
