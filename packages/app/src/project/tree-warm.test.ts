import { describe, expect, test } from "bun:test"
import { 造预热 } from "./tree-warm"

const 停 = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 记录谁被取了；`手动` 让用例自己决定什么时候落地。 */
function 记账() {
  const 取过: string[] = []
  return { 取过, 取树: async (id: string) => { 取过.push(id) } }
}

describe("文件树预热（2026-10-29）", () => {
  test("悬停后要等一小会儿才取：到点只取一次", async () => {
    const { 取过, 取树 } = 记账()
    const 预热 = 造预热(取树, 10)
    预热.悬停("p1")
    expect(取过).toEqual([]) // 刚落上去还不该发：划过不算打开
    await 停(30)
    expect(取过).toEqual(["p1"])
  })

  test("连着划过好几行 ⇒ 只取最后落定的那个", async () => {
    const { 取过, 取树 } = 记账()
    const 预热 = 造预热(取树, 20)
    预热.悬停("p1")
    await 停(5)
    预热.悬停("p2")
    await 停(5)
    预热.悬停("p3")
    await 停(60)
    expect(取过).toEqual(["p3"])
  })

  test("离开（没等到点）⇒ 一次都不取", async () => {
    const { 取过, 取树 } = 记账()
    const 预热 = 造预热(取树, 20)
    预热.悬停("p1")
    预热.离开()
    await 停(50)
    expect(取过).toEqual([])
  })

  test("同一时刻只热一个：在飞时悬停别的项目不取", async () => {
    const 取过: string[] = []
    let 放行: (() => void) | undefined
    const 取树 = (id: string) => {
      取过.push(id)
      return new Promise<void>((resolve) => {
        放行 = resolve
      })
    }
    const 预热 = 造预热(取树, 10)
    预热.悬停("p1")
    await 停(30)
    expect(取过).toEqual(["p1"])

    预热.悬停("p2")
    await 停(30)
    expect(取过).toEqual(["p1"]) // 还在飞，不再开第二个

    放行?.()
    await 停(5)
    预热.悬停("p2")
    await 停(30)
    expect(取过).toEqual(["p1", "p2"])
  })

  test("取失败不抛、也不算热过：下一次悬停还会再试", async () => {
    const 取过: string[] = []
    let 第几次 = 0
    const 取树 = async (id: string) => {
      取过.push(id)
      第几次 += 1
      if (第几次 === 1) throw new Error("挂了")
    }
    const 预热 = 造预热(取树, 10)
    预热.悬停("p1")
    await 停(30)
    预热.悬停("p1")
    await 停(30)
    expect(取过).toEqual(["p1", "p1"])
  })

  test("已经热过的项目不再取", async () => {
    const { 取过, 取树 } = 记账()
    const 预热 = 造预热(取树, 10)
    预热.悬停("p1")
    await 停(30)
    预热.悬停("p1")
    await 停(30)
    expect(取过).toEqual(["p1"])
  })
})
