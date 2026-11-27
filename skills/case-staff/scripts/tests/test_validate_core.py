"""``validate_case.py`` 核心检查的行为测试（T005 / FR-080 ~ FR-083）。

夹具用 ``init_case`` 建出**完整干净工作区**，再按需改坏一处，断言「结构化 code」：
每条用例只钉一类检查（引用 / 编号 / E / A / L / V / T / D / M / 阶段），
错误按 ``(file, line, code)`` 稳定排序；「不存在」用精确集合（``#013-12``、``#006-22``）。

反向约束（FR-082）：``材料/00-材料登记表.md`` 自身与 ``.gitkeep`` 不报缺 M 行。
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from scripts import init_case, validate_case

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(HERE)
SCRIPT_PATH = os.path.join(SCRIPTS_DIR, "validate_case.py")

M_LEDGER = "材料/00-材料登记表.md"
E_LEDGER = "证据/证据索引.md"
A_LEDGER = "研判/00-研判索引.md"
T_LEDGER = "专案协同/03-任务盯办/00-任务台账.md"
L_LEDGER = "专案协同/04-线索流转/00-线索台账.md"
V_LEDGER = "专案协同/05-印证核实/00-印证台账.md"
P_LEDGER = "专案协同/06-人员与组织/00-人员台账.md"
D_LEDGER = "文书/00-文书登记表.md"
CASE_INFO = "案件信息.md"

STAGES = (
    "分析研判",
    "调查取证",
    "沟通对接",
    "落地侦查",
    "收网抓捕",
    "询问讯问",
    "报捕起诉",
)


def project_path(root, relative):
    return os.path.join(root, *relative.split("/"))


def read_text(path):
    with io.open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_text(path, text):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with io.open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def append_row(root, relative, row):
    path = project_path(root, relative)
    text = read_text(path)
    if not text.endswith("\n"):
        text += "\n"
    write_text(path, text + row + "\n")


def call_main(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = validate_case.main(argv)
    return code, out.getvalue(), err.getvalue()


def call_json(root, extra=None):
    argv = ["--root", root, "--json"]
    if extra:
        argv.extend(extra)
    code, stdout, stderr = call_main(argv)
    return code, json.loads(stdout), stderr


def codes_of(errors):
    return {item["code"] for item in errors}


def m_row(mid="M001", path="材料/99-其他/说明.txt", related="", status="已归档"):
    return "| %s | 说明.txt | %s | 书证 | 2026-11-27 | %s | %s | |" % (
        mid,
        path,
        related,
        status,
    )


def e_row(
    eid="E001",
    kind="书证",
    source="M001",
    content="转账记录显示资金往来",
    fact="犯罪数额",
    proof="",
    risk="",
):
    cells = [
        eid,
        kind,
        "证据名称",
        source,
        "民警",
        "2026-11-27",
        "某地",
        "2026-11-27-入库",
        content,
        fact,
        "",
        proof,
        "",
        "",
        risk,
        "已确认",
        "民警",
        "2026-11-27",
    ]
    return "| " + " | ".join(cells) + " |"


def a_row(aid="A001", inputs="", conclusion="", status="新发现", reviewer=""):
    cells = [aid, "2026-11-27", "主题", inputs, "推理", conclusion, "", "中", status, "", reviewer]
    return "| " + " | ".join(cells) + " |"


def l_row(lid="L001", source="E001", status="待核查", to_a=""):
    cells = [lid, "2026-11-27", "线索内容", source, status, "", to_a, ""]
    return "| " + " | ".join(cells) + " |"


def v_row(vid="V001", related_l="L001", result="证实", basis_e="E001"):
    cells = [vid, "2026-11-27", related_l, "核实内容", result, basis_e, "", ""]
    return "| " + " | ".join(cells) + " |"


def t_row(tid="T001", status="待办", source="口头部署"):
    cells = [tid, "任务", "民警", "持续", status, source, "", ""]
    return "| " + " | ".join(cells) + " |"


def d_row(
    did="D001",
    path="",
    sources="",
    status="草稿",
    reviewer="",
    review_time="",
):
    cells = [did, "文书", path, sources, "通用", status, "", reviewer, review_time]
    return "| " + " | ".join(cells) + " |"


def add_a_file(root, aid, theme="测试"):
    write_text(
        project_path(root, "研判/01-专题研判/%s-%s.md" % (aid, theme)),
        "# 研判\n\n正文。\n",
    )


class ValidateTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)
        code, payload, stderr = call_init(self.root)
        self.assertEqual(0, code, msg="stderr=%s" % stderr)
        self.assertTrue(payload["ok"])

    def tearDown(self):
        self._tmp.cleanup()

    def run_ok(self):
        code, payload, stderr = call_json(self.root)
        self.assertEqual(0, code, msg=self._excerpt(payload, stderr))
        self.assertEqual(True, payload["ok"])
        self.assertEqual([], payload["errors"])
        return payload

    def run_with_errors(self):
        code, payload, stderr = call_json(self.root)
        self.assertEqual(2, code, msg=self._excerpt(payload, stderr))
        self.assertEqual(False, payload["ok"])
        self.assertTrue(payload["errors"])
        return payload

    @staticmethod
    def _excerpt(payload, stderr):
        return "stderr=%s errors=%r" % (stderr, payload.get("errors"))

    def seed_basic(self):
        """一份已登记材料 + 一条引用它的证据 —— 其余用例在此之上加坏数据。"""
        write_text(project_path(self.root, "材料/99-其他/说明.txt"), "说明\n")
        append_row(self.root, M_LEDGER, m_row(related="E001"))
        append_row(self.root, E_LEDGER, e_row())

    def assert_only_codes(self, payload, expected):
        self.assertEqual(expected, codes_of(payload["errors"]), msg=payload["errors"])


def call_init(root):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = init_case.main(["--root", root, "--case-name", "测试案件", "--json"])
    return code, json.loads(out.getvalue()), err.getvalue()


class CleanWorkspaceTest(ValidateTestBase):
    def test_fresh_workspace_is_clean_and_exits_zero(self):
        payload = self.run_ok()
        self.assertEqual({"errors": 0, "warnings": 0}, payload["counts"])
        self.assertEqual([], payload["warnings"])
        self.assertEqual({"ok", "errors", "warnings", "counts"}, set(payload))

    def test_material_registry_and_gitkeep_are_not_unregistered(self):
        payload = self.run_ok()
        files = {item["file"] for item in payload["errors"]}
        self.assertEqual(False, M_LEDGER in files)
        self.assertEqual(0, len([name for name in files if name.endswith(".gitkeep")]))


class FilesAndTablesTest(ValidateTestBase):
    def test_missing_core_ledger_is_file_missing(self):
        os.remove(project_path(self.root, E_LEDGER))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"FILE_MISSING"})
        self.assertEqual(E_LEDGER, payload["errors"][0]["file"])

    def test_broken_table_header_is_table_invalid(self):
        path = project_path(self.root, E_LEDGER)
        text = read_text(path).replace("| E编号 | 法定种类 |", "| E编号 | 种类 |")
        write_text(path, text)
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"TABLE_INVALID"})
        self.assertEqual(E_LEDGER, payload["errors"][0]["file"])


class ReferenceTest(ValidateTestBase):
    def test_dangling_reference_in_document_body(self):
        append_row(self.root, "变更日志.md", "| 2026-11-27 | 核对 E999 | | | |")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"REF_MISSING"})
        self.assertIn("E999", payload["errors"][0]["message"])

    def test_dangling_evidence_reference_inside_evidence_ledger(self):
        self.seed_basic()
        append_row(self.root, E_LEDGER, e_row(eid="E002", proof="E999"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"REF_MISSING"})
        self.assertEqual(E_LEDGER, payload["errors"][0]["file"])

    def test_material_registry_is_a_ledger_and_checks_its_e_reference(self):
        write_text(project_path(self.root, "材料/99-其他/说明.txt"), "说明\n")
        append_row(self.root, M_LEDGER, m_row(related="E999"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"REF_MISSING"})
        self.assertEqual(M_LEDGER, payload["errors"][0]["file"])


class NumberingTest(ValidateTestBase):
    def test_duplicate_id_in_same_ledger(self):
        append_row(self.root, T_LEDGER, t_row())
        append_row(self.root, T_LEDGER, t_row())
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"DUP_ID"})
        self.assertIn("T001", payload["errors"][0]["message"])

    def test_duplicate_meeting_number(self):
        write_text(
            project_path(self.root, "专案协同/02-专案会议/C001-2026-11-27-碰头.md"),
            "# 会议\n",
        )
        write_text(
            project_path(self.root, "专案协同/02-专案会议/C001-2026-11-28-复盘.md"),
            "# 会议\n",
        )
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"DUP_ID"})

    def test_single_file_id_absent_from_index(self):
        add_a_file(self.root, "A002")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"ID_MISMATCH"})
        self.assertEqual("研判/01-专题研判/A002-测试.md", payload["errors"][0]["file"])

    def test_index_row_without_single_file(self):
        append_row(self.root, A_LEDGER, a_row())
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"ID_MISMATCH"})
        self.assertEqual(A_LEDGER, payload["errors"][0]["file"])
        self.assertGreater(payload["errors"][0]["line"], 0)


class EvidenceChecksTest(ValidateTestBase):
    def test_source_material_must_exist(self):
        self.seed_basic()
        append_row(self.root, E_LEDGER, e_row(eid="E002", source="M999"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"E_SOURCE_MISSING"})
        self.assertIn("M999", payload["errors"][0]["message"])

    def test_legal_kind_must_be_controlled(self):
        self.seed_basic()
        append_row(self.root, E_LEDGER, e_row(eid="E002", kind="传闻证据"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"E_LEGAL_KIND_INVALID"})

    def test_pending_kind_requires_risk_marker_and_deadline(self):
        self.seed_basic()
        append_row(self.root, E_LEDGER, e_row(eid="E002", kind="待定", risk=""))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"E_FIELD_MISSING"})

    def test_pending_kind_with_marker_and_deadline_is_clean(self):
        self.seed_basic()
        append_row(
            self.root,
            E_LEDGER,
            e_row(
                eid="E002",
                kind="待定",
                risk="种类待定：需鉴定；补正期限 2026-12-31",
            ),
        )
        self.run_ok()

    def test_conclusion_must_not_claim_a_charge(self):
        self.seed_basic()
        append_row(self.root, E_LEDGER, e_row(eid="E002", content="嫌疑人构成诈骗罪"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"CHARGE_CLAIM"})


class AnalysisChecksTest(ValidateTestBase):
    def test_invalid_status(self):
        add_a_file(self.root, "A001")
        append_row(self.root, A_LEDGER, a_row(status="已确认"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"A_STATUS_INVALID"})

    def test_confirmed_analysis_requires_reviewer(self):
        add_a_file(self.root, "A001")
        append_row(self.root, A_LEDGER, a_row(status="已证实"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"A_REVIEWER_MISSING"})

    def test_input_cycle_is_reported(self):
        add_a_file(self.root, "A001")
        add_a_file(self.root, "A002")
        append_row(self.root, A_LEDGER, a_row(aid="A001", inputs="A002"))
        append_row(self.root, A_LEDGER, a_row(aid="A002", inputs="A001"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"A_CYCLE"})
        self.assertEqual(2, len(payload["errors"]))

    def test_conclusion_must_not_claim_a_charge(self):
        add_a_file(self.root, "A001")
        append_row(self.root, A_LEDGER, a_row(conclusion="该行为涉嫌诈骗罪"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"CHARGE_CLAIM"})


class ClueVerificationTaskChecksTest(ValidateTestBase):
    def test_clue_source_must_not_be_empty(self):
        append_row(self.root, L_LEDGER, l_row(source=""))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"L_UNRESOLVED"})

    def test_clue_moved_to_analysis_requires_a_id(self):
        append_row(self.root, L_LEDGER, l_row(source="现场", status="转研判", to_a=""))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"L_UNRESOLVED"})

    def test_verification_result_must_be_controlled(self):
        self.seed_basic()
        append_row(self.root, L_LEDGER, l_row())
        append_row(self.root, V_LEDGER, v_row(result="待定"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"V_RESULT_INVALID"})

    def test_task_status_must_be_controlled(self):
        append_row(self.root, T_LEDGER, t_row(status="逾期"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"T_STATUS_INVALID"})


class DocumentChecksTest(ValidateTestBase):
    def test_document_source_record_must_exist(self):
        append_row(self.root, D_LEDGER, d_row(sources="P999"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"REF_MISSING"})
        self.assertEqual(D_LEDGER, payload["errors"][0]["file"])

    def test_legal_document_requires_reviewer_and_time(self):
        append_row(
            self.root,
            D_LEDGER,
            d_row(path="文书/起诉/起诉意见书草稿.md", reviewer="", review_time=""),
        )
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"D_REVIEWER_MISSING"})
        self.assertIn("复核人", payload["errors"][0]["message"])

    def test_legal_document_with_reviewer_and_time_is_clean(self):
        append_row(
            self.root,
            D_LEDGER,
            d_row(
                path="文书/起诉/起诉意见书草稿.md",
                reviewer="法制民警",
                review_time="2026-11-27",
            ),
        )
        self.run_ok()


class MaterialChecksTest(ValidateTestBase):
    def test_registered_path_must_exist_on_disk(self):
        append_row(self.root, M_LEDGER, m_row(path="材料/99-其他/不存在.pdf"))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"PATH_MISMATCH"})

    def test_material_file_without_m_row_is_reported(self):
        write_text(project_path(self.root, "材料/99-其他/未登记.pdf"), "x")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"M_UNREGISTERED"})
        self.assertEqual("材料/99-其他/未登记.pdf", payload["errors"][0]["file"])
        self.assertEqual(0, payload["errors"][0]["line"])


class StageChecksTest(ValidateTestBase):
    def _replace_stage_status(self, stage, status):
        path = project_path(self.root, CASE_INFO)
        text = read_text(path)
        old = "| %s | 未开始 |" % stage
        new = "| %s | %s |" % (stage, status)
        self.assertIn(old, text)
        write_text(path, text.replace(old, new, 1))

    def test_stage_status_must_be_controlled(self):
        self._replace_stage_status("分析研判", "审核中")
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"STAGE_INVALID"})
        self.assertEqual(CASE_INFO, payload["errors"][0]["file"])
        self.assertGreater(payload["errors"][0]["line"], 0)

    def test_all_seven_stage_rows_are_required(self):
        path = project_path(self.root, CASE_INFO)
        text = read_text(path)
        line = "| 沟通对接 | 未开始 | | | | | | |\n"
        self.assertIn(line, text)
        write_text(path, text.replace(line, "", 1))
        payload = self.run_with_errors()
        self.assert_only_codes(payload, {"STAGE_INVALID"})


class OutputContractTest(ValidateTestBase):
    def test_json_shape_counts_and_stable_sort(self):
        append_row(self.root, T_LEDGER, t_row())
        append_row(self.root, T_LEDGER, t_row())
        append_row(self.root, M_LEDGER, m_row(path="材料/99-其他/不存在.pdf"))
        path = project_path(self.root, CASE_INFO)
        write_text(
            path,
            read_text(path).replace("| 分析研判 | 未开始 |", "| 分析研判 | 审核中 |", 1),
        )
        payload = self.run_with_errors()
        self.assertEqual({"ok", "errors", "warnings", "counts"}, set(payload))
        self.assertEqual(len(payload["errors"]), payload["counts"]["errors"])
        self.assertEqual(len(payload["warnings"]), payload["counts"]["warnings"])
        for item in payload["errors"]:
            self.assertEqual({"file", "line", "code", "message"}, set(item))
        ordered = sorted(
            payload["errors"],
            key=lambda item: (item["file"], item["line"], item["code"]),
        )
        self.assertEqual(ordered, payload["errors"])
        self.assertEqual(
            {"DUP_ID", "PATH_MISMATCH", "STAGE_INVALID"},
            codes_of(payload["errors"]),
        )

    def test_json_stdout_contains_a_single_object(self):
        code, stdout, _ = call_main(["--root", self.root, "--json"])
        self.assertEqual(0, code)
        payload, end = json.JSONDecoder().raw_decode(stdout.strip())
        self.assertEqual("", stdout.strip()[end:])
        self.assertEqual(True, payload["ok"])

    def test_subprocess_cli_json_and_exit_code(self):
        append_row(self.root, L_LEDGER, l_row(source=""))
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [sys.executable, "-I", SCRIPT_PATH, "--root", self.root, "--json"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            timeout=120,
        )
        stdout = proc.stdout.decode("utf-8")
        stderr = proc.stderr.decode("utf-8", "replace")
        self.assertEqual(2, proc.returncode, msg=stderr)
        payload = json.loads(stdout)
        self.assertEqual(False, payload["ok"])
        self.assertEqual(["L_UNRESOLVED"], [item["code"] for item in payload["errors"]])


if __name__ == "__main__":
    unittest.main()
