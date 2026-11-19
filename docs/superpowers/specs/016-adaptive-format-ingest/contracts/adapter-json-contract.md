# 契约：识别卡 `adapter.json`

**来源**：需求文档 §6.1；spec FR-017 / FR-018 / FR-019 / FR-022。

## 形状

```json
{
  "id": "wechat-wallet-statement",
  "name": "微信账户流水预处理",
  "version": "1.0.0",
  "kind": "converter",
  "materialType": "资金",
  "attributeKeys": ["对方:开户行", "对方:银行卡号", "对方:证件号"],
  "match": {
    "requiredHeaders": ["查询账号", "付款方支付帐号", "收款方支付帐号", "借贷标志", "交易金额", "交易余额", "交易时间"],
    "optionalHeaders": ["收款方的商户号", "收款方的商户名称", "付款方银行卡号", "收款方银行卡号"],
    "priority": 100
  },
  "admission": {
    "checks": ["查询账号非空", "借贷标志合法", "金额可解析", "时间可解析", "方向与本方一致", "卡行成对", "开户人可分类"],
    "thresholds": { "时间可解析": 0.99, "方向与本方一致": 0.98, "其余": 1.0 }
  },
  "rowRules": ["本方方 = 借贷=='借' ? 付款方 : 收款方", "对方方 = 借贷=='借' ? 收款方 : 付款方"],
  "entry": { "command": "bun run convert.ts", "input": "xlsx", "output": "json" },
  "output": { "file": "result.json" }
}
```

## 字段规则

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | ✅ | 全项目唯一；字母数字与 `-` / `_`；**并列决胜的字典序键** |
| `name` | ✅ | 展示名 |
| `version` | ✅ | 语义版本；变更必须重跑 `test/`（FR-064） |
| `kind` | ✅ | 闭集 `"rowRules"` \| `"converter"`：`rowRules` 由内核按 `rowRules` 直接执行（不起子进程，FR-011）；`converter` 走子进程执行器（FR-012） |
| `materialType` | ✅ | ∈ `资金` / `话单` / `其他` |
| `attributeKeys` | ✅ | 形如 `<归属>:<键>`；归属 ∈ `对方` / `本方`；键必须在受控词表内（发布期 fail-closed）；无属性列写 `[]` |
| `match.requiredHeaders` | ✅ | 全含才命中（fail-closed，FR-018） |
| `match.optionalHeaders` | ✅ | 声明用；**不参与命中判定**；缺该列不影响命中 |
| `match.priority` | ✅ | 整数；多命中取最高；打平按 `id` 字典序（FR-009） |
| `admission.checks` | ✅ | 值闸检查项名称清单 |
| `admission.thresholds` | ✅ | 每个检查项的通过率阈值；`其余` 为兜底键 |
| `rowRules` | `kind=rowRules` 时 ✅ | 内核执行的声明式行规则；`kind=converter` 时仅作说明 |
| `entry.command` | `kind=converter` 时 ✅ | 白名单前缀（`bun run` / `node`）；`cwd` = 技能目录 |
| `entry.input` | ✅ | 指**原件**（不是人工预处理副本） |
| `entry.output` | ✅ | `"json"` |
| `output.file` | ✅ | 相对 `cwd` 的输出文件名；**一个** JSON 文件（rows + report 同文件） |

## 发布 / 启用校验（M10）

在既有发布 / 启用路由上执行（`project-assets.ts` / `assets.ts` 路径），任一不成立 ⇒ 拒绝并列出缺项：

1. 四件套齐全：`SKILL.md`、`adapter.json`、`convert.*`（`kind=converter` 必需）、`test/`。
2. `adapter.json` 可解析且过本节字段规则（类型、必填、闭集）。
3. `entry.command` 非空且前缀在白名单内；`entry` 指向的文件在包内存在。
4. `attributeKeys` 每一项都在受控词表内（`case-attribute-registry.ts` 的 `属性键们` + 归属闭集）。
5. `id` 在本项目已启用包内唯一。

> `SKILL.md` 的 `description` 是否只写「什么时候用」是**发布评审项**，不做自动校验（§14 补充裁定，FR-016）。

## 运行时行为

- 探测：**只跑表头闸**（`requiredHeaders` 全含）；不跑值闸。值闸由作业链在转换器成功返回后读
  `report.gates`（对应 `admission.checks` / `thresholds`）判定（Ruling X）。
- 零命中 ⇒ `未识别:无匹配适配器`；缺列 ⇒ `未识别:缺必需列:<第一个缺失列>`；值闸不过 ⇒ `未识别:值闸不过:<检查项>`。
- 命中后报告必须列**全部命中项**（含落选者）与实际采用者 id / 版本（FR-010）。
