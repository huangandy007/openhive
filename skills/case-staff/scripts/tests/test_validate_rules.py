"""``validate_case.py`` 规则类检查的行为测试（T006 / FR-080 ~ FR-083）。

覆盖 data-model §7 的剩余组：命名（§4.1 正则 / 禁用词 / 目录白名单 / 外部来件豁免）、
积压（待归档 / 待归类 / 原始记录已整理标记）、逾期 ``T_OVERDUE``、
跨文档矛盾 ``X_CONFLICT``，以及 ``--strict``（警告 → 退出码 1）。

「今天」一律经 ``call_run_at`` 注入固定日期，不依赖真实时钟；
「不存在」断言用精确集合（``#013-12`` / ``#006-22``）。
"""

import datetime
import os
import unittest

from scripts.tests.validate_fixtures import (
    M_LEDGER,
    P_LEDGER,
    T_LEDGER,
    ValidateTestBase,
    append_row,
    arrest_row,
    call_json,
    call_run_at,
    codes_of,
    insert_before,
    m_row,
    p_row,
    project_path,
    read_text,
    t_row,
    write_text,
)

TODAY = datetime.date(2026, 11, 27)

ARREST_FILE = "专案协同/07-抓捕筹备/00-抓捕对象清单.md"
ARREST_END = "<!-- AUTO:END 抓捕对象 -->"
ARREST_RECORD = "侦查/收网抓捕/00-收网记录.md"
INBOX_DIR = "材料/00-待归档/"
ORIGINAL_RECORDS = "专案协同/00-原始记录/"


class NamingTest(ValidateTestBase):
    def test_illegal_characters_in_own_file_name(self):
        write_text(project_path(self.root, "汇报 (1).md"), "")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"NAME_ILLEGAL"})
        self.assertEqual("汇报 (1).md", payload["errors"][0]["file"])
        self.assertIn("非法字符", payload["errors"][0]["message"])

    def test_forbidden_word_in_own_file_name(self):
        write_text(project_path(self.root, "最新汇报.md"), "")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"NAME_ILLEGAL"})
        self.assertIn("禁用词", payload["errors"][0]["message"])

    def test_one_finding_per_entry(self):
        write_text(project_path(self.root, "最新汇报 (1).md"), "")
        payload = self.run_with_errors()
        self.assertEqual(1, len(payload["errors"]))
        self.assert_only_codes(payload, {"NAME_ILLEGAL"})
        self.assertIn("非法字符", payload["errors"][0]["message"])
        self.assertIn("禁用词", payload["errors"][0]["message"])

    def test_second_level_directory_outside_whitelist(self):
        write_text(project_path(self.root, "研判/03-新分类/说明.md"), "")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"NAME_ILLEGAL"})
        self.assertEqual("研判/03-新分类/", payload["errors"][0]["file"])

    def test_person_directory_and_contents_are_allowed(self):
        append_row(self.root, P_LEDGER, p_row(pid="P001", name="张三"))
        write_text(
            project_path(self.root, "专案协同/06-人员与组织/P001-张三/备注.txt"),
            "对象资料\n",
        )
        self.run_ok()

    def test_legal_rule_named_file_is_clean(self):
        write_text(
            project_path(self.root, "专案协同/01-每日动态/2026-11-27-每日动态.md"),
            "---\nid: 2026-11-27-每日动态\n---\n\n# 每日动态\n",
        )
        self.run_ok()

    def test_rule_named_file_in_wrong_directory_is_illegal(self):
        write_text(
            project_path(self.root, "专案协同/01-每日动态/随手记.md"),
            "",
        )
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"NAME_ILLEGAL"})

    def test_external_incoming_file_keeps_original_name(self):
        name = "现场照片 (1).jpg"
        path = INBOX_DIR + name
        write_text(project_path(self.root, path), "x")
        append_row(
            self.root,
            M_LEDGER,
            m_row(name=name, path=path, status="待归档"),
        )
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        self.assertEqual(set(), codes_of(payload["errors"]))
        self.assertEqual({"M_PENDING"}, codes_of(payload["warnings"]))

    def test_registry_and_placeholder_files_are_not_flagged(self):
        payload = self.run_ok()
        flagged = [
            item
            for item in payload["warnings"] + payload["errors"]
            if item["code"] == "NAME_ILLEGAL"
        ]
        self.assertEqual([], flagged)


