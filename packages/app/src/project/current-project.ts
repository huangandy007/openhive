import { createSignal } from "solid-js"

/**
 * 「当前项目」的形状——左栏锚点行要显示的那两样。
 *
 * 只放**显示所需**的字段：项目的 id / 类型 / 共享目录等一概不进这里（那些是 T006 项目面板
 * 与文件树要用的），理由与 `current-user.ts` 同——**接入缝只承载它当下要喂的那一件事**，
 * 塞进来的每个字段都是将来没人负责的接口。
 */
export interface CurrentProject {
  /**
   * 项目标识。**T006 补**（T005 时还没有任何写入方，故只留了显示所需的两项）：
   * 项目面板靠它认「列表里哪一行是当前项目」（设计 §3 的「8·17专案（当前）」），
   * T018 起还要靠它发 `x-openhive-project` 头（T017 建立的客户端契约）。
   *
   * ⚠️ 它**必须等于服务端认的那个 projectId**——T017 的中间件按它拼 `join(沙箱根, projectId)`，
   * 塞一个只在客户端有意义的临时值，切换项目就只是个视觉动作，后端一个字都收不到。
   */
  id?: string
  /** 项目名（左栏锚点行显示的就是它）。 */
  name: string
  /**
   * 成员数。**私有项目读作 `undefined`**——设计 §4 只给共享项目画 `👥 N`。
   * 别把私有项目写成 `0`：那会让锚点行长出一个「成员 0」的徽章。
   */
  memberCount?: number
}

/**
 * 「当前项目」的**唯一读取点**（T005 建立的接入缝）。
 *
 * 005 落地锚点行时，**项目数据还没有来源**：后端没有「当前项目」这个接口，`project_ext`
 * 只暴露 core 的 `findByProjectID`（T003），成员数在 PG 的 `project_member` 里（T004），
 * 前端一个都读不到。所以这一版**只立缝、不填数**：写入方是 T006（项目面板：切项目 / 新建项目），
 * 届时**只改本文件**之外的那一处调用，`ProjectAnchor` 一个字不动。
 *
 * ✅ **T006 的实际交付（2026-10-06）**：`切项目` 已接（面板里点一行 ⇒ 写这里 ⇒ 锚点行跟着变），
 * **`新建项目` 没接**——用户裁定 T006 范围 = 前端面板 ＋ 接缝，不真落库；而「新建」没有落库就没有
 * 项目可切。落库缺口归 **T018**。所以这条缝今天有两个写入方中的一个，另一半是**明账**不是暗账。
 *
 * 未选中项目时读作 `undefined`，锚点行走空态「未选择项目」——**宁缺勿假**：塞一个占位项目名，
 * 等于把假数据放进 DOM，等 T006 接上真数据时没人分得清哪个是真的（同 `@/workspace/current-user`）。
 */
const [currentProjectSignal, writeCurrentProject] = createSignal<CurrentProject | undefined>()

/** 读：见上面那段。 */
export const currentProject = currentProjectSignal

/**
 * 「当前项目」的 cookie 名（006 Step 5 · ②-1，用户裁定 **B：cookie 通道**，2026-10-07）。
 *
 * ⚠️ **这是客户端契约**：左右两侧「**产品** ＋ **测试**」各写字面量、**刻意不 import**
 * （`LEARNINGS #003-05` 的假镜像：import 过来就变成「生产改什么、测试跟着改什么」）。
 * 改名要把**所有文本落点**一起改——取数**以宽 grep 为准**（**仓库根**跑）：
 * `grep -rn 'openhive_project' packages/opencode/src packages/opencode/test packages/app/src`
 *
 * ⚠️ **别用「数命中行」的办法保证改全**（Task B · 2026-10-09 复核实测）——窄 grep
 * `grep -rn '= "openhive_project"' …`（2026-10-08 曾以「应当恰好 4 条」记进两侧文档）**既漏又错**：
 * ① **漏**掉插值形态 `` `openhive_project=${id}` ``（不以引号紧跟等号出现，如
 * `packages/opencode/test/server/openhive-project.test.ts` 那处）；② **错**在它会命中**自身文档**
 * 那两行（注释里引了这条命令 ⇒ 自匹配）＋ `!== "openhive_project"` 这种比较（`!==` 末尾那个 `=`
 * 也算数，如 `workspace-entry.test.tsx`）。⇒ 这条命令**验不出漏改**（`#005-15`：检查不许比事实强；
 * 已记 `006/state.md` 缺口表）。真落点以**宽 grep** 为准，改完逐个打勾。
 */
