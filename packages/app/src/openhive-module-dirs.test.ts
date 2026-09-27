import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

// openhive 模块目录的「家」。下游 feature（002–010）按这些路径 import，
// 目录被误删/改名属静默破坏，故固定为不变量。
const moduleDirs = ["rail", "center", "topbar", "workspace"]

describe("openhive 模块目录骨架", () => {
  test("四个模块目录均已就位", () => {
    for (const dir of moduleDirs) {
      expect(existsSync(join(import.meta.dir, dir)), `${dir}/ 缺失`).toBe(true)
    }
  })
})
