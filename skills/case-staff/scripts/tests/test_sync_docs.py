"""``sync_docs.py`` 的行为测试（T007 / US5 / FR-070 ~ FR-077）。

每条用例只钉一条行为，断言结构化字段与字节，不核对自然语言措辞（TR-011）：

- 源变更 → 影响清单 + diff（``affected``）；
- ``--dry-run`` 零写入（整棵树字节快照相等）；
- ``--apply`` 后仅托管块变化、块外人工叙述原样保留；
- 法律文书原文不变，只出 ``建议`` 并把 D 表状态置 ``待法制审核``；
- 已签发 / 发放版原文不变，只追加一条 ``变更日志.md``（重复 apply 不重复追加）；
- 块异常 ⇒ 报错且**不写任何文件**（原子性）。

夹具用 ``init_case`` 建完整工作区，再登记 D 行、写人工内容；
指纹用 ``scripts.lib.fingerprint`` 独立算出（库本身另有金标准用例）。
"""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from scripts import init_case, sync_docs
from scripts.lib import blocks, fingerprint, tables

P_LEDGER = "专案协同/06-人员与组织/00-人员台账.md"
A_LEDGER = "研判/00-研判索引.md"
T_LEDGER = "专案协同/03-任务盯办/00-任务台账.md"
D_LEDGER = "文书/00-文书登记表.md"
CHANGELOG = "变更日志.md"
ARREST = "专案协同/07-抓捕筹备/00-抓捕对象清单.md"
PLAN = "专案协同/07-抓捕筹备/01-抓捕方案.md"
GROUP = "专案协同/07-抓捕筹备/02-编组与保障.md"
LEGAL = "文书/起诉/起诉意见书草稿.md"
SIGNED = "侦查/收网抓捕/00-收网记录.md"
ISSUED = "专案协同/07-抓捕筹备/2026-11-27-抓捕对象清单-发放版.md"
REPORT = "研判/01-专题研判/A001-测试研判.md"
QUESTION = "侦查/询问讯问/00-讯问计划.md"

P_HEADER = sync_docs.P_HEADER
A_HEADER = sync_docs.A_HEADER
D_HEADER = sync_docs.D_HEADER
CHANGELOG_HEADER = sync_docs.CHANGELOG_HEADER

ARREST_MANUAL_ROW = (
    "| 1 | P001 | 张三 | 主犯 | 诈骗 | E001 | 某所 | 民警甲 | 情报 | 技术 | 法制 | 高 |"
)
OUTSIDE_NOTE = "人工补充：行动前保密。"


