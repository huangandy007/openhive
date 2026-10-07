import { beforeEach, describe, expect, it } from "bun:test"
import { currentProject, setCurrentProject } from "@/project/current-project"

/**
 * 「当前项目」写进 cookie（006 Step 5 · ②-1，用户裁定 **B：cookie 通道**，2026-10-07）。
 *
 * ## 这一半为什么在客户端
 *
 * 服务端那半（`packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`
 * 读 `PROJECT_COOKIE`）只能**读**；写进来的是这里。两侧各写一份**名字字面量**——本文件刻意不
 * import 生产常量，理由与那个文件对 `PROJECT_HEADER` 的处理逐字相同（`LEARNINGS #003-05`：
 * 假镜像——import 过来就变成「生产改什么、测试跟着改什么」，改名也测不出来）。
 * **改名要同时改四处**：服务端常量、本文件这个字面量、`current-project.ts` 那个常量、
 * `openhive-project-directory.test.ts` 那个字面量（取数命令见 `current-project.ts` 里那条注释）。
 *
 * ## 为什么「客户端」不是一个可以省掉的角色
 *
 * 服务端那个 cookie 通道的**写入方就这一个**（`setCurrentProject` 是 `currentProject` 的**唯一**
 * 写入点，005 T006 建立的接缝）。所以「右栏的会话落不落进项目目录」这条链的**源头**在这里：
 * 这四行写错了，服务端那半再对也没用——而它**不会报错**，只会安静地落沙箱根
 * （`LEARNINGS #004-08`：没报错 ≠ 执行了）。
 *
 * ## 跑法（`packages/app` 的单元测试）
 *
 * `bun run test:unit`（`--conditions=solid` ＋ 忽略 tsx 的模式 ＋ `--preload ./happydom.ts`）。
 * `document` 由 `happydom.ts` 的 `GlobalRegistrator` 注册成全局，所以本文件能直接读写
 * `document.cookie`——**不 stub**：stub 掉 `document.cookie` 等于把被测的「这段字符串浏览器认不认」
 * 换成「我自己的假实现认不认」（同 `#005-07` 的取向：happy-dom 能给真值时就用真值，给不了才退化）。
 *
 * ⚠️ **本注释里刻意不写那个忽略 tsx 的 glob**：它含 `*` ＋ `/`，写进块注释会**提前闭合注释**，
 * 后面整段散文变成代码（`LEARNINGS #004-06` 的现形，2026-10-07 本文件第一版就是这么炸的：
 * 报错落在第 24 行那句散文上——`Unexpected *`——与真正的原因隔着几行）。
 *
 * ## 本组**不**覆盖什么（`LEARNINGS #002-02`：测不了的写成缺口，不写成已覆盖）
 *
 * - ⚠️ **`Path=/` 这一项没有被任何断言钉住**（2026-10-07 探针实测）。产品那一侧它是**必需**的
 *   （不写，cookie 的默认路径是「当前文档所在目录」⇒ 页面在深路径时 `/api/...` 收不到它 ⇒ 安静的
 *   落沙箱根），但 happy-dom 里**构造不出会红的断言**：它 `document.cookie` 的**读回完全不按路径
 *   过滤**——探针：在 `http://localhost/session/abc` 写下不带 `Path` 的 cookie，把文档切到
 *   `http://localhost/api/session` 再读，**照样读得到**。真实浏览器在这一步会读不到。
 *   ⇒ 今天的护栏只有**代码可读性**（写与清在同一个函数、相隔四行、都用 `Path=/`），不是测试。
 *   ⚠️ 别反过来「顺手把 `Path=/` 从被测字符串里删掉让它绿」——那会让这条链**在生产上**坏掉。
 * - **不覆盖「写与清用了不同的 `Path`」**（同名两条并存、真实浏览器发哪条变得不确定）：同上的读回
 *   不过滤，构造不出稳定断言。
 * - **不覆盖真实浏览器的 cookie 行为**：happy-dom 不是浏览器（过期与路径语义都与真浏览器有差异，
 *   见 `等于没有` 的注释）。本组钉的是「这段字符串被一个**按 URL / Path / Max-Age 规则解析**的实现
 *   收下了，且**那串里的值**等于 id（或等于没有）」——**不是** mock，也不是浏览器本身。
 *   ⚠️ **「服务端那个解析器读得到」这一步，本组没有断言**（`#003-05`）：下面那个 `读cookie` 是照着
 *   `@/server/user-identity` 的 `cookieValue` **另写的一份**（只取第一条命中、不做解码），验的是
 *   「jar 里有这一项、其值等于 id」，两侧靠「标准 `name=value` 格式大家都认」衔接。
 *   ⇒ 它能钉住「产品把值写对了」，钉不住「服务端读得出来」；那条边界归服务端那组测试。
 */

