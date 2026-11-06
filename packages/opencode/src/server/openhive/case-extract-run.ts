export * as OpenhiveCaseExtractRun from "./case-extract-run"

import { Schema } from "effect"
import { PROMPT版本, 抽取结构, 回读, 用户提示, 系统提示, type 实体输入, type 事件输入, type 关系输入 } from "./case-extract"
import { 切片, type 文本片 } from "./case-slice"

/**
 * 五层 harness 的执行层：片 → 调模型 → 校验 → 重试 → 汇总。
 *
 * ## 一片失败不牵连别的片
 *
 * 设计 §7.4「部分成功照常入库，不整份回滚」：这里从不抛错（除了切片本身的面积闸），
 * 每片自己带 `问题`。调用方按 `问题` 决定材料标不标「有问题」。
 *
 * ## 重试只重试这一片
 *
 * 失败的反馈（哪几个原子值回读不过）拼进下一次的用户提示——模型需要知道错在哪，
 * 只重启一次同样的 prompt 通常还会错在同一个地方。
 */
export interface 模型调用 {
  (输入: { 系统: string; 用户: string }): Promise<unknown>
}

export interface 抽取器 {
  readonly 模型标识: string
  readonly 调用: 模型调用
}

export interface 片结果 {
  readonly 片: 文本片
  readonly 实体: 实体输入[]
  readonly 关系: 关系输入[]
  readonly 事件: 事件输入[]
  readonly 问题: string[]
  readonly 尝试: number
}

export interface 抽取输出 {
  readonly 片们: 片结果[]
  readonly 模型标识: string
  readonly prompt版本: string
}

export interface 抽取选项 {
  /** 每片最多几次。默认 3（设计「上限 N 次」，N=3 是成本与成功率的折中）。 */
  最多尝试?: number
  /** 每片开始前问一次；返回 false 就不再跑后续片（取消，R6）。 */
  仍应继续?: () => Promise<boolean>
}

const 默认最多尝试 = 3

export async function 抽取材料(
  input: { 文本: string; fileName: string; 抽取器: 抽取器 },
  opts: 抽取选项 = {},
): Promise<抽取输出> {
  const 全部 = 切片(input.文本)
  const 最多 = Math.max(1, opts.最多尝试 ?? 默认最多尝试)
  const 片们: 片结果[] = []

  for (const [下标, 片] of 全部.entries()) {
    if (opts.仍应继续 && !(await opts.仍应继续())) break
    片们.push(
      await 抽一片({
        fileName: input.fileName,
        片序号: 下标 + 1,
        片数: 全部.length,
        片,
        调用: input.抽取器.调用,
        最多,
      }),
    )
  }

  return { 片们, 模型标识: input.抽取器.模型标识, prompt版本: PROMPT版本 }
}

async function 抽一片(input: {
  fileName: string
  片序号: number
  片数: number
  片: 文本片
  调用: 模型调用
  最多: number
}): Promise<片结果> {
  let 问题: string[] = []

  for (let 尝试 = 1; 尝试 <= input.最多; 尝试++) {
    const 用户 =
      用户提示({
        fileName: input.fileName,
        片序号: input.片序号,
        片数: input.片数,
        起: input.片.起,
        止: input.片.止,
        文本: input.片.文本,
      }) +
      (问题.length === 0
        ? ""
        : `\n\n上一次的输出有这些问题，请改正后重新输出（仍然只抽这一段原文里写到的）：\n- ${问题.join("\n- ")}`)

    let 原: unknown
    try {
      原 = await input.调用({ 系统: 系统提示(), 用户 })
    } catch (error) {
      const 说明 = error instanceof Error ? error.message : String(error)
      问题 = [`模型调用失败：${说明.slice(0, 200)}`]
      if (尝试 === input.最多) return { 片: input.片, 实体: [], 关系: [], 事件: [], 问题, 尝试 }
      continue
    }

    try {
      const 解析 = Schema.decodeUnknownSync(抽取结构)(原)
      const 回 = 回读(解析, input.片.文本)
      if (回.问题.length === 0)
        return { 片: input.片, 实体: 回.实体, 关系: 回.关系, 事件: 回.事件, 问题: [], 尝试 }
      问题 = 回.问题
      if (尝试 === input.最多)
        return { 片: input.片, 实体: 回.实体, 关系: 回.关系, 事件: 回.事件, 问题, 尝试 }
    } catch (error) {
      const 说明 = error instanceof Error ? error.message : String(error)
      问题 = [`模型输出不是约定结构：${说明.slice(0, 300)}`]
      if (尝试 === input.最多) return { 片: input.片, 实体: [], 关系: [], 事件: [], 问题, 尝试 }
    }
  }

  // 循环必然在上面 return；这一行只为类型完整性。
  return { 片: input.片, 实体: [], 关系: [], 事件: [], 问题, 尝试: input.最多 }
}
