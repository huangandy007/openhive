import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test"

/**
 * 2026-11-24 · **worker 不可用时 markdown 仍要渲染**。
 *
 * 真实现场（用户浏览器 F12）：`markdown.worker.ts` 脚本没加载起来（`onerror` 的 message 为空），
 * `getWorker()` 把模块级 `disabled` 置位后**永不复位**；此后每次渲染 markdown，`projectMarkdown`
 * 都在**同步路径**上抛 `MarkdownWorkerUnavailableError`，而它正处在 `createResource` 的 fetcher 里
 * ⇒ 异常逃进 Solid 的 `createComputed`，整块 markdown 变成一条报错（栈：`markdown-worker.ts:91`
 * → `:43` → `markdown.tsx` → `createComputed`）。
 *
 * 这里钉住的约定：worker 起不来时降级到**主线程** `project()`，resolve 出与 worker 同形的投影，
 * 同步路径上不抛；提醒只打一次，别让流式渲染把控制台刷满。
 *
 * fixture 两件（都不是产品代码的接缝，只在测试里替换全局/模块）：
 * ① `?worker&url` 用 mock 顶掉——bun 会真的把这个 specifier 解析到 `markdown.worker.ts` 并报
 *    `Missing 'default' export`（实测）；
 * ② `Worker` 换成构造即抛的类——真浏览器里「脚本加载失败」走的是 `onerror`（异步），这里只要让
 *    `getWorker()` 的 catch 分支必走。
 */
void mock.module("./markdown.worker.ts?worker&url", () => ({ default: "/markdown.worker.js" }))

const { projectMarkdown } = await import("./markdown-worker")

const RealWorker = globalThis.Worker

beforeAll(() => {
  // @ts-expect-error 故意用构造即抛的假 Worker：只覆盖失败路径，不需要真 Worker 接口
  globalThis.Worker = function Worker() {
    throw new Error("worker unavailable")
  }
})

afterAll(() => {
  globalThis.Worker = RealWorker
})

describe("worker 不可用", () => {
  test("projectMarkdown 不在同步路径抛错，改走主线程投影", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const first = projectMarkdown("k", "```js\nconst a = 1\n```", true)
      expect(first instanceof Promise).toBe(true)
      const projection = await first
      expect(projection.text).toBe("```js\nconst a = 1\n```")
      expect(projection.blocks).toHaveLength(1)
      expect(projection.blocks[0]?.mode).toBe("code")
      expect(projection.blocks[0]?.src).toBe("const a = 1")
      expect(warn).toHaveBeenCalledTimes(1)

      await projectMarkdown("k", "```js\nconst a = 1\nconst b = 2\n```", true)
      expect(warn).toHaveBeenCalledTimes(1) // 只提醒一次
    } finally {
      warn.mockRestore()
    }
  })
})
