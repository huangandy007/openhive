"""生成指挥员一页协同台账（017-case-staff / FR-084 / US6-7）。

契约见 ``docs/superpowers/specs/017-case-staff/contracts/case-staff-commands.md`` §4，
数据模型见 ``docs/superpowers/specs/017-case-staff/data-model.md`` §3.12 / §6.3 / §7：
``专案协同/00-协同台账.md`` 是**派生视图**，整文件重生，固定六段（顺序固定）：

1. 新增线索 —— 线索台账中状态为「待核查」的条目（尚未进入核查；规范未定义日期窗口，
   故不引入「最近 N 天」之类的自创口径）；
2. 待办与逾期任务 —— 任务台账中 `待办` / `进行中` 的条目，逾期标记直接复用
   ``validate_case.check_overdue`` 的判据（期限早于基准日；`当日` / `持续` / 空 /
   非法日期不参与）；
3. 待决策 —— 阶段看板「阻塞或风险」列非空的阶段（需要指挥员协调 / 拍板）；
4. 风险 —— 阶段看板状态为 `受阻` / `退回` 的阶段；
5. 收网准备度 —— 阶段看板「收网抓捕」行的状态；
6. 待归档与待归类积压 —— 直接复用 ``validate_case.check_backlog`` 产出的警告
   （收件箱文件 / 状态 `待归类` 的 M 行 / 原始记录缺「已整理」标记）。

只读约束（TR-006）：除看板文件外不写任何文件；读取失败或表格解析失败退出码 2，
**不写半份**（先在内存拼好整份，再原子替换）。

只依赖 Python 3 标准库，不联网，不写项目根以外。
"""

import argparse
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tempfile

# ``python -I``（隔离模式）不把脚本目录放进 sys.path；直接执行脚本时靠这一行
# 才能导入同目录的 ``lib/`` 与 ``validate_case``。以 ``scripts.digest`` 导入时首行即可命中。
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

try:
    from scripts.lib import constants
    from scripts import validate_case
except ImportError:  # 直接以脚本方式执行时 scripts 不是包
    from lib import constants
    import validate_case

DASHBOARD = "专案协同/00-协同台账.md"

# 台账路径 / 表头以校验器为唯一出处，避免同一前提两处各写一份（#002-06）。
CASE_INFO = validate_case.CASE_INFO
L_LEDGER = validate_case.L_LEDGER
L_HEADER = validate_case.L_HEADER
T_LEDGER = validate_case.T_LEDGER
T_HEADER = validate_case.T_HEADER
M_LEDGER = validate_case.M_LEDGER
M_HEADER = validate_case.M_HEADER
STAGE_HEADER = validate_case.STAGE_HEADER

# 从 data-model §9 的单一字面量表派生，不另写一份状态清单。
NEW_CLUE_STATUSES = tuple(status for status in constants.L_STATUSES if status in ("待核查",))
BLOCKED_STAGE_STATUSES = tuple(
    status for status in constants.STAGE_STATUSES if status in ("受阻", "退回")
)
SEND_OFF_STAGE = "收网抓捕"

ID_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


def _natural_key(value):
    """编号按前缀 + 数值排序，保证输出稳定（L2 与 L010 不会颠倒）。"""
    match = ID_RE.match(value or "")
    if match is None:
        return (value or "", 0)
    return (match.group(1), int(match.group(2)))


def _cell(value):
    """表格单元格：去掉换行、转义 ``|``，避免破坏表格结构。"""
    text = "" if value is None else str(value)
    return text.replace("\r", " ").replace("\n", " ").replace("|", "\\|").strip()


def _table(header, rows):
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join(["---"] * len(header)) + "|",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_cell(value) for value in row) + " |")
    return lines


def _section(title, body):
    lines = ["## " + title, ""]
    lines.extend(body if body else ["无"])
    lines.append("")
    return lines


def _load_sources(vctx):
    """读取 L / T / M / 阶段看板；返回 ``(ledgers, stages)``，错误记进 ``vctx``。"""
    ledgers = {}
    for prefix, rel, header in (
        ("L", L_LEDGER, L_HEADER),
        ("T", T_LEDGER, T_HEADER),
        ("M", M_LEDGER, M_HEADER),
    ):
        ledger = validate_case.load_ledger(vctx, rel, header)
        if ledger is not None:
            ledgers[prefix] = ledger
        elif not vctx.ws.isfile(rel):
            vctx.add(rel, 0, "FILE_MISSING", "缺少看板数据源：%s" % rel)

    stages = validate_case.load_ledger(vctx, CASE_INFO, STAGE_HEADER)
    if stages is None and not vctx.ws.isfile(CASE_INFO):
        vctx.add(CASE_INFO, 0, "FILE_MISSING", "缺少看板数据源：%s" % CASE_INFO)
    return ledgers, stages


def _entry_id(entry, column):
    return entry.row.get(column, "").strip()


