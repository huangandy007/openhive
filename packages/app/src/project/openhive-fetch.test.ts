/**
 * 005 · fork 外呼底座：**任何出口吃到 401，都要喊一声**（2026-10-10 用户下达的第 2 件）。
 *
 * ## 这条判断为什么住在底座、而不是各家的结论函数里
 *
 * 修之前：401 由**三个结论函数**各自认（`openhive-file-ops` 的 `outcomeOf`、`openhive-project` 的
 * `projectAction` / `createProject`、`openhive-members` 的 `memberAction`，覆盖**五处**落点），
 * 翻译成同一句话「登录已过期，请重新登录」；而**另外五处**落点（`openhive-files` 的列目录、
 * 下载、`touchProject`、`listProjects`、`listMembers`）压根不认它——它们把 401 当成「取不到」咽掉。
 * 这句话只够让人看见，够不到**唯一能处理它的人**（`AuthGate`：只有它在定「显示登录页还是工作台」）。
 *
 * 真栈实测（① 步探针，2026-10-10）：页面开着 → 会话失效 → 点「新建」⇒ 横幅说得对，
 * 而**界面一动不动**（登录页 0、工作台 1、URL 停在 `/`）；同一条坏 cookie **冷加载**却出得来
 * 登录页 ⇒ 判据没坏，缺的是「第二次探查」。
 *
 * 所以接线接在**所有出口都过的那一层**（`trySend`），不接在「记得住要判 401」的那几家：
 * 前者是「一处接线、所有出口共享」，后者是「谁记得谁接」——`LEARNINGS #002-06` 那条老账
 * （同一个判断在两处各写一份，改一处漏一处不报错也不变红）在这里连「两处」都数不清。
 *
 * ## 为什么这条判断不需要「只对 fork 自家路径生效」的限定
 *
 * `trySend` 只服务 fork 那几条裸路由（`/openhive/*`、上游 `/file`）。身份那条链
 * （`@/auth/gateway` 的 `probeSession` / `login` / `logout`）**不走它**——这一点是必须的：
 * 「登录被拒」也是 401，若那条链也喊，一次输错密码就会把重探引成回环。
 * 由本文件第 3 条用例守着（走的是真客户端，不是我自己搭的桩）。
 */

import { describe, expect, test } from "bun:test"
import { onSessionExpired } from "../auth/session-expired"
import { trySend } from "./openhive-fetch"
import { listProjectFiles } from "./openhive-files"

const 没身份 = () => new Response(null, { status: 401 })
const 成了 = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })

/**
 * 听一声。**每条用例自己退订**：接缝是模块级的（订阅表活在模块作用域里），
 * 不退订的话上一条用例的听筒会一直挂着——本文件只有三条，但那不是「所以可以不退订」的理由。
 */
function 听() {
  const 声: string[] = []
  const 退订 = onSessionExpired(() => 声.push("401"))
  return { 声, 退订 }
}

describe("fork 外呼底座 · 401 要喊一声", () => {
  test("底座收到 401 ⇒ 喊（登录门据此重探身份）", async () => {
    const { 声, 退订 } = 听()
    try {
      await trySend(async () => 没身份(), "/openhive/project")
    } finally {
      退订()
    }

    expect(声, "401 必须喊一声——不喊的话没人会去重探，页面就停在工作台上").toEqual(["401"])
  })

  test("拿到的不是 401（2xx / 网络挂了）⇒ 一声都不喊", async () => {
    const { 声, 退订 } = 听()
    try {
      await trySend(async () => 成了(), "/openhive/project")
      // 网络抛：`trySend` 吞成 `undefined`（既有契约），与 401 是两回事，不许混进来。
      await trySend(async () => {
        throw new Error("boom")
      }, "/openhive/project")
    } finally {
      退订()
    }

    expect(声).toEqual([])
  })

  /**
   * 这一条是**「所有出口共享」**的判据：走的是 `openhive-files` 那个**从来不判 401** 的客户端
   * （它把 401 与网络错一起咽成 `undefined`）。接线若接在结论函数里，这条必红；
   * 接在底座上，它绿——而且**同时**钉住「接缝没把它的返回值改坏」（仍是 `undefined`）。
   */
  test("不认 401 的客户端（列目录）也会喊，且返回值一个字不变", async () => {
    const { 声, 退订 } = 听()
    let 拿到: readonly string[] | undefined = ["还没问"]
    try {
      拿到 = await listProjectFiles("550e8400-e29b-41d4-a716-446655440000", async () => 没身份())
    } finally {
      退订()
    }

    expect(声, "列目录这条链在界面上的入口是『切到文件 tab』——它也吃 401，也必须喊").toEqual(["401"])
    expect(拿到, "喊一声不该改这条链的结论（取不到就是取不到）").toBeUndefined()
  })
})
