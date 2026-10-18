import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import type { SheetMeta, 解析限制 } from "./sheet-model"
import { 解析表格, type 解析回调, type WorkerLike } from "./sheet-parse"

function 工作簿字节(表: unknown[][]): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), "明细")
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

const 小限制: 解析限制 = {
  首屏行数: 1,
  预览行数: 3,
  预览列数: 4,
  全量行上限: 100,
  全量格上限: 1000,
  全量列上限: 4,
  分块行数: 2,
}

function 收集() {
  const 事件: string[] = []
  let meta: SheetMeta | undefined
  let done: ["full" | "preview", { rows: number; cols: number }] | undefined
  const errors: unknown[] = []
  const 回调: 解析回调 = {
    onMeta: (m) => {
      meta = m
      事件.push("meta")
    },
    onChunk: () => 事件.push("chunk"),
    onDone: (mode, truncated) => {
      done = [mode, truncated]
      事件.push("done")
    },
    onError: (kind, message) => {
      errors.push([kind, message])
      事件.push("error")
    },
  }
  return { 回调, 事件, get meta() { return meta }, get done() { return done }, errors }
}

const 等 = async (fn: () => boolean, timeout = 3000) => {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("等待超时")
    await new Promise((r) => setTimeout(r, 10))
  }
}

class 假Worker implements WorkerLike {
  static 最后: 假Worker
  posted: any
  terminated = false
  listeners = new Map<string, Set<(event: any) => void>>()
  constructor() {
    假Worker.最后 = this
  }
  postMessage(message: unknown) {
    this.posted = message
  }
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener)
  }
  terminate() {
    this.terminated = true
  }
  发(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) listener({ data })
  }
}

describe("解析客户端：主线程降级", () => {
  test("meta → chunk → done 顺序，且 ready 在 meta 后 resolve", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"], ["张三"], ["李四"], ["王五"]]), c.回调, {
      强制主线程: true,
      limits: 小限制,
    })
    await task.ready
    expect(c.事件[0]).toBe("meta")
    await 等(() => c.事件.includes("done"))
    expect(c.事件.at(-1)).toBe("done")
    expect(c.done?.[0]).toBe("full")
  })

  test("加密：ready reject 为「需要密码」，onError 为 password", async () => {
    const { 加密的Office容器 } = await import("../__fixtures__/office")
    const c = 收集()
    const task = 解析表格(加密的Office容器(["/encryption"]), c.回调, { 强制主线程: true, limits: 小限制 })
    await expect(task.ready).rejects.toThrow(/加密/)
    expect(c.errors[0]).toEqual(["password", expect.any(String)])
  })

  test("Worker 创建失败时自动降级主线程", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"], ["张三"]]), c.回调, {
      limits: 小限制,
      创建Worker: () => {
        throw new Error("no worker")
      },
    })
    await task.ready
    expect(c.meta?.header).toEqual(["姓名"])
  })
})

describe("解析客户端：Worker 协议", () => {
  test("meta/chunk/done 按 id 转发；陈旧 id 丢弃", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"]]), c.回调, { 创建Worker: () => new 假Worker(), limits: 小限制 })
    const worker = 假Worker.最后
    expect(worker.posted.limits).toEqual(小限制)
    const id = worker.posted.id as number

    worker.发({ type: "meta", id: id + 1, meta: { header: ["旧"] } })
    expect(c.事件).toEqual([])

    worker.发({
      type: "meta",
      id,
      meta: {
        sheetNames: ["明细"],
        sheetName: "明细",
        startRow: 0,
        startCol: 0,
        totalRows: 1,
        totalCols: 1,
        header: ["姓名"],
        preview: [["姓名"]],
        columnTypes: ["text"],
      },
    })
    await task.ready
    worker.发({ type: "chunk", id, start: 1, rows: [["张三"]] })
    worker.发({ type: "done", id, mode: "full", truncatedRows: 0, truncatedCols: 0 })
    expect(c.事件).toEqual(["meta", "chunk", "done"])
  })

  test("cancel 后终止 Worker，不再回调", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"]]), c.回调, { 创建Worker: () => new 假Worker(), limits: 小限制 })
    const worker = 假Worker.最后
    const id = worker.posted.id as number
    task.cancel()
    worker.发({ type: "meta", id, meta: { header: ["姓名"] } })
    expect(c.事件).toEqual([])
    expect(worker.terminated).toBe(true)
  })
})
