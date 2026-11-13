import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
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

/** 生产入口的公共两段：入队一份材料、认领并跑完它。 */
function 造入队器(db: Queryable, 文件: Map<string, Uint8Array>) {
  return async (项目: string, 文件名: string, 字节: Uint8Array) => {
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
}

function 造跑器(db: Queryable, 文件: Map<string, Uint8Array>) {
  return async (materialId: string, 建抽取器?: () => Promise<抽取器>) => {
    const job = await claimNextJob(db)
    if (!job) throw new Error("队列是空的")
    if (job.materialId !== materialId) throw new Error(`认领到别人的作业：期望 ${materialId}，实得 ${job.materialId}`)
    const 结果 = await runJob(db, { readFile: async (p) => 文件.get(p)!, ...(建抽取器 === undefined ? {} : { 建抽取器 }) }, job)
    if (结果 !== "完成") throw new Error(`作业没有跑完：${结果}（材料 ${materialId}）`)
  }
}

export async function 种P3数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<P3数据集> {
  const projectId = "p-p3"
  const 对齐项目 = "p-party"
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)

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

/** 展示层数据集（组织户名 / 候选 ≥2 回落 / 内部往来 / 归属歧义）——独立项目，不污染 p-p3。 */
export interface 展示数据集 {
  项目: string
  账号: { Q: string; P: string; S: string; T: string }
}

const 展示账号 = {
  Q: "6222021234567892001",
  P: "6222021234567892002",
  S: "6222021234567892003",
  T: "6222021234567892004",
} as const

/**
 * 账户户名走生产流水；其中三条的对方账号不是账户形状 ⇒ 只落「户名」证据、不建关系
 * （关系重建要求双方都可建实体）。这样 Q 能同时拿到「张Q（唯一）」「王歧（两个账户）」，
 * S 能拿到两个人名候选，而关系圈仍只由 Q→P / Q→S 两条机器关系构成。
 */
const 展示流水行们: (string | number)[][] = [
  流水表头,
  ["2026-05-01 10:00:00", 展示账号.Q, "张Q", 展示账号.P, "某某公司", "付", "100.00", "0.00", "", "CNY"],
  ["2026-05-02 10:00:00", 展示账号.Q, "张Q", 展示账号.S, "人甲", "付", "200.00", "0.00", "", "CNY"],
  ["2026-05-03 10:00:00", "外部付款方", "", 展示账号.Q, "王歧", "收", "10.00", "0.00", "", "CNY"],
  ["2026-05-04 10:00:00", 展示账号.T, "王歧", "外部收款方", "", "付", "10.00", "0.00", "", "CNY"],
  ["2026-05-05 10:00:00", 展示账号.S, "人乙", "外部收款方2", "", "付", "10.00", "0.00", "", "CNY"],
]

const 展示正文 = [
  "一、2026年5月6日，张Q向账户6222021234567892001转款50元。",
  "二、2026年5月7日，王歧向R转款30元。",
  "三、某某公司、人甲、人乙均为本案关联方。",
  "",
].join("\n")

/**
 * 全程走生产入口（`enqueueMaterial → claimNextJob → runJob`，`#006-28` / `#006-35`）：
 * - 组织「某某公司」由文本抽取产出，账户 P 的户名由流水产出 ⇒ 展示为组织名；
 * - 人甲 / 人乙 两张人名候选挂在账户 S ⇒ `账户展示名` fail-closed 回落账号；
 * - 张Q 唯一对齐 Q ⇒ 人工关系 张Q→Q 计入内部往来；
 * - 王歧 对齐 Q、T 两个账户 ⇒ 人工关系 王歧→R 计入归属歧义。
 */
export async function 种展示数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<展示数据集> {
  const 项目 = "p-展示"
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)

  const 流水 = await 入队(项目, "P3展示流水.xlsx", 造工作簿(展示流水行们, "流水"))
  await 跑(流水)
  const 正文 = await 入队(项目, "P3展示人名.txt", new TextEncoder().encode(展示正文))
  await 跑(正文, async () =>
    建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张Q" },
        { 类型: "人", 取值: "王歧" },
        { 类型: "人", 取值: "R" },
        { 类型: "人", 取值: "人甲" },
        { 类型: "人", 取值: "人乙" },
        { 类型: "组织", 取值: "某某公司" },
        { 类型: "账户", 取值: 展示账号.Q },
      ],
      关系: [
        {
          类型: "转账",
          从: "张Q",
          到: 展示账号.Q,
          金额原文: "50元",
          时间原文: "2026年5月6日",
          原文: "2026年5月6日，张Q向账户6222021234567892001转款50元。",
        },
        {
          类型: "转账",
          从: "王歧",
          到: "R",
          金额原文: "30元",
          时间原文: "2026年5月7日",
          原文: "2026年5月7日，王歧向R转款30元。",
        },
      ],
      事件: [],
    })),
  )

  return { 项目, 账号: 展示账号 }
}

