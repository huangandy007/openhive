"""校验案件工作区（017-case-staff / FR-080 ~ FR-083）。

契约见 ``docs/superpowers/specs/017-case-staff/contracts/case-staff-commands.md`` §2，
检查清单见 ``docs/superpowers/specs/017-case-staff/data-model.md`` §7。
检查分两组：**核心检查**（引用 / 编号 / E / A / L/V/T / D / M / 阶段）
与**规则检查**（命名 / 积压 / 逾期 / 跨文档矛盾，T006）；``--strict`` 时警告计为失败。

设计约束：

- 表格解析与状态字面量一律复用 ``scripts/lib/``（契约 §2「禁止另写一份」）；
- 每条检查是独立函数，统一返回 ``[{file, line, code, message}]`` 并追加到
  ``Context``，便于 T006 继续加检查而不动主干；
- 核心台账缺失 / 表格解析失败都是**错误**，不然校验器会对空项目静默绿；
- 输出 ``{ok, errors, warnings, counts}``，排序稳定 ``(file, line, code, message)``；
- 有错误退出码 2；无错误但有警告且 ``--strict`` 退出码 1；否则 0。

只依赖 Python 3 标准库，不联网，不写项目根以外。
"""

import argparse
import datetime
import io
import json
import os
import re
import sys

# ``python -I``（隔离模式）不把脚本目录放进 sys.path；直接执行脚本时靠这一行
# 才能导入同目录的 ``lib/``。以 ``scripts.validate_case`` 导入时首行即可命中。
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

try:
    from scripts.lib import constants, tables
except ImportError:  # 直接以脚本方式执行时 scripts 不是包
    from lib import constants, tables

# 目录白名单与「初始化模板文件」以初始化脚本的清单为唯一出处（data-model §1.1/§1.2），
# 避免校验器里再抄一份 39 个目录。
try:
    from scripts import init_case
except ImportError:  # 直接以脚本方式执行
    import init_case

CASE_INFO = "案件信息.md"
M_LEDGER = "材料/00-材料登记表.md"
E_LEDGER = "证据/证据索引.md"
A_LEDGER = "研判/00-研判索引.md"
T_LEDGER = "专案协同/03-任务盯办/00-任务台账.md"
L_LEDGER = "专案协同/04-线索流转/00-线索台账.md"
V_LEDGER = "专案协同/05-印证核实/00-印证台账.md"
P_LEDGER = "专案协同/06-人员与组织/00-人员台账.md"
D_LEDGER = "文书/00-文书登记表.md"

M_HEADER = ("M编号", "原文件名", "当前路径", "材料类型", "上传时间", "关联E", "状态", "备注")
E_HEADER = (
    "E编号", "法定种类", "证据名称", "来源M", "提取人", "提取时间", "提取地点",
    "保管链", "证明内容", "待证事实", "证明力/局限", "印证证据", "原件/介质存放地",
    "哈希/校验", "风险标记", "状态", "确认人", "确认时间",
)
A_HEADER = (
    "A编号", "日期", "主题/问题", "输入E/F/A", "推理摘要", "结论（事实说明什么）",
    "新线索L", "置信度", "状态", "产出/下一步", "复核人",
)
T_HEADER = ("T编号", "任务", "责任人", "期限", "状态", "来源", "反馈", "备注")
L_HEADER = ("L编号", "发现日期", "线索内容", "来源", "状态", "下一步", "转研判A", "备注")
V_HEADER = ("V编号", "日期", "对应L", "核实内容", "结果", "依据E", "回写", "备注")
P_HEADER = ("P编号", "姓名", "身份", "角色/层级", "单位", "状态", "关联L/E", "备注")
D_HEADER = ("D编号", "文档", "路径", "来源记录", "模板", "状态", "源版本（指纹）", "复核人", "复核时间")
STAGE_HEADER = ("阶段", "状态", "开始日期", "法定期限或节点", "负责人", "下一步", "阻塞或风险", "完成标志")

# (前缀, 台账路径, 表头, 编号列)
LEDGER_SPECS = (
    ("M", M_LEDGER, M_HEADER, "M编号"),
    ("E", E_LEDGER, E_HEADER, "E编号"),
    ("A", A_LEDGER, A_HEADER, "A编号"),
    ("T", T_LEDGER, T_HEADER, "T编号"),
    ("L", L_LEDGER, L_HEADER, "L编号"),
    ("V", V_LEDGER, V_HEADER, "V编号"),
    ("P", P_LEDGER, P_HEADER, "P编号"),
    ("D", D_LEDGER, D_HEADER, "D编号"),
)

REQUIRED_FILES = (
    CASE_INFO,
    M_LEDGER,
    E_LEDGER,
    A_LEDGER,
    T_LEDGER,
    L_LEDGER,
    V_LEDGER,
    P_LEDGER,
    D_LEDGER,
)

STAGES = (
    "分析研判",
    "调查取证",
    "沟通对接",
    "落地侦查",
    "收网抓捕",
    "询问讯问",
    "报捕起诉",
)

# data-model §4.2：法律文书节点目录；这三道必须有复核人 + 复核时间。
LEGAL_DOCUMENT_PREFIXES = ("文书/报捕/", "文书/起诉/", "文书/内部审批/")

# 引用扫描的前缀（data-model §7「引用」组）：E/A/L/T；E/A 从索引取，L/T 从台账取。
REFERENCE_RE = re.compile(r"(?<![A-Za-z0-9])([EALT])(\d{3,})(?!\d)")
# 台账单元格里可能出现的全部编号前缀（来源记录 / 转研判 / 对应L 等）。
ANY_ID_RE = re.compile(r"(?<![A-Za-z0-9])([MEALVTCDP])(\d{3,})(?!\d)")
M_ID_RE = re.compile(r"(?<![A-Za-z0-9])M(\d{3,})(?!\d)")
A_ID_RE = re.compile(r"(?<![A-Za-z0-9])A(\d{3,})(?!\d)")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

