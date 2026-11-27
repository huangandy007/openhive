"""文档联动：台账变更 → 影响清单 + diff → 更新托管块（017-case-staff / FR-070 ~ FR-077）。

契约见 ``docs/superpowers/specs/017-case-staff/contracts/case-staff-commands.md`` §3，
数据模型见 ``docs/superpowers/specs/017-case-staff/data-model.md`` §3.8 / §5 / §6。

六条行为：

1. 读 ``文书/00-文书登记表.md``，逐行按 D 表「来源记录」算源版本指纹（§5.2）；
2. 指纹未变 ⇒ 跳过；变了 ⇒ 进「受影响」；
3. 非法律文档：重新生成托管块内容，``--apply`` 时**只替换块内**（``replace_block``），
   块外一字不动；
4. 法律文书（路径在 ``文书/报捕|起诉|内部审批/`` 下）：只出 ``建议`` 并在 D 表标
   ``待法制审核``，任何模式下都不写该文件；
5. 已签发 / 已发放 / ``*-发放版.md``：不改原文，只在 ``变更日志.md`` 追加一条
   （``备注`` 带源指纹，重复 apply 不重复追加）；
6. 托管块不配对 / 重名 / 嵌套：报错并**放弃全部写入**，不半写。

写入 D 表「源版本（指纹）」是幂等的关键：``--apply`` 成功后再次执行会命中「指纹未变」
而跳过。``--dry-run`` 只算不写。

只依赖 Python 3 标准库，不联网，不写项目根以外。退出码：``--dry-run`` 有待确认变更 → 1；
``--apply`` 成功 → 0；有 ``errors`` → 2；无变化 → 0。
"""

import argparse
import datetime
import difflib
import io
import json
import os
import re
import sys

# ``python -I``（隔离模式）不把脚本目录放进 sys.path；直接执行脚本时靠这一行
# 才能导入同目录的 ``lib/``。以 ``scripts.sync_docs`` 导入时首行即可命中。
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

try:
    from scripts.lib import blocks, fingerprint, tables
    from scripts import validate_case
except ImportError:  # 直接以脚本方式执行时 scripts 不是包
    from lib import blocks, fingerprint, tables
    import validate_case

# 台账路径 / 表头以校验器的常量为唯一出处，避免同一前提两处各写一份（#002-06）。
D_LEDGER = validate_case.D_LEDGER
D_HEADER = validate_case.D_HEADER
M_LEDGER = validate_case.M_LEDGER
M_HEADER = validate_case.M_HEADER
E_LEDGER = validate_case.E_LEDGER
E_HEADER = validate_case.E_HEADER
A_LEDGER = validate_case.A_LEDGER
A_HEADER = validate_case.A_HEADER
T_LEDGER = validate_case.T_LEDGER
T_HEADER = validate_case.T_HEADER
L_LEDGER = validate_case.L_LEDGER
L_HEADER = validate_case.L_HEADER
V_LEDGER = validate_case.V_LEDGER
V_HEADER = validate_case.V_HEADER
P_LEDGER = validate_case.P_LEDGER
P_HEADER = validate_case.P_HEADER

CHANGELOG = "变更日志.md"
CHANGELOG_HEADER = ("日期", "变更内容", "影响文件", "操作人", "备注")

# 抓捕筹备派生文档的固定路径（data-model §1.2 初始化产物）。
ARREST_DOC = "专案协同/07-抓捕筹备/00-抓捕对象清单.md"

# 法律文书按**路径目录**判定，不按文件名（FR-073）。
LEGAL_DIRS = ("文书/报捕/", "文书/起诉/", "文书/内部审批/")

# 已签发 / 已发放原文只读（FR-074）；发放版按文件名识别（data-model §4.1）。
ISSUED_STATUSES = ("已签发", "已发放")
ISSUED_NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-.+-发放版\.md$")

# D 表列下标。
D_PATH = 2
D_SOURCES = 3
D_STATUS = 5
D_FINGERPRINT = 6

