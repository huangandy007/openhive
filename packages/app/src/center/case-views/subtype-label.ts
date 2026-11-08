/**
 * 细类的**显示名**唯一映射（2026-11-08 用户裁定）。
 *
 * 库里 `subtype` 仍是 `身份证`（`case-subtype.ts` 的白名单），只在这一层换词：
 * 民警的口径是「证件号」，而「身份证」在案卷里既可能是身份证也可能是其他证件号。
 * 图标查表（`graph-icons.tsx`）继续用原始值——那是视觉映射，不是文案。
 */
const 显示名: Readonly<Record<string, string>> = { 身份证: "证件号" }

export function 细类显示名(细类: string | undefined | null): string | undefined {
  if (细类 === undefined || 细类 === null || 细类 === "") return undefined
  return Object.hasOwn(显示名, 细类) ? 显示名[细类] : 细类
}
