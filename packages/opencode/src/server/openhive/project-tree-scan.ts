export * as OpenhiveProjectTreeScan from "./project-tree-scan"

/**
 * 项目文件树的**服务端遍历**（2026-10-28）。
 *
 * 逐字复刻改前前端 `packages/app/src/project/openhive-files.ts` 里 `walk`（已于 `e4fa64c941`
 * 删除）的产出口径：
 * **文件就地收下，目录钻进去、回来再按原位置补，空目录补自己**。顺序一漂，树就画错
 * （文件跑到别的目录底下、空目录挤到最前面）——所以那份前端的对应用例**整组迁到了这里**。
 *
 * ## 为什么前半段是纯函数、读目录靠注入
 *
 * 「顺序」这件事与文件系统无关，能用一个按路径分派的替身完整钉住。接线层（`project-tree.ts`）
 * 只负责把 `FileSystem.list` 与 `ignore` 规则塞进来——那一层才是真 IO，它由真栈验收兜底。
 *
 * ## ignored 在这里过滤，不在接线层
 *
 * 前端的口径是「ignored 的文件跳过；ignored 的目录**不进去走**」。两半都在这一层做，
 * 才有一条用例能同时钉住它们（接线层过滤文件、扫描层不跳目录的话，仍会白走一趟）。
 */

/**
 * 上游 `FileSystem.list` 的一行（收窄成扫描用得上那三个字段）。
 *
 * `path` 是**项目根相对的整条路径**（不是裸文件名）：目录项带末段分隔符（win32 是 `\`）。
 * 隐藏根判据 100% 依赖这个前提——接线层若传裸文件名，`资料\.git\` 里那个 `.git` 只取得到
 * 首段 `.git`，会被误判成根级隐藏目录，整支被静默跳过。
 */
export type 条目 = { path: string; type: "file" | "directory"; ignored: boolean }

/** 读一层目录。`undefined` ＝ 这一层取不到（整份判为取不到）。 */
export type 读目录 = (dir: string) => Promise<readonly 条目[] | undefined>

export type 扫描结果 = { paths: string[]; truncated: boolean }

/** 上限：达到即停，置 `truncated`。数值的依据见 design §4。 */
export const 默认上限 = 50000

/**
 * 整条路径的**第一段**是 `.git` / `.opencode`（不分大小写）⇒ 不画、也不往下走。
 *
 * 「第一段」不是「任何一段」：`资料\.git\` 是项目内容（解压进来的一份仓库），照常显示。
 *
 * `.git` 那一半与 `packages/opencode/src/server/openhive/file.ts` 的 `inGit`（`file.ts:510-513`）
 * **同形**：同样用 `/[\\/]/` 取首段、同样 `toLowerCase()`。本函数是它的**严格超集**——`inGit`
 * 只认 `.git`，这里**另加** `.opencode`。两处边界必须**同向**改：只在一侧加名字，就是
 * 「看得见却动不了」或「动得了却看不见」。
 *
 * ⚠️ 不是安全边界：拦改动的是 `file.ts` 那八个守卫；`.opencode` 服务端没有任何守卫，
 * 这里只是不画、不遍历。
 */
function 隐藏根(path: string): boolean {
  const 首段 = (path.split(/[\\/]/)[0] ?? "").toLowerCase()
  return 首段 === ".git" || 首段 === ".opencode"
}

/**
 * 同时读几个目录。
 *
 * 起点是实测（2026-10-29）：串行时**每个目录约 2.8ms**，FDE 项目 176 个目录 ≈ 500ms；
 * 而目录之间互不依赖，慢的是「一次一次等」，不是盘。
 *
 * 4 是在「比串行快一个数量级」和「不把盘打满」之间的折中：50 人同时进项目时最坏
 * 50 × 4 = 200 个读在飞，固态盘扛得住；真要更大规模，该加的是**全进程**限流，
 * 而不是把这个数调大（单个请求的分片再细，也挡不住 N 个请求叠起来）。
 */
export const 默认并发 = 4