def _collect(ledgers, stages, vctx):
    """按六段口径汇总数据；逾期与积压复用校验器的判据。"""
    clue_ledger = ledgers.get("L")
    task_ledger = ledgers.get("T")

    new_clues = []
    if clue_ledger is not None:
        new_clues = [
            entry
            for entry in clue_ledger.entries
            if _entry_id(entry, L_HEADER[0])
            and entry.row.get("状态", "").strip() in NEW_CLUE_STATUSES
        ]
    new_clues.sort(key=lambda entry: _natural_key(_entry_id(entry, L_HEADER[0])))

    open_tasks = []
    if task_ledger is not None:
        open_tasks = [
            entry
            for entry in task_ledger.entries
            if _entry_id(entry, T_HEADER[0])
            and entry.row.get("状态", "").strip() in constants.T_OPEN_STATUSES
        ]
    open_tasks.sort(key=lambda entry: _natural_key(_entry_id(entry, T_HEADER[0])))

    # 逾期 / 积压：直接跑校验器的检查函数，判据只有一份（#002-06）。
    data = validate_case.Data()
    data.ledgers.update(ledgers)
    validate_case.check_overdue(vctx, data)
    validate_case.check_backlog(vctx, data)

    overdue_lines = set()
    backlog_items = []
    for warning in vctx.warnings:
        if warning["code"] == "T_OVERDUE" and warning["file"] == T_LEDGER:
            overdue_lines.add(warning["line"])
        elif warning["code"] == "M_PENDING":
            backlog_items.append(warning)
    backlog_items.sort(
        key=lambda item: (item["file"], item["line"], item["message"])
    )

    decisions = []
    risks = []
    send_off = None
    if stages is not None:
        for entry in stages.entries:
            stage = entry.row.get("阶段", "").strip()
            if not stage:
                continue
            status = entry.row.get("状态", "").strip()
            risk = entry.row.get("阻塞或风险", "").strip()
            if stage == SEND_OFF_STAGE:
                send_off = status
            if risk:
                decisions.append(
                    (
                        stage,
                        status,
                        risk,
                        entry.row.get("负责人", ""),
                        entry.row.get("下一步", ""),
                    )
                )
            if status in BLOCKED_STAGE_STATUSES:
                risks.append(
                    (
                        stage,
                        status,
                        entry.row.get("下一步", ""),
                        entry.row.get("负责人", ""),
                    )
                )
    if send_off is None and stages is not None:
        vctx.add(CASE_INFO, 0, "STAGE_MISSING", "阶段看板缺少「%s」行" % SEND_OFF_STAGE)

    return {
        "new_clues": new_clues,
        "open_tasks": open_tasks,
        "overdue_lines": overdue_lines,
        "backlog_items": backlog_items,
        "decisions": decisions,
        "risks": risks,
        "send_off": send_off,
    }


def _render(date_text, collected):
    lines = [
        "# 协同台账",
        "",
        "> 指挥员视图，由 `scripts/digest.py` 生成，整文件重生，请勿手改。",
        "> 基准日：%s" % date_text,
        "",
    ]
    lines.extend(
        _section(
            "新增线索",
            _table(
                ("L编号", "发现日期", "线索内容", "来源", "下一步"),
                [
                    (
                        _entry_id(entry, L_HEADER[0]),
                        entry.row.get("发现日期", ""),
                        entry.row.get("线索内容", ""),
                        entry.row.get("来源", ""),
                        entry.row.get("下一步", ""),
                    )
                    for entry in collected["new_clues"]
                ],
            )
            if collected["new_clues"]
            else [],
        )
    )
    lines.extend(
        _section(
            "待办与逾期任务",
            _table(
                ("T编号", "任务", "责任人", "期限", "状态", "逾期"),
                [
                    (
                        _entry_id(entry, T_HEADER[0]),
                        entry.row.get("任务", ""),
                        entry.row.get("责任人", ""),
                        entry.row.get("期限", ""),
                        entry.row.get("状态", ""),
                        "是" if entry.line in collected["overdue_lines"] else "否",
                    )
                    for entry in collected["open_tasks"]
                ],
            )
            if collected["open_tasks"]
            else [],
        )
    )
    lines.extend(
        _section(
            "待决策",
            _table(
                ("阶段", "状态", "阻塞或风险", "负责人", "下一步"),
                collected["decisions"],
            )
            if collected["decisions"]
            else [],
        )
    )
    lines.extend(
        _section(
            "风险",
            _table(("阶段", "状态", "下一步", "负责人"), collected["risks"])
            if collected["risks"]
            else [],
        )
    )
    send_off = collected["send_off"]
    lines.extend(
        _section(
            "收网准备度",
            ["收网抓捕阶段状态：%s" % ("" if send_off is None else send_off)],
        )
    )
    backlog = []
    for item in collected["backlog_items"]:
        location = item["file"]
        if location and item["line"]:
            location = "%s:%d" % (location, item["line"])
        backlog.append(
            "- %s" % (("%s：%s" % (location, item["message"])) if location else item["message"])
        )
    lines.extend(_section("待归档与待归类积压", backlog))
    return "\n".join(lines).rstrip("\n") + "\n"


