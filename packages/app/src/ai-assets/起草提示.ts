/**
 * 「让 AI 起草」的两个纯函数（2026-10-31）。
 *
 * 设计边界：这里**只拼一段给人/给 AI 看的文字**、只从回复里抠正文，**没有任何写库能力**。
 * 回复进的是编辑框草稿，保存仍由用户自己点（`asset-detail.tsx`）。
 */

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
    行.push(input.现有)
  }
  return 行.join("\n")
}

/**
 * 从 AI 回复里取正文：优先取第一个 ``` 围栏块里的内容；没有围栏（或围栏未闭合）就整段 `trim()`。
 * 结果为空 ⇒ 返回空串，调用方据此提示「AI 的回复里没有可用内容」。
 */
export function 提取正文(回复: string): string {
  const 围栏开始 = 回复.indexOf("```")
  if (围栏开始 >= 0) {
    // 围栏后面可能跟语言名（```markdown），正文从这一行的换行之后开始。
    const 换行 = 回复.indexOf("\n", 围栏开始 + 3)
    if (换行 >= 0) {
      const 围栏结束 = 回复.indexOf("```", 换行 + 1)
      if (围栏结束 >= 0) return 回复.slice(换行 + 1, 围栏结束).trim()
    }
  }
  return 回复.trim()
}