const PROJECT_COOKIE = "openhive_project"

/**
 * 把「当前项目」写进 cookie——**环境通道的写入方**（006 Step 5 · ②-1）。
 *
 * ## 为什么非有不可
 *
 * 服务端的「当前项目」通道只有两个：请求头 `x-openhive-project` 与这个 cookie。而 **006 的右栏
 * 走 SDK v2（B 链），够不着头**——目录作用域客户端由**上游** `context/server-sdk.tsx` 的
 * `createDirSdkContext` 造，fork 侧没有注入头的缝。cookie 的特别之处是**浏览器对每一条同源请求
 * 自动附带**，于是 SDK 那条链不写一行也带上了它。判据一句话：**头是意向，cookie 是环境**。
 *
 * ## ⚠️ 它因此是**环境**：不留神就会砖掉整个 app
 *
 * 服务端那侧据此把 cookie 当**环境**处置（指向已归档项目 / 值非法 ⇒ **当作没带**，不 403 不 400），
 * 而**头**照旧会拒。这一侧对应的纪律只有一条：**它必须与信号一致**——信号说「未选中」、
 * cookie 还指着旧项目，就是「界面说没有项目、请求落在旧项目目录里」。
 *
 * ## 三个属性各自为什么
 *
 * - `Path=/`：**必需，但没有任何断言钉着它**（说明见下）。不写的话 cookie 的默认路径是
 *   「当前文档所在目录」，页面在深路径时 `/api/...` 那些请求收不到它——而症状是**安静的落沙箱根**
 *   （`#004-08`）。写与清两处**必须同一个 `Path`**，否则 jar 里会同时留着两条同名 cookie、
 *   真实浏览器发哪条不再确定。
 *   ⚠️ **测不到，是实测的**（2026-10-07 探针）：happy-dom 的 `document.cookie` **读回完全不按路径
 *   过滤**（在 `/session/abc` 写下的不带 `Path` 的 cookie，切到 `/api/session` 照样读得到），
 *   ⇒ 构造不出「漏了 `Path=/` 就红」的断言。护栏只有**这四行的可读性**（写与清相邻、同一个 `Path`），
 *   已登记在 `current-project.test.ts` 文件头的「本组不覆盖」里。**别为了让哪条用例变绿而删掉 `Path=/`**。
 * - `SameSite=Lax`：与 `context/language.tsx` 落 locale cookie 的写法同口径（该项目唯一的下发先例）。
 * - **不带 `Max-Age`**（会话级，关浏览器即失效）：它是「我此刻在看哪个项目」，不是设置。
 *   给一年有效期等于**下次开浏览器就悄悄落进上一次的项目目录**，而用户什么都没点。
 * - **值不 `encodeURIComponent`**：项目 id 是 `crypto.randomUUID()`（`server/openhive/project.ts`），
 *   编码与否是恒等变换；而服务端读取器（`@/server/user-identity` 的 `cookieValue`）**本来就会解码**，
 *   `%2E%2E%2Fbob` 那种手搓值在那边解码后才过 `isSafePathSegment`（解码先于校验，顺序是安全的）。
 */
function writeProjectCookie(id: string | undefined) {
  // ⚠️ 没有 id ⇒ **清掉**，不写 `=undefined`：`"undefined"` 是个合法路径段，服务端会照着它查一次库
  // 再落沙箱根——结果侥幸一样，但那是巧合，而且把一个「没有项目」记成了「有一个叫 undefined 的项目」。
  if (id === undefined) {
    document.cookie = `${PROJECT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`
    return
  }
  document.cookie = `${PROJECT_COOKIE}=${id}; Path=/; SameSite=Lax`
}

