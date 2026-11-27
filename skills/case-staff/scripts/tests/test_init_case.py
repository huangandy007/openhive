"""``init_case.py`` 的行为测试（T004 / TR-002、TR-003）。

断言对象是「行为与集合」而不是文案措辞（TR-011）：
- 精确集合：39 目录 / 22 模板文件 / 27 ``.gitkeep``（data-model §1）；
- 幂等：第二次 ``created_*`` 为空、既有文件内容哈希不变；
- 非覆盖：已存在文件记入 ``kept_files``、内容一字不改；
- ``--dry-run`` 磁盘零改动；
- 预检拒绝（无关文件 / 半套工作区 / 非法字符与保留字 / symlink 越界 / 根缺失）
  退出码 1 且零写入；
- 占位替换只发生在新建的 ``案件信息.md``；
- ``--json`` 只输出一个 JSON 对象、列表字典序。

多数用例直接调用 ``init_case.main(argv)``（避免 Windows 子进程编码问题）；
另有一条 ``python -I`` 子进程端到端用例钉住 CLI 契约。
「不存在」用布尔比较 / 精确集合（``#013-12``、``#006-22``）。
"""

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from scripts import init_case

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(HERE)
SCRIPT_PATH = os.path.join(SCRIPTS_DIR, "init_case.py")
ASSETS_DIR = os.path.join(os.path.dirname(SCRIPTS_DIR), "assets")

# data-model §1.1：39 个目录（父目录与子目录都列）。
EXPECTED_DIRECTORIES = {
    "材料",
    "材料/00-待归档",
    "材料/01-接报案",
    "材料/02-调取与扣押",
    "材料/03-勘验检查辨认",
    "材料/04-技术侦查",
    "材料/05-视频侦查",
    "材料/06-话单与资金",
    "材料/07-讯问询问",
    "材料/08-鉴定检验",
    "材料/99-其他",
    "证据",
    "研判",
    "研判/01-专题研判",
    "研判/02-综合研判",
    "专案协同",
    "专案协同/00-原始记录",
    "专案协同/01-每日动态",
    "专案协同/02-专案会议",
    "专案协同/03-任务盯办",
    "专案协同/04-线索流转",
    "专案协同/05-印证核实",
    "专案协同/06-人员与组织",
    "专案协同/07-抓捕筹备",
    "专案协同/07-抓捕筹备/04-对象资料",
    "侦查",
    "侦查/落地侦查",
    "侦查/收网抓捕",
    "侦查/收网抓捕/01-到案经过",
    "侦查/收网抓捕/02-现场笔录",
    "侦查/收网抓捕/03-扣押移交",
    "侦查/收网抓捕/04-案后处理",
    "侦查/询问讯问",
    "侦查/沟通对接",
    "文书",
    "文书/报捕",
    "文书/起诉",
    "文书/内部审批",
    "法律适用",
}

# data-model §1.2：初始化写盘的 22 份模板。
EXPECTED_TEMPLATE_FILES = {
    "案件信息.md",
    "AGENTS.md",
    "变更日志.md",
    "材料/00-材料登记表.md",
    "证据/证据索引.md",
    "研判/README.md",
    "研判/00-研判索引.md",
    "专案协同/README.md",
    "专案协同/03-任务盯办/00-任务台账.md",
    "专案协同/04-线索流转/00-线索台账.md",
    "专案协同/05-印证核实/00-印证台账.md",
    "专案协同/06-人员与组织/00-人员台账.md",
    "专案协同/06-人员与组织/01-组织架构.md",
    "专案协同/07-抓捕筹备/00-抓捕对象清单.md",
    "专案协同/07-抓捕筹备/01-抓捕方案.md",
    "专案协同/07-抓捕筹备/02-编组与保障.md",
    "专案协同/07-抓捕筹备/03-资料发放清单.md",
    "侦查/收网抓捕/00-收网记录.md",
    "侦查/询问讯问/00-讯问计划.md",
    "文书/00-文书登记表.md",
    "法律适用/README.md",
    "法律适用/00-索引.md",
}

