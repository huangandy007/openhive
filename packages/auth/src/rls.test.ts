import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { IDENTITY_SETTING } from "./rls"

/**
 * T008（FR-006 行级）· **RLS 机制的见证测试**。
 *
 * ## 为什么这组是「见证测试」而不是「新功能的红→绿」
 *
 * 甲裁定（用户 2026-10-05）：**机制在本 feature 定义并本机可验证，落地（业务表 / 策略 /
 * 受限账号 / GRANT）移交 F6/F7**。所以这里**没有**任何业务表或策略迁移进产品代码——
 * 表只活在**测试夹具**里，测的是「本仓约定的这套写法在真 PG 上到底拦不拦得住越权行」。
 *
 * ⇒ 首次跑就绿**不构成证据**（`LEARNINGS #002-02`：没执行过被测路径的测试是缺口，不是覆盖）。
 * 证据来自**变异**（见 §「变异」段与 `004/state.md`）：拆掉 `ENABLE ROW LEVEL SECURITY`、
 * 把策略判据换成常量、把 `SET LOCAL` 换成连接级 `set_config(..., false)` —— 每条都必须让
 * **指定的**断言红。跑不出红的那条，就是没测到。
 *
 * ## 为什么用 PGlite 而不是真 PG
 *
 * 本机没有 Docker / PG 二进制（`#002-05` 实测）。PGlite 是**编译成 WASM 的真 PG**，
 * `CREATE ROLE` / `GRANT` / `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` / `SET LOCAL ROLE`
 * / `set_config(..., true)` 全部真跑（2026-10-05 探针实测）。这正是「用替身会让被测对象消失」
 * 的反面：**测的就是 PG 自己的 RLS 执行器**。
 * ⚠️ 残差（据实记）：它不是「与生产 PG 同版本同构建」，**superuser / owner 语义**这一层
 * 仍需 CI 上的真实例复核（见 ④ 的注释）。
 *
 * ## 身份从哪来（与 T007 的接缝）
 *
 * `packages/opencode/src/mcp/openhive-identity.ts` 把用户 id 放进 MCP 出站请求的
 * `_meta["openhive/user"]`（T007 已交付、已测）。**消费侧**（MCP server 拿到它之后怎么用）
 * 就是本文件的契约：`set_config(IDENTITY_SETTING, <该 id>, true)`。
 * 两端名字不同（`_meta` 键 vs GUC 名）是**故意的**：`_meta` 是我们的协议字段，GUC 是 PG 侧的名字。
 */

/** 受限账号（账号级那一环）。真部署里**每角色一个**、名字由 F6/F7 定；测试用示意名。 */
const READER_ROLE = "openhive_reader"

/**
 * 夹具：一张「资源表 + 成员表」的**示意**结构（真名由 F6/F7 定：`fund_project_member` 等）。
 * 形状刻意与现实同构：行挂在**项目**上，成员表把**用户**与项目连起来 —— RLS 的判据是
 * 「这一行属于的项目 ∈ 这个用户是成员的项目」，不是「这一行是谁建的」。
 */
