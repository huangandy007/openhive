"""T009 口述入账的结构用例（US3 / FR-041 ~ FR-052 一带）。

**不依赖真实 AI**：`fixtures/intake/口述记录.md` 固定一段话术，
`fixtures/intake/expected.json` 固定人工拆解出的期望结构（``类型`` / ``编号`` / ``字段``）。
用例按 `references/内勤工作流.md`「口述入账」的规则，用 `scripts/lib/ids.py` 与
`scripts/lib/tables.py` 把期望结构落成台账行，再回读逐字段比对。

覆盖的判据：
- 扫收件箱分 M：`文件按名排序 → M 号 max+1 → 状态待归档 + 建议目录`；
- 口述拆 E/L/T：事实→E、推断→L、待办→T，字段逐列等于期望 JSON；
- 编号连续：E/L/T/M 各前缀 max+1、无重复；
- 未确认路径：只出回执不写盘 ⇒ 四本台账 sha256 全部不变；
- 推断不进事实：推断只落 L，任何 E 行都不含推断内容；
- 写入前重读：预览后、写入前外部追加占号 ⇒ `allocate_id` 跳过该号。

**缺口（如实声明）**：结构化内容来自夹具的人工拆解，本文件只证明
「库能力 + 规则可落地 + 形状可验证」，不证明模型解析自然语言的准确率。
"""

import datetime
import hashlib
import io
import json
import os
import tempfile
import unittest

from scripts.lib import ids, tables
from scripts.tests.validate_fixtures import (
    E_LEDGER,
    L_LEDGER,
    M_LEDGER,
    T_LEDGER,
    append_row,
    call_init,
    call_run_at,
    project_path,
    read_text,
    write_text,
)

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(os.path.dirname(HERE))
FIXTURE_DIR = os.path.join(HERE, "fixtures", "intake")
EXPECTED_JSON = os.path.join(FIXTURE_DIR, "expected.json")
TRANSCRIPT_MD = os.path.join(FIXTURE_DIR, "口述记录.md")
REFERENCE_MD = os.path.join(SKILL_DIR, "references", "内勤工作流.md")

INBOX = "材料/00-待归档"

LEDGERS = {
    "M": M_LEDGER,
    "E": E_LEDGER,
    "L": L_LEDGER,
    "T": T_LEDGER,
}
ID_COLUMNS = {"M": "M编号", "E": "E编号", "L": "L编号", "T": "T编号"}
SEED_KEYS = {"M": "材料登记表", "E": "证据索引", "L": "线索台账", "T": "任务台账"}
SUMMARY_FIELDS = {"E": "证明内容", "L": "线索内容", "T": "任务"}