# data-model §1.3：27 个空叶子目录。
EXPECTED_GITKEEP_DIRECTORIES = {
    "材料/00-待归档",
    "材料/01-接报案",
    "材料/02-调取与扣押",
    "材料/03-勘验检查辨认",
    "材料/04-技术侦查",
    "材料/05-视频侦查",
    "材料/06-话单与资金",
    "材料/07-讯问询问",
    "材料/08-鉴定检验",
    "材料/99-其他",
    "研判/01-专题研判",
    "研判/02-综合研判",
    "专案协同/00-原始记录",
    "专案协同/01-每日动态",
    "专案协同/02-专案会议",
    "专案协同/04-线索流转",
    "专案协同/05-印证核实",
    "专案协同/07-抓捕筹备/04-对象资料",
    "侦查/落地侦查",
    "侦查/收网抓捕/01-到案经过",
    "侦查/收网抓捕/02-现场笔录",
    "侦查/收网抓捕/03-扣押移交",
    "侦查/收网抓捕/04-案后处理",
    "侦查/沟通对接",
    "文书/报捕",
    "文书/起诉",
    "文书/内部审批",
}

EXPECTED_GITKEEP_FILES = {path + "/.gitkeep" for path in EXPECTED_GITKEEP_DIRECTORIES}
EXPECTED_FILES = EXPECTED_TEMPLATE_FILES | EXPECTED_GITKEEP_FILES


def call_main(argv):
    """直接调用 ``main(argv)``，返回 (退出码, stdout, stderr)。"""
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = init_case.main(argv)
    return code, out.getvalue(), err.getvalue()


def call_json(argv):
    code, stdout, stderr = call_main(argv)
    return code, json.loads(stdout), stderr


def snapshot(root):
    """递归快照：相对路径 -> 内容 sha256；目录以尾部 ``/`` 标记。"""
    result = {}
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        for name in dirnames:
            rel = name if rel_dir == "." else rel_dir + "/" + name
            result[rel + "/"] = "<dir>"
        for name in filenames:
            rel = name if rel_dir == "." else rel_dir + "/" + name
            full = os.path.join(dirpath, name)
            with open(full, "rb") as handle:
                result[rel] = hashlib.sha256(handle.read()).hexdigest()
    return result


def read_text(path):
    with io.open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


class InitCaseTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def new_root(self, name="other"):
        path = os.path.join(self._tmp.name, name)
        os.mkdir(path)
        return path

    def init_ok(self, root=None, case_name="测试案件", case_no="", dry_run=False):
        root = self.root if root is None else root
        argv = ["--root", root, "--case-name", case_name, "--json"]
        if case_no:
            argv += ["--case-no", case_no]
        if dry_run:
            argv.append("--dry-run")
        code, payload, stderr = call_json(argv)
        self.assertEqual(0, code, msg="stderr=%s" % stderr)
        self.assertTrue(payload["ok"])
        return payload


