"""``digest.py`` 的行为测试（T008 / US6 / FR-084）。

每条用例只钉一条结构化行为（TR-011）：六段标题与顺序、积压/逾期来自
``validate_case`` 的同一判据、主数据只读（运行前后逐文件 sha256 不变）、
整文件重生且稳定、读取/表格解析失败退出码 2 且磁盘零改动、``--json`` 单对象、
``--open`` 失败只警告。

夹具用 ``init_case`` 建完整工作区；基准日一律经 ``--date`` 注入固定日期，
不依赖真实时钟。
"""

import datetime
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from scripts import digest
from scripts.lib import tables
from scripts.tests.validate_fixtures import (
    CASE_INFO,
    L_LEDGER,
    M_LEDGER,
    T_LEDGER,
    append_row,
    call_init,
    l_row,
    m_row,
    project_path,
    read_text,
    t_row,
    write_text,
)

BASE = datetime.date(2026, 11, 27)
BASE_TEXT = "2026-11-27"
DASHBOARD = "专案协同/00-协同台账.md"
STAGE_HEADER = (
    "阶段",
    "状态",
    "开始日期",
    "法定期限或节点",
    "负责人",
    "下一步",
    "阻塞或风险",
    "完成标志",
)
SECTION_TITLES = [
    "新增线索",
    "待办与逾期任务",
    "待决策",
    "风险",
    "收网准备度",
    "待归档与待归类积压",
]


def snapshot(root, skip=None):
    """返回 ``{项目相对路径: sha256}``；``skip`` 为要排除的相对路径。"""
    result = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            relative = os.path.relpath(full, root).replace(os.sep, "/")
            if relative == skip:
                continue
            with open(full, "rb") as handle:
                result[relative] = hashlib.sha256(handle.read()).hexdigest()
    return result


def set_stage(root, stage, status=None, owner=None, next_step=None, risk=None):
    """改 ``案件信息.md`` 阶段看板的一行（其余单元格保持原样）。"""
    path = project_path(root, CASE_INFO)
    lines = read_text(path).splitlines()
    replaced = False
    for index, line in enumerate(lines):
        cells = tables.split_cells(line)
        if cells is None or len(cells) != len(STAGE_HEADER) or cells[0] != stage:
            continue
        cells = list(cells)
        if status is not None:
            cells[1] = status
        if owner is not None:
            cells[4] = owner
        if next_step is not None:
            cells[5] = next_step
        if risk is not None:
            cells[6] = risk
        lines[index] = "| " + " | ".join(cells) + " |"
        replaced = True
        break
    if not replaced:
        raise AssertionError("案件信息.md 缺少阶段行：%s" % stage)
    write_text(path, "\n".join(lines) + "\n")


def dashboard_headings(text):
    return [line[3:].strip() for line in text.splitlines() if line.startswith("## ")]


class DigestTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)
        code, payload, stderr = call_init(self.root)
        self.assertEqual(0, code, msg="stderr=%s" % stderr)
        self.assertTrue(payload["ok"])

    def tearDown(self):
        self._tmp.cleanup()

    def call_digest(self, extra=None, date=BASE_TEXT):
        argv = ["--root", self.root]
        if date is not None:
            argv.extend(["--date", date])
        argv.append("--json")
        if extra:
            argv.extend(extra)
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = digest.main(argv)
        return code, out.getvalue(), err.getvalue()

    def payload(self, extra=None, date=BASE_TEXT):
        code, stdout, stderr = self.call_digest(extra=extra, date=date)
        decoder = json.JSONDecoder()
        payload, end = decoder.raw_decode(stdout)
        self.assertEqual("", stdout[end:].strip(), msg="stdout 只允许一个 JSON 对象")
        return code, payload, stderr

    def read_dashboard(self):
        with io.open(
            project_path(self.root, DASHBOARD), "r", encoding="utf-8", newline=""
        ) as handle:
            return handle.read()

    def dashboard_bytes(self):
        with open(project_path(self.root, DASHBOARD), "rb") as handle:
            return handle.read()


class DigestSectionsTest(DigestTestBase):
    def test_six_sections_present_in_fixed_order(self):
        code, payload, _stderr = self.payload()
        self.assertEqual(0, code)
        self.assertEqual(True, payload["ok"])
        self.assertEqual(DASHBOARD, payload["path"])
        self.assertEqual(BASE_TEXT, payload["date"])
        self.assertEqual(SECTION_TITLES, dashboard_headings(self.read_dashboard()))

    def test_empty_sections_use_placeholder(self):
        self.payload()
        text = self.read_dashboard()
        placeholders = [line for line in text.splitlines() if line.strip() == "无"]
        # 新增线索 / 待办与逾期任务 / 待决策 / 风险 / 积压 五段为空；
        # 收网准备度有阶段状态「未开始」。
        self.assertEqual(5, len(placeholders))
        self.assertIn("收网抓捕阶段状态：未开始", text)

    def test_success_json_shape_is_exact(self):
        _code, payload, _stderr = self.payload()
        self.assertEqual({"ok", "path", "date", "sections"}, set(payload))
        self.assertEqual(
            {"新增线索", "逾期任务", "待决策", "风险", "收网准备度", "积压"},
            set(payload["sections"]),
        )

    def test_injected_date_is_echoed(self):
        code, payload, _stderr = self.payload(date="2026-11-20")
        self.assertEqual(0, code)
        self.assertEqual("2026-11-20", payload["date"])
        self.assertIn("基准日：2026-11-20", self.read_dashboard())


