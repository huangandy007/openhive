/**
 * 「让 AI 起草」的两个纯函数（2026-10-31）。
 *
 * 设计边界：这里**只拼一段给人/给 AI 看的文字**、只从回复里抠正文，**没有任何写库能力**。
 * 回复进的是编辑框草稿，保存仍由用户自己点（`asset-detail.tsx`）。
 */

import { 行数上界 } from "@/ai-session/send-to-session"

export type 起草字段 = "description" | "summary" | "precautions"

const 字段中文名: Record<起草字段, string> = {
  description: "介绍",
  summary: "功能描述",
  precautions: "注意事项",
}

/**
 * 字段定位。三句各不相同——同一个模板换个名字，AI 拿到的任务就是含糊的。
 */
const 字段定位: Record<起草字段, string> = {
  description: "详细介绍这个资产：它能做什么、怎么用、会涉及哪些文件。",
  summary: "一句话说明这个资产能干什么，这句话会显示在卡片悬停浮层上。",
  precautions: "只写这个资产专属的注意事项；产品级的「AI 结论需人工复核」不写进这里。",
}

/**
 * 拼一句送进右栏输入框的起草指令。
 *
 * - 指名资产与字段中文名、给出字数上限；
 * - Markdown 字段写明「用 Markdown」，纯文本字段**不提 Markdown**（免得模型照着写标记）；
 * - 要求**只输出正文**并用 ``` 围栏包起来——这样 `提取正文` 才取得干净；
 * - `现有` 非空时附上，让 AI 在原有基础上修订。
 */
export function 构造起草提示(input: {
  readonly 名称: string
  readonly 字段: 起草字段
  readonly 上限: number
  readonly 现有: string
  readonly markdown: boolean
}): string {
  const 行 = [
    `请为资产「${input.名称}」起草${字段中文名[input.字段]}。`,
    `字段定位：${字段定位[input.字段]}`,
    `字数上限：${input.上限} 字以内。`,
    input.markdown
      ? "格式要求：用 Markdown 写（标题 / 粗体 / 列表 / 代码块）。"
      : "格式要求：一句话的纯文本，不要加任何排版标记。",
    "只输出正文，不要任何解释，并用 ``` 围栏把正文包起来。",
  ]
  if (input.现有.trim() !== "") {
    行.push("现有内容如下，请在原内容基础上修订，不要丢掉已有的要点：")
    const 现有行们 = input.现有.split(/\r?\n/)
    // 中栏 → 右栏一次最多 `行数上界` 行（`send-to-session.ts`），这条指令同样受它约束。
    // 不截断的话，「介绍」这种列表式 Markdown 一长就永远发不出去，还报「一次最多发 50 行，
    // 请少选点」——这个按钮上根本没有「选」这个动作（2026-10-31 复审 I-2）。
    // 留 1 行给截断说明、再留 1 行余量；指令原样出现在输入框里，用户看得见截到哪。
    const 预算 = Math.max(1, 行数上界 - 行.length - 2)
    if (现有行们.length > 预算) {
      行.push(...现有行们.slice(0, 预算))
      行.push(`（上面是现有内容的前 ${预算} 行，其余已省略；请在保留上述要点的前提下补全整体）`)
    } else {
      行.push(...现有行们)
    }
  }
  return 行.join("\n")
}

/** 整行就是围栏（后面可跟语言名）。正文里顶格的行内代码不会命中。 */
const 开围栏 = /^\s*```/
/** 闭合围栏：整行只有 ``` 与空白。 */
const 闭围栏 = /^\s*```\s*$/

/**
 * 从 AI 回复里取正文：优先取 ``` 围栏块里的内容；没有围栏就整段 `trim()`。
 * 结果为空 ⇒ 返回空串，调用方据此提示「AI 的回复里没有可用内容」。
 *
 * ⚠️ 闭合围栏取**最后一个**单独的 ```，不是第一个：提示词明确要求 AI「用 Markdown 写
 * （标题 / 粗体 / 列表 / 代码块）」，正文里自己带一对 ``` 是预期之内的事，取第一个会把
 * 代码块及其后的正文整段截掉（实得只剩 `"# 标题"`，2026-10-31 复审 I-1）。
 */
export function 提取正文(回复: string): string {
  const 行们 = 回复.split(/\r?\n/)
  const 开始 = 行们.findIndex((行) => 开围栏.test(行))
  if (开始 >= 0) {
    for (let i = 行们.length - 1; i > 开始; i--) {
      if (闭围栏.test(行们[i])) return 行们.slice(开始 + 1, i).join("\n").trim()
    }
    // 围栏没闭合（流式中途被点、或 AI 没照格式写）：丢掉开头那行标记，正文照收——
    // 留着标记只会把 ``` 塞进草稿。
    return 行们.slice(开始 + 1).join("\n").trim()
  }
  return 回复.trim()
}