def arrest_block(role="主犯"):
    """一个可被普通分支改写的托管块；放进法律 / 只读文档里验证「绝不写」。"""
    return (
        "<!-- AUTO:BEGIN 抓捕对象 -->\n"
        "| 序号 | P编号 | 抓捕对象 | 角色/层级 | 涉嫌罪名 | 主要证据 |"
        " 抓捕单位 | 抓捕人 | 情报支撑 | 技术支撑 | 法制支撑 | 风险 |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|\n"
        "| 1 | P001 | 张三 | %s | | E001 | 某所 | 民警甲 | | | | 高 |\n"
        "<!-- AUTO:END 抓捕对象 -->\n" % role
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


def append_line(root, relative, line):
    path = project_path(root, relative)
    text = read_text(path)
    if not text.endswith("\n"):
        text += "\n"
    write_text(path, text + line + "\n")


def digest_for(root, relative, header, id_column, token):
    """独立算出「某台账某行」的指纹（与实现分开取数，避免自证）。"""
    text = read_text(project_path(root, relative))
    index = header.index(id_column)
    raw_rows = tables.require_table(text, header).raw_rows
    lines = ["|" + "|".join(row) + "|" for row in raw_rows if row[index].strip() == token]
    return fingerprint.source_digest(lines)


def p_row(pid="P001", name="张三", role="主犯", related="E001"):
    cells = [pid, name, "嫌疑人", role, "某单位", "在逃", related, ""]
    return "| " + " | ".join(cells) + " |"


def a_row(conclusion="原结论"):
    cells = [
        "A001", "2026-11-27", "主题", "E001", "推理", conclusion, "", "中", "新发现", "", "",
    ]
    return "| " + " | ".join(cells) + " |"


def d_row(did, path, sources, status, digest):
    cells = [did, "文档", path, sources, "通用", status, digest, "", ""]
    return "| " + " | ".join(cells) + " |"


def snapshot(root):
    result = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            relative = os.path.relpath(full, root).replace("\\", "/")
            with open(full, "rb") as handle:
                result[relative] = handle.read()
    return result


def split_outside(text):
    """返回（BEGIN 行及之前, END 行及之后）——块外内容的字节切面。"""
    block = blocks.parse_blocks(text)[0]
    lines = text.splitlines(True)
    return "".join(lines[: block.begin_line + 1]), "".join(lines[block.end_line:])


class SyncTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self._tmp.name, "case")
        os.mkdir(self.root)
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = init_case.main(["--root", self.root, "--case-name", "测试案件", "--json"])
        self.assertEqual(0, code, msg="init_case stderr=%s" % err.getvalue())

        append_line(self.root, P_LEDGER, p_row())
        self.people_digest = digest_for(
            self.root, P_LEDGER, P_HEADER, "P编号", "P001"
        )

        arrest_path = project_path(self.root, ARREST)
        arrest_text = read_text(arrest_path).replace(
            "<!-- AUTO:END 抓捕对象 -->",
            ARREST_MANUAL_ROW + "\n<!-- AUTO:END 抓捕对象 -->",
            1,
        )
        arrest_text += "\n" + OUTSIDE_NOTE + "\n"
        write_text(arrest_path, arrest_text)

        # 法律 / 已签发 / 发放版文档里都故意放一个托管块：若实现把它们当普通文档处理，
        # 就会改写它 ⇒「原文不变」用例必须红（TR-008 第四对）。
        write_text(
            project_path(self.root, LEGAL),
            "# 起诉意见书\n\nP001 张三，角色主犯。\n\n" + arrest_block(),
        )
        write_text(
            project_path(self.root, ISSUED),
            "# 发放版快照\n\n原文不变。\n\n" + arrest_block(),
        )
        signed_text = read_text(project_path(self.root, SIGNED))
        if not signed_text.endswith("\n"):
            signed_text += "\n"
        write_text(project_path(self.root, SIGNED), signed_text + arrest_block())

        for row in (
            d_row("D003", ARREST, "P001", "草稿", self.people_digest),
            d_row("D005", LEGAL, "P001", "草稿", self.people_digest),
            d_row("D006", SIGNED, "P001", "已签发", self.people_digest),
            d_row("D007", ISSUED, "P001", "草稿", self.people_digest),
        ):
            append_line(self.root, D_LEDGER, row)

    def tearDown(self):
        self._tmp.cleanup()

    def change_role(self, role="操盘手"):
        path = project_path(self.root, P_LEDGER)
        text = read_text(path)
        self.assertIn("| 主犯 |", text)
        write_text(path, text.replace("| 主犯 |", "| %s |" % role, 1))

    def call(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = sync_docs.main(["--root", self.root, "--json"] + list(args))
        payload = None
        if out.getvalue().strip():
            payload = json.loads(out.getvalue())
        return code, payload, err.getvalue()

    def assert_no_writes(self, before):
        after = snapshot(self.root)
        self.assertEqual(sorted(before), sorted(after))
        for relative in before:
            self.assertEqual(before[relative], after[relative], msg=relative)


class DryRunTest(SyncTestBase):
    def test_source_change_yields_affected_doc_and_diff(self):
        self.change_role()
        code, payload, stderr = self.call("--dry-run", "--doc", "D003")
        self.assertEqual(1, code, msg=stderr)
        self.assertEqual(True, payload["ok"])
        self.assertEqual(True, payload["dry_run"])
        self.assertEqual(1, len(payload["affected"]))
        item = payload["affected"][0]
        self.assertEqual("D003", item["doc"])
        self.assertEqual(ARREST, item["path"])
        self.assertEqual(["抓捕对象"], item["blocks"])
        changed = [line for line in item["diff"].splitlines()
                   if line.startswith(("-|", "+|"))]
        self.assertEqual(2, len(changed), msg=changed)
        self.assertIn("主犯", changed[0])
        self.assertIn("操盘手", changed[1])
        self.assertEqual([], payload["suggestions"])
        self.assertEqual([], payload["changelog"])
        self.assertEqual([], payload["errors"])

    def test_dry_run_writes_nothing(self):
        self.change_role()
        before = snapshot(self.root)
        code, payload, stderr = self.call("--dry-run")
        self.assertEqual(1, code, msg=stderr)
        self.assertTrue(payload["affected"])
        self.assert_no_writes(before)

    def test_unchanged_source_is_skipped(self):
        # 四种文档都不动：普通 / 法律 / 已签发 / 发放版；任何一项冒出都是没跳过。
        code, payload, stderr = self.call("--dry-run")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["affected"])
        self.assertEqual([], payload["suggestions"])
        self.assertEqual([], payload["changelog"])

    def test_json_contract_keys(self):
        self.change_role()
        code, payload, _stderr = self.call("--dry-run")
        self.assertEqual(1, code)
        self.assertEqual(
            {"ok", "dry_run", "affected", "suggestions", "changelog", "errors"},
            set(payload),
        )
        self.assertIsInstance(payload["affected"], list)
        self.assertIsInstance(payload["suggestions"], list)
        self.assertIsInstance(payload["changelog"], list)
        self.assertIsInstance(payload["errors"], list)


