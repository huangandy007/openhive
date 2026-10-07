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
 * ⚠️ **这是客户端契约，一共四处字面量**——**产品**两份（服务端
 * `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`
 * 的 `PROJECT_COOKIE` ＋ 客户端本文件）、**测试**两份（`current-project.test.ts` ＋
 * `packages/opencode/test/server/openhive-project-directory.test.ts`，都写字面量、刻意不 import）。
 * 改名**四处一起改**；取数命令（**仓库根**跑）——⚠️ 别数「三处」，那是个错的记法
 * （2026-10-08 复核改正）：
 * `grep -rn '= "openhive_project"' packages/opencode/src packages/opencode/test packages/app/src`
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
 * 收在一处而不是让每个调用点自己记得写 cookie：写入点有三个（面板切项目 / 新建项目后成为当前
 * 项目 / 归档后清掉），散着写就是**三处会漂的清单**（`LEARNINGS #002-06`：同一个判断两处各写一份，
 * 早晚不等）。`current-project.test.ts` 钉的就是这个函数。
 *
 * ⚠️ 它是**普通函数**而不是信号 `Setter`（不接 `(prev) => next` 那种形式）——本仓三个调用点
 * 全是直接传值，接函数形态只是**没人用的灵活性**（Karpathy 原则 2：不写没要求的灵活性）。
 */
export function setCurrentProject(project: CurrentProject | undefined) {
  writeCurrentProject(project)
  writeProjectCookie(project?.id)
}