# 源前缀 → (台账路径, 表头, 编号列)。
SOURCE_SPECS = {
    "M": (M_LEDGER, M_HEADER, "M编号"),
    "E": (E_LEDGER, E_HEADER, "E编号"),
    "A": (A_LEDGER, A_HEADER, "A编号"),
    "T": (T_LEDGER, T_HEADER, "T编号"),
    "L": (L_LEDGER, L_HEADER, "L编号"),
    "P": (P_LEDGER, P_HEADER, "P编号"),
    "V": (V_LEDGER, V_HEADER, "V编号"),
}

# 托管块表头（与 29 份模板逐列一致）。
ARREST_HEADER = (
    "序号", "P编号", "抓捕对象", "角色/层级", "涉嫌罪名", "主要证据",
    "抓捕单位", "抓捕人", "情报支撑", "技术支撑", "法制支撑", "风险",
)
PLAN_HEADER = ("要素", "内容", "负责人", "备注")
GROUP_HEADER = ("组别", "组长", "成员", "任务", "通信方式", "备注")
DISTRIBUTE_HEADER = (
    "序号", "资料名称", "发放对象", "份数", "发放人", "领取人签字", "发放时间", "备注",
)
TRACE_HEADER = ("溯源项", "内容")
AFTERCARE_HEADER = ("事项", "责任人", "期限", "状态", "产出 / 位置")

SOURCE_SPLIT_RE = re.compile(r"[、,，;；/\s]+")
ID_TOKEN_RE = re.compile(r"^([A-Z])(\d{3})$")
D_TOKEN_RE = re.compile(r"^D\d{3}$")
PREFIX_TOKEN_RE = re.compile(r"^[A-Z]$")


class SyncError(Exception):
    """单文档级错误：带稳定 code 与项目相对文件路径，由调用方汇总为 ``errors``。"""

    def __init__(self, code, message, file="", line=0):
        Exception.__init__(self, message)
        self.code = code
        self.message = message
        self.file = file
        self.line = line

    def as_error(self):
        return {
            "file": self.file,
            "line": self.line,
            "code": self.code,
            "message": self.message,
        }


def _read_text(path):
    with io.open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def _write_text(path, text):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with io.open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def _normalize_rel(raw):
    rel = (raw or "").replace("\\", "/").strip()
    while rel.startswith("./"):
        rel = rel[2:]
    return rel


def _resolve_inside(root, rel):
    """把项目相对路径解析成绝对路径；绝对路径 / ``..`` / 真实路径越界一律拒绝。"""
    if not rel:
        raise SyncError("PATH_MISSING", "D 表路径为空")
    if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel):
        raise SyncError("PATH_INVALID", "路径必须是项目相对路径：%s" % rel, file=rel)
    parts = rel.split("/")
    if ".." in parts:
        raise SyncError("PATH_INVALID", "路径不得包含 ..：%s" % rel, file=rel)
    full = os.path.realpath(os.path.join(root, *parts))
    real_root = os.path.realpath(root)
    if full != real_root and not full.startswith(real_root + os.sep):
        raise SyncError("PATH_INVALID", "路径越出项目根：%s" % rel, file=rel)
    return full


def _source_tokens(raw):
    return [token for token in SOURCE_SPLIT_RE.split((raw or "").strip()) if token]


def _serialize_row(cells):
    return "|" + "|".join(cells) + "|"


def _render_table(header, rows):
    """渲染与模板同形的表格：``| 列 | 列 |`` + ``|---|---|`` + 数据行。"""
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join("---" for _ in header) + "|",
    ]
    lines.extend("| " + " | ".join(cells) + " |" for cells in rows)
    return "\n".join(lines)


def _row_values(row, header):
    return [row.get(name, "") for name in header]


class Case(object):
    """项目根 + 台账文本缓存；同一文件在一次运行内只读一次。"""

    def __init__(self, root):
        self.root = root
        self._texts = {}
        self.d_rows = {}

    def path(self, rel):
        return _resolve_inside(self.root, rel)

    def text(self, rel):
        rel = _normalize_rel(rel)
        if rel not in self._texts:
            full = self.path(rel)
            if not os.path.isfile(full):
                raise SyncError("FILE_MISSING", "文件不存在：%s" % rel, file=rel)
            self._texts[rel] = _read_text(full)
        return self._texts[rel]

    def table_rows(self, rel, header):
        text = self.text(rel)
        try:
            return tables.require_table(text, header).rows
        except tables.TableError as exc:
            raise SyncError("TABLE_INVALID", str(exc), file=rel)