class ApplyTest(SyncTestBase):
    def test_apply_updates_only_managed_block(self):
        self.change_role()
        before_text = read_text(project_path(self.root, ARREST))
        before_prefix, before_suffix = split_outside(before_text)

        code, payload, stderr = self.call("--apply", "--doc", "D003")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(1, len(payload["affected"]))

        after_text = read_text(project_path(self.root, ARREST))
        after_prefix, after_suffix = split_outside(after_text)
        self.assertEqual(before_prefix, after_prefix)
        self.assertEqual(before_suffix, after_suffix)
        self.assertIn("操盘手", after_text)

        inside = blocks.get_block(after_text, "抓捕对象")
        row = tables.require_table(inside, sync_docs.ARREST_HEADER).rows[0]
        self.assertEqual("P001", row["P编号"])
        self.assertEqual("操盘手", row["角色/层级"])
        # 人工列原样保留（只换块内、只换来源可推导的列）。
        self.assertEqual("诈骗", row["涉嫌罪名"])
        self.assertEqual("某所", row["抓捕单位"])
        self.assertEqual("民警甲", row["抓捕人"])
        self.assertEqual("高", row["风险"])

    def test_apply_preserves_human_text_outside_block(self):
        self.change_role()
        self.call("--apply", "--doc", "D003")
        text = read_text(project_path(self.root, ARREST))
        self.assertIn(OUTSIDE_NOTE, text)
        self.assertIn("主表固定 12 列", text)

    def test_apply_then_dry_run_is_clean(self):
        self.change_role()
        code, payload, stderr = self.call("--apply")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["errors"])
        self.assertTrue(payload["affected"] or payload["suggestions"] or payload["changelog"])

        code, payload, stderr = self.call("--dry-run")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["affected"])
        self.assertEqual([], payload["suggestions"])
        self.assertEqual([], payload["changelog"])
        self.assertEqual([], payload["errors"])


