import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

test("迁移 0040：case_relation.times_cny 存在、integer、可空", async () => {
  const 行们 = rowsOf(
    await 库!.execute(sql`
      select is_nullable, data_type
        from information_schema.columns
       where table_schema = 'auth' and table_name = 'case_relation' and column_name = 'times_cny'
    `),
  )
  expect(行们).toEqual([{ is_nullable: "YES", data_type: "integer" }])
})
