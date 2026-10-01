/**
 * 003 T018 · 沙箱目录的**归档 / 恢复 / 删除**（FR-010 的文件系统那半边）。
 *
 * **与「账号侧」的分工**：`zombie.ts` 那半边做的是 `status` + `deactivated_at` + 逾期清单
 * （002 已交付），本文件测的**只有文件系统**。两者不重叠、也不互相调用——
 * 「筛出逾期账号」与「动它的目录」之间那一步（谁在什么时候调）**本 feature 做不到**，
 * 如实登记在 `tasks.md` 的 T018 段。
 *
 * **不碰数据库**：这三条动作的输入是 `(root, userId)`，与账号行无关。用真文件系统
 * （`mkdtemp`）而不是替身——被测对象就是文件系统操作，替身会让它消失
 * （`LEARNINGS #002-01` 的正题）。
 *
 * ⚠️ **不覆盖**（`LEARNINGS #002-02`：测不了的写成缺口，不写成覆盖）：
 * ① **跨卷 rename**（`EXDEV`）——`{root}/.archived` 与 `{root}/{userId}` 同卷，本机构造不出跨卷；
 * ② **归档进行到一半被打断**（进程被杀）——`rename` 是原子的，这条其实由 OS 保证，
 *    但**没有用例**能验到它，别当成已覆盖。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ARCHIVED_DIRNAME, archiveSandbox, deleteSandbox, restoreSandbox } from "./sandbox-archive"

const USER = "550e8400-e29b-41d4-a716-446655440000"
const OTHER = "550e8400-e29b-41d4-a716-446655440001"
const CONTENT = "研判报告：涉案账户 12 个"

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 接住两种结局再断言，不用 `expect(...).rejects`。
 *
 * 理由是 T019 实测撞过的两难：oxlint 的 `await-thenable` 认为 bun 的 `.rejects` 不是 thenable，
 * 而**顺着它去掉 `await` 会让拒绝无人接、断言空转**（`LEARNINGS #002-02` 那类假绿）。
 * 解析成 `undefined` 时 `toBeInstanceOf(Error)` 会红，所以「本该抛却没抛」仍拦得住。
 */
const failureOf = (run: Promise<unknown>): Promise<unknown> => run.then(() => undefined, (error: unknown) => error)

/**
 * 取出错误消息——**用收窄，不用 `as`**（`no-unsafe-type-assertion`）。
 *
 * `expect(...).toBeInstanceOf(Error)` 在 bun 里**不做类型收窄**，所以想读 `.message`
 * 只能靠断言或收窄；断言是「我已经知道它是什么」，而这里恰恰是**在验证**它是不是 Error，
 * 用断言等于把待验证的东西预先当成真的。
 */
function messageOf(thrown: unknown): string {
  if (!(thrown instanceof Error)) throw new Error(`本该抛错，实际得到 ${JSON.stringify(thrown)}`)
  return thrown.message
}