class LegalDocumentTest(SyncTestBase):
    def test_legal_document_bytes_unchanged_and_suggestion_emitted(self):
        self.change_role()
        before = read_text(project_path(self.root, LEGAL))
        code, payload, stderr = self.call("--apply", "--doc", "D005")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(before, read_text(project_path(self.root, LEGAL)))
        self.assertEqual(1, len(payload["suggestions"]))
        suggestion = payload["suggestions"][0]
        self.assertEqual("D005", suggestion["doc"])
        self.assertEqual(LEGAL, suggestion["path"])
        self.assertIn("待法制审核", suggestion["note"])
        self.assertEqual([], payload["affected"])

        rows = tables.parse_rows(
            read_text(project_path(self.root, D_LEDGER)), D_HEADER
        )
        status = {row["D编号"]: row["状态"] for row in rows}
        self.assertEqual("待法制审核", status["D005"])

    def test_issued_version_bytes_unchanged_and_logged(self):
        self.change_role()
        before = read_text(project_path(self.root, ISSUED))
        code, payload, stderr = self.call("--apply", "--doc", "D007")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(before, read_text(project_path(self.root, ISSUED)))
        self.assertEqual(1, len(payload["changelog"]))
        self.assertIn("D007", payload["changelog"][0])
        self.assertEqual([], payload["affected"])

        rows = tables.parse_rows(
            read_text(project_path(self.root, CHANGELOG)), CHANGELOG_HEADER
        )
        logged = [row for row in rows if row["影响文件"] == ISSUED]
        self.assertEqual(1, len(logged))

    def test_signed_document_logged_once_across_repeated_apply(self):
        self.change_role()
        before = read_text(project_path(self.root, SIGNED))

        code, first, stderr = self.call("--apply", "--doc", "D006")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(1, len(first["changelog"]))

        code, second, stderr = self.call("--apply", "--doc", "D006")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], second["changelog"])

        self.assertEqual(before, read_text(project_path(self.root, SIGNED)))
        rows = tables.parse_rows(
            read_text(project_path(self.root, CHANGELOG)), CHANGELOG_HEADER
        )
        logged = [row for row in rows if row["影响文件"] == SIGNED]
        self.assertEqual(1, len(logged))


class FilterTest(SyncTestBase):
    def test_doc_filter_limits_scope(self):
        self.change_role()
        code, payload, stderr = self.call("--dry-run", "--doc", "D005")
        self.assertEqual(1, code, msg=stderr)
        self.assertEqual([], payload["affected"])
        self.assertEqual(["D005"], [item["doc"] for item in payload["suggestions"]])
        self.assertEqual([], payload["changelog"])

    def test_source_filter_limits_scope(self):
        append_line(self.root, P_LEDGER, p_row(pid="P002", name="李四", role="成员"))
        digest = digest_for(self.root, P_LEDGER, P_HEADER, "P编号", "P002")
        other_legal = "文书/起诉/起诉意见书草稿2.md"
        write_text(project_path(self.root, other_legal), "# 另一份起诉意见书\n")
        append_line(
            self.root, D_LEDGER, d_row("D009", other_legal, "P002", "草稿", digest)
        )
        self.change_role()
        path = project_path(self.root, P_LEDGER)
        text = read_text(path).replace("| 成员 |", "| 骨干 |", 1)
        write_text(path, text)

        code, payload, _ = self.call("--dry-run", "--source", "P001")
        self.assertEqual(1, code)
        self.assertEqual(["D005"], [item["doc"] for item in payload["suggestions"]])
        self.assertNotIn("D009", [item["doc"] for item in payload["suggestions"]])

        code, payload, _ = self.call("--dry-run", "--source", "P002")
        self.assertEqual(1, code)
        self.assertEqual(["D009"], [item["doc"] for item in payload["suggestions"]])
        self.assertEqual([], payload["affected"])

    def test_unknown_doc_is_error(self):
        code, payload, _ = self.call("--dry-run", "--doc", "D999")
        self.assertEqual(2, code)
        self.assertEqual(["DOC_NOT_FOUND"], [item["code"] for item in payload["errors"]])


class BlockErrorTest(SyncTestBase):
    def test_block_error_aborts_all_writes(self):
        self.change_role()
        write_text(
            project_path(self.root, REPORT),
            "# A001-测试研判\n\n"
            "<!-- AUTO:BEGIN 研判溯源 -->\n"
            "| 溯源项 | 内容 |\n"
            "|---|---|\n"
            "<!-- AUTO:END 别的 -->\n",
        )
        append_line(
            self.root, D_LEDGER, d_row("D008", REPORT, "P001", "草稿", "0000000000000000")
        )
        before = snapshot(self.root)

        code, payload, _ = self.call("--apply")
        self.assertEqual(2, code)
        self.assertEqual(["BLOCK_INVALID"], [item["code"] for item in payload["errors"]])
        self.assertEqual(False, payload["ok"])
        self.assert_no_writes(before)


