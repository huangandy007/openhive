"""编号分配：同前缀 max+1，至少三位零填充。

纯函数 ``next_id`` 只负责从一段文本取号；``allocate_id`` 把「写入前重读」
（FR-042 / TR-008 第二对）固化成两次读取：

1. 第一次读文件取号（调用方用于预演 / 占位）；
2. 写入前**重读**同一文件再取一次，以第二次结果为准——外部线程在这期间
   追加的行会被看见，避免撞号。
"""

import re

ID_PREFIXES = ("M", "E", "F", "A", "L", "V", "T", "C", "P", "O", "D")


def next_id(prefix, text):
    """返回 ``prefix`` 的下一个编号（文本内同前缀最大数字 + 1）。

    ``prefix`` 必须是 ``ID_PREFIXES`` 之一，否则抛 ``ValueError``。
    编号至少三位（``M001``）；超过 999 自然增长为四位（``M1000``）。
    """
    if prefix not in ID_PREFIXES:
        raise ValueError("未知编号前缀：%r" % (prefix,))
    pattern = re.compile(
        r"(?<![A-Za-z0-9])%s(\d{3,})(?!\d)" % re.escape(prefix)
    )
    numbers = [int(match.group(1)) for match in pattern.finditer(text)]
    return "%s%03d" % (prefix, max(numbers) + 1 if numbers else 1)


def allocate_id(prefix, read_text):
    """取号并在写入前重读再取一次，返回以第二次读取为准的编号。

    ``read_text`` 是一个无参可调用对象，每次调用都应重新读取当前文件内容
    （不能缓存）。中间若被外部追加了行，返回值会跳过新占用号。
    """
    _first = next_id(prefix, read_text())  # 首次读：调用方预演 / 占位
    return next_id(prefix, read_text())  # 写入前重读：以这次结果为准
