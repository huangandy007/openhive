export * as OpenhiveCaseReferenceStore from "./case-reference-store"

/**
 * 016 T012 · N4 静态参考库 + 外部核验服务客户端。
 *
 * ## 参考库：整表载入内存，版本变了才重建
 *
 * 设计 FR-050 / research.md D10：参考库是**静态表**，富化时按 `(类别, 值)` 逐键查内存，
 * 不许逐键查库。`建参考库` 只做容器：数据源由注入的 `载入()` 提供（本期为空库，见 brief
 * Ruling K），`刷新` 在版本不变时**直接返回、不重建 Map**——每次材料都重建 1,000 条
 * 只会白白制造 GC 压力，且与「版本变了才刷新」的口径相反。
 *
 * 惰性载入：第一次 `刷新`（`富化` 开头会调）才真正调 `载入()`；`查` 是同步的，
 * 未载入时返回 `undefined`——调用方必须先 `await 刷新()`，别指望 `查` 自己异步加载。
 *
 * ## 外部服务：并发 4 / 超时 5s / 负缓存 10 分钟
 *
 * 三项都是**进程内存**（重启即失，非派生数据，见 data-model §11）。负缓存只记
 * `undefined` 结果；成功值进正缓存且**不设 TTL**（证件号 → 实名结论不会在进程生命周期内变）。
 *
 * 槽位**按 settled 释放**：超时只让调用方拿到 `undefined`，底层 `核验` 可能还在跑；
 * 若此刻就放行下一个，在飞数就成了假象。所以 `释放槽` 挂在服务调用自己的 `finally` 上
 * （`AbortController` 已 `abort()` 交给服务，但 `外部核验服务.核验` 的签名不收 signal
 * ⇒ 对不收 signal 的实现来说，abort 只是提示，真正落定以它自己 settle 为准）。
 */

export type 参考类别 = "开户行" | "卡种" | "卡行" | "号码归属地" | "行号"

export interface 参考条目 {
  readonly 类别: 参考类别
  readonly 值: string
  readonly 结果: string
}

export interface 参考库 {
  readonly 版本: string
  /** 同步查内存表；**未 `刷新` 过时恒 `undefined`**（首次调用方负责 `await 刷新()`）。 */
  查(类别: 参考类别, 值: string): string | undefined
  /** 版本变化才重新载入（整表进内存，不逐行查）。并发调用共享同一次载入。 */
  readonly 刷新: () => Promise<void>
}

/** 参考库键的唯一拼法：`\u0000` 分隔，避免「类别 + 值」拼接歧义（`#002-06`）。 */
function 参考键(类别: 参考类别, 值: string): string {
  return `${类别}\u0000${值}`
}

export function 建参考库(
  载入: () => Promise<{ 版本: string; 条目: readonly 参考条目[] }>,
): 参考库 {
  let 版本 = ""
  let 表 = new Map<string, string>()
  let 已载入 = false
  let 进行中: Promise<void> | undefined

  const 刷新 = async (): Promise<void> => {
    if (进行中 !== undefined) return 进行中
    进行中 = (async () => {
      const 新 = await 载入()
      // 版本相同 ⇒ 不重建：条目内容按契约随版本变化，版本没变就不该有差异。
      if (已载入 && 新.版本 === 版本) return
      版本 = 新.版本
      表 = new Map(新.条目.map((条目) => [参考键(条目.类别, 条目.值), 条目.结果]))
      已载入 = true
    })()
    try {
      await 进行中
    } finally {
      进行中 = undefined
    }
  }

  return {
    get 版本() {
      return 版本
    },
    查(类别, 值) {
      return 表.get(参考键(类别, 值))
    },
    刷新,
  }
}

export interface 外部核验服务 {
  核验(证件号: string): Promise<string | undefined>
}

export interface 外部服务选项 {
  readonly 并发上限?: number
  readonly 超时ms?: number
  readonly 负缓存ttl秒?: number
  readonly 现在秒?: () => number
}

export interface 外部服务客户端 {
  核验(证件号: string): Promise<string | undefined>
}

export function 建外部服务客户端(
  服务: 外部核验服务,
  选项: 外部服务选项 = {},
): 外部服务客户端 {
  const 并发上限 = 选项.并发上限 ?? 4
  const 超时ms = 选项.超时ms ?? 5_000
  const 负缓存ttl秒 = 选项.负缓存ttl秒 ?? 600
  const 现在秒 = 选项.现在秒 ?? (() => Math.floor(Date.now() / 1_000))

  /** 正缓存：成功值不再重查（无 TTL，进程内有效）。 */
  const 正缓存 = new Map<string, string>()
  /** 负缓存：`undefined` 的过期时刻（秒）。 */
  const 负缓存 = new Map<string, number>()

  let 在飞 = 0
  const 等待: (() => void)[] = []

  const 释放槽 = (): void => {
    在飞 -= 1
    const 下一个 = 等待.shift()
    if (下一个 !== undefined) 下一个()
  }

  /** 拿到槽才真正发起调用：任何时刻在飞 ≤ `并发上限`（不许把全部值一次性发出去）。 */
  const 取得槽 = (): Promise<void> =>
    new Promise((resolve) => {
      if (在飞 < 并发上限) {
        在飞 += 1
        resolve()
        return
      }
      等待.push(() => {
        在飞 += 1
        resolve()
      })
    })

  const 执行 = async (证件号: string): Promise<string | undefined> => {
    // 服务签名不收 signal：abort 只是把「调用方已放弃」传达给将来的实现。
    const 控制器 = new AbortController()
    let 计时: ReturnType<typeof setTimeout> | undefined

    const 服务任务: Promise<string | undefined> = (async () => {
      try {
        return await 服务.核验(证件号)
      } catch (error) {
        // 不空 catch（`#006-28`）：异常按未命中处理，但留下可检索的痕迹。
        console.warn(
          `[openhive-case-reference-store] 外部核验异常（按未命中处理）：${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return undefined
      }
    })()
    // 槽位按 settled 释放（见文件头）：超时返回后底层调用可能仍在跑。
    void 服务任务.finally(() => 释放槽())

    const 超时 = new Promise<undefined>((resolve) => {
      计时 = setTimeout(() => {
        控制器.abort()
        resolve(undefined)
      }, 超时ms)
    })

    try {
      const 结果 = await Promise.race([服务任务, 超时])
      if (结果 === undefined) 负缓存.set(证件号, 现在秒() + 负缓存ttl秒)
      else 正缓存.set(证件号, 结果)
      return 结果
    } finally {
      if (计时 !== undefined) clearTimeout(计时)
    }
  }

  return {
    async 核验(证件号) {
      const 成功 = 正缓存.get(证件号)
      if (成功 !== undefined) return 成功

      const 过期时刻 = 负缓存.get(证件号)
      if (过期时刻 !== undefined) {
        if (现在秒() < 过期时刻) return undefined
        负缓存.delete(证件号)
      }

      await 取得槽()
      return await 执行(证件号)
    },
  }
}