class PrecheckTest(InitCaseTestBase):
    def test_missing_root_is_rejected_without_creating_it(self):
        missing = os.path.join(self._tmp.name, "nope")
        code, payload, _ = call_json(
            ["--root", missing, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["errors"])
        self.assertTrue(payload["errors"][0].startswith("ROOT_MISSING:"))
        self.assertEqual(False, os.path.exists(missing))

    def test_root_that_is_a_file_is_rejected(self):
        path = os.path.join(self._tmp.name, "afile")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("x")
        code, payload, _ = call_json(
            ["--root", path, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertEqual(False, payload["ok"])
        self.assertTrue(payload["errors"][0].startswith("ROOT_NOT_DIR:"))

    def test_case_name_is_required_on_a_fresh_root(self):
        code, payload, _ = call_json(["--root", self.root, "--json"])
        self.assertEqual(1, code)
        self.assertEqual(False, payload["ok"])
        self.assertTrue(payload["errors"][0].startswith("CASE_NAME_MISSING:"))
        self.assertEqual({}, snapshot(self.root))

    def test_illegal_case_names_are_rejected(self):
        bad_names = [
            "CON",
            "con.txt",
            "PRN",
            "AUX",
            "NUL",
            "COM1",
            "com9.log",
            "LPT1",
            "lpt9.txt",
            "a/b",
            "a\\b",
            "bad:name",
            "bad?name",
            "bad*name",
            'bad"name',
            "bad<name",
            "bad>name",
            "bad|name",
            " leading",
            "trailing ",
            "trailing.",
            "a\nb",
            "a\tb",
        ]
        for name in bad_names:
            with self.subTest(name=name):
                root = self.new_root("name-" + str(len(os.listdir(self._tmp.name))))
                code, payload, _ = call_json(
                    ["--root", root, "--case-name", name, "--json"]
                )
                self.assertEqual(1, code)
                self.assertFalse(payload["ok"])
                self.assertTrue(
                    any(e.startswith("CASE_NAME_ILLEGAL:") for e in payload["errors"]),
                    msg=payload["errors"],
                )
                self.assertEqual({}, snapshot(root))

    def test_chinese_case_name_is_legal(self):
        payload = self.init_ok(case_name="张三盗窃案", case_no="")
        self.assertTrue(payload["created_files"])

    def test_illegal_case_no_is_rejected(self):
        for bad in ["A:1", "A/1", "A|1", "CON", "x\ny"]:
            with self.subTest(case_no=bad):
                root = self.new_root("no-" + str(len(os.listdir(self._tmp.name))))
                code, payload, _ = call_json(
                    [
                        "--root",
                        root,
                        "--case-name",
                        "测试案件",
                        "--case-no",
                        bad,
                        "--json",
                    ]
                )
                self.assertEqual(1, code)
                self.assertTrue(
                    any(e.startswith("CASE_NO_ILLEGAL:") for e in payload["errors"]),
                    msg=payload["errors"],
                )
                self.assertEqual({}, snapshot(root))

    def test_unrelated_file_rejects_with_zero_writes(self):
        with open(os.path.join(self.root, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("hello")
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertFalse(payload["ok"])
        self.assertTrue(
            any(e.startswith("UNRELATED_ENTRY:") for e in payload["errors"]),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))

    def test_unrelated_directory_rejects(self):
        os.mkdir(os.path.join(self.root, "材料"))
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("UNRELATED_ENTRY:") for e in payload["errors"])
        )
        self.assertEqual(before, snapshot(self.root))

    def test_project_base_whitelist_is_accepted(self):
        os.mkdir(os.path.join(self.root, ".git"))
        os.mkdir(os.path.join(self.root, ".opencode"))
        with open(os.path.join(self.root, ".gitignore"), "w", encoding="utf-8") as handle:
            handle.write("node_modules/\n")
        with open(os.path.join(self.root, "opencode.json"), "w", encoding="utf-8") as handle:
            handle.write("{}\n")
        with open(os.path.join(self.root, ".env.local"), "w", encoding="utf-8") as handle:
            handle.write("X=1\n")
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(0, code, msg=payload["errors"])
        self.assertTrue(payload["ok"])
        self.assertEqual(
            EXPECTED_DIRECTORIES, set(payload["created_directories"])
        )

    def test_half_workspace_with_only_case_info_is_rejected(self):
        path = os.path.join(self.root, "案件信息.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("已有内容\n")
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertFalse(payload["ok"])
        self.assertTrue(
            any(e.startswith("WORKSPACE_INCOMPLETE:") for e in payload["errors"]),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))

    def test_half_workspace_with_only_agents_is_rejected(self):
        path = os.path.join(self.root, "AGENTS.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("已有内容\n")
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("WORKSPACE_INCOMPLETE:") for e in payload["errors"])
        )
        self.assertEqual(before, snapshot(self.root))

    def test_write_probe_failure_rejects_root_with_zero_writes(self):
        before = snapshot(self.root)
        with mock.patch(
            "scripts.init_case.os.open", side_effect=PermissionError("denied")
        ):
            code, payload, _ = call_json(
                ["--root", self.root, "--case-name", "测试案件", "--json"]
            )
        self.assertEqual(1, code)
        self.assertFalse(payload["ok"])
        self.assertTrue(
            payload["errors"][0].startswith("ROOT_NOT_WRITABLE:"),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))

    def test_dry_run_skips_the_write_probe(self):
        with mock.patch(
            "scripts.init_case.os.open", side_effect=PermissionError("denied")
        ) as patched:
            code, payload, _ = call_json(
                [
                    "--root",
                    self.root,
                    "--case-name",
                    "测试案件",
                    "--dry-run",
                    "--json",
                ]
            )
        self.assertEqual(0, code, msg=payload["errors"])
        patched.assert_not_called()

    def test_symlink_pointing_outside_root_is_rejected(self):
        outside = self.new_root("outside")
        with open(os.path.join(outside, "secret.txt"), "w", encoding="utf-8") as handle:
            handle.write("secret\n")
        link = os.path.join(self.root, "evil-link")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(
                "本机无法创建符号链接（%s: %s），越界拒绝未实跑" % (type(exc).__name__, exc)
            )
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertFalse(payload["ok"])
        self.assertTrue(
            any(e.startswith("SYMLINK_OUTSIDE:") for e in payload["errors"]),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))
        self.assertFalse(os.path.exists(os.path.join(self.root, "案件信息.md")))

    def test_dot_prefixed_symlink_outside_is_also_rejected(self):
        outside = self.new_root("outside-dot")
        link = os.path.join(self.root, ".cache-link")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(
                "本机无法创建符号链接（%s: %s），越界拒绝未实跑" % (type(exc).__name__, exc)
            )
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("SYMLINK_OUTSIDE:") for e in payload["errors"])
        )
        self.assertEqual(before, snapshot(self.root))