# 单文件台账：A 双向一致；L/V/T 只查「有单文件时」的编号必须已入账。
SINGLE_FILE_SPECS = (
    ("A", ("研判/01-专题研判", "研判/02-综合研判"), re.compile(r"^(A\d{3,})-.+\.md$"), True),
    ("L", ("专案协同/04-线索流转",), re.compile(r"^(L\d{3,})-.+\.md$"), False),
    ("V", ("专案协同/05-印证核实",), re.compile(r"^(V\d{3,})-.+\.md$"), False),
    ("T", ("专案协同/03-任务盯办",), re.compile(r"^(T\d{3,})-.+\.md$"), False),
)

P_DIR_RE = re.compile(r"^(P\d{3,})-.+$")
P_FILE_RE = re.compile(r"^(P\d{3,})-.+\.md$")
D_FILE_RE = re.compile(r"^(D\d{3,})-")

# 引用扫描豁免：材料原件与外部来件保留原文，README/AGENTS 是规则说明（含示例编号）。
# 同一组目录也是命名检查的外部来件豁免（FR-082）：原件与转写稿保留原文件名。
EXCLUDED_DIRECTORIES = ("材料", "专案协同/00-原始记录")
EXCLUDED_BASENAMES = ("README.md", "AGENTS.md")

# 列名字面量从表头常量派生（#002-06：同一前提只留一处）。
M_ID = M_HEADER[0]
M_CURRENT_PATH = M_HEADER[2]
M_RELATED_E = M_HEADER[5]
M_STATUS = M_HEADER[6]
T_ID = T_HEADER[0]
T_DEADLINE = T_HEADER[3]
T_STATUS = T_HEADER[4]
P_ID = P_HEADER[0]
P_NAME = P_HEADER[1]
P_ROLE = P_HEADER[3]

# data-model §7「跨文档」：人员台账 ↔ 抓捕对象清单（12 列主表）。
ARREST_LIST = "专案协同/07-抓捕筹备/00-抓捕对象清单.md"
ARREST_HEADER = (
    "序号", "P编号", "抓捕对象", "角色/层级", "涉嫌罪名", "主要证据",
    "抓捕单位", "抓捕人", "情报支撑", "技术支撑", "法制支撑", "风险",
)
ARREST_SEQ = ARREST_HEADER[0]
ARREST_P_ID = ARREST_HEADER[1]
ARREST_NAME = ARREST_HEADER[2]
ARREST_ROLE = ARREST_HEADER[3]

# data-model §7「积压」：待归档收件箱与原始记录整理标记。
INBOX_DIR = "材料/00-待归档/"
ORIGINAL_RECORDS_DIR = "专案协同/00-原始记录/"
ORIGINAL_RECORD_MARKER = "已整理"
ARREST_RECORD = "侦查/收网抓捕/00-收网记录.md"
SUMMARY_TOTAL_KEY = "对象总数"

# data-model §4.1：我方新建文件命名正则（外部来件豁免）。
NAME_DAILY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-每日动态\.md$")
NAME_MEETING_RE = re.compile(r"^C\d{3}-\d{4}-\d{2}-\d{2}-.+\.md$")
NAME_TASK_RE = re.compile(r"^T\d{3}-.+\.md$")
NAME_CLUE_RE = re.compile(r"^L\d{3}-.+\.md$")
NAME_ANALYSIS_RE = re.compile(r"^A\d{3}-.+\.md$")
NAME_VERIFY_RE = re.compile(r"^V\d{3}-.+\.md$")
NAME_PERSON_RE = re.compile(r"^P\d{3}-.+\.md$")
NAME_DOCUMENT_RE = re.compile(r"^D\d{3}-.+-P\d{3}-\d{4}-\d{2}-\d{2}\.md$")
NAME_TRANSCRIPT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-P\d{3}-笔录-\d{2}\.md$")
NAME_POST_CASE_RE = re.compile(r"^P\d{3}-案后处理清单\.md$")
NAME_RELEASE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-.+-发放版\.md$")
NAME_PERSON_DIR_RE = re.compile(r"^[PO]\d{3}-.+$")
CHART_DIRECTORY = "图表"

# 目录 → 文件命名正则；表外的业务目录只做非法字符 / 禁用词检查。
FILE_NAME_RULES = {
    "专案协同/01-每日动态": NAME_DAILY_RE,
    "专案协同/02-专案会议": NAME_MEETING_RE,
    "专案协同/03-任务盯办": NAME_TASK_RE,
    "专案协同/04-线索流转": NAME_CLUE_RE,
    "专案协同/05-印证核实": NAME_VERIFY_RE,
    "专案协同/06-人员与组织": NAME_PERSON_RE,
    "专案协同/07-抓捕筹备": NAME_RELEASE_RE,
    "专案协同/07-抓捕筹备/04-对象资料": NAME_PERSON_RE,
    "研判/01-专题研判": NAME_ANALYSIS_RE,
    "研判/02-综合研判": NAME_ANALYSIS_RE,
    "侦查/询问讯问": NAME_TRANSCRIPT_RE,
    "侦查/收网抓捕/04-案后处理": NAME_POST_CASE_RE,
}

# data-model §4.1 硬规则：禁空格、括号、`#`、`?`、`*`（另含 win32 非法字符）。
ILLEGAL_NAME_CHARS = frozenset(' \\/:*?"<>|()（）#')

DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# data-model §6.3 / §7：只有未完成状态参与逾期派生。
OPEN_TASK_STATUSES = ("待办", "进行中")


class Entry(object):
    """台账的一行：1 基行号 + 行字典。"""

    __slots__ = ("line", "row")

    def __init__(self, line, row):
        self.line = line
        self.row = row


