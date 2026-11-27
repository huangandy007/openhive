"""脚本共用件（``scripts/lib/``）的行为测试。

四个模块各钉住一组行为，断言用精确集合 / 布尔比较（``#013-12``），
不断言自由文本措辞（TR-011）：

- ``tables``：表头逐列精确匹配，不一致/缺失抛 ``TableError``，不猜列序；
- ``ids``：同前缀 max+1、三位零填充；``allocate_id`` 在取号后**重读**再取一次
  （TR-008 第二对：写前重读）；
- ``blocks``：只认 ``<!-- AUTO:BEGIN 名称 -->`` / ``<!-- AUTO:END 名称 -->``，
  同名唯一、不嵌套、成对且顺序正确；``replace_block`` 只换块内；
- ``fingerprint``：§5.2 规范化后取 sha256 前 16 位小写十六进制；按源顺序，
  同一输入稳定，输入顺序不同则指纹不同。

指纹的期望值是用规范文字独立算出的金标准（不是从实现回读），
规范见 ``docs/superpowers/specs/017-case-staff/data-model.md`` §5.2。
"""

import hashlib
import unittest

from scripts.lib import blocks, fingerprint, ids, tables


PEOPLE_TEXT = """# 人员台账

> 状态：在逃 / 已到案 / 已处理 / 待定。

| P编号 | 姓名 | 角色 |
|---|---|---|
| P001 | 张三 | 主犯 |
| P002 | 李四 | 从犯 |
"""

PADDED_TEXT = """|   P编号 | 姓名   |
|:---|---:|
|  P001  | 张   三 |
"""

FENCED_TEXT = """# 含代码块的文档

```markdown
| 假编号 | 假姓名 |
|---|---|
| X001 | 不在表里 |
```

| E编号 | 证据名称 |
|---|---|
| E001 | 转账记录 |
"""


class TableParseTest(unittest.TestCase):
    def test_parse_tables_returns_header_and_row_dicts(self):
        parsed = tables.parse_tables(PEOPLE_TEXT)
        self.assertEqual(1, len(parsed))
        table = parsed[0]
        self.assertEqual(("P编号", "姓名", "角色"), table.header)
        self.assertEqual(
            [
                {"P编号": "P001", "姓名": "张三", "角色": "主犯"},
                {"P编号": "P002", "姓名": "李四", "角色": "从犯"},
            ],
            table.rows,
        )

    def test_parse_tables_tolerates_padding_and_alignment_markers(self):
        parsed = tables.parse_tables(PADDED_TEXT)
        self.assertEqual(1, len(parsed))
        self.assertEqual(("P编号", "姓名"), parsed[0].header)
        self.assertEqual([{"P编号": "P001", "姓名": "张   三"}], parsed[0].rows)

    def test_parse_tables_skips_fenced_code_blocks(self):
        headers = [table.header for table in tables.parse_tables(FENCED_TEXT)]
        self.assertEqual([("E编号", "证据名称")], headers)

    def test_shorthand_cell_and_separator_recognizers(self):
        self.assertEqual(("A", "B"), tables.split_cells(" | A | B | "))
        self.assertEqual(None, tables.split_cells("没有竖线"))
        self.assertEqual(True, tables.is_separator("|---|---|"))
        self.assertEqual(True, tables.is_separator("| :--- | ---: |"))
        self.assertEqual(False, tables.is_separator("| 甲 | 乙 |"))


class TableHeaderGuardTest(unittest.TestCase):
    def test_require_table_returns_rows_keyed_by_exact_header(self):
        rows = tables.parse_rows(PEOPLE_TEXT, ("P编号", "姓名", "角色"))
        self.assertEqual(["P001", "P002"], [row["P编号"] for row in rows])

    def test_require_table_rejects_reordered_header_without_guessing(self):
        with self.assertRaises(tables.TableError):
            tables.require_table(PEOPLE_TEXT, ("姓名", "P编号", "角色"))

    def test_require_table_rejects_renamed_header(self):
        with self.assertRaises(tables.TableError):
            tables.require_table(PEOPLE_TEXT, ("P编号", "姓名", "身份"))

    def test_require_table_rejects_absent_header(self):
        with self.assertRaises(tables.TableError):
            tables.require_table(PEOPLE_TEXT, ("E编号", "证据名称"))

    def test_find_table_returns_none_instead_of_guessing(self):
        self.assertEqual(None, tables.find_table(PEOPLE_TEXT, ("姓名", "P编号", "角色")))
        self.assertIsNotNone(tables.find_table(PEOPLE_TEXT, ("P编号", "姓名", "角色")))