class CreationSetTest(InitCaseTestBase):
    def test_exact_directory_set_is_created(self):
        payload = self.init_ok()
        self.assertEqual(EXPECTED_DIRECTORIES, set(payload["created_directories"]))
        self.assertEqual(39, len(payload["created_directories"]))
        for rel in payload["created_directories"]:
            full = os.path.join(self.root, *rel.split("/"))
            self.assertTrue(os.path.isdir(full), msg=rel)

    def test_exact_template_file_set_is_created(self):
        payload = self.init_ok(case_name="张三案", case_no="A2026-001")
        created = set(payload["created_files"])
        self.assertEqual(EXPECTED_TEMPLATE_FILES, created & EXPECTED_TEMPLATE_FILES)
        self.assertEqual(22, len(created & EXPECTED_TEMPLATE_FILES))

    def test_exact_gitkeep_file_set_is_created(self):
        payload = self.init_ok()
        created = set(payload["created_files"])
        self.assertEqual(EXPECTED_GITKEEP_FILES, created & EXPECTED_GITKEEP_FILES)
        self.assertEqual(27, len(created & EXPECTED_GITKEEP_FILES))

    def test_created_files_total_is_49_and_sorted(self):
        payload = self.init_ok()
        self.assertEqual(EXPECTED_FILES, set(payload["created_files"]))
        self.assertEqual(49, len(payload["created_files"]))
        self.assertEqual(sorted(payload["created_files"]), payload["created_files"])
        self.assertEqual(
            sorted(payload["created_directories"]), payload["created_directories"]
        )
        self.assertEqual([], payload["kept_files"])

    def test_root_snapshot_keys_are_exactly_39_dirs_and_49_files(self):
        self.init_ok()
        keys = set(snapshot(self.root))
        expected = {directory + "/" for directory in EXPECTED_DIRECTORIES}
        expected |= EXPECTED_FILES
        self.assertEqual(expected, keys)
        self.assertEqual(88, len(keys))

    def test_upload_dependency_structures_exist(self):
        self.init_ok()
        self.assertTrue(os.path.isdir(os.path.join(self.root, "材料", "00-待归档")))
        self.assertTrue(
            os.path.isfile(os.path.join(self.root, "材料", "00-材料登记表.md"))
        )
        self.assertTrue(
            os.path.isdir(os.path.join(self.root, "专案协同", "00-原始记录"))
        )

    def test_gitkeep_files_are_empty(self):
        self.init_ok()
        for rel in EXPECTED_GITKEEP_FILES:
            full = os.path.join(self.root, *rel.split("/"))
            self.assertEqual(b"", read_bytes(full), msg=rel)