export async function 扫树(
  读: 读目录,
  上限: number = 默认上限,
  并发: number = 默认并发,
): Promise<扫描结果 | undefined> {
  /** 在飞上限。等待是最贵的部分：目录之间没有先后依赖，串行等就是纯浪费。 */
  let 在飞 = 0
  const 排位: (() => void)[] = []
  /**
   * 槽位**直接转手**，不是「先放下再抢」。
   *
   * 放下再抢会留一个窗口：离场者把 `在飞` 减了、还没叫醒下一个时，新来的调用者看到有空位就
   * 先占了，被叫醒的那位再 `+= 1` 就冲过并发度（实测峰值 5 而并发 4）。而「叫醒之后重新检查」
   * 这种写法在本仓库的用例里钉不住（把 `while` 改成 `if`，20 条用例全绿）。
   *
   * 转手没有窗口：只有**没人排队**时才减 `在飞`，排队者是接过一个本来就在算的槽。
   * 界因此由结构本身保证，不靠时序。
   */
  async function 限流<T>(做: () => Promise<T>): Promise<T> {
    if (在飞 >= 并发) {
      await new Promise<void>((放行) => 排位.push(放行))
    } else {
      在飞 += 1
    }
    try {
      return await 做()
    } finally {
      const 接手 = 排位.shift()
      // 有人接着 ⇒ 槽位原样交出去（`在飞` 不动）；没人 ⇒ 这个槽真的空出来了。
      if (接手) 接手()
      else 在飞 -= 1
    }
  }

  /**
   * 一支的产物：**已经按条目顺序排好的路径**，加上「这一支下面有没有文件」。
   *
   * `失败` 不做成抛异常、也不做成 `undefined`：并行之后，某一支失败的**位置**要在
   * 全序里才判得了（截断点之前 ⇒ 整份失败；之后 ⇒ 不算数，同 `#004-09` 的「门在副作用之前」）。
   * 所以失败也要跟着前缀一起带上去，由最外层按位置裁定。
   */
  type 支 = { 路径: string[]; 有文件: boolean; 失败: boolean }

  /**
   * 顺序由下面收的循环决定（条目顺序），**与谁先读完无关**——并行只改何时读，
   * 不改交出什么。这也是「并发与串行逐字相同」那条用例钉着的东西。
   */
  async function 走(dir: string): Promise<支> {
    const body = await 限流(() => 读(dir))
    if (body === undefined) return { 路径: [], 有文件: false, 失败: true }

    // 先发后收：这一层的子目录一起发出去，回来再按原顺序拼。
    const 子 = new Map<number, Promise<支>>()
    for (let i = 0; i < body.length; i++) {
      const 条 = body[i]
      if (条.ignored || 隐藏根(条.path) || 条.type !== "directory") continue
      子.set(i, 走(条.path))
    }

    const 出: string[] = []
    let 有文件 = false
    for (let i = 0; i < body.length; i++) {
      const entry = body[i]
      if (entry.ignored || 隐藏根(entry.path)) continue
      const 下 = 子.get(i)
      if (下 === undefined) {
        出.push(entry.path)
        有文件 = true
        continue
      }
      const 下面 = await 下
      if (下面.失败) {
        // 前缀到此为止：失败在不在截断点之内，由最外层按 `出.length` 的位置裁定。
        出.push(...下面.路径)
        return { 路径: 出, 有文件, 失败: true }
      }
      if (下面.有文件) {
        出.push(...下面.路径)
        有文件 = true
      } else {
        // 空目录 / 全是空目录：自己补自己那一条，位置在这一支的末尾（与改前同一口径）。
        出.push(...下面.路径, entry.path)
      }
    }
    return { 路径: 出, 有文件, 失败: false }
  }

  const 根 = await 走("")
  /**
   * 裁截断，并按**位置**裁定失败：
   * - 前缀已够 `上限` ⇒ 后面那一支即使读不到也不算数——改前它根本不会被读到。
   * - 前缀不够 ⇒ 整份 `undefined`（不交半棵树）。
   *
   * ⚠️ 并行换来的代价（2026-10-29 与用户确认）：截断之后**不再提前停**，会多读一些目录。
   * 结果与改前逐字相同，多花的是盘上的时间，只发生在 ≥`上限` 条路径的超大项目上。
   */
  if (根.失败 && 根.路径.length < 上限) return undefined
  return { paths: 根.路径.slice(0, 上限), truncated: 根.路径.length > 上限 || 根.失败 }
}
