import { afterEach, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { CaseStatusBadge } from "./case-status-badge"
import {
  入队不可用原因,
  取消不可用原因,
  可解析路径,
  查看不可用原因,
  标记形状,
  汇总全部,
  文件待入队,
  目录下待入队,
  悬停文案,
  选中集入队范围,
  选中集待入队,
  跳过不可用原因,
  重新解析不可用原因,
  状态文案,
  type 亮灯依据,
} from "./case-materials-view"
// `视图行` 是**测试夹具**（brief Step 5 / 计划 Task 7、Task 8 同样从 test-support 取），
// 不放进生产模块——否则夹具会被打进浏览器包。
import { 假材料状态, 视图行 } from "./case-materials.test-support"

const 扩展名 = [".xlsx", ".xls", ".csv"]
const 挂过的: Array<() => void> = []
afterEach(() => 挂过的.splice(0).forEach((卸载) => 卸载()))

const 悬 = (partial: Parameters<typeof 视图行>[0]) => 悬停文案(视图行(partial), 扩展名)

test("标记形状：运行中半圆、已解析勾、有问题叹号；未入队/已跳过不标记", () => {
  expect(标记形状("排队中")).toBe("half")
  expect(标记形状("解析中")).toBe("half")
  expect(标记形状("已解析")).toBe("check")
  expect(标记形状("有问题")).toBe("alert")
  expect(标记形状("未入队")).toBeUndefined()
  expect(标记形状("已跳过")).toBeUndefined()
})

test("悬停文案：已解析带事实数与号码数；排队中带前面还有几个", () => {
  expect(悬({ path: "a.xlsx", status: "已解析", factCount: 12, numberCount: 3 })).toBe(
    "已解析 · 12 条事实 · 3 个号码",
  )
  expect(悬({ path: "a.xlsx", status: "排队中", queueAhead: 4 })).toBe("排队中，前面还有 4 个")
})

test("悬停文案：有问题优先说 reason；没有 reason 说段数；都没有不说数字", () => {
  expect(悬({ path: "a.xlsx", status: "有问题", detail: { reason: "时间列认不出" } })).toBe("时间列认不出")
  expect(
    悬({
      path: "a.xlsx",
      status: "有问题",
      detail: { slices: [{ range: "1-200", reason: "回读失败", count: 2 }] },
    }),
  ).toBe("有 1 段未通过校验，点击查看")
  expect(悬({ path: "a.xlsx", status: "有问题" })).toBe("解析没通过，点击查看")
})

test("悬停文案：未入队分「能解析」与「系统不解析」；已跳过说清是用户跳的", () => {
  expect(悬({ path: "a.xlsx", status: "未入队", parseable: true })).toBe("未入队 · 右键「解析」可入库")
  expect(悬({ path: "a.pdf", status: "未入队", parseable: false })).toBe("未入队 · 系统不解析这类文件")
  expect(悬({ path: "a.xlsx", status: "未入队", kind: "产物", parseable: true })).toBe(
    "未入队 · 系统不解析这类文件",
  )
  expect(悬({ path: "a.xlsx", status: "已跳过" })).toBe("已跳过 · 你手动跳过了解析")
})

test("目录汇总按全量清单算：嵌套、排除非表格与产物、归到每一层祖先", () => {
  const 行们 = [
    视图行({ path: "资料/8·17/话单.csv", status: "已解析" }),
    视图行({ path: "资料/8·17/流水.xlsx", status: "有问题" }),
    视图行({ path: "资料/说明.pdf", status: "已解析" }),
    视图行({ path: "资料/结论.xlsx", status: "未入队", kind: "产物" }),
  ]
  const 汇 = 汇总全部(
    ["资料/8·17/话单.csv", "资料/8·17/流水.xlsx", "资料/说明.pdf", "资料/结论.xlsx", "笔记.md"],
    行们,
    扩展名,
  )

  expect(汇.get("资料/8·17")).toEqual({ 已解析: 1, 总数: 2, 有问题: 1 })
  expect(汇.get("资料")).toEqual({ 已解析: 1, 总数: 2, 有问题: 1 })
  expect(汇.get("")).toEqual({ 已解析: 1, 总数: 2, 有问题: 1 })
  expect(汇.get("笔记.md")).toBeUndefined()
})

test("目录汇总：没有材料行的可解析文件算「未入队」，计入总数但不计已解析", () => {
  const 汇 = 汇总全部(["资料/待入队.xlsx", "资料/已解析.xlsx"], [视图行({ path: "资料/已解析.xlsx", status: "已解析" })], 扩展名)
  expect(汇.get("资料")).toEqual({ 已解析: 1, 总数: 2, 有问题: 0 })
})

test("目录下待入队：只收会被入队的（未入队 / 有问题 / 无行），排除已解析、已跳过与运行中", () => {
  const 行们 = [
    视图行({ path: "资料/已解析.xlsx", status: "已解析" }),
    视图行({ path: "资料/有问题.xlsx", status: "有问题" }),
    视图行({ path: "资料/排队.xlsx", status: "排队中" }),
    视图行({ path: "资料/解析中.xlsx", status: "解析中" }),
    视图行({ path: "资料/跳过.xlsx", status: "已跳过" }),
    视图行({ path: "资料/其他.xlsx", status: "未入队" }),
  ]
  const 文件们 = [
    "资料/已解析.xlsx",
    "资料/有问题.xlsx",
    "资料/排队.xlsx",
    "资料/解析中.xlsx",
    "资料/跳过.xlsx",
    "资料/其他.xlsx",
    "资料/没行.xlsx",
    "资料/说明.pdf",
    "资料/产物.xlsx",
    "资料2/不该进.xlsx",
  ]
  const 候选 = 目录下待入队("资料", 文件们, [...行们, 视图行({ path: "资料/产物.xlsx", kind: "产物" })], 扩展名)
  // 「已跳过」不在里面：跳过是人的意志（设计 §5.2），一次文件夹批量不该把它悄悄翻回来。
  expect([...候选].sort()).toEqual(["资料/有问题.xlsx", "资料/其他.xlsx", "资料/没行.xlsx"].sort())
})

test("文件待入队：候选判据只有这一份——未入队 / 有问题 / 无行可入，其余一律不可", () => {
  // 可入队的三类。
  expect(文件待入队("资料/未入队.xlsx", 视图行({ path: "资料/未入队.xlsx", status: "未入队" }), 扩展名)).toBe(true)
  expect(文件待入队("资料/有问题.xlsx", 视图行({ path: "资料/有问题.xlsx", status: "有问题" }), 扩展名)).toBe(true)
  // 没有材料行（还没登记过）也算候选。
  expect(文件待入队("资料/没行.xlsx", undefined, 扩展名)).toBe(true)

  // 不可入队：已解析 / 已跳过 / 排队中 / 解析中 / 产物 / 不可解析扩展名。
  expect(文件待入队("资料/已解析.xlsx", 视图行({ path: "资料/已解析.xlsx", status: "已解析" }), 扩展名)).toBe(false)
  expect(文件待入队("资料/跳过.xlsx", 视图行({ path: "资料/跳过.xlsx", status: "已跳过" }), 扩展名)).toBe(false)
  expect(文件待入队("资料/排队.xlsx", 视图行({ path: "资料/排队.xlsx", status: "排队中" }), 扩展名)).toBe(false)
  expect(文件待入队("资料/解析中.xlsx", 视图行({ path: "资料/解析中.xlsx", status: "解析中" }), 扩展名)).toBe(false)
  expect(文件待入队("资料/产物.xlsx", 视图行({ path: "资料/产物.xlsx", status: "未入队", kind: "产物" }), 扩展名)).toBe(
    false,
  )
  expect(文件待入队("资料/说明.pdf", 视图行({ path: "资料/说明.pdf", status: "未入队", parseable: false }), 扩展名)).toBe(
    false,
  )
})

test("选中集待入队：文件与目录混选按输入顺序展开，同一文件只出现一次", () => {
  const 文件们 = ["资料/未入队.xlsx", "资料/其他.xlsx"]
  // 「资料」先展开出两份；后面再选中同一份文件不能重复出现，顺序也不许变。
  expect(选中集待入队(["资料", "资料/未入队.xlsx"], 文件们, [], 扩展名)).toEqual([
    "资料/未入队.xlsx",
    "资料/其他.xlsx",
  ])
})

test("选中集待入队：选中的目录里一个候选都没有 ⇒ 空（已解析 / 非表格都不算）", () => {
  const 行们 = [
    视图行({ path: "资料/已解析.xlsx", status: "已解析" }),
    视图行({ path: "资料/说明.pdf", parseable: false }),
  ]
  expect(选中集待入队(["资料"], ["资料/已解析.xlsx", "资料/说明.pdf"], 行们, 扩展名)).toEqual([])
})

test("选中集待入队：已跳过的表格不进候选——直接选中与随目录展开都一样", () => {
  const 行们 = [视图行({ path: "资料/跳过.xlsx", status: "已跳过" })]
  const 文件们 = ["资料/跳过.xlsx", "资料/未入队.xlsx"]
  expect(选中集待入队(["资料/跳过.xlsx"], 文件们, 行们, 扩展名)).toEqual([])
  expect(选中集待入队(["资料"], 文件们, 行们, 扩展名)).toEqual(["资料/未入队.xlsx"])
})

test("选中集待入队：不可解析扩展名（PDF）即使被选中也不进候选", () => {
  expect(选中集待入队(["资料/说明.pdf"], ["资料/说明.pdf", "资料/其他.xlsx"], [], 扩展名)).toEqual([])
})

test("T010-fix：目录展开按归一分隔符匹配，返回 posix 形候选", () => {
  // win32 下服务端 `fs.list` 给的是带反斜杠的原样路径，而树节点 `path` 已被
  // `normalizeFileTreeV2Path` 归一成 `资料`。候选要回写给解析入口（它按 `/` 切段、拒收 `\`），
  // 所以比较与输出都必须走归一形。
  expect(
    目录下待入队("资料", ["资料\\甲.csv", "资料\\乙.xlsx", "其他\\丙.csv"], [], [".csv", ".xlsx"]),
  ).toEqual(["资料/甲.csv", "资料/乙.xlsx"])
})

test("T010-fix：反斜杠清单上的已解析排除仍然生效（行表按归一键查）", () => {
  const 行们 = [视图行({ path: "资料/甲.csv", status: "已解析" })]
  expect(目录下待入队("资料", ["资料\\甲.csv", "资料\\乙.xlsx"], 行们, [".csv", ".xlsx"])).toEqual([
    "资料/乙.xlsx",
  ])
  // 行自己带着原始分隔符时，归一键也必须能对上——否则已解析会被当成「未入队」重复入队。
  const 反斜杠行们 = [视图行({ path: "资料\\甲.csv", status: "已解析" })]
  expect(目录下待入队("资料", ["资料\\甲.csv", "资料\\乙.xlsx"], 反斜杠行们, [".csv", ".xlsx"])).toEqual([
    "资料/乙.xlsx",
  ])
})

test("T010-fix：选中目录在反斜杠清单上能展开，候选归一且不误算被排除", () => {
  const { 候选, 被排除的选中项 } = 选中集入队范围(
    ["资料"],
    ["资料\\甲.csv", "资料\\乙.xlsx", "其他\\丙.csv"],
    [],
    [".csv", ".xlsx"],
  )
  expect(候选).toEqual(["资料/甲.csv", "资料/乙.xlsx"])
  expect(被排除的选中项).toBe(0)
})

test("T010-fix：空目录项 `资料\\` 不被当成文件候选", () => {
  const { 候选, 被排除的选中项 } = 选中集入队范围(
    ["资料"],
    ["资料\\", "资料\\甲.csv"],
    [],
    [".csv", ".xlsx"],
  )
  expect(候选).toEqual(["资料/甲.csv"])
  expect(被排除的选中项).toBe(0)
})

test("可解析路径：只看扩展名，大小写不敏感", () => {
  expect(可解析路径("资料/话单.XLSX", 扩展名)).toBe(true)
  expect(可解析路径("资料/笔录.pdf", 扩展名)).toBe(false)
})

const 依据 = (partial: Partial<亮灯依据> & { path: string }): 亮灯依据 => ({
  isFile: true,
  row: undefined,
  extensions: 扩展名,
  rowsLoaded: true,
  readFailed: false,
  接入: true,
  有对象: true,
  hasReview: true,
  ...partial,
})

test("亮灯：未入队表格能入队；已解析只能重新解析；运行中只能取消", () => {
  expect(入队不可用原因(依据({ path: "资料/a.xlsx" }))).toBeUndefined()
  expect(入队不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "已解析" }) }))).toBe(
    "已经解析过了，要重来请用「重新解析」",
  )
  expect(重新解析不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "已解析" }) }))).toBeUndefined()
  expect(取消不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "排队中" }) }))).toBeUndefined()
  expect(取消不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "已解析" }) }))).toBe(
    "这份文件现在没有在排队或解析",
  )
})

