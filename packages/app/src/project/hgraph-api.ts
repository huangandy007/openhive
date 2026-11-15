/**
 * 关系图 HTTP 客户端（012 · T007）。
 *
 * 与 `entity-api.ts` / `case-alerts-api.ts` 同一套范式：同源相对路径、可注入的 `send`、
 * **失败不抛**（收成 `{ kind: "error", message, code? }`）。
 *
 * ## 四端点形状照**代码事实**（T006 已交付，`hgraph-ops.ts`）
 *
 * `read` 是 **GET + query**（`:702`），其余三个是 **POST + JSON 体**（`:629-641`）。
 * 错误体是 `{ error, code, 最新版本? }`（`回()`，`:673-683`）。
 *
 * ## 为什么 `写` 走 `请求带错误体`
 *
 * 409 `VERSION_CONFLICT` 的响应体另带 `最新版本`（契约 hgraph-ops §5）；`请求` 只收
 * `message` / `code`，会把这个字段丢掉，前端就无从决定「重新载入」到哪一版。其余三个方法
 * 的失败分支不需要额外字段，走 `请求` 即可。
 *
 * ## projectId 是**显式必填**入参（契约 ui.md §2）
 *
 * **不在本模块内部读 `currentProject()`**：那个单例只代表「此刻打开的是哪个项目」，而一张
 * 标签页可能比它活得久——打开关系图后再切项目，内部读会把这次写落到**晚到的**项目上
 * （`#010-06`）。由调用方（视图）在挂载时读一次、向下传，读的是「打开这张图时」的项目。
 *
 * 没有项目（空串 / 未定义）⇒ **不发请求**：带空 id 发出去，服务端会退回沙箱根，读写的
 * 可能是别的项目的同名文件。四个方法共用同一道闸（`有项目时`，`#002-06`）。
 */
import { 默认发送, 请求, 请求带错误体, type CaseFetch, type 结果 } from "./entity-api"

export const PREFIX = "/openhive/hgraph"

/** 没有当前项目时那句话（与 `openhive-file-saver.ts` 的「不发请求」同一取向）。 */
export const 没项目 = "现在没有打开的项目，打不开关系图。"

/** 与后端 `hgraph-edit.ts:70-77` 的 `操作` 联合类型逐字对应（前端只发、不解释）。 */
export interface 加节点操作 {
  readonly 操作: "加节点"
  readonly 节点: readonly Record<string, unknown>[]
}
export interface 加边操作 {
  readonly 操作: "加边"
  readonly 边: readonly Record<string, unknown>[]
}
export interface 加文字操作 {
  readonly 操作: "加文字"
  readonly 文字: readonly Record<string, unknown>[]
}
export interface 改字段操作 {
  readonly 操作: "改字段"
  readonly 目标: readonly { readonly 类别: "节点" | "边" | "文字"; readonly id: string; readonly 补丁: Record<string, unknown> }[]
}
export interface 删对象操作 {
  readonly 操作: "删对象"
  readonly 目标: readonly { readonly 类别: "节点" | "边" | "文字"; readonly id: string }[]
}
export interface 移动操作 {
  readonly 操作: "移动"
  readonly 目标: readonly { readonly 类别: "节点" | "文字"; readonly id: string; readonly x: number; readonly y: number }[]
}
export interface 合并节点操作 {
  readonly 操作: "合并节点"
  readonly 保留: string
  readonly 并入: readonly string[]
}

export type 操作 =
  | 加节点操作
  | 加边操作
  | 加文字操作
  | 改字段操作
  | 删对象操作
  | 移动操作
  | 合并节点操作

/** 与后端 `hgraph-ops.ts:112-119` 的 `操作结果` 逐字对应。 */
export interface 操作结果 {
  readonly 映射: Record<string, string>
  readonly 复用: string[]
  readonly 新增: { 节点: number; 边: number; 文字: number }
  readonly 更新: number
  readonly 删除: { 节点: number; 边: number }
  readonly 批次?: string
}

/** `POST /ops` 的 200 体（契约 hgraph-ops §5）。 */
export interface 写结果 {
  readonly 版本: string
  readonly 结果: 操作结果
  readonly 重放: boolean
}

/** 写应答：`结果<T>` 之外，409 时多带盘上最新版本。 */
export type 写应答 = 结果<写结果> & { readonly 最新版本?: string }

export interface HgraphApi {
  readonly 读: (input: { projectId: string; path: string }) => Promise<结果<{ 内容: string; 版本: string }>>
  readonly 初始化: (input: {
    projectId: string
    path: string
  }) => Promise<结果<{ 内容: string; 版本: string; 写入: boolean }>>
  readonly 写: (input: {
    projectId: string
    path: string
    版本?: string
    操作: 操作[]
    批次?: string
    幂等键?: string
  }) => Promise<写应答>
  readonly 导出许可: (input: {
    projectId: string
    path: string
  }) => Promise<结果<{ 允许: true; 文件名: string }>>
}

const 体 = (init: RequestInit) => ({
  ...init,
  headers: { "content-type": "application/json" },
})

/** 四个方法共用的「没项目就不发请求」那道闸——判据只有这一处（`#002-06`）。 */
async function 有项目时<T>(
  projectId: string | undefined,
  执行: (id: string) => Promise<结果<T>>,
): Promise<结果<T>> {
  if (projectId === undefined || projectId === "") return { kind: "error", message: 没项目 }
  return await 执行(projectId)
}

export function createHgraphApi(send: CaseFetch = 默认发送): HgraphApi {
  return {
    读: async ({ projectId, path }) =>
      await 有项目时(projectId, async (id) => {
        const 参数 = new URLSearchParams({ projectId: id, path })
        return await 请求<{ 内容: string; 版本: string }>(send, `${PREFIX}/read?${参数.toString()}`)
      }),

    初始化: async ({ projectId, path }) =>
      await 有项目时(projectId, async (id) => {
        return await 请求<{ 内容: string; 版本: string; 写入: boolean }>(
          send,
          `${PREFIX}/init`,
          体({ method: "POST", body: JSON.stringify({ projectId: id, path }) }),
        )
      }),

    写: async (input) =>
      await 有项目时(input.projectId, async (id) => {
        const 回 = await 请求带错误体<写结果>(
          send,
          `${PREFIX}/ops`,
          体({
            method: "POST",
            // 可选字段**缺了就整个不写**：后端把 `版本: null` 当请求形状错误（BAD_REQUEST）。
            body: JSON.stringify({
              projectId: id,
              path: input.path,
              ...(input.版本 === undefined ? {} : { 版本: input.版本 }),
              操作: input.操作,
              ...(input.批次 === undefined ? {} : { 批次: input.批次 }),
              ...(input.幂等键 === undefined ? {} : { 幂等键: input.幂等键 }),
            }),
          }),
        )
        if (回.kind === "ok") return { kind: "ok", value: 回.value }

        const 错误体 = 回.错误体
        const 最新版本 =
          typeof 错误体 === "object" && 错误体 !== null && "最新版本" in 错误体 ? 错误体.最新版本 : undefined
        return {
          kind: "error",
          message: 回.message,
          ...(回.code === undefined ? {} : { code: 回.code }),
          ...(typeof 最新版本 === "string" ? { 最新版本 } : {}),
        }
      }),

    导出许可: async ({ projectId, path }) =>
      await 有项目时(projectId, async (id) => {
        return await 请求<{ 允许: true; 文件名: string }>(
          send,
          `${PREFIX}/export`,
          体({ method: "POST", body: JSON.stringify({ projectId: id, path }) }),
        )
      }),
  }
}