def _ledger_rows(ctx, rel, header):
    return ctx.table_rows(rel, header)


# --------------------------------------------------------------------------- #
# 源版本指纹（data-model §5.2）
# --------------------------------------------------------------------------- #


def _source_raw_rows(ctx, token):
    """返回一个源 token 的原始数据行（保持源顺序）。"""
    match = ID_TOKEN_RE.match(token)
    if match is not None:
        prefix = match.group(1)
        spec = SOURCE_SPECS.get(prefix)
        if spec is None:
            raise SyncError("SOURCE_UNKNOWN", "未知来源前缀：%s" % token)
        rel, header, id_column = spec
        try:
            table = tables.require_table(ctx.text(rel), header)
        except tables.TableError as exc:
            raise SyncError("TABLE_INVALID", str(exc), file=rel)
        index = table.header.index(id_column)
        rows = [
            raw for raw in table.raw_rows if raw[index].strip() == token
        ]
        if not rows:
            raise SyncError(
                "SOURCE_ROW_MISSING", "来源 %s 不在台账 %s" % (token, rel), file=rel
            )
        return rows

    if PREFIX_TOKEN_RE.match(token):
        spec = SOURCE_SPECS.get(token)
        if spec is None:
            raise SyncError("SOURCE_UNKNOWN", "未知来源前缀：%s" % token)
        rel, header, _ = spec
        try:
            return tables.require_table(ctx.text(rel), header).raw_rows
        except tables.TableError as exc:
            raise SyncError("TABLE_INVALID", str(exc), file=rel)

    if D_TOKEN_RE.match(token):
        row = ctx.d_rows.get(token)
        if row is None:
            raise SyncError("SOURCE_UNKNOWN", "D 表没有 %s" % token, file=D_LEDGER)
        rel = _normalize_rel(row.get("路径", ""))
        return fingerprint.extract_data_rows(ctx.text(rel))

    raise SyncError("SOURCE_UNKNOWN", "未知来源：%s" % token)


def _source_digest(ctx, raw_sources):
    lines = []
    for token in _source_tokens(raw_sources):
        for raw in _source_raw_rows(ctx, token):
            lines.append(_serialize_row(raw))
    return fingerprint.source_digest(lines)


def _source_covers(raw_sources, wanted):
    """``--source P001`` 命中 D 行：声明 ``P001`` 或前缀 ``P`` 都算覆盖。"""
    for token in _source_tokens(raw_sources):
        if token == wanted:
            return True
        if PREFIX_TOKEN_RE.match(token) and wanted.startswith(token):
            return True
    return False


# --------------------------------------------------------------------------- #
# 托管块渲染（data-model §5.3 的来源映射）
# --------------------------------------------------------------------------- #


def _block_rows(old_content, header, rel):
    try:
        return tables.require_table(old_content, header).rows
    except tables.TableError as exc:
        raise SyncError("BLOCK_INVALID", str(exc), file=rel)


def _arrest_rows(ctx):
    try:
        content = blocks.get_block(ctx.text(ARREST_DOC), "抓捕对象")
    except blocks.BlockError as exc:
        raise SyncError("BLOCK_INVALID", str(exc), file=ARREST_DOC)
    return _block_rows(content, ARREST_HEADER, ARREST_DOC)