test("亮灯：非表格只亮「跳过」；产物五项全灰；未接入全灰", () => {
  const 非表格 = 依据({ path: "资料/笔录.pdf", row: 视图行({ path: "资料/笔录.pdf", parseable: false }) })
  expect(入队不可用原因(非表格)).toBe("该类型的解析在后续计划")
  expect(跳过不可用原因(非表格)).toBeUndefined()

  const 产物 = 依据({ path: "分析/结论.xlsx", row: 视图行({ path: "分析/结论.xlsx", kind: "产物" }) })
  for (const 原因 of [入队不可用原因(产物), 重新解析不可用原因(产物), 取消不可用原因(产物), 跳过不可用原因(产物), 查看不可用原因(产物)]) {
    expect(原因).toBeTruthy()
  }
  expect(入队不可用原因(产物)).toBe("产物只登记不解析")
  expect(跳过不可用原因(产物)).toBe("产物只登记不解析")

  const 未接入 = 依据({ path: "资料/a.xlsx", 接入: false })
  expect(入队不可用原因(未接入)).toBe("解析状态还没接上")
})

test("亮灯：目录始终可点（候选为 0 由确认弹窗解释）；「查看」没接收方时明说后续计划", () => {
  // 候选数不再参与亮灯：文件夹的「解析入库」永远放行到确认弹窗，N=0 时由弹窗正文
  // 说清原因、确认键置灰——灰在菜单项上的话，用户根本看不到那句解释（弹窗不打开）。
  expect(入队不可用原因(依据({ path: "资料", isFile: false }))).toBeUndefined()
  expect(查看不可用原因(依据({ path: "资料/a.xlsx", hasReview: false }))).toBe("抽取结果面板在后续计划")
  expect(
    查看不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "已解析" }) })),
  ).toBeUndefined()
})

