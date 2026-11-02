import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { 净化子进程环境 } from "../../src/mcp/openhive-child-env"

/**
 * 终审 C1 · 本地 MCP 子进程不继承平台凭据。
 *
 * 判据分两层：
 * - 行为：`净化子进程环境` 剥掉整键 / 前缀 / 凭据字样，`undefined` 不进结果；
 * - 接线：`connectLocal` 真的用了它，且源码里不再有裸 `...process.env`
 *   （静态断言钉的是「这一行」，因为起真子进程验环境需要平台凭据在场，成本与风险都不该落到单测上）。
 */

test("剥掉平台数据库 / 对象存储凭据", () => {
  const 结果 = 净化子进程环境({
    PATH: "C:/bin",
    HOME: "C:/Users/x",
    PGHOST: "db",
    PGPORT: "5432",
    PGUSER: "u",
    PGPASSWORD: "s3cret",
    PGDATABASE: "openhive_dev",
    OPENHIVE_MINIO_ENDPOINT: "http://minio",
    OPENHIVE_MINIO_SECRET_KEY: "s3cret",
    DATABASE_URL: "postgres://u:s3cret@db/db",
    OPENCODE_CONFIG_CONTENT: '{"mcp":{}}',
    MY_SERVICE_TOKEN: "t",
    MY_SERVICE_SECRET: "s",
    my_service_password: "p",
    SOME_API_KEY: "k",
    OPENHIVE_ASSETS_ROOT: "D:/assets",
  })
  expect(Object.keys(结果).toSorted()).toEqual(["HOME", "OPENHIVE_ASSETS_ROOT", "PATH"])
})

test("undefined 值不进子进程环境", () => {
  expect(净化子进程环境({ PATH: "C:/bin", EMPTY: undefined })).toEqual({ PATH: "C:/bin" })
})

test("整键剥离大小写无关（Windows 子进程按 process.env.DATABASE_URL 仍取得到）", () => {
  // 变量名大小写不敏感的平台（Windows）上，`database_url` 与 `DATABASE_URL` 是同一个进程环境项。
  const 结果 = 净化子进程环境({
    database_url: "postgres://u:s3cret@db/db",
    Opencode_Config_Content: '{"mcp":{}}',
    pgpassword: "s3cret",
    PATH: "C:/bin",
  })
  expect(结果).toEqual({ PATH: "C:/bin" })
})

test("connectLocal 用净化函数，且不再裸铺 process.env", () => {
  const 源 = readFileSync(new URL("../../src/mcp/index.ts", import.meta.url), "utf8")
  expect(源).toContain("净化子进程环境(process.env)")
  // 显式授权项 `...mcp.environment` 必须保留；裸铺内核环境的那一行必须消失。
  expect(源).not.toContain("...process.env")
  expect(源).toContain("...mcp.environment")
})
