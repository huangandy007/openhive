import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import type { JSX } from "solid-js"
import {
  Toast,
  showToast as showLegacyToast,
  toaster as legacyToaster,
  type ToastOptions,
  type ToastVariant,
} from "@opencode-ai/ui/toast"
import { ToastV2, showToastV2, toasterV2 } from "@opencode-ai/ui/v2/toast-v2"

let v2 = false

export function setV2Toast(value: boolean) {
  v2 = value
}

export function ToastRegion(props: { v2: boolean }) {
  if (props.v2) return <ToastV2.Region />
  return <Toast.Region />
}

export function showToast(options: ToastOptions | string) {
  if (!v2) return showLegacyToast(options)
  if (typeof options === "string") return showToastV2(options)

  return showToastV2({
    ...options,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

// v1 and v2 ids come from separate registries, so dismissal has to use the same
// implementation that issued the id.
export function dismissToast(toastId: number) {
  if (!v2) return legacyToaster.dismiss(toastId)
  return toasterV2.dismiss(toastId)
}

function resolveIcon(
  icon: IconProps["name"] | undefined,
  variant: ToastVariant | undefined,
): JSX.Element | undefined {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return undefined
  // ⚠️ 交的是 **thunk**，不是直接 `<Icon />`：`showToast` 从事件回调里调用，那一刻没有 owner，
  // 而 `Icon` 内部有 `onMount(ensureSprite)` ⇒ 落进 root 外面（Solid 实测警告
  // 「computations created outside a `createRoot` or `render` will never be disposed」，
  // 图标 sprite 也只能靠别处先挂上）。solid-sonner 把 icon 交给 Solid 的 `insert()`，
  // 函数值会在 Toaster 的 render 上下文里再求值一次 ⇒ 图标由 Toaster 的 root 创建与释放。
  // `icon` 的类型只声明了 `JSX.Element`（不含函数），故断言。
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- thunk 是为「在 Toaster 的 root 里再求值」而交的（理由见上），类型声明没有这个口子。
  return (() => <Icon name={name} />) as unknown as JSX.Element
}