/**
 * 项目 cookie 的名字。**写字面量**（见文件头）。服务端那份导出是 `PROJECT_COOKIE`。
 */
const PROJECT_COOKIE = "openhive_project"

/**
 * **夹具：把文档的 URL 设成一个 http 源。**
 *
 * ⚠️ **不设的话本组全部用例测的都是 happy-dom，不是产品**（2026-10-07 实测，探针两轮）：
 * `GlobalRegistrator.register()` 给的文档是 **`about:blank`**，而 happy-dom **正确地**拒绝往一个
 * 没有源 / 没有路径的文档上落 cookie ⇒ `document.cookie = "X=1; Path=/"` **整条被丢弃**、
 * 读回来是空串。症状极具误导性：**两条「cookie 写上了」的用例红成 `Received: undefined`**，
 * 看着像「产品没写」，其实是**写入被环境吃了**（`LEARNINGS #003-01`：先怀疑测量）。
 * 对照探针：同一句去掉了 `Path`，`about:blank` 上**能**写进去 —— 可见拒的是 `Path`，
 * 而 `Path=/` 恰恰是产品**必需**的那个属性（不写它，`/api/...` 那些请求收不到 cookie）。
 * ⇒ 唯一诚实的做法是把 URL 补成真实形状，而不是把 `Path` 从被测字符串里删掉。
 *
 * ⚠️ 只影响**本文件**：`bun test` 里每个测试文件有独立的全局域（`LEARNINGS #004-11`）。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码：`happyDOM` 长在 happy-dom 自己的 `Window` 上（`DetachedWindowAPI`），而 TS 的全局 `window` 是 lib.dom 那个 `Window`——两条互不相干的类型，没有可收窄的交集（探针实测 `typeof window.happyDOM === "object"`，断言在运行时是真话）。
;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL("http://localhost/")

/**
 * 当前 jar 里这个 cookie 的**值**；没有它就读作 `undefined`。
 *
 * ⚠️ 只回报**第一条**命中（同名多条今天是写不出来的：写与清在同一个函数里、同一个 `Path`）。
 */
function 读cookie(): string | undefined {
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== PROJECT_COOKIE) continue
    return part.slice(separator + 1).trim()
  }
  return undefined
}

/**
 * 「这个 cookie 等于没有」——**清掉那一支的判据**，两种形态都算。
 *
 * ⚠️ **为什么不是 `toBeUndefined()`**（2026-10-07 实测）：happy-dom 的 `Max-Age=0` **不删条目**，
 * 只把值置空 ⇒ 读回来是 `"openhive_project="`（`读cookie()` 得 `""`），而**真实浏览器会整条删掉**
 * （值仍是 `undefined`）。两种形态在**这个通道的语义上完全等价**：服务端的读取器
 * （`@/server/user-identity` 的 `cookieValue`）对空值有一句显式的 `if (!raw) return undefined`
 * ——它读到的同样是「没有这个 cookie」⇒ 落沙箱根。
 * ⇒ 判据写成「**值是空的或不存在**」，而不是写死其中一种形态：写死任一种，都会让这条用例
 * 变成在钉 **happy-dom 的实现**，而不是在钉产品（同 `#005-07` 的取向）。
 */
const 等于没有 = () => expect(读cookie() ?? "").toBe("")

beforeEach(() => {
  // ⚠️ 清场**不走** `setCurrentProject(undefined)`：用它清会让「清除那一支自己坏了」这件事
  // 在**每一条**用例的前置里静默发生（前置失败不是断言失败，红的地方会莫名其妙）。
  document.cookie = `${PROJECT_COOKIE}=; Path=/; Max-Age=0`
})

