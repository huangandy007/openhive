import { describe, expect, mock, test } from "bun:test"
import { GlobalWorkerOptions } from "pdfjs-dist"
import { renderPdf } from "./pdf-view"
import { 是哪种看不了 } from "./unsupported-format"

/**
 * 这个 mock 就是本文件存在的理由：把「**我们这边**的懒加载块没到」造成**真的** rejection，
 * 好让 `pdf-view.tsx` 里那处 `.catch((原因) => { throw 加载失败(...) })` 真被走到。
 * （工厂抛错会让 `await import(...)` reject——含 `?url` 这种带查询串的 specifier，实测过。）
 *
 * ⚠️ **别想着再加第二个 mock**。Bun 在同一进程内**跨文件共享**模块注册表，而模块**已经加载过**
 * 时，工厂是在 `mock.module()` **调用当场**就被同步执行的——抛错的工厂于是会炸在
 * **注册那一行**（`# Unhandled error between tests`），跟用例怎么写无关。`xlsx` 已被
 * `document-view.test.tsx`（经 `__fixtures__/office.ts`）先加载，必炸。
 *
 * ⚠️ 顺带更正一个容易顺手写错的说法：**工厂的返回值对「已加载过」的模块不生效**——它照样在注册
 * 当场被调用，但返回的模块被**丢弃**，之后的 `await import(spec)` 拿到的仍是**真模块**；只有对
 * **尚未加载**的模块，返回值才会被缓存并生效。两条绕法都试过、都不成立：「注册时返回真模块 +
 * 用例里拨开关」（工厂全程只被调一次，之后的 import 不再调它）、「异步工厂」（照样在注册期被
 * await 并抛）。**所以 `document-view.tsx` 里那条同性质的分支当前没有测试钉着**——那边的注释写了
 * 它靠什么兜底。**在不改生产代码的前提下**，唯一的解法是给 `test:components` 加 `--isolate`
 * （实测 181 pass / 0 fail，但 3.66s → 14.02s，≈3.8×），代价远大于收益、还要改上游的
 * `package.json`。（审查员另提过一条更便宜的思路：给渲染器注入可替换的加载器接缝——那要动生产
 * 代码，已记入 state.md 待决项，本批不引入。）
 *
 * ⚠️ 这一条目前安全，是因为 `pdfjs-dist/build/pdf.worker.min.mjs?url` 在本套件里**没有别的消费者**
 * （`pdf-view.test.tsx` 走不到它，被 `配好worker脚本` 开头那句 early-return 挡着）。**将来若有
 * 文件先加载了它，会炸在下面这行**——那不是用例坏了，是这条已知限制被触发了。
 */
mock.module("pdfjs-dist/build/pdf.worker.min.mjs?url", () => {
  throw new Error("worker 没到")
})

describe("我们自己的懒加载块没到（load-failed）", () => {
  /**
   * 走的是 `renderPdf` 的**第一条语句**（`配好worker脚本`）：worker 地址没配好时 pdfjs 连文档都
   * 拿不到。少了那行 `.catch` 的后果是把**我们的**问题说成**文件的**问题——普通 rejection 一路
   * 兜成 `error`＝「这个文件打不开 · 可能已经损坏」，让民警去怀疑一份好卷宗、甚至退回去重新取证。
   *
   * ⚠️ **得先把 `workerSrc` 清回空串**，否则这条分支在 Bun 里根本执行不到：pdfjs 的 Node 分支在
   * **模块加载时**就把 `workerSrc` 兜成了 `"./pdf.worker.mjs"`（实测它这个值），而 `配好worker脚本`
   * 第一句是 `if (GlobalWorkerOptions.workerSrc) return`——于是那句 `await import("...?url")` 在本
   * 环境永远走不到。（此前这里标的是「动态导入总成功，造不出失败」——**结论对、理由错**：动态导入
   * 能被 mock 成 reject，挡路的是前面那句 early-return。）
   *
   * 清空它并不是造一个假状态，而是把 `workerSrc` 摆回它在**浏览器里的实际初值**——`pdf-view.tsx`
   * 的模块头注释说的正是这件事：浏览器分支没有任何回退，值为空时 pdfjs 无条件抛。所以这条分支在
   * 生产里是**首访必经**的，不是边角。
   *
   * 用完把原值还回去：`GlobalWorkerOptions` 是 pdfjs-dist 的模块级状态，别的用例不该被本文件搅动。
   */
  test("PDF 的 worker 脚本没到：抛的是 load-failed 标记错，不是普通 rejection", async () => {
    const 原始workerSrc = GlobalWorkerOptions.workerSrc
    GlobalWorkerOptions.workerSrc = ""
    let 错误: unknown
    try {
      await renderPdf(new Uint8Array([1, 2, 3]), document.createElement("div"))
    } catch (原因) {
      错误 = 原因
    } finally {
      GlobalWorkerOptions.workerSrc = 原始workerSrc
    }

    // 没有标记的普通 rejection 会被壳兜成 error（「可能已经损坏」）——正是要避免的那件事
    expect(是哪种看不了(错误)).toBe("load-failed")
  })
})