/**
 * 「当前项目」的**唯一写入点**——信号与 cookie **在这里一起变**（006 Step 5 · ②-1 起）。
 *
 * 收在一处而不是让每个调用点自己记得写 cookie：调用点有**五个**（面板切项目 / 新建项目后成为当前
 * 项目 / 归档后清掉 / **启动时还原** / **启动时没有数据源那一支的兜底清除**），散着写就是**五处会漂
 * 的清单**（`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。`current-project.test.ts` 钉
 * 的就是这个函数。
 *
 * ⚠️ 别把这个数写成一个「我记得的」数——**它漂过**：Task B 重写 `onMount` 时把「无数据源兜底清除」
 * 那处（`workspace-entry.tsx` 的 `onMount`，`if (!projectData)` 支）带进来，注释里的「四个」当场
 * 就不成立了（`LEARNINGS #003-02`：数落点靠 `grep -rn 'setCurrentProject' packages/app/src`，
 * 不靠记忆。同类：cookie 字面量的「三处实为四处」）。
 *
 * ⚠️ 它是**普通函数**而不是信号 `Setter`（不接 `(prev) => next` 那种形式）——本仓五个调用点
 * 全是直接传值，接函数形态只是**没人用的灵活性**（Karpathy 原则 2：不写没要求的灵活性）。
 */
export function setCurrentProject(project: CurrentProject | undefined) {
  writeCurrentProject(project)
  writeProjectCookie(project?.id)
}

/**
 * 从 jar 里读回「当前项目」的存档（Task B · 2026-10-09，用户裁定 **A：跟随当前项目**）。
 *
 * ## 为什么要有读侧
 *
 * 在它之前这条通道**只有写侧**（见 `writeProjectCookie`）：写进去的 id **没有任何一处读回来**
 * ⇒ 刷新之后信号归零（内存）、cookie 却还在（活得比页面久）。裁定 A 要求「刷新后把上次那个项目
 * 恢复回来」，读侧是它的第一步。
 *
 * ## 判据：按名字**精确**匹配，不拿第一段凑数
 *
 * jar 里通常掺着别的 cookie（本域还落着 `oc_locale` 等），所以逐段按 `name=value` 切开、比对
 * **整段名字**。一个「取第一段」的朴素实现在只有一条 cookie 的用例里照样绿——所以读回那一组
 * 专门有一条「掺着别的 cookie」的用例钉这一点。
 *
 * ⚠️ 与测试里的两份**同类助手**（`current-project.test.ts` / `workspace-entry.test.tsx` 各自的
 * `读cookie`）是**三份实现**：测试那两份刻意不 import 本函数（`LEARNINGS #003-05`：假镜像——
 * import 过来就成「生产改什么、测试跟着改什么」，改名也测不出来）。这里读的是**真
 * `document.cookie`**，不 stub。
 *
 * **没有这条 cookie ⇒ `undefined`**（不是空串）：调用方（`还原启动项目`）拿 `undefined` 当
 * 「全新用户 / 清过 cookie」，那是**什么都不做**的一支，必须与「有一条空值的 cookie」分开。
 *
 * ⚠️ **空值按「没有」处理**，与**服务端读取器**同口径（`@/server/user-identity` 的 `cookieValue`
 * 对空值有一句 `if (!raw) return undefined`；`LEARNINGS #003-05`：要镜像就对着它的行为写）。
 * 这不是为了迁就某个环境：真浏览器里 `Max-Age=0` 把整条删掉（读到 `undefined`），happy-dom
 * **不删、只置空**（读到 `"openhive_project="`）——两种形态在本通道语义上**等价**（都是「没选
 * 项目」），判据写死任一种都会变成在钉 happy-dom（`LEARNINGS #005-07`）。而项目 id 是
 * `crypto.randomUUID()`，**永不可能是空串** ⇒ 空值只可能来自「清过」。
 */