def load_expected():
    with io.open(EXPECTED_JSON, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


class IntakeTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)
        code, payload, stderr = call_init(self.root)
        self.assertEqual(0, code, msg="stderr=%s" % stderr)
        self.assertTrue(payload["ok"])

        self.fixture = load_expected()
        self.today = self.fixture["日期"]
        self.files = {entry["文件名"]: entry for entry in self.fixture["收件箱"]}
        self.items = self.fixture["条目"]

        self._seed_ledgers()
        self._seed_materials()
        self._seed_inbox()

    def tearDown(self):
        self._tmp.cleanup()

    # ---- 夹具落盘 -------------------------------------------------------

    def _items_of(self, prefix):
        return [item for item in self.items if item["类型"] == prefix]

    def _seed_ledgers(self):
        for prefix, key in SEED_KEYS.items():
            for fields in self.fixture["种子"][key]:
                self.append_fields(prefix, fields)

    def _seed_materials(self):
        for fields in self.fixture["种子"]["材料登记表"]:
            write_text(project_path(self.root, fields["当前路径"]), "fixture\n")

    def _seed_inbox(self):
        for name in self.files:
            write_text(os.path.join(project_path(self.root, INBOX), name), "fixture\n")

    # ---- 台账读写 -------------------------------------------------------

    def ledger_path(self, prefix):
        return project_path(self.root, LEDGERS[prefix])

    def ledger_text(self, prefix):
        return read_text(self.ledger_path(prefix))

    def header(self, prefix):
        parsed = tables.parse_tables(self.ledger_text(prefix))
        self.assertEqual(1, len(parsed), msg="%s 应只有一张台账表" % LEDGERS[prefix])
        return parsed[0].header

    def append_fields(self, prefix, fields):
        header = self.header(prefix)
        self.assertEqual(set(header), set(fields), msg="字段与表头不一致：%r" % (fields,))
        append_row(
            self.root,
            LEDGERS[prefix],
            "| " + " | ".join(fields[column] for column in header) + " |",
        )

    def read_rows(self, prefix):
        return tables.parse_rows(self.ledger_text(prefix), self.header(prefix))

    def ledger_hashes(self):
        return {
            prefix: hashlib.sha256(read_bytes(self.ledger_path(prefix))).hexdigest()
            for prefix in LEDGERS
        }

    # ---- 口述入账的两段流程 ---------------------------------------------

    def allocate(self, prefix, before_second_read=None):
        """按参考文档取号：`ids.allocate_id` 写入前重读（FR-042）。"""
        path = self.ledger_path(prefix)
        state = {"reads": 0}

        def reread():
            state["reads"] += 1
            if state["reads"] == 2 and before_second_read is not None:
                before_second_read()
            return read_text(path)

        return ids.allocate_id(prefix, reread)

    def scan_inbox(self):
        """扫收件箱分 M：按文件名排序逐份登记为「待归档」，自动档。"""
        names = sorted(
            name
            for name in os.listdir(project_path(self.root, INBOX))
            if name != ".gitkeep"
        )
        self.assertEqual(sorted(self.files), names, msg="夹具收件箱文件对不上")
        assigned = []
        for name in names:
            entry = self.files[name]
            remark = "建议：" + entry["建议目录"]
            if entry["证据候选"]:
                remark += "；证据候选"
            fields = {
                "M编号": self.allocate("M"),
                "原文件名": name,
                "当前路径": INBOX + "/" + name,
                "材料类型": "待定",
                "上传时间": self.today,
                "关联E": "",
                "状态": "待归档",
                "备注": remark,
            }
            self.append_fields("M", fields)
            assigned.append(fields)
        return assigned

    def build_receipt(self):
        """只出回执：E/L/T 暂定编号 + 摘要 + 目标台账，不写盘。"""
        receipt = []
        for item in self.items:
            prefix = item["类型"]
            if prefix == "M":
                continue
            receipt.append(
                {
                    "类型": prefix,
                    "编号": ids.next_id(prefix, self.ledger_text(prefix)),
                    "摘要": item["字段"][SUMMARY_FIELDS[prefix]],
                    "目标台账": LEDGERS[prefix],
                }
            )
        return receipt

    def confirm_items(self):
        """人确认后写台账：逐条按表头落行，编号写入前重读。"""
        written = []
        for item in self.items:
            prefix = item["类型"]
            if prefix == "M":
                continue  # M 已在自动档写入
            fields = dict(item["字段"])
            fields[ID_COLUMNS[prefix]] = self.allocate(prefix)
            self.append_fields(prefix, fields)
            written.append(fields)
        return written


class InboxScanTest(IntakeTestBase):
    def test_inbox_scan_registers_each_file_as_pending_material(self):
        self.scan_inbox()
        expected = list(self.fixture["种子"]["材料登记表"]) + [
            item["字段"] for item in self._items_of("M")
        ]
        self.assertEqual(expected, self.read_rows("M"))
        for row in self.read_rows("M"):
            self.assertEqual(True, os.path.isfile(project_path(self.root, row["当前路径"])))
        for row in self._items_of("M"):
            self.assertEqual("待归档", row["字段"]["状态"])


class TranscriptSplitTest(IntakeTestBase):
    def test_transcript_items_land_in_expected_ledgers_with_exact_fields(self):
        self.scan_inbox()
        self.confirm_items()
        for prefix in ("E", "L", "T"):
            with self.subTest(prefix=prefix):
                expected = list(self.fixture["种子"][SEED_KEYS[prefix]]) + [
                    item["字段"] for item in self._items_of(prefix)
                ]
                self.assertEqual(expected, self.read_rows(prefix))

    def test_each_prefix_numbering_is_max_plus_one_and_unique(self):
        self.scan_inbox()
        self.confirm_items()
        expected_ids = {
            "M": ["M001", "M002", "M003", "M004"],
            "E": ["E001", "E002"],
            "L": ["L005", "L006"],
            "T": ["T003", "T004"],
        }
        expected_next = {"M": "M005", "E": "E003", "L": "L007", "T": "T005"}
        for prefix, wanted in expected_ids.items():
            with self.subTest(prefix=prefix):
                actual = [row[ID_COLUMNS[prefix]] for row in self.read_rows(prefix)]
                self.assertEqual(wanted, actual)
                self.assertEqual(len(actual), len(set(actual)), msg="编号重复：%r" % actual)
                for previous, current in zip(actual, actual[1:]):
                    self.assertEqual(int(previous[1:]) + 1, int(current[1:]))
                self.assertEqual(expected_next[prefix], ids.next_id(prefix, self.ledger_text(prefix)))