def _atomic_write(path, text):
    """先写同目录临时文件，再 ``os.replace``；任何异常都清掉临时文件。"""
    directory = os.path.dirname(path)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".00-协同台账.", suffix=".tmp", dir=directory
    )
    try:
        with io.open(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _open_path(path):
    """用系统默认程序打开；失败抛异常，由调用方降级为警告。"""
    if os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def _error_payload(date_text, errors):
    return {"ok": False, "path": DASHBOARD, "date": date_text, "errors": errors}


def run(args, today=None):
    """返回 ``(退出码, payload)``；成功时已原子写好看板。"""
    root = os.path.abspath(args.root)
    date_text = None
    if today is not None:
        base_date = today
        date_text = base_date.isoformat()
    else:
        raw_date = getattr(args, "date", None)
        if raw_date is None:
            base_date = datetime.date.today()
            date_text = base_date.isoformat()
        else:
            base_date = validate_case._parse_date(raw_date)
            date_text = raw_date
            if base_date is None:
                return 2, _error_payload(
                    date_text,
                    [
                        {
                            "file": "",
                            "line": 0,
                            "code": "DATE_INVALID",
                            "message": "--date 需为 YYYY-MM-DD：%r" % raw_date,
                        }
                    ],
                )

    if not os.path.isdir(root):
        return 2, _error_payload(
            date_text,
            [
                {
                    "file": "",
                    "line": 0,
                    "code": "FILE_MISSING",
                    "message": "项目根不存在或不是目录：%s" % root,
                }
            ],
        )

    vctx = validate_case.Context(root, base_date)
    ledgers, stages = _load_sources(vctx)
    collected = _collect(ledgers, stages, vctx)

    if vctx.errors:
        return 2, _error_payload(date_text, validate_case._sorted(vctx.errors))

    target = os.path.join(root, *DASHBOARD.split("/"))
    if not os.path.isdir(os.path.dirname(target)):
        return 2, _error_payload(
            date_text,
            [
                {
                    "file": DASHBOARD,
                    "line": 0,
                    "code": "FILE_MISSING",
                    "message": "缺少目录：专案协同",
                }
            ],
        )

    sections = {
        "新增线索": len(collected["new_clues"]),
        "逾期任务": len(collected["overdue_lines"]),
        "待决策": len(collected["decisions"]),
        "风险": len(collected["risks"]),
        "收网准备度": collected["send_off"],
        "积压": len(collected["backlog_items"]),
    }
    content = _render(date_text, collected)
    _atomic_write(target, content)
    return 0, {
        "ok": True,
        "path": DASHBOARD,
        "date": date_text,
        "sections": sections,
    }


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
    if payload.get("ok"):
        sections = payload["sections"]
        _write_stream(
            sys.stdout,
            "协同台账已生成：%s（基准日 %s）\n"
            "新增线索 %d / 逾期任务 %d / 待决策 %d / 风险 %d / 收网准备度 %s / 积压 %d\n"
            % (
                payload["path"],
                payload["date"],
                sections["新增线索"],
                sections["逾期任务"],
                sections["待决策"],
                sections["风险"],
                sections["收网准备度"],
                sections["积压"],
            ),
        )
        return
    _write_stream(sys.stderr, "看板生成失败（退出码 2）\n")
    for item in payload.get("errors", []):
        _write_stream(
            sys.stderr,
            "- [%s] %s %s\n" % (item["code"], item["file"], item["message"]),
        )


def build_parser():
    parser = argparse.ArgumentParser(
        prog="digest.py", description="生成指挥员一页协同台账（整文件重生）"
    )
    parser.add_argument("--root", default=None, help="项目根，默认当前目录")
    parser.add_argument(
        "--date", default=None, help="统计基准日 YYYY-MM-DD，默认今天"
    )
    parser.add_argument(
        "--open", action="store_true", help="生成后用系统默认程序打开（失败只警告）"
    )
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
        payload = _error_payload(
            getattr(args, "date", None) or "",
            [
                {
                    "file": "",
                    "line": 0,
                    "code": "INTERNAL_ERROR",
                    "message": "%s: %s" % (type(exc).__name__, exc),
                }
            ],
        )
        code = 2

    if code == 0 and getattr(args, "open", False):
        target = os.path.abspath(os.path.join(args.root, *DASHBOARD.split("/")))
        try:
            _open_path(target)
        except Exception as exc:  # noqa: BLE001 - 打开失败只警告
            _write_stream(sys.stderr, "警告：无法打开 %s（%s）\n" % (DASHBOARD, exc))

    emit(payload, getattr(args, "json", False))
    return code


if __name__ == "__main__":
    sys.exit(main())