test("标记组件：形状、颜色语义、aria-label 三样都有；未标记状态不画节点", () => {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <>
          <CaseStatusBadge status="已解析" 文案="已解析 · 1 条事实 · 1 个号码" />
          <CaseStatusBadge status="未入队" 文案="不该画出来" />
        </>
      ),
      host,
    ),
  )

  const 标记 = host.querySelector<HTMLElement>("[data-slot='file-tree-parse-badge']")
  expect(标记?.getAttribute("data-shape")).toBe("check")
  expect(标记?.getAttribute("aria-label")).toBe("已解析 · 1 条事实 · 1 个号码")
  expect(host.querySelectorAll("[data-slot='file-tree-parse-badge']").length).toBe(1)
})

test("标记组件：颜色语义 success / warning / info 各在其位", () => {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <>
          <CaseStatusBadge status="已解析" 文案="a" />
          <CaseStatusBadge status="有问题" 文案="b" />
          <CaseStatusBadge status="排队中" 文案="c" />
          <CaseStatusBadge status="解析中" 文案="d" />
        </>
      ),
      host,
    ),
  )
  const 取 = (status: string) =>
    host.querySelector<HTMLElement>(`[data-slot='file-tree-parse-badge'][data-status='${status}']`)

  // `classList.contains` 是**整词**判定：颜色对调会被抓住（`#006-22` 的子串匹配抓不住）。
  expect(取("已解析")?.classList.contains("text-v2-state-fg-success")).toBe(true)
  expect(取("有问题")?.classList.contains("text-v2-state-fg-warning")).toBe(true)
  expect(取("排队中")?.classList.contains("text-v2-state-fg-info")).toBe(true)
  expect(取("解析中")?.classList.contains("text-v2-state-fg-info")).toBe(true)
})