const createFixture = async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE project(id text PRIMARY KEY);
    CREATE TABLE project_member(user_id text, project_id text);
    CREATE TABLE fund_txn(id int, project_id text);
    CREATE TABLE secret_txn(id int);          -- 没 GRANT 的表：⑥ 用

    CREATE ROLE ${READER_ROLE} NOLOGIN;
    GRANT USAGE ON SCHEMA public TO ${READER_ROLE};
    GRANT SELECT ON project, project_member, fund_txn TO ${READER_ROLE};

    INSERT INTO project VALUES ('p1'), ('p2');
    INSERT INTO project_member VALUES ('alice', 'p1'), ('bob', 'p2');
    INSERT INTO fund_txn VALUES (1, 'p1'), (2, 'p1'), (3, 'p2');
    INSERT INTO secret_txn VALUES (42);

    ALTER TABLE fund_txn ENABLE ROW LEVEL SECURITY;
    CREATE POLICY txn_read ON fund_txn FOR SELECT TO ${READER_ROLE}
      USING (project_id IN (SELECT pm.project_id FROM project_member pm
                            WHERE pm.user_id = current_setting('${IDENTITY_SETTING}', true)));
  `)
  return db
}

const db = await createFixture()

/**
 * 以**受限账号** + 给定身份读一次资源表，按当前身份过滤。
 *
 * `identity` 传 `undefined` = 这次请求**没有身份**（GUC 不设）——那正是「未认证」的形状。
 * 事务里 `SET LOCAL ROLE` + `set_config(..., true)` 都是**事务作用域**（⑤ 钉住这点）。
 */
const readAs = async (
  conn: PGlite,
  identity: string | undefined,
  sql = "SELECT id::int AS id FROM fund_txn ORDER BY id",
): Promise<number[]> => {
  await conn.exec("BEGIN")
  try {
    await conn.exec(`SET LOCAL ROLE ${READER_ROLE}`)
    if (identity !== undefined) await conn.query("SELECT set_config($1, $2, true)", [IDENTITY_SETTING, identity])
    const rows = await conn.query<{ id: number }>(sql)
    return rows.rows.map((row) => row.id)
  } finally {
    await conn.exec("ROLLBACK")
  }
}

const readAsConnectionRole = async (conn: PGlite, sql: string): Promise<number[]> => {
  const rows = await conn.query<{ id: number }>(sql)
  return rows.rows.map((row) => row.id)
}

/**
 * 期望抛错的一次调用，返回**真正的那个错误**。
 *
 * ⚠️ **刻意不写 `await expect(fn()).rejects.toThrow()`**：`bun-types` 把 `.rejects` 声明成
 * `Matchers<unknown>`，`await` 一个 `void` 会被 `await-thenable` 记一条。本包两处先例
 * （`rbac.test.ts` / `migrate-cli.test.ts`）同样刻意避开，理由逐字相同。
 */
/** PGlite 抛出的 PG 错误：`code` 是 SQLSTATE（实测为**字符串**，如 `"42501"`）。 */
interface PgError extends Error {
  code?: string
}

async function failure(run: () => Promise<unknown>): Promise<PgError> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught
}

describe("T008 · 业务数据 RLS 机制（见证测试）", () => {
  /** 正向：**A 读得到自己的**。少了这条，一条「把所有人都拦死」的策略也会全绿。 */
  test("① 授过的项目：用户只看得到自己是成员的那些行", async () => {
    expect(await readAs(db, "alice")).toEqual([1, 2])
    expect(await readAs(db, "bob")).toEqual([3])
  })

  /** 反向：**A 读不到 B 的**（spec R3 要求双向验证：过松=越权，过紧=自己查不到）。 */
  test("② 换一个身份，别人的行一行都看不见", async () => {
    const alice = await readAs(db, "alice")
    const bob = await readAs(db, "bob")

    expect(alice).not.toContain(3) // p2 的行（bob 的）
    expect(bob).not.toContain(1) // p1 的行（alice 的）
    expect(bob).not.toContain(2)
  })

  /**
   * 🔴 **无身份 ⇒ 空集**（fail-closed），不是「看得见全部」。
   *
   * 机制上这是因为 `current_setting(..., true)` 在未设时给 **NULL**，而
   * `project_id IN (空/ NULL)` 恒不成立。**这是好性质、不是巧合**：它意味着
   * 「身份通道断了」（MCP server 忘了 SET、或 `_meta` 没送到）时，结果是**查不到数据**，
   * 而不是**看到所有人的数据**。⇔ 与 T006 的「取不到授权 ⇒ 不建会话」同一取向。
   */
  test("③ 无身份 ⇒ 空集（fail-closed，绝不是看得见全部）", async () => {
    expect(await readAs(db, undefined)).toEqual([])
    // 和「有身份但没成员关系」区分开：两者都是空集，但路径不同（前者 NULL、后者非空不匹配）。
    expect(await readAs(db, "carol")).toEqual([])
  })

  /**
   * 🔴 **负对照：表 owner / superuser 绕过 RLS** —— 本组其余断言的**反证**。
   *
   * 没有这条时，①②③ 可能只是「表里刚好没数据」造成的假绿。这条拿**同一个查询**、在
   * **连接用户**（实测 `rolsuper = true`）下跑，看到**全部 3 行** ⇒ 证明：
   * ① 表里确实有 3 行；② ①②③ 的过滤**只能**来自「非 owner 角色 + 策略」这一对。
   *
   * 由此得到一条**必须写进契约的不变式**：受限账号**不得**是业务表的 owner、不得是
   * superuser / `BYPASSRLS` 角色。反过来，若将来让 owner 也参与查询，必须
   * `ALTER TABLE ... FORCE ROW LEVEL SECURITY`（PG 对 owner 默认不套策略）。
   * ⚠️ 这一层是 PGlite 与生产 PG **语义最可能不同**的一处（残差见文件头）。
   */
  test("④ 负对照：连接用户（superuser / owner）绕过 RLS，看得到全部行", async () => {
    expect(await readAsConnectionRole(db, "SELECT id::int AS id FROM fund_txn ORDER BY id")).toEqual([1, 2, 3])
  })

  /**
   * 🔴 **`SET LOCAL` 不是可选的写法**：身份必须**事务作用域**。
   *
   * 连接池里一条连接会**跨请求复用**。用连接级 `set_config(..., false)` 设身份 ⇒ 上一个人的
   * 身份**留到下一个请求**，而 RLS 会老老实实按那个残留身份放行 —— 越权且**静默**
   * （返回的是「另一个人的数据」，看起来完全正常）。
   *
   * 这条把两种写法**各自跑一遍**（同一张表、同一个用户）：
   * - `LOCAL`（事务内）：事务一结束身份就没了 ⇒ 下一个事务读到**空集**；
   * - 连接级：事务结束后身份**还在** ⇒ 下一个事务**照样**读到 alice 的行（= 串号）。
   *
   * ⚠️ 这条会污染连接级状态（正是它要演示的），所以**单独起一个库**跑。
   */
  test("⑤ 身份必须 `SET LOCAL`（事务作用域）：连接级身份会跨请求残留 ⇒ 串号", async () => {
    const own = await createFixture()

    // 事务作用域：读一次、事务结束，身份随之消失。
    expect(await readAs(own, "alice")).toEqual([1, 2])
    expect(await readAs(own, undefined)).toEqual([])

    // 连接级（错误写法）：`SET ROLE` + `set_config(..., false)` 越过事务留下。
    await own.exec(`SET ROLE ${READER_ROLE}`)
    await own.query("SELECT set_config($1, $2, false)", [IDENTITY_SETTING, "alice"])
    await own.exec("BEGIN")
    const first = await readAsConnectionRole(own, "SELECT id::int AS id FROM fund_txn ORDER BY id")
    await own.exec("COMMIT")
    await own.exec("BEGIN")
    const second = await readAsConnectionRole(own, "SELECT id::int AS id FROM fund_txn ORDER BY id")
    await own.exec("COMMIT")

    expect(first).toEqual([1, 2])
    // ⚠️ 这条断言断的是**灾难**本身：第二个事务没有设置任何身份，却仍看得到 alice 的数据。
    expect(second).toEqual([1, 2])

    /**
     * 🔴 再钉住两件**与上面同源**、但更容易踩的事（都在一个新库上量，避开上面的残留）：
     *
     * 1. **「没有身份」在 PG 里有两个形态**：从没设过 ⇒ `NULL`；设过又被事务回滚 ⇒ **空串**。
     *    两者都落空集（判据是**相等比对**：空串不等于任何 `project_id`），所以不是缺陷——
     *    但**别把「读到空串」读成「有人设过身份」**（F6/F7 看日志时会遇到）。
     * 2. 🔴 **`LOCAL` 剥不掉上一层**：连接里已有残留时，事务内的 LOCAL 值回滚后**回到那个残留值**，
     *    不是回到「无身份」。⇒ 「用 SET LOCAL 就安全了」是**错的**，前提是**连接本身干净**
     *    （新连接 / `RESET ALL` / 不要用会话级 SET）。这条比 ①–⑤ 都隐蔽：它会**静默地**
     *    让一个事务拿到「别人的身份」。
     */
    const fresh = new PGlite()
    await fresh.exec("BEGIN")
    await fresh.query("SELECT set_config($1, $2, true)", [IDENTITY_SETTING, "alice"])
    await fresh.exec("ROLLBACK")
    const noPrior = await fresh.query<{ v: string | null }>("SELECT current_setting($1, true) AS v", [
      IDENTITY_SETTING,
    ])
    expect(noPrior.rows[0]?.v).toBe("")
    // 对照：**从没设过**的那个名字读出来是 **NULL**（不是空串）——两个形态确实不同，
    // 上面那条不是「反正都读得到」的假绿。
    const neverSet = await fresh.query<{ v: string | null }>("SELECT current_setting($1, true) AS v", [
      "openhive.never_set",
    ])
    expect(neverSet.rows[0]?.v).toBeNull()

    await fresh.query("SELECT set_config($1, $2, false)", [IDENTITY_SETTING, "alice"]) // 会话级残留
    await fresh.exec("BEGIN")
    await fresh.query("SELECT set_config($1, $2, true)", [IDENTITY_SETTING, "bob"])
    await fresh.exec("ROLLBACK")
    const withPrior = await fresh.query<{ v: string | null }>("SELECT current_setting($1, true) AS v", [
      IDENTITY_SETTING,
    ])
    expect(withPrior.rows[0]?.v).toBe("alice")
    await fresh.close()

    await own.close()
  })

  /**
   * **账号级与行级是两道不同的门**（FR-006 把它们列成两档，这条钉住「GRANT 不是装饰」）。
   *
   * 没有 `GRANT` 时，受限账号连**表**都读不到 ⇒ 报 `42501`（insufficient_privilege），
   * **不是空集**。两者形状相似、含义相反：
   * - 权限不足 = 配置漏了（要修部署）；
   * - 行级空集 = 机制在工作（正常的越权拦截）。
   * 混在一起会让人把「漏了 GRANT」读成「RLS 生效了」。
   */
  test("⑥ 没有 GRANT 的表 ⇒ 报 insufficient_privilege，不是空集", async () => {
    const err = await failure(() => readAs(db, "alice", "SELECT id::int AS id FROM secret_txn"))
    // SQLSTATE **实测为字符串** `"42501"`（探针 `typeof` 量过，见 `#002-03`），不是数字。
    expect(err.code).toBe("42501")
    expect(err.message).toMatch(/permission denied/i)
  })
})

describe("T008 · 契约常量本身", () => {
  /**
   * GUC 名要**带命名空间前缀**（`x.y`）：PG 对不认识的带前缀 GUC 允许任何角色 `SET`
   * （实测：受限账号设得进去，见 ①），而无前缀的名字会撞上 PG 自己的设置项。
   * 同时钉住「它不是 `search_path` / `role` 这类既有设置」——改名字会让**策略与 SET 两侧
   * 一起改**（策略写在 F6/F7 的迁移里，那边不会红），所以这里钉死。
   */
  test("⑦ 身份 GUC 名带命名空间前缀且稳定（改名等于同时改策略侧）", () => {
    expect(IDENTITY_SETTING).toBe("openhive.user_id")
    expect(IDENTITY_SETTING).toMatch(/^[a-z_]+\.[a-z_]+$/)
  })
})