class ArgsTest(SyncTestBase):
    def test_mode_is_required_and_exclusive(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            missing = sync_docs.main(["--root", self.root, "--json"])
            both = sync_docs.main(
                ["--root", self.root, "--json", "--dry-run", "--apply"]
            )
        self.assertEqual(2, missing)
        self.assertEqual(2, both)


class TraceBlockTest(SyncTestBase):
    def test_research_index_change_updates_trace_block(self):
        append_line(self.root, A_LEDGER, a_row(conclusion="原结论"))
        digest = digest_for(self.root, A_LEDGER, A_HEADER, "A编号", "A001")
        write_text(
            project_path(self.root, REPORT),
            "# A001-测试研判\n\n"
            "<!-- AUTO:BEGIN 研判溯源 -->\n"
            "| 溯源项 | 内容 |\n"
            "|---|---|\n"
            "| 问题 / 假设 | 主题 |\n"
            "| 输入及用途 | E001 |\n"
            "| 推理链 | 推理 |\n"
            "| 替代假设与排除理由 | 无 |\n"
            "| 结论 | 原结论 |\n"
            "| 新线索 | |\n"
            "| 置信度 | 中 |\n"
            "| 反证 / 矛盾 | 无 |\n"
            "| 修订记录 | 2026-11-27 |\n"
            "<!-- AUTO:END 研判溯源 -->\n",
        )
        append_line(
            self.root, D_LEDGER, d_row("D008", REPORT, "A001", "草稿", digest)
        )

        path = project_path(self.root, A_LEDGER)
        text = read_text(path)
        write_text(path, text.replace("| 原结论 |", "| 新结论 |", 1))

        code, payload, stderr = self.call("--dry-run", "--doc", "D008")
        self.assertEqual(1, code, msg=stderr)
        self.assertEqual(["研判溯源"], payload["affected"][0]["blocks"])
        diff = payload["affected"][0]["diff"]
        self.assertIn("新结论", diff)
        # 只有「结论」一行变化；推理链等人工叙述不由索引覆盖。
        changed = [line for line in diff.splitlines()
                   if line.startswith(("-|", "+|"))]
        self.assertEqual(2, len(changed), msg=changed)
        self.assertIn("结论", changed[0])

        code, _payload, stderr = self.call("--apply", "--doc", "D008")
        self.assertEqual(0, code, msg=stderr)
        inside = blocks.get_block(read_text(project_path(self.root, REPORT)), "研判溯源")
        rows = {row["溯源项"]: row["内容"]
                for row in tables.require_table(inside, sync_docs.TRACE_HEADER).rows}
        self.assertEqual("新结论", rows["结论"])
        self.assertEqual("推理", rows["推理链"])


def register(root, did, path, sources, status="草稿", digest="0000000000000000"):
    append_line(root, D_LEDGER, d_row(did, path, sources, status, digest))


class AffectedAlwaysTest(SyncTestBase):
    """源变了就必须进 affected——哪怕块内容不需要改（Fix round 1 #1）。"""

    def test_source_change_without_managed_block_is_reported(self):
        register(self.root, "D010", QUESTION, "P001", digest=self.people_digest)
        before_question = read_text(project_path(self.root, QUESTION))
        self.change_role()
        before = snapshot(self.root)

        code, payload, stderr = self.call("--dry-run", "--doc", "D010")
        self.assertEqual(1, code, msg=stderr)
        self.assertEqual(1, len(payload["affected"]))
        item = payload["affected"][0]
        self.assertEqual("D010", item["doc"])
        self.assertEqual(QUESTION, item["path"])
        self.assertEqual([], item["blocks"])
        self.assertEqual("", item["diff"])
        self.assertTrue(item["reason"])
        self.assert_no_writes(before)

        code, payload, stderr = self.call("--apply", "--doc", "D010")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(1, len(payload["affected"]))
        self.assertEqual(before_question, read_text(project_path(self.root, QUESTION)))
        new_digest = digest_for(self.root, P_LEDGER, P_HEADER, "P编号", "P001")
        rows = {row["D编号"]: row for row in tables.parse_rows(
            read_text(project_path(self.root, D_LEDGER)), D_HEADER)}
        self.assertEqual(new_digest, rows["D010"]["源版本（指纹）"])

        code, payload, stderr = self.call("--dry-run", "--doc", "D010")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["affected"])

    def test_first_sync_of_template_block_has_no_text_diff(self):
        # 清空抓捕单位 ⇒ 抓捕方案「编组」不需要改；模板 8 行应按原样重渲染。
        arrest_path = project_path(self.root, ARREST)
        write_text(arrest_path, read_text(arrest_path).replace("| 某所 |", "| |", 1))
        register(self.root, "D010", PLAN, "D003")
        before_plan = read_text(project_path(self.root, PLAN))

        code, payload, stderr = self.call("--dry-run", "--doc", "D010")
        self.assertEqual(1, code, msg=stderr)
        item = payload["affected"][0]
        self.assertEqual("D010", item["doc"])
        self.assertEqual([], item["blocks"])
        self.assertEqual("", item["diff"])
        self.assertTrue(item["reason"])

        code, _payload, stderr = self.call("--apply", "--doc", "D010")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual(before_plan, read_text(project_path(self.root, PLAN)))


