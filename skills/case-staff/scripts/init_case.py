"""在目标项目内建案件工作区（017-case-staff / FR-001 ~ FR-011）。

契约见 ``docs/superpowers/specs/017-case-staff/contracts/case-staff-commands.md`` §1，
精确清单见 ``docs/superpowers/specs/017-case-staff/data-model.md`` §1：

- 39 个目录、22 份模板文件、27 份 ``.gitkeep``（合计 49 个文件）；
- 只把新建 ``案件信息.md`` 中的 ``{{案名}}`` / ``{{案号}}`` 替换成入参，其余模板原样复制；
- 幂等：已存在文件一律保留、不覆盖，第二次运行 ``created_*`` 为空；
- 预检失败（退出码 1）与 ``--dry-run`` 都**磁盘零改动**；内部异常退出码 2；
- ``--json`` 只向 stdout 打一个 JSON 对象，日志走 stderr；路径一律项目相对、``/`` 分隔、字典序。

只依赖 Python 3 标准库，不联网，不写项目根以外。
"""

import argparse
import json
import os
import re
import stat
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")

# data-model §1.1：39 个目录（父目录与子目录都列）。
DIRECTORIES = (
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
)

# data-model §1.2：初始化写盘的 22 份模板（目标路径，模板文件名）。
TEMPLATE_FILES = (
    ("案件信息.md", "案件信息.template.md"),
    ("AGENTS.md", "AGENTS.template.md"),
    ("变更日志.md", "变更日志.template.md"),
    ("材料/00-材料登记表.md", "材料登记表.template.md"),
    ("证据/证据索引.md", "证据索引.template.md"),
    ("研判/README.md", "研判-README.template.md"),
    ("研判/00-研判索引.md", "研判索引.template.md"),
    ("专案协同/README.md", "专案协同-README.template.md"),
    ("专案协同/03-任务盯办/00-任务台账.md", "任务台账.template.md"),
    ("专案协同/04-线索流转/00-线索台账.md", "线索台账.template.md"),
    ("专案协同/05-印证核实/00-印证台账.md", "印证台账.template.md"),
    ("专案协同/06-人员与组织/00-人员台账.md", "人员台账.template.md"),
    ("专案协同/06-人员与组织/01-组织架构.md", "组织架构.template.md"),
    ("专案协同/07-抓捕筹备/00-抓捕对象清单.md", "抓捕对象清单.template.md"),
    ("专案协同/07-抓捕筹备/01-抓捕方案.md", "抓捕方案.template.md"),
    ("专案协同/07-抓捕筹备/02-编组与保障.md", "编组与保障.template.md"),
    ("专案协同/07-抓捕筹备/03-资料发放清单.md", "资料发放清单.template.md"),
    ("侦查/收网抓捕/00-收网记录.md", "收网记录.template.md"),
    ("侦查/询问讯问/00-讯问计划.md", "讯问计划.template.md"),
    ("文书/00-文书登记表.md", "文书登记表.template.md"),
    ("法律适用/README.md", "法律适用-README.template.md"),
    ("法律适用/00-索引.md", "法律适用-索引.template.md"),
)

# data-model §1.3：27 个初始化后为空的叶子目录（各放一个空 ``.gitkeep``）。
GITKEEP_DIRECTORIES = (
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
)

TEMPLATE_BY_TARGET = dict(TEMPLATE_FILES)
GITKEEP_FILES = tuple(directory + "/.gitkeep" for directory in GITKEEP_DIRECTORIES)

CASE_INFO_FILE = "案件信息.md"
AGENTS_FILE = "AGENTS.md"
WORKSPACE_MARKERS = (CASE_INFO_FILE, AGENTS_FILE)

# 项目基础项：这些顶层条目不视为「无关文件」；其余以 ``.`` 开头的顶层条目也算本机配置。
PROJECT_BASE_ENTRIES = (".git", ".gitignore", ".opencode", "opencode.json")

ILLEGAL_NAME_CHARS = '/\\:*?"<>|'
RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL"]
    + ["COM%d" % index for index in range(1, 10)]
    + ["LPT%d" % index for index in range(1, 10)]
)

PLACEHOLDER_PATTERN = re.compile(r"\{\{(案名|案号)\}\}")

_FILE_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class InitError(Exception):
    """可预期的执行期错误（模板缺失等），由 ``main`` 转成退出码 2。"""


def _project_path(root, relative):
    return os.path.join(root, *relative.split("/"))


