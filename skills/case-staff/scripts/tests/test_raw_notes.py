"""T010 原始记录整理的结构用例（US4 / FR-061、FR-082 一带）。

**不依赖真实 AI**：`fixtures/raw_notes/手记.md` 固定一份内部碰头手记，
`fixtures/raw_notes/外部来件.txt` 固定一份外部来件，
`fixtures/raw_notes/expected.json` 固定人工拆解出的期望结构（``类型`` / ``编号`` / ``字段``）。
用例按 `references/内勤工作流.md`「原始记录整理」的规则，用 `scripts/lib/ids.py` 与
`scripts/lib/tables.py` 把期望结构落成台账行，再回读逐字段比对。

覆盖的判据：
- 原文只读：整理前后正文字节相等，只在末尾多出「已整理」追加段（不重写、不合并段落）；
- 分流 E/L/T：事实→E 草稿、推断→L、待办→T，字段逐列等于期望 JSON；
- 标记格式：`已整理：L001 / T001（2026-11-27）`，含 C/T/L/V 编号与整理时间；
- 幂等：已标记的不重复追加、不重复写台账行；
- 外部来件不改写、保留原名；
- 校验联动：整理后同一 `validate_case.run` 不再报该记录的 `M_PENDING`。

**缺口（如实声明）**：结构化内容来自夹具的人工拆解，本文件只证明
「库能力 + 规则可落地 + 形状可验证」，不证明模型解析自然语言的准确率。
"""

import datetime
import hashlib
import io
import json
import os
import re
import tempfile
import unittest

from scripts import validate_case
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
FIXTURE_DIR = os.path.join(HERE, "fixtures", "raw_notes")
EXPECTED_JSON = os.path.join(FIXTURE_DIR, "expected.json")
REFERENCE_MD = os.path.join(SKILL_DIR, "references", "内勤工作流.md")

ORIGINAL_DIR = validate_case.ORIGINAL_RECORDS_DIR.rstrip("/")
MARKER_TOKEN = validate_case.ORIGINAL_RECORD_MARKER

LEDGERS = {
    "M": M_LEDGER,
    "E": E_LEDGER,
    "L": L_LEDGER,
    "T": T_LEDGER,
}
ID_COLUMNS = {"M": "M编号", "E": "E编号", "L": "L编号", "T": "T编号"}
SEED_KEYS = {"M": "材料登记表"}
# data-model §6.4：末尾标记只列 C/T/L/V 编号；E 草稿在证据索引另行确认。
MARKER_PREFIXES = ("C", "T", "L", "V")


def load_expected():
    with io.open(EXPECTED_JSON, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


class RawNotesTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)
        code, payload, stderr = call_init(self.root)
        self.assertEqual(0, code, msg="stderr=%s" % stderr)
        self.assertTrue(payload["ok"])

        self.fixture = load_expected()
        self.today = self.fixture["日期"]
        self.items = self.fixture["条目"]

        note = self.fixture["原始记录"]["手记"]
        self.note_rel = ORIGINAL_DIR + "/" + note["文件名"]
        external = self.fixture["原始记录"]["外部来件"]
        self.external_rel = ORIGINAL_DIR + "/" + external["文件名"]

        self._seed_materials()
        self._seed_records()

    def tearDown(self):
        self._tmp.cleanup()

    # ---- 夹具落盘 -------------------------------------------------------

    def _seed_materials(self):
        for fields in self.fixture["种子"][SEED_KEYS["M"]]:
            self.append_fields("M", fields)
        for rel in self.fixture["种子"]["材料文件"]:
            write_text(project_path(self.root, rel), "fixture\n")

    def _seed_records(self):
        for key in ("手记", "外部来件"):
            entry = self.fixture["原始记录"][key]
            source = os.path.join(FIXTURE_DIR, entry["夹具"])
            target = project_path(self.root, ORIGINAL_DIR + "/" + entry["文件名"])
            write_text(target, read_text(source))

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

    def allocate(self, prefix):
        """按参考文档取号：`ids.allocate_id` 写入前重读（FR-042）。"""
        path = self.ledger_path(prefix)
        return ids.allocate_id(prefix, lambda: read_text(path))

    # ---- 原始记录整理流程 -----------------------------------------------

    def marker_numbers(self):
        return [
            item["编号"] for item in self.items if item["类型"] in MARKER_PREFIXES
        ]

    def marker_text(self, numbers):
        meta = self.fixture["标记"]
        return (
            meta["前缀"]
            + meta["分隔"].join(numbers)
            + meta["左括号"]
            + self.today
            + meta["右括号"]
        )

    def append_marker(self, numbers):
        path = project_path(self.root, self.note_rel)
        text = read_text(path)
        if not text.endswith("\n"):
            text += "\n"
        write_text(path, text + "\n" + self.marker_text(numbers) + "\n")

    def organize(self):
        """整理手记：先把 E/L/T 按期望结构落账，再在原文末尾追加标记。

        幂等入口：原文已含「已整理」标记 ⇒ 本次什么都不做（不追加、不重写台账行）。
        """
        text = read_text(project_path(self.root, self.note_rel))
        if MARKER_TOKEN in text:
            return []
        written = []
        numbers = []
        for item in self.items:
            prefix = item["类型"]
            fields = dict(item["字段"])
            fields[ID_COLUMNS[prefix]] = self.allocate(prefix)
            self.append_fields(prefix, fields)
            written.append(fields)
            if prefix in MARKER_PREFIXES:
                numbers.append(fields[ID_COLUMNS[prefix]])
        self.append_marker(numbers)
        return written

    def pending_files(self, payload):
        return [
            item["file"]
            for item in payload["warnings"]
            if item["code"] == "M_PENDING"
        ]


