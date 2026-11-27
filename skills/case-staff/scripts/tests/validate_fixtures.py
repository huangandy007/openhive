"""``validate_case.py`` 用例共用夹具（T005 / T006）。

不是测试模块（文件名不匹配 ``test*.py``），只提供：

- 用 ``init_case`` 建完整干净工作区，再按需改坏一处；
- 台账行走器（M/E/A/L/V/T/P/D）与表格插入；
- 调用 ``validate_case.main`` / ``run`` 的小工具。

把「今天」注入 ``run`` 的入口是 ``call_run_at``，用例不依赖真实时钟。
"""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from types import SimpleNamespace

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
    # 通用换行：Windows 检出（core.autocrlf=true）把模板落成 CRLF，
    # 用例断言的是行内容而非字节，统一归一到 "\n"。
    with io.open(path, "r", encoding="utf-8") as handle:
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


def insert_before(root, relative, marker, text):
    """把一行插到托管块结束标记前（表格数据行必须仍在块内）。"""
    path = project_path(root, relative)
    content = read_text(path)
    if marker not in content:
        raise AssertionError("夹具文件 %s 缺少标记 %r" % (relative, marker))
    write_text(path, content.replace(marker, text + "\n" + marker, 1))


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


def call_run_at(root, today, strict=False):
    """直接调 ``run`` 并注入固定日期（不依赖真实时钟）。"""
    args = SimpleNamespace(root=root, strict=strict)
    return validate_case.run(args, today=today)


def call_init(root):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = init_case.main(["--root", root, "--case-name", "测试案件", "--json"])
    return code, json.loads(out.getvalue()), err.getvalue()


def codes_of(findings):
    return {item["code"] for item in findings}


def m_row(
    mid="M001",
    path="材料/99-其他/说明.txt",
    related="",
    status="已归档",
    name="说明.txt",
):
    return "| %s | %s | %s | 书证 | 2026-11-27 | %s | %s | |" % (
        mid,
        name,
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
    cells = [
        aid,
        "2026-11-27",
        "主题",
        inputs,
        "推理",
        conclusion,
        "",
        "中",
        status,
        "",
        reviewer,
    ]
    return "| " + " | ".join(cells) + " |"


def l_row(lid="L001", source="E001", status="待核查", to_a=""):
    cells = [lid, "2026-11-27", "线索内容", source, status, "", to_a, ""]
    return "| " + " | ".join(cells) + " |"


def v_row(vid="V001", related_l="L001", result="证实", basis_e="E001"):
    cells = [vid, "2026-11-27", related_l, "核实内容", result, basis_e, "", ""]
    return "| " + " | ".join(cells) + " |"


def t_row(tid="T001", status="待办", source="口头部署", deadline="持续"):
    cells = [tid, "任务", "民警", deadline, status, source, "", ""]
    return "| " + " | ".join(cells) + " |"


def p_row(pid="P001", name="张三", role="主犯", status="在逃", related=""):
    cells = [pid, name, "嫌疑人", role, "某单位", status, related, ""]
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


def arrest_row(
    seq="1",
    pid="P001",
    name="张三",
    role="主犯",
    evidence="",
):
    cells = [seq, pid, name, role, "诈骗", evidence, "某所", "民警", "", "", "", ""]
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

    def run_clean(self):
        """零错误**且零警告**——「匹配即不报」的负向用例必须用它（#005-18）。"""
        code, payload, stderr = call_json(self.root)
        self.assertEqual(0, code, msg=self._excerpt(payload, stderr))
        self.assertEqual(True, payload["ok"])
        self.assertEqual([], payload["errors"])
        self.assertEqual([], payload["warnings"])
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