class BacklogTest(ValidateTestBase):
    def test_inbox_file_is_pending(self):
        name = "未归档.pdf"
        path = INBOX_DIR + name
        write_text(project_path(self.root, path), "x")
        append_row(
            self.root,
            M_LEDGER,
            m_row(mid="M001", name=name, path=path, status="待归档"),
        )
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        items = [
            item for item in payload["warnings"] if item["file"] == INBOX_DIR
        ]
        self.assertEqual(1, len(items))
        self.assertEqual("M_PENDING", items[0]["code"])
        self.assertIn("1", items[0]["message"])

    def test_material_row_pending_classification(self):
        write_text(project_path(self.root, "材料/99-其他/说明.txt"), "说明\n")
        append_row(
            self.root,
            M_LEDGER,
            m_row(mid="M001", path="材料/99-其他/说明.txt", status="待归类"),
        )
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        items = [
            item for item in payload["warnings"] if item["file"] == M_LEDGER
        ]
        self.assertEqual(1, len(items))
        self.assertEqual("M_PENDING", items[0]["code"])
        self.assertGreater(items[0]["line"], 0)

    def test_original_record_without_marker_is_pending(self):
        rel = ORIGINAL_RECORDS + "碰头手记.md"
        write_text(project_path(self.root, rel), "手记正文，无整理标记。\n")
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        items = [item for item in payload["warnings"] if item["file"] == rel]
        self.assertEqual(1, len(items))
        self.assertEqual("M_PENDING", items[0]["code"])

    def test_original_record_with_marker_is_clean(self):
        write_text(
            project_path(self.root, ORIGINAL_RECORDS + "碰头手记.md"),
            "手记正文。\n\n已整理：C001 / T001 / L001（2026-11-27）\n",
        )
        payload = self.run_ok()
        self.assertEqual([], payload["warnings"])

    def test_gitkeep_is_not_counted_as_backlog(self):
        payload = self.run_ok()
        self.assertEqual([], payload["warnings"])


class OverdueTest(ValidateTestBase):
    def _warnings(self):
        code, payload = call_run_at(self.root, TODAY)
        self.assertEqual(0, code, msg=payload)
        return payload

    def test_pending_task_past_deadline_is_overdue(self):
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="待办", deadline="2026-11-26"),
        )
        payload = self._warnings()
        self.assertEqual(set(), codes_of(payload["errors"]))
        self.assertEqual({"T_OVERDUE"}, codes_of(payload["warnings"]))
        self.assertGreater(payload["warnings"][0]["line"], 0)
        self.assertIn("T001", payload["warnings"][0]["message"])

    def test_in_progress_task_past_deadline_is_overdue(self):
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="进行中", deadline="2026-01-01"),
        )
        payload = self._warnings()
        self.assertEqual({"T_OVERDUE"}, codes_of(payload["warnings"]))

    def test_deadline_today_or_later_is_not_overdue(self):
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="待办", deadline="2026-11-27"),
        )
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T002", status="进行中", deadline="2026-12-01"),
        )
        payload = self._warnings()
        self.assertEqual([], payload["warnings"])

    def test_non_date_deadline_does_not_participate(self):
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="待办", deadline="持续"),
        )
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T002", status="进行中", deadline="当日"),
        )
        payload = self._warnings()
        self.assertEqual([], payload["warnings"])

    def test_finished_task_past_deadline_is_not_overdue(self):
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="已完成", deadline="2026-01-01"),
        )
        payload = self._warnings()
        self.assertEqual([], payload["warnings"])


