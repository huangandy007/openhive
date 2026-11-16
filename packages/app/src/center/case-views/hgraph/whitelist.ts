/**
 * 改字段白名单的前端物理副本（后端 `hgraph-edit.ts` 的 `可改键` 是唯一语义来源，data-model §7 是唯一出处）。
 * 本文件刻意零 import：跨层守卫用例 `packages/opencode/test/server/case-hgraph-whitelist-parity.test.ts`
 * 要直接相对导入它（history.ts 带 `@/` 类型 import，跨包会被 opencode 的 paths 解析错）。
 * 改白名单必须两处同改（`#002-06`）。
 */
export type 类别 = "节点" | "边" | "文字"
/** 与后端 `可改键` 逐字一致；`x`/`y` 只能走「移动」。 */
export const 可改键: Readonly<Record<类别, ReadonlySet<string>>> = {
  节点: new Set(["名称", "类型", "细类", "外环", "备注", "出现序", "锁定", "样式", "来源", "可信度", "属性", "出处", "时间"]),
  边: new Set(["标签", "性质", "方向", "备注", "线宽档", "出现序", "来源", "可信度"]),
  文字: new Set(["内容", "字号", "加粗", "颜色", "对齐", "宽度", "出现序"]),
}