/** 多对手数据集：25 个 CNY 对手（前 3 笔 100.00、其余 10.00，合计 520.00），独立项目。 */
export interface 多对手数据集 {
  项目: string
  主账号: string
  对手账号们: string[]
}

export async function 种多对手数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<多对手数据集> {
  const 项目 = "p-资金流多对手"
  const 主账号 = "6222021234567893000"
  const 对手账号们 = Array.from(
    { length: 25 },
    (_, i) => `6222021234567893${String(i + 1).padStart(3, "0")}`,
  )
  // 全部「收」：对手 → 主账号（入）。金额刻意让「前 3 对手 ÷ 方向合计」与
  // 「前 3 对手 ÷ 前 20 对手合计」不同（300/520 = 57.7% vs 300/470 = 63.8%，I1）。
  const 行们: (string | number)[][] = [
    流水表头,
    ...对手账号们.map((对手账号, i) => [
      `2026-06-${String(i + 1).padStart(2, "0")} 10:00:00`,
      主账号,
      "多对手主户",
      对手账号,
      `对手${i + 1}`,
      "收",
      i < 3 ? "100.00" : "10.00",
      "0.00",
      "",
      "CNY",
    ]),
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3多对手流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  return { 项目, 主账号, 对手账号们 }
}

/**
 * 对齐交叉数据集（`find_crossings` 基 2 用例）：甲**自身没有任何边**，但流水给了它一条
 * 户名证据「四哥」；文本材料再造 四哥→中间。甲与乙因此只能在「中间」相交。
 *
 * 旧实现按裸端点 `from_id/to_id ∈ 实体.ids` 取另一端 ⇒ 甲侧邻居为空 ⇒ 共同关联 `[]`。
 */
export interface 对齐交叉数据集 {
  项目: string
  账号: { 甲: string; 中间: string; 乙: string }
}

const 对齐交叉账号 = {
  甲: "6222021234567899000",
  中间: "6222021234567899001",
  乙: "6222021234567899002",
} as const

const 对齐交叉流水行们: (string | number)[][] = [
  流水表头,
  // 「外部付款方」不是账户形状 ⇒ 查询账号侧不建关系；只给甲落「户名 四哥」证据。
  ["2026-12-01 10:00:00", "外部付款方", "", 对齐交叉账号.甲, "四哥", "收", "10.00", "0.00", "", "CNY"],
  // 数据关系：中间 → 乙。
  ["2026-12-02 10:00:00", 对齐交叉账号.中间, "中间户", 对齐交叉账号.乙, "乙户", "付", "20.00", "0.00", "", "CNY"],
]

const 对齐交叉正文 = ["2026年12月3日，四哥向账户6222021234567899001转款5元。", ""].join("\n")

export async function 种对齐交叉数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<对齐交叉数据集> {
  const 项目 = "p-对齐交叉"
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3对齐交叉流水.xlsx", 造工作簿(对齐交叉流水行们, "流水"))
  await 跑(流水)
  const 正文 = await 入队(项目, "P3对齐交叉人名.txt", new TextEncoder().encode(对齐交叉正文))
  await 跑(正文, async () =>
    建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "四哥" },
        { 类型: "账户", 取值: 对齐交叉账号.中间 },
      ],
      关系: [
        {
          类型: "转账",
          从: "四哥",
          到: 对齐交叉账号.中间,
          金额原文: "5元",
          时间原文: "2026年12月3日",
          原文: "2026年12月3日，四哥向账户6222021234567899001转款5元。",
        },
      ],
      事件: [],
    })),
  )
  return { 项目, 账号: 对齐交叉账号 }
}

/** 老数据数据集：一条只有 `participants` 文本、没有参与者行的事件（模拟 P3 前数据）。 */
export interface 老数据数据集 {
  项目: string
  主账号: string
}

