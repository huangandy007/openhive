"""Markdown 表格解析：表头 + 分隔行 + 数据行。

调用方给出期望表头时，只有**逐列相等**的表才算命中（``require_table``）；
找不到或用多个表匹配都抛 ``TableError``，不按列数 / 列集合 / 位置猜列序。

``parse_tables`` 跳过围栏代码块里的示例表，保证文档中的说明性代码不被当成数据。
"""

import re

SEPARATOR_RE = re.compile(r"^\|(?: *:?-+:? *\|)+$")
FENCE_RE = re.compile(r"^(?:```|~~~)")


class TableError(ValueError):
    """表格结构不合法，或期望表头与文档中的表不唯一匹配。"""


class Table(object):
    """一张解析后的表：``header`` 是列名元组，``rows`` 是行字典列表。"""

    __slots__ = ("header", "rows", "raw_rows")

    def __init__(self, header, raw_rows):
        self.header = tuple(header)
        self.raw_rows = [list(row) for row in raw_rows]
        self.rows = [dict(zip(self.header, row)) for row in self.raw_rows]

    def __repr__(self):
        return "Table(header=%r, rows=%d)" % (self.header, len(self.rows))


def split_cells(line):
    """返回 ``line`` 的单元格元组；不是以 ``|`` 包住的行则返回 ``None``。"""
    stripped = line.strip()
    if len(stripped) < 2 or stripped[0] != "|" or stripped[-1] != "|":
        return None
    return tuple(cell.strip() for cell in stripped[1:-1].split("|"))


def is_separator(line):
    """判断一行是否是 Markdown 表格分隔行（允许 ``:---:`` 对齐标记）。"""
    return bool(SEPARATOR_RE.match(line.strip()))


def parse_tables(text):
    """解析 ``text`` 中全部表格，按出现顺序返回 ``Table`` 列表。"""
    lines = text.splitlines()
    tables = []
    in_fence = False
    index = 0
    while index < len(lines):
        raw = lines[index]
        if FENCE_RE.match(raw.strip()):
            in_fence = not in_fence
            index += 1
            continue
        if in_fence:
            index += 1
            continue

        header = split_cells(raw)
        if header is None or index + 1 >= len(lines) or not is_separator(lines[index + 1]):
            index += 1
            continue

        separator = split_cells(lines[index + 1])
        if separator is None or len(separator) != len(header):
            raise TableError(
                "第 %d 行表头有 %d 列，分隔行有 %d 列"
                % (index + 1, len(header), 0 if separator is None else len(separator))
            )

        raw_rows = []
        cursor = index + 2
        while cursor < len(lines):
            cells = split_cells(lines[cursor])
            if cells is None:
                break
            if len(cells) != len(header):
                raise TableError(
                    "第 %d 行有 %d 列，表头 %r 有 %d 列"
                    % (cursor + 1, len(cells), header, len(header))
                )
            raw_rows.append(cells)
            cursor += 1

        tables.append(Table(header, raw_rows))
        index = cursor
    return tables


def find_table(text, header):
    """返回第一张表头逐列等于 ``header`` 的表；没有则返回 ``None``。"""
    expected = tuple(header)
    for table in parse_tables(text):
        if table.header == expected:
            return table
    return None


def require_table(text, header):
    """返回表头逐列等于 ``header`` 的唯一一张表；缺失或不唯一抛 ``TableError``。"""
    expected = tuple(header)
    tables = parse_tables(text)
    matches = [table for table in tables if table.header == expected]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise TableError(
            "找不到表头 %r；文档中的表头：%r"
            % (expected, [table.header for table in tables])
        )
    raise TableError("表头 %r 出现 %d 次，无法确定目标表" % (expected, len(matches)))


def parse_rows(text, header):
    """``require_table(...).rows`` 的便捷入口：返回行字典列表。"""
    return require_table(text, header).rows
