import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

// openhive 模块目录的「家」。下游 feature（002–010）按这些路径 import，
// 目录被误删/改名属静默破坏，故固定为不变量。
// `auth` 是 003 T015 加的（登录页 / 强制改密遮罩 / 网关客户端），与上面四个同性质：
// 被 `app.tsx` 直接 import，删掉就是白屏。
// 测试名刻意不带数目——数目是「会随编辑而变的值」，加一个目录就得回头改名字。
const moduleDirs = ["rail", "center", "topbar", "workspace", "auth"]

describe("openhive 模块目录骨架", () => {
  test("模块目录均已就位", () => {
    for (const dir of moduleDirs) {
      expect(existsSync(join(import.meta.dir, dir)), `${dir}/ 缺失`).toBe(true)
    }
  })
})
