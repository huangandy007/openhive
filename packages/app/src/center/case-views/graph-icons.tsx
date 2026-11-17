import type { JSX } from "solid-js"

/**
 * 关系图节点正中的那一个小图标（「人」是人形、「号码 · 手机号」是手机……）。
 *
 * ## 为什么不引图标库
 *
 * 图标数据**内联在本文件**，随 JS 一起打包：页面运行期不发任何请求，内网 / 断网 / 离线部署
 * 一视同仁——不存在「内网找不到图标」这回事。也不进 `packages/ui/src/components/icon.tsx`：
 * 那份是上游文件，往里加图标就是往「与官方合并冲突」这个第一号约束上凑（`CLAUDE.md` 定制三原则）。
 *
 * 图形数据摘自 [Lucide](https://lucide.dev) v1.70.0（ISC 许可），只取 path / 圆 / 矩形本体。
 *
 * ## 认不出类型时怎么办
 *
 * 细类优先、回退大类；**大类也认不出就返回 `undefined`**，调用方不画图标（形状照旧画）。
 * 宁可少一个图标，也不能出现空框或问号方块——那种「缺图」观感比没有图标更糟。
 */

export type 图标名 =
  | "user"
  | "smartphone"
  | "phone"
  | "hash"
  | "id-card"
  | "credit-card"
  | "landmark"
  | "wallet"
  | "mail"
  | "chat"
  | "pin"
  | "building"
  | "car"
  | "package"
  | "calendar"
  | "circle-dashed"

/** 24×24 视口的图形本体（不含 `<svg>` 外壳，描边属性由调用方给）。 */
const 图集: Record<图标名, () => JSX.Element> = {
  // 人
  user: () => (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // 手机号
  smartphone: () => (
    <>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </>
  ),
  // 固定电话
  phone: () => (
    <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
  ),
  // 号码（细类判不出）：井号
  hash: () => (
    <>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </>
  ),
  // 身份证
  "id-card": () => (
    <>
      <path d="M13 19a4 4 0 0 0-8 0" />
      <path d="M16 10h2" />
      <path d="M16 14h2" />
      <circle cx="9" cy="12" r="3" />
      <rect x="2" y="5" width="20" height="14" rx="2" />
    </>
  ),
  // 银行卡
  "credit-card": () => (
    <>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
      <path d="M6 14h2" />
    </>
  ),
  // 银行账号：银行门面
  landmark: () => (
    <>
      <path d="M10 18v-7" />
      <path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" />
      <path d="M14 18v-7" />
      <path d="M18 18v-7" />
      <path d="M3 22h18" />
      <path d="M6 18v-7" />
    </>
  ),
  // 第三方支付 / 账户细类判不出：钱包
  wallet: () => (
    <>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </>
  ),
  // 邮箱
  mail: () => (
    <>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  // 微信 / QQ / 虚拟身份细类判不出：对话气泡（不画品牌 logo）
  chat: () => (
    <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  ),
  // 地点
  pin: () => (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  // 组织
  building: () => (
    <>
      <path d="M10 12h4" />
      <path d="M10 8h4" />
      <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
      <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    </>
  ),
  // 车辆
  car: () => (
    <>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  // 物品：包裹
  package: () => (
    <>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="m7.5 4.27 9 5.15" />
    </>
  ),
  // 事件：日历
  calendar: () => (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  // 未分类：虚线圆（「待归类」，不是「缺图」——不用问号，问号看起来像图标没加载出来）
  "circle-dashed": () => (
    <>
      <path d="M10.1 2.18a10 10 0 0 1 3.8 0" />
      <path d="M13.9 21.82a10 10 0 0 1-3.8 0" />
      <path d="M17.6 3.72a10 10 0 0 1 2.7 2.7" />
      <path d="M2.18 13.9a10 10 0 0 1 0-3.8" />
      <path d="M20.28 17.6a10 10 0 0 1-2.7 2.7" />
      <path d="M21.82 10.1a10 10 0 0 1 0 3.8" />
      <path d="M3.72 6.4a10 10 0 0 1 2.7-2.7" />
      <path d="M6.4 20.28a10 10 0 0 1-2.7-2.7" />
    </>
  ),
}

/** 24×24 视口里的图形本体（图例的 `<svg>` 与节点的 `<g>` 共用这一份）。 */
export function 图标图形(名: 图标名): JSX.Element {
  return 图集[名]()
}

/**
 * 类型 → 图标。**细类优先、回退大类**；大类也认不出 ⇒ `undefined`。
 *
 * 细类来自关系图接口的 `subtype`（`case-graph.ts` 的 `细类()`），所以这一层只是查表，
 * 不重新判值——同一个判断写第二份就会漂（`LEARNINGS #002-06`）。
 */
export function 节点图标(点: { readonly type: string; readonly subtype?: string }): 图标名 | undefined {
  switch (点.type) {
    case "人":
      return "user"
    case "号码":
      if (点.subtype === "手机号") return "smartphone"
      if (点.subtype === "固定电话") return "phone"
      if (点.subtype === "身份证") return "id-card"
      return "hash"
    case "账户":
      if (点.subtype === "银行卡") return "credit-card"
      if (点.subtype === "银行账号") return "landmark"
      return "wallet"
    case "虚拟身份":
      if (点.subtype === "邮箱") return "mail"
      return "chat"
    case "地点":
      return "pin"
    case "组织":
      return "building"
    case "车辆":
      return "car"
    case "物品":
      return "package"
    case "事件":
      return "calendar"
    case "未分类":
      return "circle-dashed"
    default:
      return undefined
  }
}

/**
 * 节点里图标的边长：中心节点 22（节点直径 40）、普通 16（直径 30）。
 *
 * 第一版取 20 / 14，真栈截图里「号码」那种留白大的图标（手机轮廓只占 24 视口的 14×20）
 * 实际只画出约 9px，认不出是什么 ⇒ 放大一档。16px 的正方形内接在 30px 圆里（对角线 22.6）没问题，
 * 菱形（地点）的内接正方形边长 ≈ 21 也放得下。
 */
export function 图标边长(中心: boolean): number {
  return 中心 ? 22 : 16
}

/**
 * 把图标画在 `(x, y)` 正中。`色` 与节点描边同色——点选换成品牌金时图标跟着换，
 * 否则会看到「金边框＋灰图标」两个色。
 */
export function 节点图标组(props: {
  readonly 名: 图标名
  readonly x: number
  readonly y: number
  readonly 边长: number
  readonly 色: string
}): JSX.Element {
  const 半 = () => props.边长 / 2
  return (
    <g
      data-slot="graph-node-icon"
      data-icon={props.名}
      transform={`translate(${props.x - 半()} ${props.y - 半()}) scale(${props.边长 / 24})`}
      fill="none"
      stroke={props.色}
      stroke-width="2.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {图标图形(props.名)}
    </g>
  )
}
