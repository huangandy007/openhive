"""托管块解析与替换（data-model §5.1 / FR-071）。

只认显式注释：

    <!-- AUTO:BEGIN 名称 -->
    …由台账生成的内容…
    <!-- AUTO:END 名称 -->

硬规则：名称非空白且同文件唯一；BEGIN/END 成对、名称一致、顺序正确；
不许嵌套。任何违反都抛 ``BlockError``，由调用方转成退出码 2，不半写。
"""

import re

BEGIN_RE = re.compile(r"^<!--\s*AUTO:BEGIN\s+(\S+)\s*-->$")
END_RE = re.compile(r"^<!--\s*AUTO:END\s+(\S+)\s*-->$")


class BlockError(ValueError):
    """托管块语法错误（不配对 / 重名 / 嵌套 / 名称不一致）。"""


class Block(object):
    """一个托管块：``content`` 是两行注释之间的原文（不含首尾换行）。"""

    __slots__ = ("name", "content", "begin_line", "end_line")

    def __init__(self, name, content, begin_line, end_line):
        self.name = name
        self.content = content
        self.begin_line = begin_line
        self.end_line = end_line

    def __repr__(self):
        return "Block(name=%r, lines=%d-%d)" % (
            self.name,
            self.begin_line + 1,
            self.end_line + 1,
        )


def parse_blocks(text):
    """解析全部托管块并校验；有语法错误抛 ``BlockError``。"""
    lines = text.splitlines()
    blocks = []
    seen = set()
    open_name = None
    open_line = None

    for index, line in enumerate(lines):
        stripped = line.strip()
        begin = BEGIN_RE.match(stripped)
        end = END_RE.match(stripped)

        if begin is not None:
            name = begin.group(1)
            if open_name is not None:
                raise BlockError(
                    "第 %d 行托管块 %r 嵌套在第 %d 行的 %r 内"
                    % (index + 1, name, open_line + 1, open_name)
                )
            if name in seen:
                raise BlockError("第 %d 行托管块 %r 重复" % (index + 1, name))
            open_name = name
            open_line = index
        elif end is not None:
            name = end.group(1)
            if open_name is None:
                raise BlockError("第 %d 行 END %r 没有对应的 BEGIN" % (index + 1, name))
            if name != open_name:
                raise BlockError(
                    "第 %d 行 END %r 与第 %d 行 BEGIN %r 不配对"
                    % (index + 1, name, open_line + 1, open_name)
                )
            blocks.append(
                Block(
                    name,
                    "\n".join(lines[open_line + 1:index]),
                    open_line,
                    index,
                )
            )
            seen.add(name)
            open_name = None
            open_line = None

    if open_name is not None:
        raise BlockError("第 %d 行 BEGIN %r 没有对应的 END" % (open_line + 1, open_name))
    return blocks


def get_block(text, name):
    """返回名为 ``name`` 的块内容；没有该块抛 ``BlockError``。"""
    for block in parse_blocks(text):
        if block.name == name:
            return block.content
    raise BlockError("找不到托管块 %r" % (name,))


def replace_block(text, name, content):
    """只替换 ``name`` 块内内容，块外（含换行风格与末尾换行）保持不变。"""
    matches = [block for block in parse_blocks(text) if block.name == name]
    if len(matches) != 1:
        raise BlockError("托管块 %r 匹配到 %d 个" % (name, len(matches)))
    block = matches[0]
    lines = text.splitlines(True)
    newline = "\r\n" if "\r\n" in text else "\n"
    replacement = [part + newline for part in content.splitlines()] if content else []
    return "".join(lines[:block.begin_line + 1] + replacement + lines[block.end_line:])