export async function 种无参与者数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<老数据数据集> {
  const 项目 = "p-资金流老数据"
  const 主账号 = "6222021234567894000"
  const 行们: (string | number)[][] = [
    流水表头,
    [
      "2026-07-01 10:00:00",
      主账号,
      "旧主户",
      "6222021234567894001",
      "旧对手",
      "收",
      "500.00",
      "0.00",
      "",
      "CNY",
    ],
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3老数据流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  // P3 参与者表之前的老事件只有 `participants text[]`：删掉参与者行，模拟「方向不可判」。
  // 事件本身、明细行、关系都保留——这正是 C3 要盖的 fail-closed 场景。
  await db.execute(sql`delete from auth.case_event_participant where project_id = ${项目}`)
  return { 项目, 主账号 }
}

/** 他者参与者数据集：事件有别人的参与者行，本账户只能靠 `participants` 文本归属。 */
export interface 他者参与者数据集 {
  项目: string
  主账号: string
}

export async function 种他者参与者数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<他者参与者数据集> {
  const 项目 = "p-资金流他者角色"
  const 主账号 = "6222021234567895000"
  const 行们: (string | number)[][] = [
    流水表头,
    [
      "2026-08-01 10:00:00",
      主账号,
      "他者主户",
      "6222021234567895001",
      "他者对手",
      "收",
      "500.00",
      "0.00",
      "",
      "CNY",
    ],
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3他者角色流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  // 生产入口无法直接产出「只有别人的参与者行」的中间态；写入方在实体缓存未命中时会把
  // `entity_id` 写成 null（case-translate-store.ts）。把本方的参与行置 null 模拟该状态，
  // 保留对手行——事件仍能靠 `participants` 文本被基 1 命中，但本账户没有角色行。
  await db.execute(sql`update auth.case_event_participant
                          set entity_id = null
                        where project_id = ${项目}
                          and entity_id = (select id from auth.case_entity
                                            where project_id = ${项目}
                                              and canonical_value = ${主账号})`)
  return { 项目, 主账号 }
}

/** 无时间数据集：资金交易事件的 `occurred_at` 为 null（模拟导入时无时间的事件）。 */
export interface 无时间数据集 {
  项目: string
  主账号: string
}

export async function 种无时间数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<无时间数据集> {
  const 项目 = "p-资金流无时间"
  const 主账号 = "6222021234567896000"
  const 行们: (string | number)[][] = [
    流水表头,
    [
      "2026-09-01 10:00:00",
      主账号,
      "无时主户",
      "6222021234567896001",
      "无时对手",
      "收",
      "700.00",
      "0.00",
      "",
      "CNY",
    ],
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3无时间流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  // 生产入口在时间无法解析时会跳过该行（case-translate.ts），造不出「有时间字段但为 null」
  // 的资金交易事件；这里在入库后把 occurred_at 置 null 模拟「无时间」状态（关系与明细不动）。
  await db.execute(sql`update auth.case_event set occurred_at = null where project_id = ${项目}`)
  return { 项目, 主账号 }
}

/** 金额乱序数据集：12 笔「收」，字符串序与数值序的 Top-10 不同（9/8/7/6/5/4/3 开头挤在前面）。 */
export interface 金额乱序数据集 {
  项目: string
  主账号: string
}

export async function 种金额乱序数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<金额乱序数据集> {
  const 项目 = "p-资金流金额序"
  const 主账号 = "6222021234567897000"
  // 字符串降序前 10 = 9000, 8000, 7000, 6000, 50000, 5000, 4000, 3000, 20000, 100000；
  // 数值降序前 10 = 100000, 50000, 30000, 20000, 9000, 8000, 7000, 6000, 5000, 4000。
  // 两序的入选集合与顺序都不同，且共 12 笔 ⇒ 同时覆盖「选错」与「排错」。
  const 金额们 = [
    "100000.00",
    "50000.00",
    "30000.00",
    "20000.00",
    "9000.00",
    "8000.00",
    "7000.00",
    "6000.00",
    "5000.00",
    "4000.00",
    "3000.00",
    "1000.00",
  ]
  const 行们: (string | number)[][] = [
    流水表头,
    ...金额们.map((金额, i) => [
      `2026-10-${String(i + 1).padStart(2, "0")} 10:00:00`,
      主账号,
      "金额序主户",
      `6222021234567897${String(i + 1).padStart(3, "0")}`,
      `金额序对手${i + 1}`,
      "收",
      金额,
      "0.00",
      "",
      "CNY",
    ]),
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3金额序流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  return { 项目, 主账号 }
}

/** 混币关系数据集：同一对账户一笔 CNY、一笔 USD ⇒ 关系 `times=2 / times_cny=1 / amount=100.00`。 */
export interface 混币关系数据集 {
  项目: string
  主账号: string
  对手账号: string
}

export async function 种混币关系数据集(
  db: Queryable,
  文件: Map<string, Uint8Array>,
): Promise<混币关系数据集> {
  const 项目 = "p-混币"
  const 主账号 = "6222021234567898000"
  const 对手账号 = "6222021234567898001"
  const 行们: (string | number)[][] = [
    流水表头,
    ["2026-11-01 10:00:00", 主账号, "混币主户", 对手账号, "混币对手", "付", "100.00", "0.00", "", "CNY"],
    ["2026-11-02 10:00:00", 主账号, "混币主户", 对手账号, "混币对手", "付", "50.00", "0.00", "", "USD"],
  ]
  const 入队 = 造入队器(db, 文件)
  const 跑 = 造跑器(db, 文件)
  const 流水 = await 入队(项目, "P3混币流水.xlsx", 造工作簿(行们, "流水"))
  await 跑(流水)
  return { 项目, 主账号, 对手账号 }
}
