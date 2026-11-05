/**
 * 材料的处理状态机（设计 §5.2 / §8.1）。
 *
 * 纯函数、不碰库：状态规则是**产品规则**，不该被埋在 SQL 里。DAO 只负责
 * 「读当前状态 → 问这里 → 带并发条件写回」。
 *
 * ## 为什么「取消」有两个落点
 *
 * - 排队中取消 ⇒ 回「未入队」：一片都没跑，等于没发生。
 * - 解析中取消 ⇒ 落「有问题」：**已提交的切片要保留**（设计 §8.1）。当成没跑过的话，
 *   下次重解析会在已有事实之上再叠一遍，用户看到的是「取消过的东西又冒出来了」。
 */
export const PARSE_STATUSES = ["未入队", "排队中", "解析中", "已解析", "有问题", "已跳过"] as const
export type ParseStatus = (typeof PARSE_STATUSES)[number]

export const PARSE_ACTIONS = ["入队", "开始", "完成", "出问题", "取消", "跳过", "重新解析"] as const
export type ParseAction = (typeof PARSE_ACTIONS)[number]

const TRANSITIONS: Record<ParseStatus, Partial<Record<ParseAction, ParseStatus>>> = {
  未入队: { 入队: "排队中", 跳过: "已跳过" },
  排队中: { 开始: "解析中", 取消: "未入队" },
  解析中: { 完成: "已解析", 出问题: "有问题", 取消: "有问题" },
  已解析: { 重新解析: "排队中" },
  有问题: { 重新解析: "排队中", 跳过: "已跳过" },
  已跳过: { 入队: "排队中" },
}

/** 这一步合不合法。不合法返回 `undefined` —— 调用点自己决定是抛错还是忽略。 */
export function nextStatus(from: ParseStatus, action: ParseAction): ParseStatus | undefined {
  return TRANSITIONS[from]?.[action]
}

/** 是否占着队列：这两种状态下的文件，「解析入库」不该亮（设计 §8.1）。 */
export function isRunning(status: ParseStatus): boolean {
  return status === "排队中" || status === "解析中"
}
