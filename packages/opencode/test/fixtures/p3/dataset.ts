import * as XLSX from "xlsx"
import { claimNextJob, enqueueMaterial, runJob } from "../../../src/server/openhive/case-ingest"
import type { 抽取器 } from "../../../src/server/openhive/case-extract-run"
import type { Queryable } from "../../../src/server/openhive/case-store"
import { 建假抽取器 } from "../../server/openhive-case-extract-fixture"

/**
 * P3 专用数据集（去重 / 保护修正 / 外币 / 对齐三态 / 时间线）。
 *
 * 两个项目各走一次 `enqueueMaterial → claimNextJob → runJob`：
 * - `p-p3`：先流水（3 张卡）后笔录（2 条 human 转账 + 1 个无时间事件）。
 *   机器行因此先建后触发重算——这正是 D-1 文本触发要证明的路径。
 * - `p-party`：两份流水 + 一份文本材料造出「李四」对应两个账户（歧义）与唯一户名的王五/赵六。
 *
 * 不裸写事实表（#006-28 / #006-35）。
 */
export interface P3数据集 {
  projectId: string
  材料: { 流水: string; 笔录: string }
  账号: { A: string; B: string; C: string }
  对齐项目: string
  对齐账号: { X: string; Y: string; Z: string; W: string }
}

const 账号 = {
  A: "6222021234567890123",
  B: "6222021234567890456",
  C: "6222021234567890789",
} as const

const 对齐账号 = {
  X: "6222021234567891001",
  Y: "6222021234567891002",
  Z: "6222021234567891003",
  W: "6222021234567891004",
} as const

const 流水表头 = [
  "交易时间", "查询账号", "本方户名", "对方账号", "对方户名",
  "借贷标志", "交易金额", "余额", "备注", "币种",
]

const 流水行们: (string | number)[][] = [
  流水表头,
  ["2026-04-01 10:00:00", 账号.A, "张三", 账号.B, "李四", "付", "10000.00", "0.00", "货款", "CNY"],
  ["2026-04-03 10:00:00", 账号.A, "张三", 账号.B, "李四", "付", "20000.00", "0.00", "货款", "CNY"],
  ["2026-04-04 10:00:00", 账号.A, "张三", 账号.C, "陈三", "付", "100.00", "0.00", "美元结算", "USD"],
]

const 对齐行们: (string | number)[][] = [
  流水表头,
  ["2026-05-01 10:00:00", 对齐账号.X, "李四", 对齐账号.Y, "李四", "付", "100.00", "0.00", "", "CNY"],
  ["2026-05-02 10:00:00", 对齐账号.Z, "王五", 对齐账号.W, "赵六", "付", "200.00", "0.00", "", "CNY"],
]

/** 第二份流水（同账户同户名）：别名 id 含 materialId ⇒ 给账户 Z 的「王五」落下第二条别名行。 */
const 对齐补充行们: (string | number)[][] = [
  流水表头,
  ["2026-05-03 10:00:00", 对齐账号.Z, "王五", 对齐账号.W, "赵六", "付", "300.00", "0.00", "补充", "CNY"],
]

/** p-p3 第二份流水：只给 B 造一条纯外币「出」，让「某方向只有纯外币」有观测点。 */
const 补充行们: (string | number)[][] = [
  流水表头,
  ["2026-04-05 10:00:00", 账号.B, "李四", 账号.C, "陈三", "付", "50.00", "0.00", "外币支出", "USD"],
]

const 笔录正文 = [
  "一、2026年4月1日，张三账户6222021234567890123向李四转账1万元。",
  "二、2026年4月2日，张三账户6222021234567890123向李四账户6222021234567890456转账5000元。",
  "三、李四与周八曾在城东见面。",
  "",
].join("\n")

/**
 * 只造人的文本材料：赵六供第二档显示观测；李四→X 的关系给「人李四的户名对应
 * X、Y 两个账户」造出歧义（fail-closed，不合并）。
 */
const 对齐人名正文 = [
  "赵六是本案第三方。",
  "2026年5月4日，李四向账户6222021234567891001转款50元。",
  "",
].join("\n")

