import { Icon, type IconProps } from "@opencode-ai/ui/icon"
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
}

function TopbarIconButton(props: {
  slot: string
  label: string
  icon: IconProps["name"]
  onClick?: () => void
  children?: JSX.Element
}) {
  return (
    <button
      type="button"
      data-slot={props.slot}
      aria-label={props.label}
      onClick={() => props.onClick?.()}
      class="group relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-v2-overlay-simple-overlay-hover"
    >
      {/* 图标颜色必须由这层 wrapper 注入 `--icon-base`（写在按钮上的 `text-*` 到不了图标，
          原因见 `rail.tsx` 同一处注释）。未选中的档位靠类、hover 提亮才有空间。 */}
      <span
        data-slot="topbar-icon"
        class="flex items-center [--icon-base:var(--v2-icon-icon-muted)] group-hover:[--icon-base:var(--v2-icon-icon-base)]"
      >
        <Icon name={props.icon} size="small" />
      </span>
      {props.children}
    </button>
  )
}

/**
 * 顶栏（FR-003 / DESIGN §4.4）：品牌 Logo、站内信、全屏、用户下拉。
 *
 * 组件本身不关心落在哪——挂载由调用方通过上游的 `useTitlebarRightMount()` +
 * `<Portal>` 注入 `#opencode-titlebar-right`（**不改 Titlebar 主体**，宪法 V）。
 */
export function Topbar(props: TopbarProps) {
  return (
    <div data-component="topbar" class="flex shrink-0 items-center justify-end gap-1">
      <span class="flex items-center gap-1.5 pl-1">
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
      <TopbarIconButton
        slot="topbar-messages"
        label="站内信"
        icon="comment"
        onClick={() => props.onOpenMessages?.()}
      >
        <Show when={props.unreadCount}>
          {(count) => (
            <span
              data-slot="topbar-messages-unread"
              class="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full border border-v2-state-border-danger bg-v2-state-bg-danger px-0.5 text-center text-[10px] leading-3.5 font-semibold text-v2-state-fg-danger"
            >
              {count()}
            </span>
          )}
        </Show>
      </TopbarIconButton>
      <TopbarIconButton
        slot="topbar-fullscreen"
        label="全屏"
        icon="expand"
        onClick={() => void toggleFullscreen()}
      />
      <Show when={props.user} keyed>
        {(user) => <UserMenu user={user} onSelect={props.onSelect} />}
      </Show>
    </div>
  )
}

/** 用户区：首字头像 + 姓名 + 警号，点击展开下拉（FR-003）。 */
function UserMenu(props: { user: TopbarUser; onSelect?: (id: string) => void }) {
  const [open, setOpen] = createSignal(false)

  return (
    <div class="relative ml-1 shrink-0">
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
        <span class="flex flex-col items-start leading-tight">
          <span data-slot="topbar-user-name" class="text-xs font-semibold text-v2-text-text-base">
            {props.user.name}
          </span>
          <span data-slot="topbar-user-police-id" class="text-[10px] text-v2-text-text-muted">
            警号: {props.user.policeId}
          </span>
        </span>
      </button>
      <Show when={open()}>
        <div
          data-slot="topbar-user-menu"
          class="absolute top-full right-0 z-50 mt-1 flex min-w-32 flex-col rounded-xl border border-v2-border-border-base bg-v2-background-bg-base py-1 shadow-lg"
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