class IdAllocationTest(unittest.TestCase):
    def test_next_id_starts_at_001_when_text_is_empty(self):
        self.assertEqual("M001", ids.next_id("M", ""))

    def test_next_id_uses_max_plus_one_not_row_count(self):
        text = "| M002 | 甲 |\n| M005 | 乙 |\n"
        self.assertEqual("M006", ids.next_id("M", text))

    def test_next_id_zero_pads_to_three_digits(self):
        self.assertEqual("M010", ids.next_id("M", "| M009 |"))
        self.assertEqual("M100", ids.next_id("M", "| M099 |"))

    def test_next_id_ignores_other_prefixes(self):
        text = "| E099 |\n| L050 |\n| P090 |\n| M002 |\n"
        self.assertEqual("M003", ids.next_id("M", text))

    def test_next_id_supports_every_declared_prefix(self):
        for prefix in ids.ID_PREFIXES:
            with self.subTest(prefix=prefix):
                self.assertEqual(prefix + "003", ids.next_id(prefix, "%s002 号" % prefix))

    def test_next_id_rejects_unknown_prefix(self):
        with self.assertRaises(ValueError):
            ids.next_id("Z", "Z001")

    def test_allocate_id_rereads_before_write(self):
        # 第一次读到的文本最大号 T006（⇒ T007），写入前重读时外部已追加 T007
        # （⇒ T008）。只取一次 max+1 会撞号，返回 T007。
        snapshots = iter(
            [
                "| T006 | 现场勘查 |\n",
                "| T006 | 现场勘查 |\n| T007 | 外部线程追加 |\n",
            ]
        )

        def read_text():
            return next(snapshots)

        self.assertEqual("T008", ids.allocate_id("T", read_text))


BLOCK_TEXT = """# 抓捕对象清单

## 抓捕对象

<!-- AUTO:BEGIN 抓捕对象 -->
| 序号 | P编号 |
|---|---|
| 1 | P001 |
<!-- AUTO:END 抓捕对象 -->

块外正文一字不动。
"""


class BlockParseTest(unittest.TestCase):
    def test_parse_blocks_returns_name_and_inner_content(self):
        parsed = blocks.parse_blocks(BLOCK_TEXT)
        self.assertEqual(1, len(parsed))
        self.assertEqual("抓捕对象", parsed[0].name)
        self.assertEqual(
            "| 序号 | P编号 |\n|---|---|\n| 1 | P001 |",
            parsed[0].content,
        )

    def test_get_block_by_name(self):
        self.assertEqual(
            "| 序号 | P编号 |\n|---|---|\n| 1 | P001 |",
            blocks.get_block(BLOCK_TEXT, "抓捕对象"),
        )

    def test_text_without_blocks_parses_to_empty_list(self):
        self.assertEqual([], blocks.parse_blocks("# 没有托管块\n\n正文\n"))

    def test_unpaired_begin_raises(self):
        text = "<!-- AUTO:BEGIN 甲 -->\n内容\n"
        with self.assertRaises(blocks.BlockError):
            blocks.parse_blocks(text)

    def test_unpaired_end_raises(self):
        text = "内容\n<!-- AUTO:END 甲 -->\n"
        with self.assertRaises(blocks.BlockError):
            blocks.parse_blocks(text)

    def test_end_name_mismatch_raises(self):
        text = "<!-- AUTO:BEGIN 甲 -->\n内容\n<!-- AUTO:END 乙 -->\n"
        with self.assertRaises(blocks.BlockError):
            blocks.parse_blocks(text)

    def test_duplicate_block_name_raises(self):
        text = (
            "<!-- AUTO:BEGIN 甲 -->\n1\n<!-- AUTO:END 甲 -->\n"
            "<!-- AUTO:BEGIN 甲 -->\n2\n<!-- AUTO:END 甲 -->\n"
        )
        with self.assertRaises(blocks.BlockError):
            blocks.parse_blocks(text)

    def test_nested_block_raises(self):
        text = (
            "<!-- AUTO:BEGIN 外 -->\n"
            "<!-- AUTO:BEGIN 内 -->\n"
            "<!-- AUTO:END 内 -->\n"
            "<!-- AUTO:END 外 -->\n"
        )
        with self.assertRaises(blocks.BlockError):
            blocks.parse_blocks(text)

    def test_replace_block_changes_only_the_inside(self):
        new_inner = "| 序号 | P编号 |\n|---|---|\n| 2 | P002 |"
        replaced = blocks.replace_block(BLOCK_TEXT, "抓捕对象", new_inner)
        self.assertEqual(new_inner, blocks.get_block(replaced, "抓捕对象"))
        self.assertEqual(
            BLOCK_TEXT.split("<!-- AUTO:BEGIN")[0],
            replaced.split("<!-- AUTO:BEGIN")[0],
        )
        self.assertEqual(
            "\n块外正文一字不动。\n",
            replaced.split("<!-- AUTO:END 抓捕对象 -->\n")[1],
        )
        self.assertEqual(False, "| 1 | P001 |" in replaced)

    def test_replace_block_preserves_crlf_outside_the_block(self):
        text = BLOCK_TEXT.replace("\n", "\r\n")
        replaced = blocks.replace_block(text, "抓捕对象", "| 9 |")
        self.assertEqual(
            text.split("<!-- AUTO:BEGIN")[0],
            replaced.split("<!-- AUTO:BEGIN")[0],
        )
        self.assertEqual(replaced.count("\n"), replaced.count("\r\n"))