class Workspace(object):
    """只在项目根内读写；文本缓存避免同一文件重复读。"""

    def __init__(self, root):
        self.root = root
        self._text = {}

    def rel_path(self, relative):
        return os.path.join(self.root, *relative.split("/"))

    def isfile(self, relative):
        return os.path.isfile(self.rel_path(relative))

    def read(self, relative):
        if relative not in self._text:
            try:
                with io.open(self.rel_path(relative), "r", encoding="utf-8") as handle:
                    self._text[relative] = handle.read()
            except (IOError, OSError, UnicodeError):
                self._text[relative] = None
        return self._text[relative]


class Context(object):
    """收集 findings；同一 ``(file, line, code, message)`` 只记一次。

    ``today`` 可注入（测试固定日期），默认取真实时钟。
    """

    def __init__(self, root, today=None):
        self.ws = Workspace(root)
        self.today = today if today is not None else datetime.date.today()
        self.errors = []
        self.warnings = []
        self._seen = set()

    def add(self, file, line, code, message):
        self._record(self.errors, file, line, code, message)

    def add_warning(self, file, line, code, message):
        self._record(self.warnings, file, line, code, message)

    def _record(self, bucket, file, line, code, message):
        finding = {"file": file, "line": int(line), "code": code, "message": message}
        key = (finding["file"], finding["line"], finding["code"], finding["message"])
        if key in self._seen:
            return
        self._seen.add(key)
        bucket.append(finding)


class Data(object):
    """已解析的台账与编号集合；加载失败的台账不登记（由 FILE_MISSING/TABLE_INVALID 覆盖）。"""

    def __init__(self):
        self.ledgers = {}
        self.ids = {}
        self.stages = None
        self.meetings = set()

    def ledger(self, prefix):
        return self.ledgers.get(prefix)


class Ledger(object):
    def __init__(self, rel, header, entries):
        self.rel = rel
        self.header = header
        self.entries = entries

    def id_values(self, column):
        values = set()
        for entry in self.entries:
            value = entry.row.get(column, "").strip()
            if value:
                values.add(value)
        return values


def _row_line_numbers(text, header):
    """返回该表每个数据行的 1 基行号；扫描规则与 ``tables.parse_tables`` 一致。"""
    expected = tuple(header)
    lines = text.splitlines()
    in_fence = False
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if tables.FENCE_RE.match(stripped):
            in_fence = not in_fence
            index += 1
            continue
        if in_fence:
            index += 1
            continue
        cells = tables.split_cells(lines[index])
        if cells != expected or index + 1 >= len(lines) or not tables.is_separator(lines[index + 1]):
            index += 1
            continue
        numbers = []
        cursor = index + 2
        while cursor < len(lines):
            if tables.split_cells(lines[cursor]) is None:
                break
            numbers.append(cursor + 1)
            cursor += 1
        return numbers
    return []


def load_ledger(ctx, rel, header):
    """读取并按表头解析台账；缺失返回 None（由调用方先报 FILE_MISSING）。"""
    if not ctx.ws.isfile(rel):
        return None
    text = ctx.ws.read(rel)
    if text is None:
        ctx.add(rel, 0, "TABLE_INVALID", "无法以 UTF-8 读取：%s" % rel)
        return None
    try:
        table = tables.require_table(text, header)
    except tables.TableError as exc:
        ctx.add(rel, 0, "TABLE_INVALID", str(exc))
        return None
    line_numbers = _row_line_numbers(text, header)
    if len(line_numbers) != len(table.rows):
        line_numbers = line_numbers + [0] * (len(table.rows) - len(line_numbers))
    entries = [Entry(line, row) for line, row in zip(line_numbers, table.rows)]
    return Ledger(rel, header, entries)


def _normalize_rel(value):
    text = value.strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    if not text:
        return ""
    return os.path.normpath(text).replace("\\", "/")


def _compare_key(value):
    return os.path.normcase(_normalize_rel(value))


def _project_relative(path, root):
    return os.path.relpath(path, root).replace(os.sep, "/")


def _walk_files(directory):
    if not os.path.isdir(directory):
        return
    for dirpath, dirnames, filenames in os.walk(directory):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in sorted(filenames):
            yield os.path.join(dirpath, name)


def _meeting_ids(ws):
    """会议 C 编号来自 ``专案协同/02-专案会议/`` 的文件名。"""
    found = set()
    directory = ws.rel_path("专案协同/02-专案会议")
    for full in _walk_files(directory):
        name = os.path.basename(full)
        if not name.endswith(".md"):
            continue
        match = re.match(r"^(C\d{3,})-", name)
        if match:
            found.add(match.group(1))
    return found


def _claim_charge(text):
    return any(marker in text for marker in constants.CONCLUSION_CHARGE_MARKERS) and "罪" in text


# ---------------------------------------------------------------------------
# 检查函数：每个只做一类，统一把 findings 追加到 ctx
# ---------------------------------------------------------------------------


def check_required_files(ctx, data):
    for rel in REQUIRED_FILES:
        if not ctx.ws.isfile(rel):
            ctx.add(rel, 0, "FILE_MISSING", "缺少核心台账：%s" % rel)


def check_references(ctx, data):
    """正文 / 台账中的 E、A、L、T 编号必须存在于对应台账（data-model §7）。"""
    root = ctx.ws.root
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            name
            for name in dirnames
            if not name.startswith(".") and not _is_excluded_directory(dirpath, name, root)
        )
        for name in sorted(filenames):
            if not name.endswith(".md") or name in EXCLUDED_BASENAMES:
                continue
            rel = _project_relative(os.path.join(dirpath, name), root)
            if any(
                _compare_key(rel) == _compare_key(excluded)
                or _compare_key(rel).startswith(_compare_key(excluded) + "/")
                for excluded in EXCLUDED_DIRECTORIES
            ):
                continue
            _scan_references(ctx, data, rel)
    # 材料目录整体豁免（原件保留原文）；登记表只按行扫「关联E」列，
    # 不扫原文件名/当前路径——那里的「T1001-通话记录.xlsx」是文件名，不是引用。
    _scan_material_registry(ctx, data)