def _render_arrest(ctx, drow, old_content):
    """人员台账 → 抓捕对象 12 列表；人工填的支撑 / 风险 / 罪名列原样保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    previous = {}
    for row in _block_rows(old_content, ARREST_HEADER, rel):
        pid = row["P编号"].strip()
        if pid:
            previous[pid] = row

    rows = []
    for index, person in enumerate(_ledger_rows(ctx, P_LEDGER, P_HEADER), 1):
        pid = person["P编号"].strip()
        if not pid:
            continue
        old = previous.get(pid, {})
        evidence = "、".join(re.findall(r"E\d{3}", person.get("关联L/E", "")))
        rows.append(
            [
                str(index),
                pid,
                person["姓名"].strip(),
                person["角色/层级"].strip(),
                old.get("涉嫌罪名", ""),
                evidence or old.get("主要证据", ""),
                old.get("抓捕单位", ""),
                old.get("抓捕人", ""),
                old.get("情报支撑", ""),
                old.get("技术支撑", ""),
                old.get("法制支撑", ""),
                old.get("风险", ""),
            ]
        )
    return _render_table(ARREST_HEADER, rows)


def _render_plan(ctx, drow, old_content):
    """抓捕对象清单的「抓捕单位」→ 抓捕方案「编组」一行；其余行原样保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    units = []
    for row in _arrest_rows(ctx):
        unit = row.get("抓捕单位", "").strip()
        if unit and unit not in units:
            units.append(unit)

    rows = []
    for row in _block_rows(old_content, PLAN_HEADER, rel):
        cells = _row_values(row, PLAN_HEADER)
        if cells[0].strip() == "编组" and units:
            cells[1] = "、".join(units)
        rows.append(cells)
    return _render_table(PLAN_HEADER, rows)


def _render_group(ctx, drow, old_content):
    """抓捕对象清单 → 编组保障：按抓捕单位分组；通信方式 / 备注人工列保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    previous = {}
    for row in _block_rows(old_content, GROUP_HEADER, rel):
        group = row["组别"].strip()
        if group:
            previous[group] = row

    groups = []
    members = {}
    for row in _arrest_rows(ctx):
        group = row.get("抓捕单位", "").strip() or "未编组"
        if group not in members:
            groups.append(group)
            members[group] = []
        members[group].append(row)

    rows = []
    for group in groups:
        people = members[group]
        leader = next(
            (person.get("抓捕人", "").strip() for person in people
             if person.get("抓捕人", "").strip()),
            "",
        )
        names = "、".join(
            person.get("抓捕对象", "").strip()
            for person in people
            if person.get("抓捕对象", "").strip()
        )
        old = previous.get(group, {})
        rows.append(
            [group, leader, names, "抓捕", old.get("通信方式", ""), old.get("备注", "")]
        )
    return _render_table(GROUP_HEADER, rows)


def _person_key(text):
    match = re.search(r"P\d{3}", text or "")
    return match.group(0) if match is not None else (text or "").strip()


def _render_distribute(ctx, drow, old_content):
    """抓捕对象清单 → 资料发放清单：一人一份「对象资料」；发放人工列保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    previous = {}
    for row in _block_rows(old_content, DISTRIBUTE_HEADER, rel):
        previous[_person_key(row["发放对象"])] = row

    rows = []
    for index, person in enumerate(_arrest_rows(ctx), 1):
        pid = person.get("P编号", "").strip()
        name = person.get("抓捕对象", "").strip()
        target = "%s(%s)" % (name, pid) if name and pid else (name or pid)
        old = previous.get(_person_key(target), {})
        rows.append(
            [
                str(index),
                "对象资料",
                target,
                old.get("份数", ""),
                old.get("发放人", ""),
                old.get("领取人签字", ""),
                old.get("发放时间", ""),
                old.get("备注", ""),
            ]
        )
    return _render_table(DISTRIBUTE_HEADER, rows)


def _first_id(drow, prefix):
    for token in _source_tokens(drow.get("来源记录", "")):
        match = ID_TOKEN_RE.match(token)
        if match is not None and match.group(1) == prefix:
            return token
    basename = os.path.basename(_normalize_rel(drow.get("路径", "")))
    match = re.match(r"^%s(\d{3})" % re.escape(prefix), basename)
    if match is not None:
        return "%s%s" % (prefix, match.group(1))
    return None


TRACE_FIELDS = (
    ("问题 / 假设", "主题/问题"),
    ("输入及用途", "输入E/F/A"),
    ("结论", "结论（事实说明什么）"),
    ("新线索", "新线索L"),
    ("置信度", "置信度"),
)