class UnconfirmedReceiptTest(IntakeTestBase):
    def test_receipt_before_confirmation_writes_nothing(self):
        self.scan_inbox()
        before = self.ledger_hashes()
        receipt = self.build_receipt()
        after = self.ledger_hashes()

        self.assertEqual(before, after)
        self.assertEqual(
            [("E", "E002"), ("L", "L006"), ("T", "T004")],
            [(entry["类型"], entry["编号"]) for entry in receipt],
        )
        for entry in receipt:
            self.assertEqual(True, bool(entry["摘要"].strip()))
            self.assertEqual(LEDGERS[entry["类型"]], entry["目标台账"])
        # 未确认时 E/L/T 仍只有种子行
        self.assertEqual(1, len(self.read_rows("E")))
        self.assertEqual(1, len(self.read_rows("L")))
        self.assertEqual(1, len(self.read_rows("T")))

    def test_confirming_only_evidence_leaves_clues_and_tasks_untouched(self):
        self.scan_inbox()
        before = self.ledger_hashes()
        for item in self._items_of("E"):
            fields = dict(item["字段"])
            fields["E编号"] = self.allocate("E")
            self.append_fields("E", fields)
        after = self.ledger_hashes()
        self.assertEqual(False, before["E"] == after["E"])
        self.assertEqual(before["L"], after["L"])
        self.assertEqual(before["T"], after["T"])


class InferenceBoundaryTest(IntakeTestBase):
    def test_inference_stays_in_clues_and_never_becomes_evidence(self):
        self.scan_inbox()
        self.confirm_items()
        evidence = self.read_rows("E")
        clues = self.read_rows("L")

        inference_items = [item for item in self.items if item.get("性质") == "推断"]
        self.assertEqual(True, bool(inference_items), msg="夹具必须至少有一条推断")
        for item in inference_items:
            with self.subTest(编号=item["编号"]):
                self.assertEqual("L", item["类型"])
                content = item["字段"]["线索内容"]
                self.assertEqual(
                    1,
                    len([row for row in clues if row["L编号"] == item["编号"] and row["线索内容"] == content]),
                )
                self.assertEqual(0, len([row for row in evidence if content in row["证明内容"]]))
                self.assertEqual(False, any(row["E编号"] == item["编号"] for row in evidence))

        marker = "操盘手"
        self.assertEqual(False, marker in "".join(row["证明内容"] for row in evidence))
        self.assertEqual(True, marker in "".join(row["线索内容"] for row in clues))


class RereadBeforeWriteTest(IntakeTestBase):
    def test_allocate_id_skips_a_number_taken_between_preview_and_write(self):
        preview = ids.next_id("E", self.ledger_text("E"))
        self.assertEqual("E002", preview)

        def concurrent_append():
            fields = dict(self._items_of("E")[0]["字段"])
            fields["E编号"] = "E002"
            fields["证明内容"] = "外部会话先写入的 E002"
            self.append_fields("E", fields)

        allocated = self.allocate("E", before_second_read=concurrent_append)
        self.assertEqual("E003", allocated)

        fields = dict(self._items_of("E")[0]["字段"])
        fields["E编号"] = allocated
        fields["证明内容"] = "本会话写入的 E003"
        self.append_fields("E", fields)

        actual = [row["E编号"] for row in self.read_rows("E")]
        self.assertEqual(["E001", "E002", "E003"], actual)
        self.assertEqual(len(actual), len(set(actual)))


class ReferenceRulesTest(unittest.TestCase):
    """规则本体在参考文档里；删掉约束句会让本用例红（变异用）。"""

    REQUIRED_TOKENS = ("推断不得写成 E", "allocate_id", "确认前不动台账", "材料/00-待归档")

    def test_intake_section_keeps_the_binding_rules(self):
        text = read_text(REFERENCE_MD)
        start = text.index("## 口述入账")
        rest = text[start + len("## 口述入账"):]
        end = rest.find("\n## ")
        section = rest if end == -1 else rest[:end]
        for token in self.REQUIRED_TOKENS:
            with self.subTest(token=token):
                self.assertEqual(True, token in section)


class ValidatorIntegrationTest(IntakeTestBase):
    def test_intake_result_has_no_validation_errors(self):
        self.scan_inbox()
        self.confirm_items()
        code, payload = call_run_at(self.root, datetime.date.fromisoformat(self.today))
        self.assertEqual(0, code, msg="errors=%r" % (payload["errors"],))
        self.assertEqual([], payload["errors"])
        warning_codes = {item["code"] for item in payload["warnings"]}
        self.assertEqual(True, "M_PENDING" in warning_codes)


if __name__ == "__main__":
    unittest.main()