def _is_excluded_directory(dirpath, name, root):
    rel = _project_relative(os.path.join(dirpath, name), root)
    return any(
        _compare_key(rel) == _compare_key(excluded)
        or _compare_key(rel).startswith(_compare_key(excluded) + "/")
        for excluded in EXCLUDED_DIRECTORIES
    )


def _scan_material_registry(ctx, data):
    """材料登记表只扫「关联E」单元格（原文件名/当前路径不算引用）。"""
    ledger = data.ledger("M")
    if ledger is None:
        return
    for entry in ledger.entries:
        for match in REFERENCE_RE.finditer(entry.row.get(M_RELATED_E, "")):
            prefix = match.group(1)
            if prefix not in data.ids:
                continue
            ident = prefix + match.group(2)
            if ident not in data.ids[prefix]:
                ctx.add(ledger.rel, entry.line, "REF_MISSING", "%s 不在对应台账" % ident)


def _scan_references(ctx, data, rel):
    text = ctx.ws.read(rel)
    if text is None:
        return
    in_fence = False
    for number, raw in enumerate(text.splitlines(), 1):
        stripped = raw.strip()
        if tables.FENCE_RE.match(stripped):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in REFERENCE_RE.finditer(raw):
            prefix = match.group(1)
            if prefix not in data.ids:
                continue
            ident = prefix + match.group(2)
            if ident not in data.ids[prefix]:
                ctx.add(rel, number, "REF_MISSING", "%s 不在对应台账" % ident)


def check_numbering(ctx, data):
    """同前缀无重复；单文件编号与台账行一致（data-model §2）。"""
    for prefix, _rel, _header, id_column in LEDGER_SPECS:
        ledger = data.ledger(prefix)
        if ledger is None:
            continue
        seen = {}
        for entry in ledger.entries:
            ident = entry.row.get(id_column, "").strip()
            if not ident:
                continue
            if ident in seen:
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "DUP_ID",
                    "编号 %s 重复（首次在第 %d 行）" % (ident, seen[ident]),
                )
            else:
                seen[ident] = entry.line

    for prefix, directories, pattern, reverse in SINGLE_FILE_SPECS:
        _check_single_files(ctx, data, prefix, directories, pattern, reverse)

    _check_meeting_files(ctx, data)
    _check_person_files(ctx, data)
    _check_document_paths(ctx, data)


def _collect_single_files(ctx, directories, pattern):
    results = []
    for directory in directories:
        for full in _walk_files(ctx.ws.rel_path(directory)):
            name = os.path.basename(full)
            match = pattern.match(name)
            if match:
                results.append((match.group(1), _project_relative(full, ctx.ws.root)))
    return results


def _check_single_files(ctx, data, prefix, directories, pattern, reverse):
    if prefix not in data.ids:
        return
    ids = data.ids[prefix]
    seen = set()
    for ident, rel in _collect_single_files(ctx, directories, pattern):
        if ident in seen:
            ctx.add(rel, 0, "DUP_ID", "编号 %s 有重复的单文件" % ident)
        seen.add(ident)
        if ident not in ids:
            ctx.add(rel, 0, "ID_MISMATCH", "文件编号 %s 不在对应台账" % ident)
    if reverse:
        ledger = data.ledger(prefix)
        if ledger is not None:
            id_column = prefix + "编号"
            for entry in ledger.entries:
                ident = entry.row.get(id_column, "").strip()
                if ident and ident not in seen:
                    ctx.add(
                        ledger.rel,
                        entry.line,
                        "ID_MISMATCH",
                        "台账编号 %s 没有对应的单文件" % ident,
                    )


def _check_meeting_files(ctx, data):
    """会议 C 编号来自文件名，同号出现两份即重复。"""
    seen = set()
    pattern = re.compile(r"^(C\d{3,})-.+\.md$")
    for full in _walk_files(ctx.ws.rel_path("专案协同/02-专案会议")):
        match = pattern.match(os.path.basename(full))
        if not match:
            continue
        ident = match.group(1)
        rel = _project_relative(full, ctx.ws.root)
        if ident in seen:
            ctx.add(rel, 0, "DUP_ID", "编号 %s 有重复的会议文件" % ident)
        seen.add(ident)


def _check_person_files(ctx, data):
    if "P" not in data.ids:
        return
    ids = data.ids["P"]
    seen = set()
    base = ctx.ws.rel_path("专案协同")
    if not os.path.isdir(base):
        return
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in dirnames:
            match = P_DIR_RE.match(name)
            if match:
                rel = _project_relative(os.path.join(dirpath, name), ctx.ws.root)
                _check_person_id(ctx, data, ids, seen, match.group(1), rel)
        for name in sorted(filenames):
            match = P_FILE_RE.match(name)
            if match:
                rel = _project_relative(os.path.join(dirpath, name), ctx.ws.root)
                _check_person_id(ctx, data, ids, seen, match.group(1), rel)


def _check_person_id(ctx, data, ids, seen, ident, rel):
    if ident in seen:
        ctx.add(rel, 0, "DUP_ID", "编号 %s 有重复的人员目录/对象页" % ident)
    seen.add(ident)
    if ident not in ids:
        ctx.add(rel, 0, "ID_MISMATCH", "人员编号 %s 不在人员台账" % ident)