def _is_project_base_entry(name):
    if name in PROJECT_BASE_ENTRIES:
        return True
    return name.startswith(".")


def _is_link_like(path):
    """符号链接或 Windows junction / 其他 reparse point（fail-closed）。"""
    try:
        info = os.lstat(path)
    except OSError:
        return False
    if stat.S_ISLNK(info.st_mode):
        return True
    attributes = getattr(info, "st_file_attributes", 0)
    return bool(attributes & _FILE_REPARSE_POINT)


def _is_within(root_real, target_real):
    try:
        common = os.path.commonpath([root_real, target_real])
    except ValueError:
        return False
    return os.path.normcase(common) == root_real


def find_symlinks_outside(root):
    """递归（不跟随链接）找出解析目标落在项目根之外的链接，返回项目相对路径。"""
    root_real = os.path.normcase(os.path.realpath(root))
    found = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            names = sorted(os.listdir(current))
        except OSError:
            continue
        for name in names:
            full = os.path.join(current, name)
            if _is_link_like(full):
                target_real = os.path.normcase(os.path.realpath(full))
                if not _is_within(root_real, target_real):
                    found.append(os.path.relpath(full, root).replace(os.sep, "/"))
            elif os.path.isdir(full):
                stack.append(full)
    return sorted(found)


def _validate_value(value, code):
    """校验案名 / 案号：路径分隔符、win32 非法字符、控制字符、首尾空格或点、保留名。"""
    problems = []
    if any(character in ILLEGAL_NAME_CHARS for character in value):
        problems.append("含路径分隔符或 win32 非法字符")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        problems.append("含控制字符")
    if value[:1] in (" ", ".") or value[-1:] in (" ", "."):
        problems.append("不得以空格或点开头/结尾")
    base = value.split(".", 1)[0].rstrip(" ").upper()
    if base in RESERVED_NAMES:
        problems.append("是 win32 保留名")
    if not problems:
        return []
    return ["%s: 值 %r 非法（%s）" % (code, value, "；".join(problems))]


def precheck(root, case_name, case_no):
    """返回 (errors, mode)；mode 为 ``fresh`` / ``workspace``。"""
    if not os.path.exists(root):
        return ["ROOT_MISSING: 项目根不存在：%s" % root], "fresh"
    if not os.path.isdir(root):
        return ["ROOT_NOT_DIR: 项目根不是目录：%s" % root], "fresh"

    errors = []
    if not os.access(root, os.W_OK):
        errors.append("ROOT_NOT_WRITABLE: 项目根不可写：%s" % root)
    try:
        entries = sorted(os.listdir(root))
    except OSError as exc:
        errors.append("ROOT_UNREADABLE: 无法读取项目根：%s（%s）" % (root, exc))
        return errors, "fresh"

    for relative in find_symlinks_outside(root):
        errors.append("SYMLINK_OUTSIDE: 链接指向项目根之外：%s" % relative)

    has_case_info = os.path.isfile(os.path.join(root, CASE_INFO_FILE))
    has_agents = os.path.isfile(os.path.join(root, AGENTS_FILE))
    if has_case_info and has_agents:
        mode = "workspace"
    elif has_case_info or has_agents:
        mode = "workspace"
        present = CASE_INFO_FILE if has_case_info else AGENTS_FILE
        missing = AGENTS_FILE if has_case_info else CASE_INFO_FILE
        errors.append(
            "WORKSPACE_INCOMPLETE: 只存在 %s、缺少 %s，疑似半套工作区，拒绝写入"
            % (present, missing)
        )
    else:
        mode = "fresh"
        unrelated = [name for name in entries if not _is_project_base_entry(name)]
        if unrelated:
            errors.append(
                "UNRELATED_ENTRY: 目标目录含无关条目：%s" % "、".join(unrelated)
            )

    if mode == "fresh" and not case_name:
        errors.append("CASE_NAME_MISSING: 新建案件工作区必须提供 --case-name")
    elif case_name:
        errors.extend(_validate_value(case_name, "CASE_NAME_ILLEGAL"))
    if case_no:
        errors.extend(_validate_value(case_no, "CASE_NO_ILLEGAL"))

    return errors, mode