test("悬停文案：解析中说清「已提交的结果会保留」", () => {
  expect(悬({ path: "a.xlsx", status: "解析中" })).toBe("正在解析，已提交的结果会保留")
})

test("状态文案：未接入 / 无对象 / 文件夹 / 读取中", () => {
  expect(状态文案({ isFile: true, loaded: true, 接入: false, 有对象: true })).toBe("未接入")
  expect(状态文案({ isFile: true, loaded: true, 接入: true, 有对象: false })).toBe("")
  expect(状态文案({ isFile: false, loaded: true, 接入: true, 有对象: true })).toBe("文件夹")
  expect(状态文案({ isFile: true, loaded: false, 接入: true, 有对象: true })).toBe("读取中")
})

test("状态文案：首拉失败说「读取失败」，不是一直「读取中」", () => {
  // 五个解析子项已经按 `readFailed` 说「读取失败」；触发项右边若还说「读取中」，
  // 就是同一份状态两句话（终审 F3）。
  const 基础 = { isFile: true, loaded: false, 接入: true, 有对象: true }
  expect(状态文案({ ...基础, readFailed: true })).toBe("读取失败")
  // 对照：没失败过 ⇒ 仍是「读取中」；老调用不传这个字段也不能变。
  expect(状态文案({ ...基础, readFailed: false })).toBe("读取中")
  expect(状态文案(基础)).toBe("读取中")
})