def _check_document_paths(ctx, data):
    ledger = data.ledger("D")
    if ledger is None:
        return
    for entry in ledger.entries:
        ident = entry.row.get("D编号", "").strip()
        path = _normalize_rel(entry.row.get("路径", ""))
        if not ident or not path:
            continue
        match = D_FILE_RE.match(os.path.basename(path))
        if match and match.group(1) != ident:
            ctx.add(
                ledger.rel,
                entry.line,
                "ID_MISMATCH",
                "文书路径编号 %s 与登记号 %s 不一致" % (match.group(1), ident),
            )


def check_evidence(ctx, data):
    ledger = data.ledger("E")
    if ledger is None:
        return
    material_loaded = "M" in data.ids
    material_ids = data.ids.get("M", set())
    for entry in ledger.entries:
        row = entry.row
        eid = row.get("E编号", "").strip()
        kind = row.get("法定种类", "").strip()
        if not kind:
            ctx.add(ledger.rel, entry.line, "E_FIELD_MISSING", "%s 缺法定种类" % eid)
        elif kind not in constants.E_LEGAL_KINDS:
            ctx.add(
                ledger.rel,
                entry.line,
                "E_LEGAL_KIND_INVALID",
                "%s 的法定种类 %r 不在受控取值" % (eid, kind),
            )
        elif kind == "待定":
            risk = row.get("风险标记", "")
            if "种类待定" not in risk or not DATE_RE.search(risk):
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "E_FIELD_MISSING",
                    "%s 法定种类待定，风险标记须含「种类待定」与补正期限" % eid,
                )

        source = row.get("来源M", "").strip()
        if not source:
            ctx.add(ledger.rel, entry.line, "E_FIELD_MISSING", "%s 缺来源M" % eid)
        else:
            refs = M_ID_RE.findall(source)
            if not refs:
                ctx.add(ledger.rel, entry.line, "E_FIELD_MISSING", "%s 来源M 未包含 M 编号" % eid)
            elif material_loaded:
                for number in refs:
                    ident = "M" + number
                    if ident not in material_ids:
                        ctx.add(
                            ledger.rel,
                            entry.line,
                            "E_SOURCE_MISSING",
                            "%s 的来源 %s 不在材料登记表" % (eid, ident),
                        )

        # data-model §3.2：证明内容与待证事实都不许写成法律结论（罪名认定）。
        for column in ("证明内容", "待证事实"):
            value = row.get(column, "")
            if not value.strip():
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "E_FIELD_MISSING",
                    "%s 的%s为空" % (eid, column),
                )
            if _claim_charge(value):
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "CHARGE_CLAIM",
                    "%s 的%s含罪名认定" % (eid, column),
                )


def check_analysis(ctx, data):
    ledger = data.ledger("A")
    if ledger is None:
        return
    graph = {}
    entries_by_id = {}
    for entry in ledger.entries:
        row = entry.row
        aid = row.get("A编号", "").strip()
        status = row.get("状态", "").strip()
        if status not in constants.A_STATUSES:
            ctx.add(
                ledger.rel,
                entry.line,
                "A_STATUS_INVALID",
                "%s 的状态 %r 不在受控取值" % (aid, status),
            )
        if status == "已证实" and not row.get("复核人", "").strip():
            ctx.add(
                ledger.rel,
                entry.line,
                "A_REVIEWER_MISSING",
                "%s 状态为已证实，复核人必填" % aid,
            )
        if _claim_charge(row.get("结论（事实说明什么）", "")):
            ctx.add(
                ledger.rel,
                entry.line,
                "CHARGE_CLAIM",
                "%s 的结论含罪名认定" % aid,
            )
        inputs = row.get("输入E/F/A", "")
        graph[aid] = set("A" + number for number in A_ID_RE.findall(inputs))
        entries_by_id[aid] = entry

    for aid in _cycle_nodes(graph):
        entry = entries_by_id.get(aid)
        if entry is not None:
            ctx.add(
                ledger.rel,
                entry.line,
                "A_CYCLE",
                "%s 的输入 A 形成环" % aid,
            )


def _cycle_nodes(graph):
    """返回参与环的节点集合（DFS 栈内回边即环）。"""
    visiting = set()
    visited = set()
    stack = []
    cycle = set()

    def visit(node):
        if node in visiting:
            if node in stack:
                cycle.update(stack[stack.index(node):])
            return
        if node in visited:
            return
        visiting.add(node)
        stack.append(node)
        for neighbour in graph.get(node, ()):
            visit(neighbour)
        stack.pop()
        visiting.discard(node)
        visited.add(node)

    for node in graph:
        visit(node)
    return cycle


def check_clues(ctx, data):
    ledger = data.ledger("L")
    if ledger is None:
        return
    for entry in ledger.entries:
        row = entry.row
        lid = row.get("L编号", "").strip()
        source = row.get("来源", "").strip()
        if not source:
            ctx.add(ledger.rel, entry.line, "L_UNRESOLVED", "%s 的来源为空" % lid)
        else:
            for ident in _ids_in(source):
                if not _known(data, ident):
                    ctx.add(
                        ledger.rel,
                        entry.line,
                        "L_UNRESOLVED",
                        "%s 的来源 %s 不存在" % (lid, ident),
                    )
        if row.get("状态", "").strip() == "转研判":
            to_a = row.get("转研判A", "").strip()
            if not to_a:
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "L_UNRESOLVED",
                    "%s 状态为转研判，未回填 A 编号" % lid,
                )
            else:
                for number in A_ID_RE.findall(to_a):
                    ident = "A" + number
                    if not _known(data, ident):
                        ctx.add(
                            ledger.rel,
                            entry.line,
                            "L_UNRESOLVED",
                            "%s 的转研判 %s 不存在" % (lid, ident),
                        )


def check_verifications(ctx, data):
    ledger = data.ledger("V")
    if ledger is None:
        return
    for entry in ledger.entries:
        row = entry.row
        vid = row.get("V编号", "").strip()
        result = row.get("结果", "").strip()
        if result not in constants.V_RESULTS:
            ctx.add(
                ledger.rel,
                entry.line,
                "V_RESULT_INVALID",
                "%s 的结果 %r 不在受控取值" % (vid, result),
            )
        for column in ("对应L", "依据E"):
            if not row.get(column, "").strip():
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "REF_MISSING",
                    "%s 缺%s" % (vid, column),
                )