export function 读项目cookie(): string | undefined {
  for (const part of document.cookie.split(";")) {
    const 分隔 = part.indexOf("=")
    if (分隔 === -1) continue
    if (part.slice(0, 分隔).trim() !== PROJECT_COOKIE) continue
    const 值 = part.slice(分隔 + 1).trim()
    return 值 === "" ? undefined : 值
  }
  return undefined
}

/**
 * 「还原」需要的那几项清单行属性——**是 `ProjectEntry` 的一个窄化**
 * （`project-panel.tsx` 那个接口多出来的 `type` / `lastAccessedAt` / `role` 这里一个都不读）。
 *
 * 写成**结构型**而不是直接吃 `ProjectEntry`：这条缝只关心「还原一个当前项目」要什么，多出来的
 * 字段就是将来没人负责的接口（同上面 `CurrentProject` 的取向）。`ProjectEntry` 结构上可赋值给它，
 * 调用方（`workspace-entry.tsx`）不必转换。
 */
export interface 可还原的项目行 {
  /** 见 `ProjectEntry.id`；这里是可选的——比对用的是「能找到同 id 的行」，没有 id 的行匹配不上。 */
  readonly id?: string
  /** 见 `CurrentProject.name`（锚点行显示的就是它）。 */
  readonly name: string
  /** 见 `CurrentProject.memberCount`：一并带回去，少了它共享项目的 `👥 N` 徽章会消失。 */
  readonly memberCount?: number
  /**
   * 已归档。`当前项目目录` 也因它判「没有目录」⇒ 这里必须**同口径**（见 `还原启动项目`）。
   */
  readonly archived?: boolean
}

/**
 * 「启动还原」——把 cookie 里那份存档**读回信号**（Task B · 2026-10-09，用户裁定 **A**）。
 *
 * ## 三支，缺一不可
 *
 * 1. **没有存档**（`undefined`）⇒ **什么都不做**。这是 2026-10-06「打开时不自动选」那条裁定的
 *    正面保法：全新用户不该被塞一个项目（`清单[0]` 也不行——有一条用例专门钉它）。
 * 2. **存档有效**（清单里有这一行，且**未归档**）⇒ 恢复成当前项目，连同 `memberCount`。
 * 3. **存档失效**（不在清单里 / 那一行已归档）⇒ **清掉**（`setCurrentProject(undefined)`）。
 *    留着它就是一根「指着死项目的环境通道」——界面说没项目、请求却还带着它落过去
 *    （与 `writeProjectCookie` 那条注释同因）。
 *
 * 第 2、3 两支各有一条**独立**用例：合成一条时，把 `archived` 那半摘掉不会有任何东西变红
 * （`LEARNINGS #005-12`：同一个修法落在 N 个条件上就写 N 条）。`archived` 那一支并非理论上的
 * ——`当前项目目录` 也因归档判「没有目录」，两处口径必须一致，否则会出现「锚点行挂着这个项目、
 * 会话 tab 却列不出任何东西」。
 *
 * ## 为什么不直接手搓 `document.cookie`
 *
 * 走 **`setCurrentProject`**（唯一写入点）：信号与 cookie 必须**一起**变，两处各写一份就是
 * 「界面显示甲、请求落乙」这类分叉的老家（`LEARNINGS #002-06`）。注意**失效那一支也得走它**——
 * 只清 cookie 会**留着信号**，那是反过来的同一处分叉。
 */
export function 还原启动项目(存档: string | undefined, 清单: readonly 可还原的项目行[]) {
  if (存档 === undefined) return
  const 行 = 清单.find((候选) => 候选.id === 存档)
  // `行 === undefined`（已不在清单）与 `行.archived === true`（已归档）是**两个**条件，各有一条用例。
  // ⚠️ `行.id === undefined` 是给类型收窄用的，**不是第三支**：`find` 命中的行其 `id` 必等于 `存档`。
  if (行 === undefined || 行.id === undefined || 行.archived === true) {
    setCurrentProject(undefined)
    return
  }
  setCurrentProject({ id: 行.id, name: 行.name, memberCount: 行.memberCount })
}