FINGERPRINT_TEXT = """# 人员台账

<!-- AUTO:BEGIN 抓捕对象 -->
| 序号 | P编号 |
|---|---|
| 1 | P001 |
<!-- AUTO:END 抓捕对象 -->

> 状态：在逃 / 已到案

| P编号 | 姓名 | 角色 |
|---|---|---|
| P001 | 张三 | 主犯 |
| P002 | 李四 | 从犯 |
"""


class FingerprintNormalizeTest(unittest.TestCase):
    def test_extract_data_rows_skips_header_separator_comments_and_blank(self):
        self.assertEqual(
            [
                "| 1 | P001 |",
                "| P001 | 张三 | 主犯 |",
                "| P002 | 李四 | 从犯 |",
            ],
            fingerprint.extract_data_rows(FINGERPRINT_TEXT),
        )

    def test_normalize_line_collapses_padding_and_internal_whitespace(self):
        self.assertEqual(
            "|P001|张 三|主犯|",
            fingerprint.normalize_line("  |  P001 |  张   三  |  主犯 |  "),
        )

    def test_normalize_line_strips_outer_whitespace_of_plain_lines(self):
        self.assertEqual("普通 文本", fingerprint.normalize_line("  普通   文本  "))


class SourceDigestTest(unittest.TestCase):
    def test_source_digest_is_sixteen_lowercase_hex(self):
        digest = fingerprint.source_digest(["| P001 |"])
        self.assertEqual(16, len(digest))
        self.assertEqual(True, all(ch in "0123456789abcdef" for ch in digest))

    def test_source_digest_is_stable_for_the_same_input(self):
        rows = ["| P001 | 张三 | 主犯 |", "| P002 | 李四 | 从犯 |"]
        self.assertEqual(
            fingerprint.source_digest(rows),
            fingerprint.source_digest(list(rows)),
        )

    def test_source_digest_matches_gold_value(self):
        rows = ["| P001 | 张三 | 主犯 |", "| P002 | 李四 | 从犯 |"]
        self.assertEqual("e310a4a424b5b118", fingerprint.source_digest(rows))

    def test_source_digest_of_no_rows_is_sha256_of_empty_string(self):
        self.assertEqual(
            hashlib.sha256(b"").hexdigest()[:16],
            fingerprint.source_digest([]),
        )

    def test_source_digest_joins_rows_without_trailing_newline(self):
        self.assertEqual("29040eff2aeb0b28", fingerprint.source_digest(["| P001 |"]))
        self.assertEqual(
            "a95825ae0d05f77d",
            fingerprint.source_digest(["| P001 |", "| P002 |"]),
        )

    def test_source_digest_accepts_document_text(self):
        self.assertEqual(
            fingerprint.source_digest(
                [
                    "| 1 | P001 |",
                    "| P001 | 张三 | 主犯 |",
                    "| P002 | 李四 | 从犯 |",
                ]
            ),
            fingerprint.source_digest(FINGERPRINT_TEXT),
        )

    def test_source_digest_depends_on_source_order(self):
        forward = fingerprint.source_digest(["| P001 |", "| P002 |"])
        backward = fingerprint.source_digest(["| P002 |", "| P001 |"])
        self.assertEqual(False, forward == backward)

    def test_source_digest_ignores_cosmetic_padding(self):
        self.assertEqual(
            fingerprint.source_digest(["| P001 | 张三 |"]),
            fingerprint.source_digest(["  |  P001  |   张三   |  "]),
        )


if __name__ == "__main__":
    unittest.main()