def check_tasks(ctx, data):
    ledger = data.ledger("T")
    if ledger is None:
        return
    for entry in ledger.entries:
        row = entry.row
        tid = row.get("T编号", "").strip()
        status = row.get("状态", "").strip()
        if status not in constants.T_STATUSES:
            ctx.add(
                ledger.rel,
                entry.line,
                "T_STATUS_INVALID",
                "%s 的状态 %r 不在受控取值" % (tid, status),
            )
        for ident in _ids_in(row.get("来源", "")):
            if not _known(data, ident):
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "REF_MISSING",
                    "%s 的来源 %s 不存在" % (tid, ident),
                )


def check_documents(ctx, data):
    ledger = data.ledger("D")
    if ledger is None:
        return
    for entry in ledger.entries:
        row = entry.row
        did = row.get("D编号", "").strip()
        sources = row.get("来源记录", "").strip()
        if sources:
            refs = _ids_in(sources)
            if not refs:
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "REF_MISSING",
                    "%s 的来源记录未包含可解析编号" % did,
                )
            else:
                for ident in refs:
                    if not _known(data, ident):
                        ctx.add(
                            ledger.rel,
                            entry.line,
                            "REF_MISSING",
                            "%s 的来源记录 %s 不存在" % (did, ident),
                        )

        path = _normalize_rel(row.get("路径", ""))
        if path.startswith(LEGAL_DOCUMENT_PREFIXES):
            missing = [
                name
                for name in ("复核人", "复核时间")
                if not row.get(name, "").strip()
            ]
            if missing:
                ctx.add(
                    ledger.rel,
                    entry.line,
                    "D_REVIEWER_MISSING",
                    "%s 法律文书缺少%s" % (did, "、".join(missing)),
                )


def check_materials(ctx, data):
    ledger = data.ledger("M")
    if ledger is None:
        return
    registered = set()
    for entry in ledger.entries:
        mid = entry.row.get(M_ID, "").strip()
        raw = entry.row.get(M_CURRENT_PATH, "").strip()
        if not raw:
            ctx.add(ledger.rel, entry.line, "PATH_MISMATCH", "%s 的当前路径为空" % mid)
            continue
        normalized = _normalize_rel(raw)
        parts = normalized.split("/")
        if os.path.isabs(raw) or ".." in parts:
            ctx.add(
                ledger.rel,
                entry.line,
                "PATH_MISMATCH",
                "%s 的当前路径必须是项目内相对路径：%s" % (mid, raw),
            )
            continue
        registered.add(_compare_key(normalized))
        if not os.path.isfile(ctx.ws.rel_path(normalized)):
            ctx.add(
                ledger.rel,
                entry.line,
                "PATH_MISMATCH",
                "%s 的当前路径在盘上不存在：%s" % (mid, normalized),
            )

    skip = _compare_key(M_LEDGER)
    for full in _walk_files(ctx.ws.rel_path("材料")):
        name = os.path.basename(full)
        if name == ".gitkeep":
            continue
        rel = _project_relative(full, ctx.ws.root)
        key = _compare_key(rel)
        if key == skip or key in registered:
            continue
        ctx.add(rel, 0, "M_UNREGISTERED", "材料文件没有对应的 M 行：%s" % rel)


def check_stages(ctx, data):
    ledger = data.stages
    if ledger is None:
        return
    seen = set()
    for entry in ledger.entries:
        row = entry.row
        stage = row.get("阶段", "").strip()
        status = row.get("状态", "").strip()
        if stage not in STAGES:
            ctx.add(
                ledger.rel,
                entry.line,
                "STAGE_INVALID",
                "未知阶段 %r" % stage,
            )
        elif stage in seen:
            ctx.add(
                ledger.rel,
                entry.line,
                "STAGE_INVALID",
                "阶段 %s 重复" % stage,
            )
        else:
            seen.add(stage)
        if status not in constants.STAGE_STATUSES:
            ctx.add(
                ledger.rel,
                entry.line,
                "STAGE_INVALID",
                "%s 的状态 %r 不在受控取值" % (stage, status),
            )
    for stage in STAGES:
        if stage not in seen:
            ctx.add(ledger.rel, 0, "STAGE_INVALID", "阶段看板缺少阶段：%s" % stage)


# ---------------------------------------------------------------------------
# 规则检查（T006）：命名 / 积压 / 逾期 / 跨文档
# ---------------------------------------------------------------------------


def _is_external_path(rel):
    """命中的目录/文件属于外部来件（命名豁免；引用扫描另有同一份清单）。"""
    if not rel or rel == ".":
        return False
    key = _compare_key(rel)
    for excluded in EXCLUDED_DIRECTORIES:
        base = _compare_key(excluded)
        if key == base or key.startswith(base + "/"):
            return True
    return False


def _name_issues(name):
    issues = []
    bad = sorted(set(char for char in name if char in ILLEGAL_NAME_CHARS))
    if bad:
        issues.append("含非法字符 %s" % "、".join(bad))
    words = [word for word in constants.FORBIDDEN_FILENAME_WORDS if word in name]
    if words:
        issues.append("含禁用词 %s" % "、".join(words))
    return issues


def _directory_allowed(rel, name):
    return (
        rel in init_case.DIRECTORIES
        or name == CHART_DIRECTORY
        or NAME_PERSON_DIR_RE.match(name) is not None
    )


def _file_name_rule(rel_dir):
    rule = FILE_NAME_RULES.get(rel_dir)
    if rule is not None:
        return rule
    if rel_dir == "文书" or rel_dir.startswith("文书/"):
        return NAME_DOCUMENT_RE
    return None