def _render_trace(ctx, drow, old_content):
    """研判索引 → 研判报告溯源块；推理链等人工/AI 叙述保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    aid = _first_id(drow, "A")
    if aid is None:
        raise SyncError("SOURCE_UNKNOWN", "无法确定研判编号", file=rel)
    source = None
    for row in _ledger_rows(ctx, A_LEDGER, A_HEADER):
        if row.get("A编号", "").strip() == aid:
            source = row
            break
    if source is None:
        raise SyncError("SOURCE_ROW_MISSING", "研判索引没有 %s" % aid, file=A_LEDGER)

    mapping = dict(TRACE_FIELDS)
    rows = []
    for row in _block_rows(old_content, TRACE_HEADER, rel):
        cells = _row_values(row, TRACE_HEADER)
        column = mapping.get(cells[0].strip())
        if column is not None:
            cells[1] = source.get(column, "")
        rows.append(cells)
    return _render_table(TRACE_HEADER, rows)


def _render_aftercare(ctx, drow, old_content):
    """任务台账 → 案后处理清单：把点名该 P 的任务补成事项；固定 10 项保留。"""
    rel = _normalize_rel(drow.get("路径", ""))
    pid = _first_id(drow, "P")
    if pid is None:
        raise SyncError("SOURCE_UNKNOWN", "无法确定人员编号", file=rel)

    rows = [_row_values(row, AFTERCARE_HEADER)
            for row in _block_rows(old_content, AFTERCARE_HEADER, rel)]
    existing = {cells[0].strip() for cells in rows}
    for task in _ledger_rows(ctx, T_LEDGER, T_HEADER):
        title = task.get("任务", "").strip()
        if not title or title in existing:
            continue
        if pid not in title and pid not in task.get("备注", ""):
            continue
        rows.append(
            [
                title,
                task.get("责任人", ""),
                task.get("期限", ""),
                task.get("状态", ""),
                task.get("备注", ""),
            ]
        )
        existing.add(title)
    return _render_table(AFTERCARE_HEADER, rows)


RENDERERS = {
    "抓捕对象": _render_arrest,
    "抓捕方案": _render_plan,
    "编组保障": _render_group,
    "资料发放": _render_distribute,
    "研判溯源": _render_trace,
    "案后处理": _render_aftercare,
}


# --------------------------------------------------------------------------- #
# 单文档计划
# --------------------------------------------------------------------------- #


def _is_legal(rel):
    return any(rel.startswith(prefix) for prefix in LEGAL_DIRS)


def _is_issued(rel, status):
    return status in ISSUED_STATUSES or bool(ISSUED_NAME_RE.match(os.path.basename(rel)))


def _diff(old_text, new_text, rel):
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    diff = difflib.unified_diff(old_lines, new_lines, fromfile=rel, tofile=rel, lineterm="")
    return "\n".join(diff)


def _plan_doc(ctx, drow, today):
    """算单个 D 行的处置；未变返回 ``None``，否则返回 outcome 字典。"""
    did = drow.get("D编号", "").strip()
    rel = _normalize_rel(drow.get("路径", ""))
    full = ctx.path(rel)
    if not os.path.isfile(full):
        raise SyncError("FILE_MISSING", "文书不存在：%s" % rel, file=rel)

    sources = drow.get("来源记录", "")
    if not _source_tokens(sources):
        return None
    new_digest = _source_digest(ctx, sources)
    old_digest = drow.get("源版本（指纹）", "").strip()
    if old_digest and old_digest == new_digest:
        return None

    status = drow.get("状态", "").strip()
    outcome = {
        "doc": did,
        "path": rel,
        "old_digest": old_digest,
        "new_digest": new_digest,
        "status": status,
        "new_fingerprint": new_digest,
        "new_status": None,
        "write_rel": None,
        "write_text": None,
        "affected": None,
        "suggestion": None,
        "changelog": None,
    }
    note = "待法制审核：来源 %s 指纹 %s → %s" % (
        sources.strip(),
        old_digest or "未记录",
        new_digest,
    )

    if _is_issued(rel, status):
        # FR-074 / FR-077：原文只读，只追加变更日志。
        outcome["changelog"] = {
            "doc": did,
            "path": rel,
            "fingerprint": new_digest,
            "line": [today, "源版本变化，原文不变", rel, "sync_docs.py", "源指纹 " + new_digest],
            "summary": "%s %s 发放版/已签发原文不变，变更记入变更日志" % (did, today),
        }
        if _is_legal(rel):
            outcome["suggestion"] = {"doc": did, "path": rel, "note": note}
        return outcome

    if _is_legal(rel):
        # FR-073：只出建议 + D 表标待法制审核，绝不写文书原文。
        outcome["suggestion"] = {"doc": did, "path": rel, "note": note}
        if status in ("", "草稿"):
            outcome["new_status"] = "待法制审核"
        return outcome

    old_text = ctx.text(rel)
    try:
        parsed = blocks.parse_blocks(old_text)
    except blocks.BlockError as exc:
        raise SyncError("BLOCK_INVALID", str(exc), file=rel)

    new_text = old_text
    changed = []
    for block in parsed:
        renderer = RENDERERS.get(block.name)
        if renderer is None:
            raise SyncError(
                "BLOCK_UNSUPPORTED", "不认识的托管块 %r" % block.name, file=rel
            )
        new_content = renderer(ctx, drow, block.content)
        if new_content == block.content:
            continue
        try:
            new_text = blocks.replace_block(new_text, block.name, new_content)
        except blocks.BlockError as exc:
            raise SyncError("BLOCK_INVALID", str(exc), file=rel)
        changed.append(block.name)

    if changed:
        outcome["affected"] = {
            "doc": did,
            "path": rel,
            "blocks": changed,
            "diff": _diff(old_text, new_text, rel),
        }
        outcome["write_rel"] = rel
        outcome["write_text"] = new_text
    return outcome


# --------------------------------------------------------------------------- #
# D 表 / 变更日志写回
# --------------------------------------------------------------------------- #


def _rewrite_d_table(text, updates):
    """按 D 编号改「状态」「源版本（指纹）」两列；其余字节原样保留。"""
    lines = text.splitlines(True)
    out = []
    index = 0
    header_seen = False
    while index < len(lines):
        cells = tables.split_cells(lines[index])
        if not header_seen:
            if (
                cells == D_HEADER
                and index + 1 < len(lines)
                and tables.is_separator(lines[index + 1])
            ):
                out.append(lines[index])
                out.append(lines[index + 1])
                index += 2
                header_seen = True
                while index < len(lines):
                    row_cells = tables.split_cells(lines[index])
                    if row_cells is None or tables.is_separator(lines[index]):
                        break
                    update = updates.get(row_cells[0].strip())
                    if update is None:
                        out.append(lines[index])
                    else:
                        changed = list(row_cells)
                        if update.get("fingerprint"):
                            changed[D_FINGERPRINT] = update["fingerprint"]
                        if update.get("status"):
                            changed[D_STATUS] = update["status"]
                        newline = "\r\n" if lines[index].endswith("\r\n") else "\n"
                        out.append("| " + " | ".join(changed) + " |" + newline)
                    index += 1
                continue
            out.append(lines[index])
            index += 1
            continue
        out.append(lines[index])
        index += 1
    if not header_seen:
        raise SyncError("TABLE_INVALID", "找不到文书登记表表头", file=D_LEDGER)
    return "".join(out)


def _changelog_rows(text):
    try:
        return tables.require_table(text, CHANGELOG_HEADER).rows
    except tables.TableError as exc:
        raise SyncError("TABLE_INVALID", str(exc), file=CHANGELOG)


def _changelog_has(rows, rel, fingerprint):
    for row in rows:
        if row.get("影响文件", "").strip() != rel:
            continue
        if fingerprint in row.get("备注", ""):
            return True
    return False


def _append_changelog_row(text, row):
    """把一行追加到变更日志表格末尾（表格之后若还有正文，插在正文前）。"""
    lines = text.splitlines(True)
    out = []
    index = 0
    inserted = False
    while index < len(lines):
        cells = tables.split_cells(lines[index])
        if (
            not inserted
            and cells == CHANGELOG_HEADER
            and index + 1 < len(lines)
            and tables.is_separator(lines[index + 1])
        ):
            out.append(lines[index])
            out.append(lines[index + 1])
            index += 2
            while index < len(lines):
                data_cells = tables.split_cells(lines[index])
                if data_cells is None or tables.is_separator(lines[index]):
                    break
                out.append(lines[index])
                index += 1
            newline = "\r\n" if out[-1].endswith("\r\n") else "\n"
            if not out[-1].endswith(("\n", "\r")):
                out[-1] += newline
            out.append("| " + " | ".join(row) + " |" + newline)
            inserted = True
            continue
        out.append(lines[index])
        index += 1
    if not inserted:
        raise SyncError("TABLE_INVALID", "找不到变更日志表头", file=CHANGELOG)
    return "".join(out)


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #


def _payload(ok, dry_run, affected, suggestions, changelog, errors):
    return {
        "ok": ok,
        "dry_run": dry_run,
        "affected": affected,
        "suggestions": suggestions,
        "changelog": changelog,
        "errors": sorted(errors, key=lambda item: (
            item["file"], item["line"], item["code"], item["message"]
        )),
    }


def run(args, today=None):
    root = os.path.abspath(args.root)
    today = today or datetime.date.today().isoformat()
    dry_run = bool(getattr(args, "dry_run", False))

    errors = []
    affected = []
    suggestions = []
    changelog = []

    if not os.path.isdir(root):
        errors.append({
            "file": "",
            "line": 0,
            "code": "FILE_MISSING",
            "message": "项目根不存在或不是目录：%s" % root,
        })
        return 2, _payload(False, dry_run, affected, suggestions, changelog, errors)

    ctx = Case(root)
    try:
        d_text = ctx.text(D_LEDGER)
        d_rows = tables.parse_rows(d_text, D_HEADER)
    except SyncError as exc:
        errors.append(exc.as_error())
        return 2, _payload(False, dry_run, affected, suggestions, changelog, errors)
    except tables.TableError as exc:
        errors.append({
            "file": D_LEDGER,
            "line": 0,
            "code": "TABLE_INVALID",
            "message": str(exc),
        })
        return 2, _payload(False, dry_run, affected, suggestions, changelog, errors)

    ctx.d_rows = {row.get("D编号", "").strip(): row for row in d_rows}

    selected = []
    wanted_doc = (getattr(args, "doc", None) or "").strip()
    wanted_source = (getattr(args, "source", None) or "").strip()
    for row in d_rows:
        if wanted_doc and row.get("D编号", "").strip() != wanted_doc:
            continue
        if wanted_source and not _source_covers(row.get("来源记录", ""), wanted_source):
            continue
        selected.append(row)
    if wanted_doc and not selected:
        errors.append({
            "file": D_LEDGER,
            "line": 0,
            "code": "DOC_NOT_FOUND",
            "message": "文书登记表没有 %s" % wanted_doc,
        })
        return 2, _payload(False, dry_run, affected, suggestions, changelog, errors)

    updates = {}
    changelog_rows_to_add = []
    changelog_seen = set()
    changelog_rows = None
    doc_writes = {}

    for row in selected:
        try:
            outcome = _plan_doc(ctx, row, today)
        except SyncError as exc:
            errors.append(exc.as_error())
            continue
        if outcome is None:
            continue

        did = outcome["doc"]
        update = {}
        if outcome["new_fingerprint"] != outcome["old_digest"]:
            update["fingerprint"] = outcome["new_fingerprint"]
        if outcome["new_status"]:
            update["status"] = outcome["new_status"]
        if update:
            updates[did] = update

        if outcome["affected"]:
            affected.append(outcome["affected"])
        if outcome["suggestion"]:
            suggestions.append(outcome["suggestion"])
        if outcome["changelog"]:
            entry = outcome["changelog"]
            if changelog_rows is None:
                try:
                    changelog_rows = _changelog_rows(ctx.text(CHANGELOG))
                except SyncError as exc:
                    errors.append(exc.as_error())
                    continue
            if _changelog_has(changelog_rows, entry["path"], entry["fingerprint"]):
                continue
            key = (entry["path"], entry["fingerprint"])
            if key in changelog_seen:
                continue
            changelog_seen.add(key)
            changelog.append(entry["summary"])
            changelog_rows_to_add.append(entry)
        if outcome["write_rel"]:
            doc_writes[outcome["write_rel"]] = outcome["write_text"]

    if errors:
        return 2, _payload(False, dry_run, affected, suggestions, changelog, errors)

    if not dry_run and args.apply:
        for rel, text in doc_writes.items():
            _write_text(ctx.path(rel), text)

        if changelog_rows_to_add:
            try:
                log_text = ctx.text(CHANGELOG)
                existing = _changelog_rows(log_text)
            except SyncError as exc:
                return 2, _payload(False, dry_run, affected, suggestions, changelog,
                                   [exc.as_error()])
            for entry in changelog_rows_to_add:
                if _changelog_has(existing, entry["path"], entry["fingerprint"]):
                    continue
                log_text = _append_changelog_row(log_text, entry["line"])
                existing = _changelog_rows(log_text)
            if log_text != ctx.text(CHANGELOG):
                _write_text(ctx.path(CHANGELOG), log_text)

        if updates:
            try:
                new_d_text = _rewrite_d_table(ctx.text(D_LEDGER), updates)
            except SyncError as exc:
                return 2, _payload(False, dry_run, affected, suggestions, changelog,
                                   [exc.as_error()])
            if new_d_text != ctx.text(D_LEDGER):
                _write_text(ctx.path(D_LEDGER), new_d_text)

    if dry_run and (affected or suggestions or changelog):
        code = 1
    else:
        code = 0
    return code, _payload(True, dry_run, affected, suggestions, changelog, errors)


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
    lines = []
    if payload["dry_run"]:
        lines.append(
            "预演：受影响 %d 项，建议 %d 项，变更日志 %d 条"
            % (len(payload["affected"]), len(payload["suggestions"]),
               len(payload["changelog"]))
        )
    else:
        lines.append(
            "已应用：更新 %d 项，建议 %d 项，变更日志 %d 条"
            % (len(payload["affected"]), len(payload["suggestions"]),
               len(payload["changelog"]))
        )
    for item in payload["affected"]:
        lines.append("- 受影响 %s %s（块：%s）" % (
            item["doc"], item["path"], "、".join(item["blocks"])))
    for item in payload["suggestions"]:
        lines.append("- 建议 %s %s：%s" % (item["doc"], item["path"], item["note"]))
    for item in payload["changelog"]:
        lines.append("- 变更日志：%s" % item)
    if lines:
        _write_stream(sys.stdout, "\n".join(lines) + "\n")
    if payload["errors"]:
        error_lines = ["发现 %d 个错误：" % len(payload["errors"])]
        for item in payload["errors"]:
            error_lines.append("- [%s] %s %s" % (
                item["code"], item["file"], item["message"]))
        _write_stream(sys.stderr, "\n".join(error_lines) + "\n")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="sync_docs.py", description="台账变更 → 影响清单与托管块更新"
    )
    parser.add_argument("--root", default=None, help="项目根，默认当前目录")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="只算影响清单与 diff，不写盘")
    mode.add_argument("--apply", action="store_true", help="应用非法律文档的托管块更新")
    parser.add_argument("--doc", default=None, help="只处理某个 D 编号")
    parser.add_argument("--source", default=None, help="只处理某个源（如 P001）")
    parser.add_argument("--json", action="store_true", help="输出机器可解析 JSON")
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
            False,
            bool(getattr(args, "dry_run", False)),
            [],
            [],
            [],
            [{
                "file": "",
                "line": 0,
                "code": "INTERNAL_ERROR",
                "message": "%s: %s" % (type(exc).__name__, exc),
            }],
        )
        code = 2

    emit(payload, args.json)
    return code


if __name__ == "__main__":
    sys.exit(main())