def build_plan(root):
    """计算将创建 / 将保留的清单；返回 (created_dirs, created_files, kept_files, conflicts)。"""
    created_directories = []
    conflicts = []
    for relative in DIRECTORIES:
        full = _project_path(root, relative)
        if os.path.isdir(full):
            continue
        if os.path.lexists(full):
            conflicts.append("PATH_CONFLICT: 目录位置已被非目录占用：%s" % relative)
            continue
        created_directories.append(relative)

    created_files = []
    kept_files = []
    for relative in tuple(TEMPLATE_BY_TARGET) + GITKEEP_FILES:
        full = _project_path(root, relative)
        if os.path.isdir(full):
            conflicts.append("PATH_CONFLICT: 文件位置被目录占用：%s" % relative)
            continue
        if os.path.lexists(full):
            kept_files.append(relative)
            continue
        created_files.append(relative)

    return created_directories, created_files, kept_files, conflicts


def _check_templates(created_files):
    missing = []
    for relative in created_files:
        template = TEMPLATE_BY_TARGET.get(relative)
        if template is None:
            continue
        if not os.path.isfile(os.path.join(ASSETS_DIR, template)):
            missing.append(template)
    if missing:
        raise InitError("模板缺失：%s" % "、".join(sorted(set(missing))))


def _read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def _write_bytes(path, data):
    with open(path, "xb") as handle:
        handle.write(data)


def apply_plan(root, created_directories, created_files, case_name, case_no):
    for relative in sorted(created_directories, key=lambda item: (item.count("/"), item)):
        os.makedirs(_project_path(root, relative), exist_ok=True)

    values = {"案名": case_name or "", "案号": case_no or ""}
    for relative in sorted(created_files):
        full = _project_path(root, relative)
        parent = os.path.dirname(full)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
        if relative.endswith("/.gitkeep"):
            data = b""
        else:
            template = TEMPLATE_BY_TARGET[relative]
            data = _read_bytes(os.path.join(ASSETS_DIR, template))
            if relative == CASE_INFO_FILE:
                text = data.decode("utf-8")
                text = PLACEHOLDER_PATTERN.sub(
                    lambda match: values[match.group(1)], text
                )
                data = text.encode("utf-8")
        _write_bytes(full, data)


def _payload(ok, root, dry_run, created_directories, created_files, kept_files,
             warnings, errors):
    return {
        "ok": ok,
        "root": root,
        "dry_run": dry_run,
        "created_directories": list(created_directories),
        "created_files": list(created_files),
        "kept_files": list(kept_files),
        "warnings": list(warnings),
        "errors": list(errors),
    }


def run(args):
    root = os.path.abspath(args.root)
    dry_run = bool(args.dry_run)
    case_name = args.case_name
    case_no = args.case_no

    errors, mode = precheck(root, case_name, case_no)
    if errors:
        return 1, _payload(False, root, dry_run, [], [], [], [], errors)

    created_directories, created_files, kept_files, conflicts = build_plan(root)
    if conflicts:
        return 1, _payload(False, root, dry_run, [], [], [], [], conflicts)

    _check_templates(created_files)

    if not dry_run:
        apply_plan(root, created_directories, created_files, case_name, case_no)

    return 0, _payload(
        True,
        root,
        dry_run,
        sorted(created_directories),
        sorted(created_files),
        sorted(kept_files),
        [],
        [],
    )


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
    if payload["ok"]:
        title = "预演完成（未写盘）" if payload["dry_run"] else "案件工作区初始化完成"
        lines = [
            title,
            "根目录：%s" % payload["root"],
            "新建目录：%d 个" % len(payload["created_directories"]),
            "新建文件：%d 个" % len(payload["created_files"]),
            "保留文件：%d 个" % len(payload["kept_files"]),
        ]
        if payload["warnings"]:
            lines.append("警告：")
            lines.extend("- " + item for item in payload["warnings"])
        _write_stream(sys.stdout, "\n".join(lines) + "\n")
    else:
        lines = ["初始化失败（磁盘未改动）"]
        lines.extend("- " + item for item in payload["errors"])
        _write_stream(sys.stderr, "\n".join(lines) + "\n")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="init_case.py", description="在目标项目内建案件工作区（幂等、非覆盖）"
    )
    parser.add_argument("--root", default=None, help="项目根，默认当前目录")
    parser.add_argument("--case-name", default=None, help="案件名称")
    parser.add_argument("--case-no", default=None, help="案号，可空")
    parser.add_argument(
        "--dry-run", action="store_true", help="只预演，不写盘"
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
        payload = _payload(
            False,
            os.path.abspath(args.root),
            bool(args.dry_run),
            [],
            [],
            [],
            [],
            ["INTERNAL_ERROR: %s: %s" % (type(exc).__name__, exc)],
        )
        code = 2

    emit(payload, args.json)
    return code


if __name__ == "__main__":
    sys.exit(main())
