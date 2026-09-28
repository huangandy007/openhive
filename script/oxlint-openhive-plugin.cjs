/**
 * openhive 的**设计 token 守卫**——一个 oxlint 本地插件。
 *
 * **为什么是 lint 而不是测试**：「颜色只能走 token」这条宪法 §八 铁律，判的是**形状/来源**
 * （这个色值是从 token 来的，还是凭空写死的），编译期静态可判——不需要渲染、不需要浏览器，
 * 拦在最左侧最便宜。所以它**不写测试**，做成规则。
 *
 * **为什么用 oxlint 自己的插件机制，而不是装 stylelint**：本项目已经在跑 oxlint（`bun run lint`），
 * 而 stylelint 是**另一条工具链**——装它要多一个 devDependency、多一份配置、多一个 CI 步骤，且它看
 * 不到 JSX 里的 class 字符串（本项目 Tailwind 的色值正是写在 class 里的）。oxlint 1.60 起支持
 * `jsPlugins`，于是这件事**零新依赖**就能做进已有的那道门。在一个「每次改动都是上游合并面」的 fork 里
 * （宪法 §二），不新增依赖这一条本身就值。（`jsPlugins` 是本插件存在的**前提**——若将来 oxlint 移掉它，
 * 本文件要改成独立脚本或退回 stylelint，届时这次权衡要重新算一遍。）
 *
 * ⚠️ **本插件里的 `meta.name` 不能省**：oxlint 靠它给规则命名空间（规则在配置里写作
 * `openhive/no-raw-color`）。少了它，oxlint 直接拒绝加载："Plugin must either define `meta.name`,
 * be loaded from an NPM package with a `name` field in `package.json`, or be given an alias"。
 *
 * ⚠️ **规则名在配置里必须带前缀**（`openhive/…`）。写成 `no-raw-color` 会报
 * "Rule 'no-raw-color' not found in plugin 'eslint'"——它会把裸名当内置插件找。
 */

/** 整个字符串就是一个色值（含 3/4 位简写：`#fff`、`#ffff`）。 */
const 整体色值 = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * 字符串**内部**出现的 6/8 位色值——覆盖 `"3px solid #D97706"`、`"bg-[#D97706]"` 这类写法。
 *
 * ⚠️ 这里**刻意不收 3/4 位简写**：`"工单 #123"` 这种散文里的井号会被 `#123` 误伤，而 6 位色值
 * 在散文里出现的概率低到可以忽略。代价是 `"bg-[#fff]"` 这种简写漏网——已知的取舍，写在注释里
 * 而不是留成暗坑。（要收紧就收紧这里，别去改下面的 `颜色函数`。）
 */
const 内嵌色值 = /#(?:[0-9a-f]{6}|[0-9a-f]{8})\b/i

/** 颜色函数调用：`rgb(217 119 6)` / `oklch(...)` / `color(srgb ...)`。 */
const 颜色函数 = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i

/**
 * 这个字符串**看起来**是个写死的颜色吗。
 *
 * 三条判决依据见上。**刻意不管**的：`transparent` / `currentColor` / `inherit` 这类 CSS 关键字
 * （它们不是色值，是语义），以及 `"white"` / `"red"` 这类**具名色**——具名色当数据用的场合
 * （状态机取值、测试夹具）比当颜色用的多，收进来会淹掉真阳性。这是边界，不是遗漏。
 */
function 是写死的颜色(值) {
  return 整体色值.test(值) || 内嵌色值.test(值) || 颜色函数.test(值)
}

const 禁裸色值 = {
  meta: {
    name: "no-raw-color",
    docs: {
      description: "禁止写死的色值：颜色必须走 v2 语义 token（宪法 §八）",
    },
  },
  create(context) {
    /** 报点统一收口：`node` 用来定位，`值` 用来判。 */
    function 查(node, 值) {
      if (typeof 值 !== "string") return
      if (!是写死的颜色(值)) return
      context.report({
        node,
        message: `写死的色值 ${JSON.stringify(值)}——颜色要走 v2 语义 token（\`var(--v2-*)\` 或对应的 Tailwind 类），这样换皮才改一处生效。`,
      })
    }

    return {
      Literal(node) {
        查(node, node.value)
      },
      /**
       * 模板串（`` `bg-[#fff] ${x}` ``）单独走一遍：它的文本不在 `Literal` 上，
       * 而在 `quasis[].value.raw` 里。只查静态那几段——插值表达式里是真变量，不是写死的色值。
       */
      TemplateLiteral(node) {
        for (const 段 of node.quasis ?? []) 查(段, 段?.value?.raw)
      },
    }
  },
}

module.exports = { meta: { name: "openhive" }, rules: { "no-raw-color": 禁裸色值 } }
