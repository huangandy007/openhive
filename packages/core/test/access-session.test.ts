import { describe, expect, test } from "bun:test"
import { AccessSession } from "@opencode-ai/core/access/session"

/**
 * T007 修正（**C1**，2026-10-05）· **MCP server 命名前缀碰撞**的纯判定。
 *
 * ## 为什么要有这个函数
 *
 * 链 A 的 mcp 授权投影成**前缀规则**（`{ permission: <toolPattern>, pattern: "*" }` 与
 * `{ permission: "read", pattern: "mcp:<server>:*" }`），而链 A 的 `evaluate` 取 `findLast`
 * （**后者胜**）。两个 server 的工具名通配若**互相覆盖**，同一个工具名就会同时命中两条方向相反
 * 的规则 ⇒ **授权结果由 `Config.mcp` 的键序决定**（「顺序无关」在这里不成立）。
 *
 * 真判决器上的实证在 `packages/opencode/test/server/openhive-access-mcp.test.ts`（那里够得着
 * 链 A 的 `evaluate`）；本文件只钉**判定本身**——core 不依赖 opencode，够不着判决器。
 *
 * ## 判据
 *
 * `toolPattern` = `sanitize(server) + "_" + "*"`（翻译由调用方做，core 不抄一份 `sanitize`）。
 * 去掉末尾那个 `*`，得到 `sanitize(server) + "_"`；碰撞 ⟺ **其中一个前缀是另一个的前缀**
 * （`startsWith`，**非严格** ⇒ 净化后同名也算）。
 * 之所以是「前缀」而不是「相等」：那个 `_` **不是**无歧义分界——`sanitize` 把 `.` / `/` 之类
 * 也换成 `_`（`packages/opencode/src/mcp/catalog.ts`）。
 */
const naming = (server: string, toolPattern: string): AccessSession.McpServerNaming => ({ server, toolPattern })

/**
 * 冲突对是**无序**的（`i < j` 只决定谁排在前面），断言时归一成集合再比；
 * 想验顺序的地方单独去读原始数组（⑥）。
 */
const pairs = (servers: readonly AccessSession.McpServerNaming[]) =>
  AccessSession.namingConflicts(servers).map((pair) => [...pair].sort().join(" | "))

describe("MCP server 命名：前缀碰撞判定（C1）", () => {
  test("① 两两不互为前缀 ⇒ 无冲突", () => {
    expect(AccessSession.namingConflicts([naming("fund.db", "fund_db_*"), naming("call.db", "call_db_*")])).toEqual([])
    expect(AccessSession.namingConflicts([naming("fund.db", "fund_db_*")])).toEqual([])
    expect(AccessSession.namingConflicts([])).toEqual([])
  })

  /**
   * 🔴 **防伪反例**：`fund_db_` 与 `fundx_db_` 看着像（公共字面 `fund`），其实互不为前缀。
   * 少了这条，一个「凡名字有公共字面前缀就报冲突」的实现也能让③④⑤全绿——而那种实现会把
   * 一片本来能用的配置拦在门外。
   */
  test("② 反例：公共字面前缀 ≠ 碰撞（`fund_db_` vs `fundx_db_`）", () => {
    expect(pairs([naming("fund.db", "fund_db_*"), naming("fundx.db", "fundx_db_*")])).toEqual([])
  })

  test("③ 净化后一个前缀是另一个的前缀 ⇒ 冲突（`fund.db` / `fund.db.prod`）", () => {
    expect(pairs([naming("fund.db", "fund_db_*"), naming("fund.db.prod", "fund_db_prod_*")])).toEqual([
      "fund.db | fund.db.prod",
    ])
  })

  /**
   * 🔴 **跨 server / 工具名的那条边界**：`a` + 工具 `b/query` 与 `a_b` + 工具 `query` 会产出
   * **同一个工具名**。只看 server 名之间有没有公共前缀是看不出这条的——它是「server 名末尾的 `_`
   * 与工具名内部的 `_` 撞在一起」。判据仍是前缀，因为 `toolPattern` 已经把 server 名末尾那个 `_`
   * 带进来了（`a_*` vs `a_b_*`）。
   */
  test("④ 跨边界：`a` 与 `a_b` 互相覆盖（`a_*` vs `a_b_*`）", () => {
    expect(pairs([naming("a", "a_*"), naming("a_b", "a_b_*")])).toEqual(["a | a_b"])
  })

  /** 净化后**同名**（`fund.db` 与 `fund-db` 都 → `fund_db_*`）：非严格前缀 ⇒ 也算冲突。 */
  test("⑤ 净化后同名 ⇒ 冲突（判据是非严格前缀）", () => {
    expect(pairs([naming("fund.db", "fund_db_*"), naming("fund-db", "fund_db_*")])).toEqual(["fund-db | fund.db"])
  })

  /** 检测**对称**：交换输入顺序，冲突集合不变（对内的先后跟输入走，⑥ 的第二半钉它）。 */
  test("⑥ 对称：交换输入顺序冲突集合不变", () => {
    const a = naming("fund.db", "fund_db_*")
    const b = naming("fund.db.prod", "fund_db_prod_*")

    expect(pairs([a, b])).toEqual(pairs([b, a]))
    expect(AccessSession.namingConflicts([b, a])[0]).toEqual(["fund.db.prod", "fund.db"])
  })

  /** 三个 server 里只有一对撞 ⇒ **只报那一对**（别把无关的 `call.db` 拉进来）。 */
  test("⑦ 只报真正撞的那一对", () => {
    const servers = [naming("a", "a_*"), naming("a_b", "a_b_*"), naming("call.db", "call_db_*")]

    expect(pairs(servers)).toEqual(["a | a_b"])
  })

  /**
   * **形状护栏**：`toolPattern` 末尾没有 `*`（调用方传了裸前缀）时按**整串**比——不去猜通配符。
   * 将来有人把 `toolPattern` 改成非通配写法，判定不会静默失配。
   */
  test("⑧ 末尾没有 `*` 时按整串当前缀比（形状护栏）", () => {
    expect(pairs([naming("a", "a_"), naming("a_b", "a_b_")])).toEqual(["a | a_b"])
  })
})