describe("沙箱归档 / 恢复 / 删除（FR-010）", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openhive-archive-test-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** 造一个沙箱并在里面放一个文件——归档若走「复制 / 打包」而不是 rename，内容就该原样。 */
  async function seed(userId: string, content = CONTENT) {
    const sandbox = join(root, userId)
    await mkdir(sandbox, { recursive: true })
    await writeFile(join(sandbox, "report.txt"), content)
    return sandbox
  }

  const at = (userId: string) => join(root, userId)
  const archived = (userId: string) => join(root, ARCHIVED_DIRNAME, userId)

  describe("归档", () => {
    test("把整个沙箱移进归档区，内容原样", async () => {
      const sandbox = await seed(USER)

      expect(await archiveSandbox(root, USER)).toBe(archived(USER))

      expect(await exists(sandbox)).toBe(false)
      expect(await readFile(join(archived(USER), "report.txt"), "utf8")).toBe(CONTENT)
    })

    test("从没建过沙箱 ⇒ 什么都不做，也不留一个空的归档区", async () => {
      // 历史账号没有沙箱目录是**正常情况**（`isolation-scheme.md` §1 就是这么写的），
      // 批量归档时它不该把整批打断。
      expect(await archiveSandbox(root, USER)).toBeUndefined()
      expect(await readdir(root)).toEqual([])
    })

    test("重复归档 ⇒ 幂等：不报错，归档物原样还在", async () => {
      await seed(USER)
      await archiveSandbox(root, USER)

      expect(await archiveSandbox(root, USER)).toBeUndefined()
      expect(await readFile(join(archived(USER), "report.txt"), "utf8")).toBe(CONTENT)
    })

    test("活动位置与归档位置同时有东西 ⇒ 抛错，且两边都没被动过", async () => {
      // 这是**真冲突**（不是「已归档过」那种可幂等的重复）——不猜、不合并、不丢任何一边。
      await seed(USER, "新的")
      await mkdir(archived(USER), { recursive: true })
      await writeFile(join(archived(USER), "old.txt"), "旧的")

      expect(await failureOf(archiveSandbox(root, USER))).toBeInstanceOf(Error)

      expect(await readFile(join(at(USER), "report.txt"), "utf8")).toBe("新的")
      expect(await readFile(join(archived(USER), "old.txt"), "utf8")).toBe("旧的")
    })

    test("冲突是**自己判出来**的，不是碰巧撞上文件系统报错", async () => {
      // ⚠️ 这条断言的是**消息**，理由是一段实测（不是洁癖）：
      // `rename` 撞上已存在的目录时，本机（win32）抛 `EPERM` ⇒ 上面那条用例**分不出**
      // 两种实现：显式判冲突的，和直接 `rename` 撞运气失败的。**变异检验证实**：
      // 把 `archiveSandbox` 里那行冲突检查删掉，上面那条**照样绿**（14/14 全绿）。
      //
      // 而它在 Linux（CI 与生产）上**不等价**：`rename` 撞上**空**目录会**静默成功**、
      // 把归档区那一份换掉——正是 FR-010 要防的那种静默丢失。
      // ⇒ 那行检查买的是「跨平台行为一致 + 人能看懂的错误」，所以把消息钉住。
      // 消息本身也是运维唯一读得到的东西：没有它就是一句 `EPERM`。
      await seed(USER)
      await mkdir(archived(USER), { recursive: true })

      const error = await failureOf(archiveSandbox(root, USER))

      expect(error).toBeInstanceOf(Error)
      expect(messageOf(error)).toContain("冲突")
    })

    test("只归档指定那一个用户", async () => {
      await seed(USER)
      await seed(OTHER)

      await archiveSandbox(root, USER)

      expect(await exists(at(USER))).toBe(false)
      expect(await exists(at(OTHER))).toBe(true)
    })
  })

  describe("恢复", () => {
    test("把归档移回活动位置，内容原样，归档区里不再有它", async () => {
      await seed(USER)
      await archiveSandbox(root, USER)

      expect(await restoreSandbox(root, USER)).toBe(at(USER))

      expect(await readFile(join(at(USER), "report.txt"), "utf8")).toBe(CONTENT)
      expect(await exists(archived(USER))).toBe(false)
    })

    test("活动位置已经有东西 ⇒ 抛错，两边都没被动过", async () => {
      // 用户 2026-10-01 裁定的冲突处置：**拒绝**。场景是账号被恢复后重新启用、
      // 沙箱又被建了出来，此时再执行一次「从归档恢复」。
      // 自动合并会**静默覆盖活动目录里的同名文件**——那正是 FR-010 要防的误删。
      await seed(USER, "归档里的")
      await archiveSandbox(root, USER)
      await seed(USER, "重新启用后新写的")

      const error = await failureOf(restoreSandbox(root, USER))

      expect(error).toBeInstanceOf(Error)
      // 与「归档」那侧同源的理由：`rename` 撞目录在本机也抛 `EPERM`，
      // 行为断言分不出「我们判的」与「文件系统碰巧报的」，而 Linux 上撞空目录会静默覆盖。
      expect(messageOf(error)).toContain("冲突")

      expect(await readFile(join(at(USER), "report.txt"), "utf8")).toBe("重新启用后新写的")
      expect(await readFile(join(archived(USER), "report.txt"), "utf8")).toBe("归档里的")
    })

    test("两边都没有 ⇒ 抛错（数据不见了，要人看，不能安静当成成功）", async () => {
      expect(await failureOf(restoreSandbox(root, USER))).toBeInstanceOf(Error)
    })

    test("已经在活动位置、归档区里没有 ⇒ 同样抛错", async () => {
      // 刻意**不**做成「目标状态已达成 ⇒ 安静返回」那种幂等：恢复是管理员的明确动作，
      // 「它不在归档区里」是一个该被说出来的事实（可能已经恢复过、也可能根本不是这个 id）。
      // 安静返回会让「我以为恢复了它」与「它早就在那儿」长得一模一样。
      const sandbox = await seed(USER)

      expect(await failureOf(restoreSandbox(root, USER))).toBeInstanceOf(Error)

      expect(await readFile(join(sandbox, "report.txt"), "utf8")).toBe(CONTENT)
    })
  })

  describe("删除", () => {
    test("递归删掉归档，归档位置不再存在", async () => {
      await seed(USER)
      await archiveSandbox(root, USER)
      await mkdir(join(archived(USER), "nested"), { recursive: true })
      await writeFile(join(archived(USER), "nested", "deep.txt"), "深一层的产物")

      await deleteSandbox(root, USER)

      expect(await exists(archived(USER))).toBe(false)
    })

    test("没归档过的沙箱 ⇒ 拒绝，且活动目录一行都没被动过", async () => {
      // **这条是安全属性，不是幂等性偏好**：删除**只够得到归档区**。
      // 判据若写成「删活动目录」，一个把「删」点在活人沙箱上的实现会让这条红。
      // 002 当初拒绝自动删空目录的原话是「宁可留一个空目录也不冒误删的风险」——
      // 这里让它**在代码上就够不到**。
      const sandbox = await seed(USER)

      expect(await failureOf(deleteSandbox(root, USER))).toBeInstanceOf(Error)

      expect(await readFile(join(sandbox, "report.txt"), "utf8")).toBe(CONTENT)
    })

    test("归档与活动同时存在 ⇒ 只删归档，活动目录原样", async () => {
      await seed(USER, "活着的")
      await mkdir(archived(USER), { recursive: true })
      await writeFile(join(archived(USER), "old.txt"), "归档的")

      await deleteSandbox(root, USER)

      expect(await exists(archived(USER))).toBe(false)
      expect(await readFile(join(at(USER), "report.txt"), "utf8")).toBe("活着的")
    })
  })

  describe("userId 校验：越界的值不许把动作引出沙箱根", () => {
    const BAD = ["", ".", "..", "../victim", "a/b", "a\\b"]

    test("三个动作都拒绝非法 id", async () => {
      for (const bad of BAD) {
        expect(await failureOf(archiveSandbox(root, bad))).toBeInstanceOf(Error)
        expect(await failureOf(restoreSandbox(root, bad))).toBeInstanceOf(Error)
        expect(await failureOf(deleteSandbox(root, bad))).toBeInstanceOf(Error)
      }
    })

    test("`../victim` 长得像用户 id 时，根目录之外的东西一个都没被碰过", async () => {
      // 单靠 `toBeInstanceOf(Error)` 还不够：一个「先 rename 再校验」的实现也会抛，
      // 但东西已经被移走了。所以这里断言**受害目录原样**。
      // 破坏性动作比建目录危险得多——`createWorkspace` 那套校验在这里是**必须**的，
      // 而再抄一份校验就会漂（两处分头演化），所以三个动作走的是同一个判据。
      const base = await mkdtemp(join(tmpdir(), "openhive-archive-escape-"))
      const guard = join(base, "ws")
      const victim = join(base, "victim")
      await mkdir(guard, { recursive: true })
      await mkdir(victim, { recursive: true })
      await writeFile(join(victim, "secret.txt"), "别人的案子")

      try {
        for (const act of [archiveSandbox, restoreSandbox, deleteSandbox]) {
          expect(await failureOf(act(guard, "../victim"))).toBeInstanceOf(Error)
        }

        expect(await readFile(join(victim, "secret.txt"), "utf8")).toBe("别人的案子")
      } finally {
        await rm(base, { recursive: true, force: true })
      }
    })
  })
})