def _check_directory_name(ctx, rel, name):
    issues = _name_issues(name)
    if not issues and not _directory_allowed(rel, name):
        issues.append("不在目录白名单")
    if issues:
        ctx.add(rel + "/", 0, "NAME_ILLEGAL", "目录名不合规：%s" % "；".join(issues))


def _check_file_name(ctx, rel_dir, name):
    rel = name if rel_dir == "." else rel_dir + "/" + name
    issues = _name_issues(name)
    if rel not in init_case.TEMPLATE_BY_TARGET:
        rule = _file_name_rule(rel_dir)
        if rule is not None and rule.match(name) is None:
            issues.append("不符合该目录的文件命名规则")
    if issues:
        ctx.add(rel, 0, "NAME_ILLEGAL", "文件名不合规：%s" % "；".join(issues))


def check_naming(ctx, data):
    """data-model §4.1：非法字符 / 禁用词 / 目录白名单；外部来件整枝豁免。"""
    root = ctx.ws.root
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = _project_relative(dirpath, root)
        kept = []
        for name in sorted(dirnames):
            if name.startswith("."):
                continue
            rel = name if rel_dir == "." else rel_dir + "/" + name
            if _is_external_path(rel):
                continue
            _check_directory_name(ctx, rel, name)
            kept.append(name)
        dirnames[:] = kept
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            _check_file_name(ctx, rel_dir, name)


def _count_inbox_files(ctx):
    count = 0
    base = ctx.ws.rel_path(INBOX_DIR.rstrip("/"))
    for _dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        count += len([name for name in filenames if not name.startswith(".")])
    return count


def check_backlog(ctx, data):
    """data-model §7「积压」：收件箱、待归类、原始记录缺整理标记，均为警告。"""
    count = _count_inbox_files(ctx)
    if count:
        ctx.add_warning(
            INBOX_DIR, 0, "M_PENDING", "收件箱还有 %d 份未归档" % count
        )

    ledger = data.ledger("M")
    if ledger is not None:
        for entry in ledger.entries:
            if entry.row.get(M_STATUS, "").strip() == "待归类":
                mid = entry.row.get(M_ID, "").strip()
                ctx.add_warning(
                    ledger.rel, entry.line, "M_PENDING", "%s 状态为待归类" % mid
                )

    base = ctx.ws.rel_path(ORIGINAL_RECORDS_DIR.rstrip("/"))
    for full in _walk_files(base):
        if os.path.basename(full).startswith("."):
            continue
        rel = _project_relative(full, ctx.ws.root)
        text = ctx.ws.read(rel)
        if text is None:
            continue
        if ORIGINAL_RECORD_MARKER not in text:
            ctx.add_warning(
                rel,
                0,
                "M_PENDING",
                "原始记录缺「%s」标记" % ORIGINAL_RECORD_MARKER,
            )


def _parse_date(value):
    """只认 ``YYYY-MM-DD``；``当日`` / ``持续`` / 空 / 非法日期都不参与逾期。"""
    if DATE_ONLY_RE.match(value) is None:
        return None
    try:
        return datetime.date(int(value[0:4]), int(value[5:7]), int(value[8:10]))
    except ValueError:
        return None


def check_overdue(ctx, data):
    """data-model §7「逾期」：待办/进行中且期限早于当天 ⇒ 警告。"""
    ledger = data.ledger("T")
    if ledger is None:
        return
    for entry in ledger.entries:
        if entry.row.get(T_STATUS, "").strip() not in OPEN_TASK_STATUSES:
            continue
        deadline = entry.row.get(T_DEADLINE, "").strip()
        parsed = _parse_date(deadline)
        if parsed is None or parsed >= ctx.today:
            continue
        tid = entry.row.get(T_ID, "").strip()
        ctx.add_warning(
            ledger.rel,
            entry.line,
            "T_OVERDUE",
            "%s 期限 %s 已过且未完成" % (tid, deadline),
        )


def _compare_identity(ctx, line, pid, field, ledger_value, arrest_value):
    if ledger_value and arrest_value and ledger_value != arrest_value:
        ctx.add(
            ARREST_LIST,
            line,
            "X_CONFLICT",
            "%s %s冲突：人员台账「%s」≠ 抓捕对象清单「%s」"
            % (pid, field, ledger_value, arrest_value),
        )


def _load_arrest_table(ctx):
    """读取并解析抓捕对象清单；缺失/表头不匹配返回 None，坏表报 TABLE_INVALID。"""
    if not ctx.ws.isfile(ARREST_LIST):
        return None
    text = ctx.ws.read(ARREST_LIST)
    if text is None:
        return None
    try:
        table = tables.find_table(text, ARREST_HEADER)
    except tables.TableError as exc:
        ctx.add(ARREST_LIST, 0, "TABLE_INVALID", str(exc))
        return None
    if table is None:
        return None
    lines = _row_line_numbers(text, ARREST_HEADER)
    if len(lines) != len(table.rows):
        lines = lines + [0] * (len(table.rows) - len(lines))
    return table, lines


def _arrest_row_count(table):
    count = 0
    for row in table.rows:
        if row.get(ARREST_P_ID, "").strip() or row.get(ARREST_SEQ, "").strip():
            count += 1
    return count


def _summary_number(text, key):
    for number, raw in enumerate(text.splitlines(), 1):
        cells = tables.split_cells(raw)
        if cells is None or len(cells) != 2:
            continue
        if cells[0].strip() != key:
            continue
        value = cells[1].strip()
        if re.match(r"^\d+$", value) is None:
            return None
        return int(value), number
    return None