class PlaceholderTest(InitCaseTestBase):
    def test_case_name_and_no_are_substituted_in_case_info(self):
        self.init_ok(case_name="张三盗窃案", case_no="A2026-001")
        text = read_text(os.path.join(self.root, "案件信息.md"))
        self.assertIn("| 案件名称 | 张三盗窃案 |", text)
        self.assertIn("| 案件编号 | A2026-001 |", text)
        self.assertEqual(False, "{{案名}}" in text)
        self.assertEqual(False, "{{案号}}" in text)

    def test_missing_case_no_leaves_blank_cell(self):
        self.init_ok(case_name="张三案", case_no="")
        text = read_text(os.path.join(self.root, "案件信息.md"))
        self.assertIn("| 案件编号 |  |", text)
        self.assertEqual(False, "{{案号}}" in text)

    def test_all_templates_are_copied_or_substituted_byte_for_byte(self):
        name, case_no = "张三案", "A2026-001"
        self.init_ok(case_name=name, case_no=case_no)
        self.assertEqual(22, len(init_case.TEMPLATE_FILES))
        for target, template in init_case.TEMPLATE_FILES:
            with self.subTest(target=target):
                expected = read_bytes(os.path.join(ASSETS_DIR, template))
                if target == init_case.CASE_INFO_FILE:
                    expected = (
                        expected.decode("utf-8")
                        .replace("{{案名}}", name)
                        .replace("{{案号}}", case_no)
                        .encode("utf-8")
                    )
                created = read_bytes(os.path.join(self.root, *target.split("/")))
                self.assertEqual(expected, created)


class IdempotencyTest(InitCaseTestBase):
    def test_second_run_creates_nothing_and_keeps_everything(self):
        self.init_ok(case_name="张三案", case_no="A2026-001")
        before = snapshot(self.root)
        payload = self.init_ok(case_name="张三案", case_no="A2026-001")
        self.assertEqual([], payload["created_directories"])
        self.assertEqual([], payload["created_files"])
        self.assertEqual(sorted(EXPECTED_FILES), payload["kept_files"])
        self.assertEqual(before, snapshot(self.root))

    def test_existing_files_are_not_overwritten(self):
        self.init_ok(case_name="原名案", case_no="A001")
        changelog = os.path.join(self.root, "变更日志.md")
        with io.open(changelog, "a", encoding="utf-8", newline="") as handle:
            handle.write("\n人工追加一行\n")
        case_info_before = read_bytes(os.path.join(self.root, "案件信息.md"))
        payload = self.init_ok(case_name="改名案", case_no="A999")
        self.assertEqual([], payload["created_directories"])
        self.assertEqual([], payload["created_files"])
        self.assertIn("变更日志.md", payload["kept_files"])
        self.assertIn("人工追加一行", read_text(changelog))
        self.assertEqual(
            case_info_before, read_bytes(os.path.join(self.root, "案件信息.md"))
        )

    def test_case_name_is_optional_in_workspace_mode(self):
        self.init_ok()
        code, payload, _ = call_json(["--root", self.root, "--json"])
        self.assertEqual(0, code, msg=payload["errors"])
        self.assertEqual([], payload["created_files"])
        self.assertEqual(sorted(EXPECTED_FILES), payload["kept_files"])

    def test_missing_items_are_backfilled_in_workspace_mode(self):
        self.init_ok()
        shutil.rmtree(os.path.join(self.root, "研判", "01-专题研判"))
        os.remove(os.path.join(self.root, "证据", "证据索引.md"))
        payload = self.init_ok()
        self.assertEqual(["研判/01-专题研判"], payload["created_directories"])
        self.assertEqual(
            sorted(["研判/01-专题研判/.gitkeep", "证据/证据索引.md"]),
            payload["created_files"],
        )
        self.assertEqual(
            sorted(EXPECTED_FILES - {"研判/01-专题研判/.gitkeep", "证据/证据索引.md"}),
            payload["kept_files"],
        )
        self.assertTrue(
            os.path.isfile(os.path.join(self.root, "研判", "01-专题研判", ".gitkeep"))
        )
        self.assertTrue(os.path.isfile(os.path.join(self.root, "证据", "证据索引.md")))