describe("「当前项目」的 cookie 写入（006 Step 5 · ②-1）", () => {
  /**
   * 主判据：**选中一个带 id 的项目 ⇒ cookie 有了、值就是那个 id**。
   *
   * 值必须**逐字等于 projectId**，不是「有点东西就行」：服务端拿它直接 `join` 进沙箱路径
   * （`join(沙箱根, projectId)`），差一个字符就是另一个目录（或落沙箱根）。
   */
  it("选中一个带 id 的项目 ⇒ cookie 写上了，值就是那个 id", () => {
    setCurrentProject({ id: "prj_alpha_0001", name: "8·17专案" })

    expect(读cookie()).toBe("prj_alpha_0001")
  })

  /** 换一个项目 ⇒ cookie **跟着换**（而不是留着上一个：那会把右栏的会话建进上一个项目里）。 */
  it("由甲项目切到乙项目 ⇒ cookie 换成乙的 id", () => {
    setCurrentProject({ id: "prj_alpha_0001", name: "8·17专案" })
    setCurrentProject({ id: "prj_beta_0002", name: "9·03专案" })

    expect(读cookie()).toBe("prj_beta_0002")
  })

  /**
   * 由选中改回**未选中** ⇒ cookie 被清掉。
   *
   * ⚠️ 「清掉」是**必需**的，不是洁癖：cookie 是**环境通道**——不清的话，用户在左栏点了
   * 「未选择项目」之后，每一条请求仍然自带一个指向旧项目的 cookie，于是**界面说没有项目、
   * 而请求落在旧项目目录里**。这是本组里唯一「不写也能跑、但会静默说反话」的一条。
   */
  it("由选中改为未选中（`undefined`）⇒ cookie 被清掉", () => {
    setCurrentProject({ id: "prj_alpha_0001", name: "8·17专案" })
    setCurrentProject(undefined)

    等于没有()
  })

  /**
   * 选中一个**没有 id** 的项目 ⇒ cookie 被清掉，**不写 `=undefined`**。
   *
   * 这一支是**真实存在**的：`CurrentProject.id` 是可选字段，而 T006 的「新建项目」没落库
   * （`workspace-entry.test.tsx` 里就有 `setCurrentProject({ name: "8·17专案", memberCount: 3 })`
   * 这种没有 id 的调用）。朴素的 `${project?.id}` 会写出 `openhive_project=undefined`：
   * 服务端读到字符串 `"undefined"`，它**是个合法路径段** ⇒ 过 `isSafePathSegment` ⇒ 查不到
   * ⇒ 落沙箱根。结果侥幸一样，但那是**巧合**——它把一个「没有项目」写成了「有一个叫 undefined
   * 的项目」，而服务端那边从此多一条没人能解释的查询。
   */
  it("选中一个**没有 id** 的项目 ⇒ cookie 被清掉，不写 `=undefined`", () => {
    setCurrentProject({ id: "prj_alpha_0001", name: "8·17专案" })
    setCurrentProject({ name: "我的项目" })

    等于没有()
  })

  /**
   * 信号本身照旧（`currentProject()` 与 cookie **同步**）。
   *
   * 这条是**对照**：上面四条全在钉 cookie，若实现写成「不写信号、只写 cookie」，就没人红了。
   * 顺带钉住「没 id 的项目**仍然进得了信号**」——id 只是 cookie 通道的入场券，不是信号的门槛
   * （T006 的显示路径依赖这一点：锚点行要显示项目名，而那时还没有 id）。
   */
  it("对照：cookie 与信号同步（没有 id 的项目照样进信号）", () => {
    setCurrentProject({ id: "prj_alpha_0001", name: "8·17专案" })
    expect(currentProject()?.name).toBe("8·17专案")

    setCurrentProject({ name: "我的项目" })
    expect(currentProject()?.name).toBe("我的项目")
    expect(currentProject()?.id).toBeUndefined()

    setCurrentProject(undefined)
    expect(currentProject()).toBeUndefined()
  })
})