class SplitRowsTest(RawNotesTestBase):
    def test_fact_inference_and_todo_land_in_expected_ledgers(self):
        self.organize()
        for prefix in ("E", "L", "T"):
            with self.subTest(prefix=prefix):
                expected = [
                    item["字段"] for item in self.items if item["类型"] == prefix
                ]
                self.assertEqual(expected, self.read_rows(prefix))

    def test_each_type_keeps_its_initial_status(self):
        self.organize()
        self.assertEqual("草稿", self.read_rows("E")[0]["状态"])
        self.assertEqual("待核查", self.read_rows("L")[0]["状态"])
        self.assertEqual("待办", self.read_rows("T")[0]["状态"])


class OriginalUnchangedTest(RawNotesTestBase):
    def test_body_is_byte_identical_and_only_marker_is_appended(self):
        before = read_bytes(project_path(self.root, self.note_rel))
        self.organize()
        after = read_bytes(project_path(self.root, self.note_rel))

        self.assertEqual(before, after[: len(before)], msg="原文正文被改写")
        appended = after[len(before):].decode("utf-8")
        self.assertEqual(True, bool(appended.strip()), msg="末尾没有追加段")
        self.assertEqual(True, MARKER_TOKEN in appended)

        original_text = before.decode("utf-8")
        after_text = after.decode("utf-8")
        paragraphs = [line for line in original_text.splitlines() if line.strip()]
        self.assertEqual(True, bool(paragraphs))
        for line in paragraphs:
            with self.subTest(line=line):
                self.assertEqual(1, after_text.count(line), msg="段落被重写/合并/重复")

        last_line = [line for line in after_text.splitlines() if line.strip()][-1]
        self.assertEqual(True, MARKER_TOKEN in last_line, msg="标记不在末尾")

    def test_external_incoming_file_is_not_rewritten_and_keeps_its_name(self):
        path = project_path(self.root, self.external_rel)
        before = read_bytes(path)
        self.organize()
        self.assertEqual(before, read_bytes(path))

        note = self.fixture["原始记录"]["手记"]["文件名"]
        external = self.fixture["原始记录"]["外部来件"]["文件名"]
        names = sorted(os.listdir(project_path(self.root, ORIGINAL_DIR)))
        self.assertEqual(sorted([".gitkeep", note, external]), names)


class MarkerFormatTest(RawNotesTestBase):
    def test_marker_has_prefix_numbers_and_time(self):
        self.organize()
        text = read_text(project_path(self.root, self.note_rel))
        lines = [line for line in text.splitlines() if MARKER_TOKEN in line]
        self.assertEqual(1, len(lines), msg="应恰好一行「已整理」标记")

        marker = lines[0]
        self.assertEqual(self.marker_text(self.marker_numbers()), marker)
        self.assertEqual(True, marker.startswith(self.fixture["标记"]["前缀"]))
        # data-model §6.4：标记列 C/T/L/V 编号 + 时间。
        self.assertEqual(True, re.search(r"[CLTV]\d{3,}", marker) is not None)
        self.assertEqual(True, self.today in marker)
        for number in self.marker_numbers():
            with self.subTest(编号=number):
                self.assertEqual(True, number in marker)


class IdempotencyTest(RawNotesTestBase):
    def test_second_organize_appends_nothing_and_writes_no_rows(self):
        self.organize()
        note_after_first = read_bytes(project_path(self.root, self.note_rel))
        ledgers_after_first = self.ledger_hashes()

        second = self.organize()

        self.assertEqual([], second)
        self.assertEqual(
            note_after_first, read_bytes(project_path(self.root, self.note_rel))
        )
        self.assertEqual(ledgers_after_first, self.ledger_hashes())
        text = read_text(project_path(self.root, self.note_rel))
        self.assertEqual(1, text.count(MARKER_TOKEN), msg="「已整理」被重复追加")


class ValidationLinkTest(RawNotesTestBase):
    def test_organized_note_is_no_longer_pending_for_the_same_validator(self):
        code, before = call_run_at(self.root, datetime.date.fromisoformat(self.today))
        self.assertEqual(0, code, msg=before.get("errors"))
        self.assertEqual(True, self.note_rel in self.pending_files(before))

        self.organize()

        code, after = call_run_at(self.root, datetime.date.fromisoformat(self.today))
        self.assertEqual(0, code, msg=after.get("errors"))
        self.assertEqual([], after["errors"])
        self.assertEqual(False, self.note_rel in self.pending_files(after))
        # 外部来件按 FR-082 原样保留、不追加标记 ⇒ 其积压警告留给下一轮人工处理。
        self.assertEqual(True, self.external_rel in self.pending_files(after))


class ReferenceRulesTest(unittest.TestCase):
    """规则本体在参考文档里；删掉约束句会让本用例红（变异用）。"""

    REQUIRED_TOKENS = ("正文不改", "已整理：", "外部来件", "YYYY-MM-DD-沟通记录-主题.md", "幂等")

    def test_raw_notes_section_keeps_the_binding_rules(self):
        text = read_text(REFERENCE_MD)
        start = text.index("## 原始记录整理")
        rest = text[start + len("## 原始记录整理"):]
        end = rest.find("\n## ")
        section = rest if end == -1 else rest[:end]
        for token in self.REQUIRED_TOKENS:
            with self.subTest(token=token):
                self.assertEqual(True, token in section)


if __name__ == "__main__":
    unittest.main()