class PathConflictTest(InitCaseTestBase):
    def test_file_position_taken_by_directory_is_rejected(self):
        self.init_ok()
        target = os.path.join(self.root, "证据", "证据索引.md")
        os.remove(target)
        os.mkdir(target)
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("PATH_CONFLICT:") for e in payload["errors"]),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))

    def test_directory_position_taken_by_file_is_rejected(self):
        self.init_ok()
        target = os.path.join(self.root, "研判", "01-专题研判")
        shutil.rmtree(target)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("x\n")
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("PATH_CONFLICT:") for e in payload["errors"]),
            msg=payload["errors"],
        )
        self.assertEqual(before, snapshot(self.root))


class DryRunTest(InitCaseTestBase):
    def test_dry_run_writes_nothing_and_reports_full_plan(self):
        before = snapshot(self.root)
        payload = self.init_ok(dry_run=True)
        self.assertEqual(True, payload["dry_run"])
        self.assertEqual(EXPECTED_DIRECTORIES, set(payload["created_directories"]))
        self.assertEqual(EXPECTED_FILES, set(payload["created_files"]))
        self.assertEqual([], payload["kept_files"])
        self.assertEqual(before, snapshot(self.root))
        self.assertEqual([], sorted(os.listdir(self.root)))

    def test_dry_run_on_workspace_reports_only_missing(self):
        self.init_ok()
        os.remove(os.path.join(self.root, "证据", "证据索引.md"))
        before = snapshot(self.root)
        payload = self.init_ok(dry_run=True)
        self.assertEqual([], payload["created_directories"])
        self.assertEqual(["证据/证据索引.md"], payload["created_files"])
        self.assertEqual(48, len(payload["kept_files"]))
        self.assertEqual(before, snapshot(self.root))

    def test_dry_run_with_unrelated_file_still_rejects(self):
        with open(os.path.join(self.root, "extra.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        before = snapshot(self.root)
        code, payload, _ = call_json(
            ["--root", self.root, "--case-name", "测试案件", "--dry-run", "--json"]
        )
        self.assertEqual(1, code)
        self.assertTrue(
            any(e.startswith("UNRELATED_ENTRY:") for e in payload["errors"])
        )
        self.assertEqual(before, snapshot(self.root))


class JsonContractTest(InitCaseTestBase):
    def test_json_payload_has_contract_keys_and_lists(self):
        code, payload, stderr = call_json(
            [
                "--root",
                self.root,
                "--case-name",
                "张三案",
                "--case-no",
                "A2026-001",
                "--json",
            ]
        )
        self.assertEqual(0, code)
        self.assertEqual(
            {
                "ok",
                "root",
                "dry_run",
                "created_directories",
                "created_files",
                "kept_files",
                "warnings",
                "errors",
            },
            set(payload.keys()),
        )
        self.assertEqual(True, payload["ok"])
        self.assertEqual(False, payload["dry_run"])
        self.assertEqual(os.path.abspath(self.root), payload["root"])
        self.assertEqual([], payload["warnings"])
        self.assertEqual([], payload["errors"])
        self.assertEqual("", stderr)

    def test_non_json_mode_does_not_print_json(self):
        code, stdout, _ = call_main(
            ["--root", self.root, "--case-name", "测试案件"]
        )
        self.assertEqual(0, code)
        with self.assertRaises(ValueError):
            json.loads(stdout)

    def test_subprocess_e2e_outputs_single_json_object(self):
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [
                sys.executable,
                "-I",
                SCRIPT_PATH,
                "--root",
                self.root,
                "--case-name",
                "张三盗窃案",
                "--case-no",
                "A2026-001",
                "--json",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            timeout=120,
        )
        stdout = proc.stdout.decode("utf-8")
        stderr = proc.stderr.decode("utf-8", "replace")
        self.assertEqual(0, proc.returncode, msg=stderr)
        payload = json.loads(stdout)
        self.assertEqual(True, payload["ok"])
        self.assertEqual(EXPECTED_DIRECTORIES, set(payload["created_directories"]))
        self.assertEqual(EXPECTED_FILES, set(payload["created_files"]))
        self.assertIn("张三", read_text(os.path.join(self.root, "案件信息.md")))


if __name__ == "__main__":
    unittest.main()