test("状态文案：多选时写「已选 K 项」，优先于文件夹 / 行状态", () => {
  // T009：selection 作用域下触发项右侧回答的是「这一次动作带了几项」，不是某一行状态。
  expect(状态文案({ isFile: true, loaded: true, 接入: true, 有对象: true, 选中集大小: 3 })).toBe("已选 3 项")
  // 右键的是目录也照样写 K——多选动作的对象是整批，不是那一行。
  expect(状态文案({ isFile: false, loaded: true, 接入: true, 有对象: true, 选中集大小: 2 })).toBe("已选 2 项")
  // 对照：只有 1 项（单选）/ 没传 ⇒ 行为逐字不变。
  expect(
    状态文案({ isFile: true, loaded: true, 接入: true, 有对象: true, 选中集大小: 1 }),
  ).toBe("未入队")
  // 多选也不能盖过公共闸：未接入 / 无对象仍回原话。
  expect(状态文案({ isFile: true, loaded: true, 接入: false, 有对象: true, 选中集大小: 3 })).toBe("未接入")
  expect(状态文案({ isFile: true, loaded: true, 接入: true, 有对象: false, 选中集大小: 3 })).toBe("")
})

test("状态文案：无材料行且不可解析 ⇒ 与悬停同一句话（系统不解析这类文件）", () => {
  // N3：同一份文件，行提示说「系统不解析这类文件」、子菜单状态却说「未入队」——两句话矛盾。
  expect(
    状态文案({
      isFile: true,
      loaded: true,
      接入: true,
      有对象: true,
      path: "资料/笔录.pdf",
      extensions: 扩展名,
    }),
  ).toBe("系统不解析这类文件")
  // 对照：可解析但没有材料行，仍然是「未入队」（右键能入库的那一档）。
  expect(
    状态文案({
      isFile: true,
      loaded: true,
      接入: true,
      有对象: true,
      path: "资料/待入队.xlsx",
      extensions: 扩展名,
    }),
  ).toBe("未入队")
})

test("亮灯：读取失败与正在读取是两种话，五项一律不按「未入队」推演", () => {
  const 失败 = 依据({ path: "资料/a.xlsx", rowsLoaded: false, readFailed: true })
  const 失败文案 = "解析状态读取失败，请右键刷新重试"
  expect(入队不可用原因(失败)).toBe(失败文案)
  expect(重新解析不可用原因(失败)).toBe(失败文案)
  expect(取消不可用原因(失败)).toBe(失败文案)
  expect(跳过不可用原因(失败)).toBe(失败文案)
  expect(查看不可用原因(失败)).toBe(失败文案)

  // 还没有过结果、也没报错 ⇒ 仍是「请稍候」。
  expect(入队不可用原因(依据({ path: "资料/a.xlsx", rowsLoaded: false, readFailed: false }))).toBe(
    "解析状态还在读取，请稍候",
  )
})

test("亮灯：有问题的文件可以重新解析（别把它误判成灰）", () => {
  expect(
    重新解析不可用原因(依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "有问题" }) })),
  ).toBeUndefined()
})

test("亮灯：已跳过不能再跳过（点击必 409）；但「入队」仍亮（那一份的明确动作）", () => {
  const 已跳过 = 依据({ path: "资料/a.xlsx", row: 视图行({ path: "资料/a.xlsx", status: "已跳过" }) })
  expect(跳过不可用原因(已跳过)).toBe("已经跳过了")
  expect(入队不可用原因(已跳过)).toBeUndefined()
})

test("亮灯：状态未读出来时全灰，不按「未入队」推演", () => {
  // 文件实际已解析，但首屏 `rows` 还没读回来（`loaded=false`）：按「未入队」推演会让
  // 「解析入库」亮着、点下去 409——与「前端不本地推演状态」相悖。
  const 假 = 假材料状态({ loaded: false })
  const 读后 = (path: string, isFile: boolean): 亮灯依据 =>
    依据({
      path,
      isFile,
      rowsLoaded: 假.状态.loaded(),
      row: 假.状态.rows().find((row) => row.path === path),
    })

  expect(入队不可用原因(读后("资料/已解析.xlsx", true))).toBe("解析状态还在读取，请稍候")
  // 目录批量也挡：rows 没读出来时算出的候选不可信。
  expect(入队不可用原因(读后("资料", false))).toBe("解析状态还在读取，请稍候")
})
