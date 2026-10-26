// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import { DataSource } from "./data-source"
import type { DataSourceApi, DataSourceRow } from "./data-source-api"

/**
 * 数据源配置（010 T012 / FR-011 / US6）。
 *
 * 四条 story 对应四种真实 DOM：有数据（三种类型各一行，最近同步全部「—」）/
 * 空（不预置假数据源）/ 错误（服务端明确拒绝）/ **血缘浮层打开态**（上游 → 本数据源 → 下游）。
 *
 * 第四条在挂载后点开第一行的「血缘」：axe 与视觉审阅都只看到首屏，浮层需要有人替它点开。
 * 「后端」是纯内存替身——story 不连网，也不往库里塞假事实。
 */

const 行 = (overrides: Partial<DataSourceRow> = {}): DataSourceRow => ({
  id: "s1",
  name: "话单库",
  kind: "database",
  endpoint: "pg://10.0.0.8:5432/cdr",
  frequency: "daily",
  owner: "科信支队 张三",
  status: "active",
  // connector 未落地：从来没有同步过，界面显示「—」。
  lastSyncedAt: null,
  createdBy: "u-甲",
  createdAt: 1_758_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_759_000_000,
  ...overrides,
})

const 三行: DataSourceRow[] = [
  行(),
  行({
    id: "s2",
    name: "资金交易明细",
    kind: "file",
    endpoint: "/data/funds/2026",
    frequency: "manual",
    owner: "经侦支队 李四",
    updatedAt: 1_758_900_000,
  }),
  行({
    id: "s3",
    name: "在逃人员接口",
    kind: "api",
    endpoint: "https://10.0.2.4/api/wanted",
    frequency: "hourly",
    owner: "",
    status: "disabled",
    updatedAt: 1_758_800_000,
  }),
]

function 假后端(值: readonly DataSourceRow[] = 三行): DataSourceApi {
  return {
    list: async () => ({ kind: "ok", value: 值 }),
    create: async (input) => ({ kind: "ok", value: 行({ ...input }) }),
    update: async (id, patch) => ({ kind: "ok", value: 行({ id, ...patch }) }),
    lineage: async (id) => ({
      kind: "ok",
      value: {
        source: 值.find((row) => row.id === id) ?? 行({ id }),
        upstream:
          id === "s1" ? [{ id: "s3", name: "在逃人员接口", kind: "api", status: "disabled" }] : [],
        downstream:
          id === "s1" ? [{ id: "s2", name: "资金交易明细", kind: "file", status: "active" }] : [],
      },
    }),
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/**
 * 挂载后点开第一行的「血缘」：三段式列表是这一页唯一需要「点了才看得到」的产物。
 *
 * ⚠️ 不能只 `queueMicrotask` 就点：行是 `list()` 回包**之后**才渲染的，那一刻按钮还不存在
 * （2026-10-26 实测：浮层永远打不开）。所以按 50ms 轮询等按钮出现，上限 2 秒。
 */
function 血缘态(props: { api: DataSourceApi }): JSX.Element {
  let 根: HTMLDivElement | undefined
  onMount(() => {
    const 试 = (剩余: number) => {
      const 按钮 = 根?.querySelector<HTMLElement>('[data-slot="data-source-lineage"]')
      if (按钮) {
        按钮.click()
        return
      }
      if (剩余 > 0) setTimeout(() => 试(剩余 - 1), 50)
    }
    queueMicrotask(() => 试(40))
  })
  return (
    <div ref={根}>
      <DataSource api={props.api} />
    </div>
  )
}

/** 有数据：数据库 / 文件 / 接口各一行；最近同步全部「—」（connector 未落地）。 */
export const 有数据 = {
  render: () => (
    <框架>
      <DataSource api={假后端()} />
    </框架>
  ),
}

/** 空：一个数据源都没登记过。文案明说「不预置任何假数据源」。 */
export const 空 = {
  render: () => (
    <框架>
      <DataSource api={假后端([])} />
    </框架>
  ),
}

/** 错误：服务端明确拒绝，红框 ＋ 重试。 */
export const 错误 = {
  render: () => (
    <框架>
      <DataSource api={{ ...假后端(), list: async () => ({ kind: "rejected", message: "没有数据源配置权限" }) }} />
    </框架>
  ),
}

/** 血缘：上游（接口，已停用）→ 话单库（数据库）→ 下游（文件）。 */
export const 血缘 = {
  render: () => (
    <框架>
      <血缘态 api={假后端()} />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/DataSource",
  id: "app-openhive-governance-data-source",
}
