import { describe, expect, test } from "bun:test"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { realpathSync } from "fs"
import * as NFS from "fs/promises"
import os from "os"
import path from "path"

/**
 * `canonicalRoot` —— 沙箱根在**接缝处归一化一次**的那个函数（2026-10-09）。
 *
 * 它有两个消费者，合一就是为了**没有第二份**：`AnchorWorkspace.Config`（配置解析时过一遍）
 * 与 `DiskQuota.sandboxOf`（判「这次写入落在哪个沙箱」时过一遍）。两份各写一遍的话，
 * 一处改了另一处不会红（`LEARNINGS #004-02`：同一判定两个投影要有相等断言；
 * 这里是干脆合成一个函数，从根上不产生第二个投影）。
 *
 * ## 这一组为什么按「两种写法 ⇒ 同一个结果」来断，而不是断某个字面量
 *
 * 「规范形态」在这台机器上是 `…\Administrator\…`、在 CI（posix）上就是原串——写死哪一个都是
 * 把一台机器的形态当成契约。判据取**不变量**：同一物理目录的两种写法必须收敛到同一个串
 * （`LEARNINGS #006-18`：断「副作用留下的可见痕迹/不变量」，不断「我传对了参数」）。
 */
const tmpRoot = async () => await NFS.mkdtemp(path.join(os.tmpdir(), "openhive-workspace-root-"))

describe("canonicalRoot", () => {
  /**
   * 本机的实例：`os.tmpdir()` 给 **8.3 短名**（`…\ADMINI~1\AppData\Local\Temp`），
   * 而 `realpathSync.native` 展成**长名**（`…\Administrator\…`）——2026-10-09 实测。
   * posix 上两者相同，这一条就退化成自明的恒等（不会假红，也不会假绿到把洞盖住：
   * 有牙的那半在下面「别名」那条，两个平台都咬得住）。
   */
  test("同一目录的两种写法（win32 的 8.3 短名 / 长名）解到同一个串", () => {
    const 短 = os.tmpdir()
    const 长 = realpathSync.native(短)
    expect(WorkspaceRoot.canonicalRoot(短)).toBe(WorkspaceRoot.canonicalRoot(长))
  })

  /**
   * **承重的那一半、也是它与 `FSUtil.resolve` 的差别**：整个路径还不存在时，
   * `FSUtil.resolve` 是**空操作**（`realpathSync` 抛 ENOENT ⇒ 退回字面量），
   * 而沙箱根**恰恰常常不存在**——它由建项目那一步 `mkdir(…, { recursive: true })` 才生出来，
   * 而配置在层构造期就解析了。所以这里要「退到**存在的最长前缀**，再把不存在的那几段拼回来」。
   */
  test("路径还不存在 ⇒ 规范化的（存在的最长前缀）＋ 原样接回不存在的尾巴", async () => {
    const 根 = await tmpRoot()
    const 目标 = path.join(根, "还没建", "再深一层")

    expect(WorkspaceRoot.canonicalRoot(目标)).toBe(
      path.join(WorkspaceRoot.canonicalRoot(根), "还没建", "再深一层"),
    )
    // 反过来说：不存在的尾巴不许被吃掉、也不许被规范化成别的样子。
    expect(WorkspaceRoot.canonicalRoot(目标)).toEndWith(path.join("还没建", "再深一层"))
  })

  test("幂等：规范形态再规范一次还是它自己", async () => {
    const 根 = await tmpRoot()
    const 目标 = path.join(根, "还没建", "再深一层")
    expect(WorkspaceRoot.canonicalRoot(WorkspaceRoot.canonicalRoot(目标))).toBe(
      WorkspaceRoot.canonicalRoot(目标),
    )
  })

  /** 别名（junction / 符号链接）解到真身——两个平台都成立的形态，也是真栈里 8.3 那一支的同一条路。 */
  test("别名（junction / 符号链接）解到真身", async () => {
    const 真 = await tmpRoot()
    const 别名 = path.join(await tmpRoot(), "ws")
    await NFS.symlink(真, 别名, process.platform === "win32" ? "junction" : "dir")

    expect(WorkspaceRoot.canonicalRoot(别名)).toBe(WorkspaceRoot.canonicalRoot(真))
    // 别名 + 还不存在的尾巴：一半解真身、一半原样接上。
    expect(WorkspaceRoot.canonicalRoot(path.join(别名, "还没建", "x.txt"))).toBe(
      path.join(WorkspaceRoot.canonicalRoot(真), "还没建", "x.txt"),
    )
  })
})