/** 第一条 human 关系落在「账户 → 人」；第二条落在「账户 → 账户」（保护修正用例需要原对相等）。 */
const 假抽取器回答 = {
  实体: [
    { 类型: "人", 取值: "张三" },
    { 类型: "人", 取值: "李四" },
    { 类型: "人", 取值: "周八" },
    { 类型: "人", 取值: "吴九" },
    { 类型: "账户", 取值: 账号.A },
    { 类型: "账户", 取值: 账号.B },
    { 类型: "账户", 取值: 账号.C },
  ],
  关系: [
    {
      类型: "转账",
      从: 账号.A,
      到: "李四",
      金额原文: "1万",
      时间原文: "2026年4月1日",
      原文: "2026年4月1日，张三账户6222021234567890123向李四转账1万元。",
    },
    {
      类型: "转账",
      从: 账号.A,
      到: 账号.B,
      金额原文: "5000元",
      时间原文: "2026年4月2日",
      原文: "2026年4月2日，张三账户6222021234567890123向李四账户6222021234567890456转账5000元。",
    },
  ],
  事件: [
    {
      类型: "见面",
      参与人: ["李四", "周八"],
      原文: "李四与周八曾在城东见面。",
    },
  ],
}

function 造工作簿(行们: (string | number)[][], 表名: string): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(行们), 表名)
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

export async function 种P3数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<P3数据集> {
  const projectId = "p-p3"
  const 对齐项目 = "p-party"

  const 入队 = async (项目: string, 文件名: string, 字节: Uint8Array) => {
    文件.set(`${项目}/${文件名}`, 字节)
    const r = await enqueueMaterial(db, {
      projectId: 项目,
      path: 文件名,
      sourcePath: `${项目}/${文件名}`,
      fileName: 文件名,
      fingerprint: `fp-${项目}-${文件名}`,
    })
    if (!r.enqueued) throw new Error(`材料没有入队：${文件名}`)
    return r.materialId
  }

  const 跑 = async (materialId: string, 建抽取器?: () => Promise<抽取器>) => {
    const job = await claimNextJob(db)
    if (!job) throw new Error("队列是空的")
    if (job.materialId !== materialId) throw new Error(`认领到别人的作业：期望 ${materialId}，实得 ${job.materialId}`)
    const 结果 = await runJob(db, { readFile: async (p) => 文件.get(p)!, ...(建抽取器 === undefined ? {} : { 建抽取器 }) }, job)
    if (结果 !== "完成") throw new Error(`作业没有跑完：${结果}（材料 ${materialId}）`)
  }

  // R-J：队列是全局 FIFO 且 queued_at 只有秒精度 ⇒ 必须入队一份、跑完、再入队下一份。
  const 流水 = await 入队(projectId, "P3流水.xlsx", 造工作簿(流水行们, "流水"))
  await 跑(流水)
  const 笔录 = await 入队(projectId, "P3笔录.txt", new TextEncoder().encode(笔录正文))
  await 跑(笔录, async () => 建假抽取器(() => 假抽取器回答))
  // 顺序必须在笔录之后：笔录会触发重建，补充材料自己再建 B→C 的机器行。
  const 补充 = await 入队(projectId, "P3流水补充.xlsx", 造工作簿(补充行们, "流水"))
  await 跑(补充)

  const 对齐流水 = await 入队(对齐项目, "P3对齐.xlsx", 造工作簿(对齐行们, "流水"))
  await 跑(对齐流水)
  const 对齐补充 = await 入队(对齐项目, "P3对齐补充.xlsx", 造工作簿(对齐补充行们, "流水"))
  await 跑(对齐补充)
  // 赵六：第二档显示（账户 → 唯一户名对应人名）的观测量；
  // 李四→X：人工关系，造出「人李四的户名对应 X、Y 两个账户」的歧义观测量。
  const 对齐人名 = await 入队(对齐项目, "P3对齐人名.txt", new TextEncoder().encode(对齐人名正文))
  await 跑(对齐人名, async () =>
    建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "赵六" },
        { 类型: "人", 取值: "李四" },
      ],
      关系: [
        {
          类型: "转账",
          从: "李四",
          到: 对齐账号.X,
          金额原文: "50元",
          时间原文: "2026年5月4日",
          原文: "2026年5月4日，李四向账户6222021234567891001转款50元。",
        },
      ],
      事件: [],
    })),
  )

  return {
    projectId,
    材料: { 流水, 笔录 },
    账号,
    对齐项目,
    对齐账号,
  }
}