class ChangelogScopeTest(SyncTestBase):
    def test_only_changelog_dry_run_exits_zero(self):
        self.change_role()
        code, payload, stderr = self.call("--dry-run", "--doc", "D006")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["affected"])
        self.assertEqual([], payload["suggestions"])
        self.assertEqual(1, len(payload["changelog"]))

    def test_changelog_dedupe_survives_fingerprint_rewind(self):
        self.change_role()
        code, _payload, stderr = self.call("--apply", "--doc", "D006")
        self.assertEqual(0, code, msg=stderr)

        # 人工把 D 表指纹改回旧值：源相对 D 表又「变了」，但日志已记过。
        d_path = project_path(self.root, D_LEDGER)
        d_text = read_text(d_path)
        rows = {row["D编号"]: row for row in tables.parse_rows(d_text, D_HEADER)}
        write_text(
            d_path,
            d_text.replace(rows["D006"]["源版本（指纹）"], self.people_digest, 1),
        )

        code, payload, stderr = self.call("--apply", "--doc", "D006")
        self.assertEqual(0, code, msg=stderr)
        self.assertEqual([], payload["changelog"])

        log_rows = tables.parse_rows(
            read_text(project_path(self.root, CHANGELOG)), CHANGELOG_HEADER
        )
        self.assertEqual(1, len([row for row in log_rows if row["影响文件"] == SIGNED]))


class ErrorCodeTest(SyncTestBase):
    def assert_code(self, expected, did=None):
        argv = ["--dry-run"]
        if did:
            argv.extend(["--doc", did])
        code, payload, stderr = self.call(*argv)
        self.assertEqual(2, code, msg=stderr)
        self.assertEqual([expected], [item["code"] for item in payload["errors"]],
                         msg=payload["errors"])

    def test_path_invalid(self):
        register(self.root, "D010", "../outside.md", "P001")
        self.assert_code("PATH_INVALID", "D010")

    def test_path_missing(self):
        register(self.root, "D010", "", "P001")
        self.assert_code("PATH_MISSING", "D010")

    def test_file_missing(self):
        register(self.root, "D010", "文书/起诉/不存在.md", "P001")
        self.assert_code("FILE_MISSING", "D010")

    def test_source_unknown(self):
        register(self.root, "D010", ARREST, "X001")
        self.assert_code("SOURCE_UNKNOWN", "D010")

    def test_source_row_missing(self):
        register(self.root, "D010", ARREST, "P999")
        self.assert_code("SOURCE_ROW_MISSING", "D010")

    def test_table_invalid(self):
        path = project_path(self.root, D_LEDGER)
        text = read_text(path).replace(
            "| D编号 | 文档 |", "| D编号 | 名称 |", 1
        )
        write_text(path, text)
        self.assert_code("TABLE_INVALID")

    def test_block_unsupported(self):
        write_text(
            project_path(self.root, REPORT),
            "# 未知块\n\n<!-- AUTO:BEGIN 未知块 -->\n内容\n<!-- AUTO:END 未知块 -->\n",
        )
        register(self.root, "D010", REPORT, "P001")
        self.assert_code("BLOCK_UNSUPPORTED", "D010")

    def test_internal_error(self):
        with mock.patch.object(sync_docs, "_plan_doc", side_effect=RuntimeError("boom")):
            code, payload, _stderr = self.call("--dry-run")
        self.assertEqual(2, code)
        self.assertEqual(["INTERNAL_ERROR"], [
            item["code"] for item in payload["errors"]])


if __name__ == "__main__":
    unittest.main()