def _check_summary_total(ctx, arrest):
    if arrest is None or not ctx.ws.isfile(ARREST_RECORD):
        return
    text = ctx.ws.read(ARREST_RECORD)
    if text is None:
        return
    found = _summary_number(text, SUMMARY_TOTAL_KEY)
    if found is None:
        return
    value, line = found
    count = _arrest_row_count(arrest[0])
    if count == value:
        return
    ctx.add_warning(
        ARREST_RECORD,
        line,
        "X_CONFLICT",
        "%s：收网记录 %d ≠ 抓捕对象清单 %d 行"
        % (SUMMARY_TOTAL_KEY, value, count),
    )


def check_cross_document(ctx, data):
    """data-model §7「跨文档」：P 姓名/角色为错误，汇总人数差异为警告。"""
    arrest = _load_arrest_table(ctx)
    people = data.ledger("P")
    if people is not None and arrest is not None:
        by_id = {}
        for entry in people.entries:
            pid = entry.row.get(P_ID, "").strip()
            if pid and pid not in by_id:
                by_id[pid] = entry.row
        table, lines = arrest
        for line, row in zip(lines, table.rows):
            pid = row.get(ARREST_P_ID, "").strip()
            if not pid:
                continue
            person = by_id.get(pid)
            if person is None:
                ctx.add(
                    ARREST_LIST,
                    line,
                    "REF_MISSING",
                    "抓捕对象清单的 %s 不在人员台账" % pid,
                )
                continue
            _compare_identity(
                ctx,
                line,
                pid,
                "姓名",
                person.get(P_NAME, "").strip(),
                row.get(ARREST_NAME, "").strip(),
            )
            _compare_identity(
                ctx,
                line,
                pid,
                "角色",
                person.get(P_ROLE, "").strip(),
                row.get(ARREST_ROLE, "").strip(),
            )
    _check_summary_total(ctx, arrest)


CHECKS = (
    check_required_files,
    check_references,
    check_numbering,
    check_evidence,
    check_analysis,
    check_clues,
    check_verifications,
    check_tasks,
    check_documents,
    check_materials,
    check_stages,
    check_naming,
    check_backlog,
    check_overdue,
    check_cross_document,
)


# ---------------------------------------------------------------------------
# 编号解析辅助
# ---------------------------------------------------------------------------


def _ids_in(text):
    if not text:
        return []
    return [prefix + number for prefix, number in ANY_ID_RE.findall(text)]


def _known(data, ident):
    prefix = ident[0]
    if prefix == "C":
        return ident in data.meetings
    ids = data.ids.get(prefix)
    if ids is None:
        return True  # 对应台账缺失已由 FILE_MISSING 报过，不再连带报引用
    return ident in ids


# ---------------------------------------------------------------------------
# 运行与输出
# ---------------------------------------------------------------------------


def _sorted(findings):
    return sorted(
        findings,
        key=lambda item: (item["file"], item["line"], item["code"], item["message"]),
    )


def _payload(errors, warnings):
    return {
        "ok": not errors,
        "errors": _sorted(errors),
        "warnings": _sorted(warnings),
        "counts": {"errors": len(errors), "warnings": len(warnings)},
    }


def run(args, today=None):
    root = os.path.abspath(args.root)
    ctx = Context(root, today)
    data = Data()

    if not os.path.isdir(root):
        ctx.add("", 0, "FILE_MISSING", "项目根不存在或不是目录：%s" % root)
        return 2, _payload(ctx.errors, ctx.warnings)

    for prefix, rel, header, id_column in LEDGER_SPECS:
        ledger = load_ledger(ctx, rel, header)
        if ledger is not None:
            data.ledgers[prefix] = ledger
            data.ids[prefix] = ledger.id_values(id_column)
    if ctx.ws.isfile(CASE_INFO):
        data.stages = load_ledger(ctx, CASE_INFO, STAGE_HEADER)
    data.meetings = _meeting_ids(ctx.ws)

    for check in CHECKS:
        check(ctx, data)

    code = 0
    if ctx.errors:
        code = 2
    elif ctx.warnings and getattr(args, "strict", False):
        code = 1
    return code, _payload(ctx.errors, ctx.warnings)


def _write_stream(stream, text):
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:
        try:
            stream.flush()
        except (AttributeError, ValueError):
            pass
        buffer.write(text.encode("utf-8"))
        buffer.flush()
    else:
        stream.write(text)


def emit(payload, as_json):
    if as_json:
        _write_stream(
            sys.stdout, json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        )
        return
    counts = payload["counts"]
    if payload["ok"]:
        _write_stream(
            sys.stdout,
            "校验通过：0 个错误，%d 个警告\n" % counts["warnings"],
        )
        return
    lines = ["校验发现问题：%d 个错误，%d 个警告" % (counts["errors"], counts["warnings"])]
    for item in payload["errors"]:
        location = item["file"] if not item["line"] else "%s:%d" % (item["file"], item["line"])
        lines.append("- [%s] %s %s" % (item["code"], location, item["message"]))
    _write_stream(sys.stderr, "\n".join(lines) + "\n")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="validate_case.py", description="校验案件工作区的台账、引用、编号与阶段"
    )
    parser.add_argument("--root", default=None, help="项目根，默认当前目录")
    parser.add_argument("--json", action="store_true", help="输出机器可解析 JSON")
    parser.add_argument(
        "--strict", action="store_true", help="警告也算失败（无错误时退出码 1）"
    )
    return parser


def main(argv=None):
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    if args.root is None:
        args.root = os.getcwd()

    try:
        code, payload = run(args)
    except Exception as exc:  # noqa: BLE001 - 内部异常统一转退出码 2
        payload = _payload(
            [
                {
                    "file": "",
                    "line": 0,
                    "code": "INTERNAL_ERROR",
                    "message": "%s: %s" % (type(exc).__name__, exc),
                }
            ],
            [],
        )
        code = 2

    emit(payload, args.json)
    return code


if __name__ == "__main__":
    sys.exit(main())