class CrossDocumentTest(ValidateTestBase):
    def _seed_people(self, *rows):
        for row in rows:
            append_row(self.root, P_LEDGER, row)

    def _seed_arrests(self, *rows):
        for index, row in enumerate(rows, 1):
            insert_before(self.root, ARREST_FILE, ARREST_END, row)

    def test_person_name_conflict_is_an_error(self):
        self._seed_people(p_row(pid="P001", name="张三", role="主犯"))
        self._seed_arrests(arrest_row(pid="P001", name="张三丰", role="主犯"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"X_CONFLICT"})
        self.assertEqual(ARREST_FILE, payload["errors"][0]["file"])
        self.assertIn("姓名", payload["errors"][0]["message"])

    def test_person_role_conflict_is_an_error(self):
        self._seed_people(p_row(pid="P001", name="张三", role="主犯"))
        self._seed_arrests(arrest_row(pid="P001", name="张三", role="从犯"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"X_CONFLICT"})
        self.assertIn("角色", payload["errors"][0]["message"])

    def test_matching_person_is_clean(self):
        self._seed_people(p_row(pid="P001", name="张三", role="主犯"))
        self._seed_arrests(arrest_row(pid="P001", name="张三", role="主犯"))
        self.run_ok()

    def test_arrest_person_absent_from_ledger_is_ref_missing(self):
        self._seed_arrests(arrest_row(pid="P002", name="李四", role="从犯"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"REF_MISSING"})
        self.assertIn("P002", payload["errors"][0]["message"])

    def _write_summary(self, key, value):
        path = project_path(self.root, ARREST_RECORD)
        text = read_text(path)
        old = "| %s | |" % key
        self.assertIn(old, text)
        write_text(path, text.replace(old, "| %s | %d |" % (key, value), 1))

    def _write_summary_total(self, value):
        self._write_summary("对象总数", value)

    def test_summary_count_mismatch_is_a_warning(self):
        self._seed_people(
            p_row(pid="P001", name="张三", role="主犯"),
            p_row(pid="P002", name="李四", role="从犯"),
        )
        self._seed_arrests(
            arrest_row(seq="1", pid="P001", name="张三", role="主犯"),
            arrest_row(seq="2", pid="P002", name="李四", role="从犯"),
        )
        self._write_summary_total(3)
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        self.assertEqual(set(), codes_of(payload["errors"]))
        self.assertEqual({"X_CONFLICT"}, codes_of(payload["warnings"]))
        self.assertEqual(ARREST_RECORD, payload["warnings"][0]["file"])
        self.assertIn("对象总数", payload["warnings"][0]["message"])

    def test_summary_count_match_is_clean(self):
        self._seed_people(p_row(pid="P001", name="张三", role="主犯"))
        self._seed_arrests(arrest_row(seq="1", pid="P001", name="张三", role="主犯"))
        self._write_summary_total(1)
        self.run_ok()

    def _seed_two_targets(self):
        self._seed_people(
            p_row(pid="P001", name="张三", role="主犯", status="已到案"),
            p_row(pid="P002", name="李四", role="从犯", status="在逃"),
        )
        self._seed_arrests(
            arrest_row(seq="1", pid="P001", name="张三", role="主犯"),
            arrest_row(seq="2", pid="P002", name="李四", role="从犯"),
        )

    def test_arrived_count_mismatch_is_a_warning(self):
        self._seed_two_targets()
        self._write_summary("到案人数", 2)
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        self.assertEqual(set(), codes_of(payload["errors"]))
        self.assertEqual({"X_CONFLICT"}, codes_of(payload["warnings"]))
        self.assertIn("到案人数", payload["warnings"][0]["message"])

    def test_at_large_count_mismatch_is_a_warning(self):
        self._seed_two_targets()
        self._write_summary("在逃人数", 2)
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code, msg=payload)
        self.assertEqual(set(), codes_of(payload["errors"]))
        self.assertEqual({"X_CONFLICT"}, codes_of(payload["warnings"]))
        self.assertIn("在逃人数", payload["warnings"][0]["message"])

    def test_arrived_and_at_large_counts_match_is_clean(self):
        self._seed_two_targets()
        self._write_summary("到案人数", 1)
        self._write_summary("在逃人数", 1)
        self.run_ok()


class StrictModeTest(ValidateTestBase):
    def _seed_warning(self):
        name = "未归档.pdf"
        path = INBOX_DIR + name
        write_text(project_path(self.root, path), "x")
        append_row(
            self.root,
            M_LEDGER,
            m_row(mid="M001", name=name, path=path, status="待归档"),
        )

    def test_warning_without_strict_exits_zero(self):
        self._seed_warning()
        code, payload, _ = call_json(self.root)
        self.assertEqual(0, code)
        self.assertEqual(True, payload["ok"])
        self.assertEqual(0, payload["counts"]["errors"])
        self.assertGreaterEqual(payload["counts"]["warnings"], 1)

    def test_warning_with_strict_exits_one(self):
        self._seed_warning()
        code, payload, _ = call_json(self.root, ["--strict"])
        self.assertEqual(1, code)
        self.assertEqual(True, payload["ok"])
        self.assertEqual(0, payload["counts"]["errors"])
        self.assertGreaterEqual(payload["counts"]["warnings"], 1)

    def test_error_still_exits_two_with_strict(self):
        write_text(project_path(self.root, "汇报 (1).md"), "")
        code, payload, _ = call_json(self.root, ["--strict"])
        self.assertEqual(2, code)
        self.assertEqual(False, payload["ok"])


class WarningContractTest(ValidateTestBase):
    def test_warnings_have_same_shape_and_are_sorted(self):
        write_text(project_path(self.root, "材料/99-其他/说明.txt"), "说明\n")
        name = "未归档.pdf"
        write_text(project_path(self.root, INBOX_DIR + name), "x")
        append_row(
            self.root,
            M_LEDGER,
            m_row(mid="M001", name=name, path=INBOX_DIR + name, status="待归档"),
        )
        append_row(
            self.root,
            M_LEDGER,
            m_row(
                mid="M002",
                path="材料/99-其他/说明.txt",
                status="待归类",
            ),
        )
        write_text(project_path(self.root, ORIGINAL_RECORDS + "手记.md"), "正文\n")
        append_row(
            self.root,
            T_LEDGER,
            t_row(tid="T001", status="待办", deadline="2026-11-26"),
        )
        code, payload = call_run_at(self.root, TODAY)
        self.assertEqual(0, code, msg=payload)
        self.assertEqual(len(payload["warnings"]), payload["counts"]["warnings"])
        for item in payload["warnings"]:
            self.assertEqual({"file", "line", "code", "message"}, set(item))
        ordered = sorted(
            payload["warnings"],
            key=lambda item: (item["file"], item["line"], item["code"], item["message"]),
        )
        self.assertEqual(ordered, payload["warnings"])
        self.assertEqual(
            {"M_PENDING", "T_OVERDUE"},
            codes_of(payload["warnings"]),
        )


if __name__ == "__main__":
    unittest.main()
