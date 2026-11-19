# 契约：转换器输出（`rows` + `report`）

**来源**：需求文档 §6.2；spec FR-019 / FR-020 / FR-021。

## 形状

```json
{
  "rows": [
    {
      "sheet": "Sheet1",
      "rowNo": 2,
      "startedAt": 1730000000,
      "amount": "1234.56",
      "direction": "收",
      "ownerAccount": "6222...",
      "counterparty": "6217...",
      "currency": "CNY",
      "extras": {
        "属性:对方:开户行": "招商银行",
        "属性:对方:银行卡号": "6214..."
      }
    }
  ],
  "report": {
    "adapterId": "wechat-wallet-statement",
    "adapterVersion": "1.0.0",
    "sourceSha256": "...",
    "gates": [],
    "warnings": [],
    "skippedRows": []
  }
}
```

## 硬约束

| # | 约束 | 违反后果 |
|---|---|---|
| 1 | `rowNo` 是**源文件行号**（Excel 行号 / CSV 行号），用于出处 `材料#表#行` | 出处指不回去 ⇒ 契约校验失败 |
| 2 | 金额一律**正数**；方向只用 `收` / `付` | 校验失败（`失败:转换器异常`） |
| 3 | 属性列**只出现在 `extras`**，键形如 `属性:<归属>:<键>`；不冒充标准字段。已知 extras 键（`case-field-registry.ts` 的 `extras字段们`：`address`/`merchant`/`contactPhone`/`personName`/`deliveredAt`/`ownerName`，以及没有标准列、只能落 extras 的 `备注`/`交易类型`）不算违规 | **词表外**的键进 `extras` 的，按「未认出」告警；裸属性列见 FR-032 |
| 4 | `rows` 与 `report` 同在一个文件、各占一段，互不混写 | 校验失败 |
| 5 | 报告**不进入事实行表** | 写入侧只读 `rows`；`report` 落 `case_material_report` |
| 6 | 转换器**不写库、不连库**，不产 xlsx 副本 | 环境已剔除 `PG_*`；产出 xlsx 视为多余输出，不采用 |
| 7 | 输出必须是**一个** JSON 文件（`output.file`） | 多文件视为校验失败 |
| 8 | `startedAt` **若出现必须是有限数字**（缺省 / `null` 合法 ⇒ 写 NULL） | 字符串等其他类型 ⇒ 整份材料失败 `失败:转换器异常` |

## 校验时机与失败原因码

1. 执行器跑完（退出码 0、未超时）后先做**形状校验**。
2. 任一约束不成立 ⇒ 材料落「有问题」+ `失败:转换器异常`；自由文本写明第几条约束、哪个字段。
3. 校验通过 ⇒ 交准入闸（N8）→ 事实行写入 → `翻译资金`（复用 `case-translate.ts:238`，`extras` 属性走 `:341-350` 的既有挂载路径）。

## `report` 最小内容（进入材料报告的字段）

| 字段 | 说明 |
|---|---|
| `adapterId` / `adapterVersion` | 实际执行者 |
| `sourceSha256` | 原件 SHA-256（N8 准入判定依据之一） |
| `gates` | 值闸逐项：`{闸, 检查项, 分母, 命中, 通过率, 阈值}` |
| `warnings` | 告警清单（含词表外键） |
| `skippedRows` | 跳过的坏行 `{sheet, rowNo, 原因}` |

> 报告的完整落库形状见 `data-model.md` §4；`rule_version` / 富化统计 / 准入结论由内核在写入时补，转换器不需要产出。
