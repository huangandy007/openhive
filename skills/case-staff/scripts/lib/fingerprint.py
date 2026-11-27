"""源版本指纹（data-model §5.2 / FR-071）。

规范化规则：
1. 只取表格**数据行**——跳过表头、分隔行、``<!-- AUTO:* -->`` 注释与空行；
2. 每行去首尾空白；表格行逐单元格去首尾空白并把连续空白压成一个空格；
3. 按**源顺序**用 ``\\n`` 拼接，末尾不加换行；
4. 取 ``sha256`` 的 16 位小写十六进制前缀。

「按源顺序」意味着同一批行换个顺序会得到不同指纹；同一输入重复计算结果稳定。
"""

import hashlib
import re

AUTO_COMMENT_RE = re.compile(r"<!--\s*AUTO:(?:BEGIN|END)\b")
SEPARATOR_RE = re.compile(r"^\|(?: *:?-+:? *\|)+$")
WHITESPACE_RE = re.compile(r"\s+")


def _is_table_row(stripped):
    return len(stripped) >= 2 and stripped[0] == "|" and stripped[-1] == "|"


def extract_data_rows(text):
    """从文档原文取表格数据行（保持源顺序、原始行文本）。"""
    lines = text.splitlines()
    rows = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if AUTO_COMMENT_RE.search(stripped):
            continue
        if SEPARATOR_RE.match(stripped):
            continue
        if not _is_table_row(stripped):
            continue
        if index + 1 < len(lines) and SEPARATOR_RE.match(lines[index + 1].strip()):
            continue  # 下一行是分隔行 ⇒ 本行是表头
        rows.append(line)
    return rows


def normalize_line(line):
    """规范化一行：去首尾空白、单元格内连续空白压成一个空格。"""
    stripped = line.strip()
    if _is_table_row(stripped):
        cells = [
            WHITESPACE_RE.sub(" ", cell.strip())
            for cell in stripped[1:-1].split("|")
        ]
        return "|" + "|".join(cells) + "|"
    return WHITESPACE_RE.sub(" ", stripped)


def source_digest(rows):
    """返回规范化后的 sha256 前 16 位小写十六进制。

    ``rows`` 可以是文档原文（str，自动抽取数据行），也可以是数据行字符串
    的可迭代对象（调用方已用 :func:`extract_data_rows` 抽好）。
    """
    if isinstance(rows, str):
        rows = extract_data_rows(rows)
    payload = "\n".join(normalize_line(row) for row in rows)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