class DigestItemsTest(DigestTestBase):
    def seed(self):
        write_text(project_path(self.root, "材料/00-待归档/未归档.txt"), "待归档\n")
        write_text(
            project_path(self.root, "专案协同/00-原始记录/2026-11-26-手记.md"),
            "手记原文\n",
        )
        append_row(self.root, M_LEDGER, m_row(mid="M001", status="待归类"))
        append_row(self.root, L_LEDGER, l_row(lid="L001", status="待核查"))
        append_row(self.root, L_LEDGER, l_row(lid="L002", status="已排除"))
        append_row(self.root, T_LEDGER, t_row(tid="T001", status="待办", deadline="2026-11-20"))
        append_row(self.root, T_LEDGER, t_row(tid="T002", status="进行中", deadline="持续"))
        append_row(self.root, T_LEDGER, t_row(tid="T003", status="已完成", deadline="2026-11-01"))
        set_stage(
            self.root,
            "落地侦查",
            status="受阻",
            owner="民警甲",
            next_step="补材料",
            risk="等待法制审核",
        )
        set_stage(
            self.root,
            "收网抓捕",
            status="进行中",
            owner="民警乙",
            next_step="推进方案",
            risk="等审批",
        )

    def test_counts_come_from_ledgers(self):
        self.seed()
        code, payload, _stderr = self.payload()
        self.assertEqual(0, code)
        self.assertEqual(
            {
                "新增线索": 1,
                "逾期任务": 1,
                "待决策": 2,
                "风险": 1,
                "收网准备度": "进行中",
                "积压": 3,
            },
            payload["sections"],
        )

    def test_items_are_rendered(self):
        self.seed()
        self.payload()
        text = self.read_dashboard()
        for expected in (
            "L001",
            "T001",
            "T002",
            "收件箱还有 1 份未归档",
            "M001 状态为待归类",
            "原始记录缺「已整理」标记",
            "等待法制审核",
            "等审批",
        ):
            self.assertIn(expected, text)
        self.assertNotIn("L002", text)
        self.assertNotIn("T003", text)

    def test_overdue_flag_matches_validate_case(self):
        self.seed()
        _code, payload, _stderr = self.payload()
        self.assertEqual(1, payload["sections"]["逾期任务"])
        text = self.read_dashboard()
        task_lines = [line for line in text.splitlines() if line.startswith("| T00")]
        self.assertEqual(2, len(task_lines))
        overdue = [line for line in task_lines if line.rstrip().endswith("| 是 |")]
        self.assertEqual(1, len(overdue))
        self.assertIn("T001", overdue[0])


class DigestReadOnlyTest(DigestTestBase):
    def test_main_data_hashes_unchanged(self):
        write_text(project_path(self.root, "材料/00-待归档/未归档.txt"), "待归档\n")
        append_row(self.root, T_LEDGER, t_row(tid="T001", status="待办", deadline="2026-11-20"))
        before = snapshot(self.root, skip=DASHBOARD)
        code, payload, _stderr = self.payload()
        self.assertEqual(0, code)
        self.assertTrue(payload["ok"])
        after = snapshot(self.root, skip=DASHBOARD)
        self.assertEqual(before, after, msg="主数据文件哈希必须精确不变")
        self.assertTrue(os.path.isfile(project_path(self.root, DASHBOARD)))

    def test_second_run_is_byte_identical(self):
        self.payload()
        first = self.dashboard_bytes()
        _code, payload, _stderr = self.payload()
        self.assertEqual(True, payload["ok"])
        self.assertEqual(first, self.dashboard_bytes())


class DigestFailureTest(DigestTestBase):
    def test_missing_source_exits_2_without_writing(self):
        os.remove(project_path(self.root, L_LEDGER))
        before = snapshot(self.root)
        code, payload, _stderr = self.payload()
        self.assertEqual(2, code)
        self.assertEqual(False, payload["ok"])
        self.assertTrue(payload["errors"])
        self.assertEqual(before, snapshot(self.root))
        self.assertFalse(os.path.isfile(project_path(self.root, DASHBOARD)))

    def test_bad_table_exits_2_and_keeps_existing_dashboard(self):
        _code, _payload, _stderr = self.payload()
        previous = self.dashboard_bytes()
        append_row(self.root, L_LEDGER, "| 坏行 |")
        before = snapshot(self.root)
        code, payload, _stderr = self.payload()
        self.assertEqual(2, code)
        self.assertEqual(False, payload["ok"])
        self.assertTrue(payload["errors"])
        self.assertEqual(before, snapshot(self.root), msg="解析失败不得写半份")
        self.assertEqual(previous, self.dashboard_bytes())

    def test_invalid_date_exits_2(self):
        code, payload, _stderr = self.payload(date="2026-02-30")
        self.assertEqual(2, code)
        self.assertEqual(False, payload["ok"])
        self.assertFalse(os.path.isfile(project_path(self.root, DASHBOARD)))


class DigestOpenTest(DigestTestBase):
    def test_open_invokes_system_opener_with_absolute_path(self):
        with mock.patch.object(digest, "_open_path") as opener:
            code, payload, _stderr = self.payload(extra=["--open"])
        self.assertEqual(0, code)
        self.assertTrue(payload["ok"])
        opener.assert_called_once_with(project_path(self.root, DASHBOARD))

    def test_open_failure_only_warns(self):
        with mock.patch.object(digest, "_open_path", side_effect=OSError("no opener")):
            code, payload, stderr = self.payload(extra=["--open"])
        self.assertEqual(0, code)
        self.assertTrue(payload["ok"])
        self.assertIn("警告", stderr)
        self.assertTrue(os.path.isfile(project_path(self.root, DASHBOARD)))


if __name__ == "__main__":
    unittest.main()
