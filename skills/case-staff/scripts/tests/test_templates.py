"""29 份案件工作区模板（T002）的结构测试。

断言对象是「结构」而不是文案（TR-011）：
- ``assets/`` 精确是 29 份 ``*.template.md``（22 份初始化 + 7 份按需）；
- 每份 UTF-8、无 BOM、非空、有且仅有一个 H1；
- 关键表头逐列精确相等（列序、标点、全半角都钉住）；
- 四段式日报、溯源块九项、抓捕对象 12 列、D 表 9 列、阶段看板 8 列；
- 托管块 ``<!-- AUTO:BEGIN 名称 -->`` / ``<!-- AUTO:END 名称 -->`` 成对存在；
- 所有 Markdown 表格的分隔行与数据行列数必须与表头一致。

「文件集合」用精确集合比较（#006-22），
「不应存在」用布尔比较而不是只读起来像断言的形式（#013-12）。
"""

import os
import re
import unittest

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")

# data-model §1.2：初始化时写盘的 22 份模板。
INIT_TEMPLATES = {
    "案件信息.template.md",
    "AGENTS.template.md",
    "变更日志.template.md",
    "材料登记表.template.md",
    "证据索引.template.md",
    "研判-README.template.md",
    "研判索引.template.md",
    "专案协同-README.template.md",
    "任务台账.template.md",
    "线索台账.template.md",
    "印证台账.template.md",
    "人员台账.template.md",
    "组织架构.template.md",
    "抓捕对象清单.template.md",
    "抓捕方案.template.md",
    "编组与保障.template.md",
    "资料发放清单.template.md",
    "收网记录.template.md",
    "讯问计划.template.md",
    "文书登记表.template.md",
    "法律适用-README.template.md",
    "法律适用-索引.template.md",
}

# data-model §1.2 末尾：只做模板、初始化不写盘的 7 份。
ON_DEMAND_TEMPLATES = {
    "研判报告.template.md",
    "每日动态.template.md",
    "会议纪要.template.md",
    "沟通记录.template.md",
    "案后处理清单.template.md",
    "移送前自检清单.template.md",
    "本案适用分析.template.md",
}

EXPECTED_TEMPLATES = INIT_TEMPLATES | ON_DEMAND_TEMPLATES

# 表头逐列精确比较。来源：data-model §3（编号即为规范出处）。
EXPECTED_HEADERS = {
    "材料登记表.template.md": (
        "M编号", "原文件名", "当前路径", "材料类型",
        "上传时间", "关联E", "状态", "备注",
    ),
    "证据索引.template.md": (
        "E编号", "法定种类", "证据名称", "来源M", "提取人", "提取时间",
        "提取地点", "保管链", "证明内容", "待证事实", "证明力/局限",
        "印证证据", "原件/介质存放地", "哈希/校验", "风险标记", "状态",
        "确认人", "确认时间",
    ),
    "研判索引.template.md": (
        "A编号", "日期", "主题/问题", "输入E/F/A", "推理摘要",
        "结论（事实说明什么）", "新线索L", "置信度", "状态",
        "产出/下一步", "复核人",
    ),
    "任务台账.template.md": (
        "T编号", "任务", "责任人", "期限", "状态", "来源", "反馈", "备注",
    ),
    "线索台账.template.md": (
        "L编号", "发现日期", "线索内容", "来源", "状态", "下一步",
        "转研判A", "备注",
    ),
    "印证台账.template.md": (
        "V编号", "日期", "对应L", "核实内容", "结果", "依据E", "回写", "备注",
    ),
    "人员台账.template.md": (
        "P编号", "姓名", "身份", "角色/层级", "单位", "状态", "关联L/E", "备注",
    ),
    "组织架构.template.md": (
        "O编号", "名称", "类型", "上级O", "涉及人员P", "备注",
    ),
    "抓捕对象清单.template.md": (
        "序号", "P编号", "抓捕对象", "角色/层级", "涉嫌罪名", "主要证据",
        "抓捕单位", "抓捕人", "情报支撑", "技术支撑", "法制支撑", "风险",
    ),
    "文书登记表.template.md": (
        "D编号", "文档", "路径", "来源记录", "模板", "状态",
        "源版本（指纹）", "复核人", "复核时间",
    ),
    "法律适用-索引.template.md": (
        "序号", "名称", "文号/条文号", "版本", "生效日期",
        "来源", "效力", "所在目录", "用途",
    ),
    "案后处理清单.template.md": (
        "事项", "责任人", "期限", "状态", "产出 / 位置",
    ),
}

STAGE_BOARD_HEADER = (
    "阶段", "状态", "开始日期", "法定期限或节点", "负责人",
    "下一步", "阻塞或风险", "完成标志",
)

STAGES = (
    "分析研判", "调查取证", "沟通对接", "落地侦查",
    "收网抓捕", "询问讯问", "报捕起诉",
)

STAGE_STATUSES = {"未开始", "进行中", "已完成", "受阻", "退回"}

F_LIST_COLUMNS = (
    "F编号", "待证事实", "对应构成要件/情节", "覆盖E", "状态", "备注",
)

TRACE_BLOCK = "研判溯源"
TRACE_TABLE_HEADER = ("溯源项", "内容")
TRACE_ITEMS = (
    "问题 / 假设",
    "输入及用途",
    "推理链",
    "替代假设与排除理由",
    "结论",
    "新线索",
    "置信度",
    "反证 / 矛盾",
    "修订记录",
)

ARREST_BLOCK = "抓捕对象"

# data-model §5.3：六份派生文档各有一个托管块，块名固定。
MANAGED_BLOCKS = {
    "抓捕对象清单.template.md": "抓捕对象",
    "抓捕方案.template.md": "抓捕方案",
    "编组与保障.template.md": "编组保障",
    "资料发放清单.template.md": "资料发放",
    "研判报告.template.md": "研判溯源",
    "案后处理清单.template.md": "案后处理",
}

ACTION_ELEMENTS = (
    "行动时间", "行动地点", "编组", "通信",
    "车辆", "押解", "看管", "应急处置",
)

AFTER_ARREST_ITEMS = (
    "到案经过",
    "人身检查 / 体检",
    "第一次讯问",
    "讯问笔录 / 录音录像",
    "扣押 / 提取",
    "物证 / 电子数据固定",
    "拘留证 / 通知书",
    "家属通知",
    "送押 / 涉案财物",
    "后续补证 / 在逃",
)

SEPARATOR = re.compile(r"^\|(?: *:?-+:? *\|)+$")
NUMBERING = re.compile(r"^\d+[.、]\s*")
LEGAL_ARTICLE = re.compile(r"第\s*\d+\s*条")


def _asset_path(name):
    return os.path.join(ASSETS_DIR, name)


def _require_assets_dir():
    if not os.path.isdir(ASSETS_DIR):
        raise AssertionError("assets 目录不存在：%s" % ASSETS_DIR)


def _read_bytes(name):
    _require_assets_dir()
    with open(_asset_path(name), "rb") as handle:
        return handle.read()


def _read(name):
    return _read_bytes(name).decode("utf-8")


def _cells(line):
    stripped = line.strip()
    if len(stripped) < 2 or stripped[0] != "|" or stripped[-1] != "|":
        return None
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def _table_blocks(text):
    """返回 [(表头单元格, 分隔行单元格, [数据行单元格...]), ...]。"""
    lines = text.splitlines()
    blocks = []
    index = 0
    while index < len(lines):
        header = _cells(lines[index])
        if header is None or index + 1 >= len(lines):
            index += 1
            continue
        separator = _cells(lines[index + 1])
        if separator is None or not SEPARATOR.match(lines[index + 1].strip()):
            index += 1
            continue
        rows = []
        cursor = index + 2
        while cursor < len(lines):
            row = _cells(lines[cursor])
            if row is None:
                break
            rows.append(row)
            cursor += 1
        blocks.append((header, separator, rows))
        index = cursor
    return blocks


def _table_after_header(text, header):
    for found_header, _separator, rows in _table_blocks(text):
        if tuple(found_header) == tuple(header):
            return rows
    return None


def _headings(text, level=2):
    prefix = "#" * level + " "
    headings = []
    in_fence = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith(prefix):
            headings.append(NUMBERING.sub("", stripped[len(prefix):].strip()))
    return headings


def _section_text(text, heading):
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if line.strip() == "## " + heading:
            start = index + 1
            break
    if start is None:
        raise AssertionError("找不到小节：%s" % heading)
    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].strip().startswith("## "):
            end = index
            break
    return "\n".join(lines[start:end])


def _block_text(text, name):
    begin = "<!-- AUTO:BEGIN %s -->" % name
    end = "<!-- AUTO:END %s -->" % name
    lines = text.splitlines()
    begin_indexes = [index for index, line in enumerate(lines) if line.strip() == begin]
    end_indexes = [index for index, line in enumerate(lines) if line.strip() == end]
    if len(begin_indexes) != 1 or len(end_indexes) != 1:
        raise AssertionError(
            "托管块 %s 必须各出现一次，实得 BEGIN=%d END=%d"
            % (name, len(begin_indexes), len(end_indexes))
        )
    if begin_indexes[0] >= end_indexes[0]:
        raise AssertionError("托管块 %s 的 BEGIN 在 END 之后" % name)
    return "\n".join(lines[begin_indexes[0] + 1:end_indexes[0]])


class TemplateSetTest(unittest.TestCase):
    def test_assets_contains_exactly_the_29_templates(self):
        _require_assets_dir()
        self.assertEqual(EXPECTED_TEMPLATES, set(os.listdir(ASSETS_DIR)))

    def test_templates_partition_into_22_init_and_7_on_demand(self):
        self.assertEqual(22, len(INIT_TEMPLATES))
        self.assertEqual(7, len(ON_DEMAND_TEMPLATES))
        self.assertEqual(set(), INIT_TEMPLATES & ON_DEMAND_TEMPLATES)
        self.assertEqual(EXPECTED_TEMPLATES, INIT_TEMPLATES | ON_DEMAND_TEMPLATES)

    def test_every_template_is_utf8_without_bom_and_has_one_h1(self):
        for name in sorted(EXPECTED_TEMPLATES):
            with self.subTest(template=name):
                data = _read_bytes(name)
                self.assertEqual(False, data.startswith(b"\xef\xbb\xbf"), "%s 带 BOM" % name)
                text = data.decode("utf-8")
                self.assertTrue(text.strip(), "%s 为空" % name)
                h1 = [line for line in text.splitlines() if line.startswith("# ")]
                self.assertEqual(1, len(h1), "%s 的 H1 数量" % name)

    def test_templates_do_not_embed_legal_article_text(self):
        for name in sorted(EXPECTED_TEMPLATES):
            with self.subTest(template=name):
                text = _read(name)
                self.assertEqual(
                    False,
                    bool(LEGAL_ARTICLE.search(text)),
                    "%s 含法律条文正文：%r" % (name, LEGAL_ARTICLE.search(text)),
                )


class TableHeaderTest(unittest.TestCase):
    def test_key_table_headers_are_exact(self):
        for name in sorted(EXPECTED_HEADERS):
            with self.subTest(template=name):
                expected = EXPECTED_HEADERS[name]
                headers = [tuple(header) for header, _sep, _rows in _table_blocks(_read(name))]
                self.assertEqual(1, headers.count(expected), "%s 的表头不唯一或缺失" % name)

    def test_all_tables_have_consistent_column_counts(self):
        for name in sorted(EXPECTED_TEMPLATES):
            with self.subTest(template=name):
                for header, separator, rows in _table_blocks(_read(name)):
                    self.assertEqual(len(header), len(separator), "%s 分隔行列数" % name)
                    for row in rows:
                        self.assertEqual(len(header), len(row), "%s 数据行列数：%r" % (name, row))


class ManagedBlockTest(unittest.TestCase):
    def test_all_six_managed_blocks_exist_and_hold_one_table(self):
        for name, block_name in sorted(MANAGED_BLOCKS.items()):
            with self.subTest(template=name):
                block = _block_text(_read(name), block_name)
                self.assertEqual(1, len(_table_blocks(block)), "%s 的托管块内应恰好一张表" % name)


class CaseInfoTest(unittest.TestCase):
    def test_case_info_has_the_three_managed_sections(self):
        headings = _headings(_read("案件信息.template.md"))
        self.assertEqual({"基本信息", "阶段看板", "F 清单（默认关闭）"}, set(headings))

    def test_stage_board_has_eight_columns_and_seven_stages(self):
        text = _read("案件信息.template.md")
        rows = _table_after_header(text, STAGE_BOARD_HEADER)
        self.assertIsNotNone(rows, "找不到阶段看板表头")
        self.assertEqual(len(STAGES), len(rows))
        self.assertEqual(STAGES, tuple(row[0] for row in rows))
        for row in rows:
            self.assertIn(row[1], STAGE_STATUSES, "阶段状态越界：%r" % row)

    def test_f_list_is_closed_by_default_but_keeps_its_schema(self):
        text = _read("案件信息.template.md")
        section = _section_text(text, "F 清单（默认关闭）")
        for column in F_LIST_COLUMNS:
            self.assertIn(column, section, "F 清单缺列名：%s" % column)
        self.assertEqual(
            False,
            "| F编号" in section,
            "F 清单默认关闭时不应出现可解析的表头",
        )


class DailyReportTest(unittest.TestCase):
    def test_daily_report_has_exactly_the_four_sections(self):
        headings = _headings(_read("每日动态.template.md"))
        self.assertEqual({"今日工作", "发现", "问题", "明日计划"}, set(headings))

    def test_meeting_minutes_have_four_sections_plus_decisions(self):
        headings = _headings(_read("会议纪要.template.md"))
        self.assertEqual(
            {"今日工作", "发现", "问题", "明日计划", "议定事项与责任人"},
            set(headings),
        )


class ResearchReportTest(unittest.TestCase):
    def test_trace_block_has_the_nine_items_in_order(self):
        text = _read("研判报告.template.md")
        block = _block_text(text, TRACE_BLOCK)
        rows = _table_after_header(block, TRACE_TABLE_HEADER)
        self.assertIsNotNone(rows, "溯源块里找不到表头")
        self.assertEqual(TRACE_ITEMS, tuple(row[0] for row in rows))


class ArrestPreparationTest(unittest.TestCase):
    def test_arrest_list_has_twelve_columns_inside_its_block(self):
        text = _read("抓捕对象清单.template.md")
        block = _block_text(text, ARREST_BLOCK)
        rows = _table_after_header(block, EXPECTED_HEADERS["抓捕对象清单.template.md"])
        self.assertIsNotNone(rows, "抓捕对象主表不在托管块内")
        self.assertEqual(12, len(EXPECTED_HEADERS["抓捕对象清单.template.md"]))

    def test_arrest_plan_covers_all_action_elements(self):
        text = _read("抓捕方案.template.md")
        block = _block_text(text, "抓捕方案")
        rows = _table_after_header(block, ("要素", "内容", "负责人", "备注"))
        self.assertIsNotNone(rows, "抓捕方案要素表缺失")
        self.assertEqual(set(ACTION_ELEMENTS), {row[0] for row in rows})

    def test_grouping_has_the_four_sections_and_support_roles(self):
        text = _read("编组与保障.template.md")
        self.assertEqual({"编组", "保障", "通信与口令", "应急"}, set(_headings(text)))
        rows = _table_after_header(
            text, ("保障类型", "负责人", "人员/装备", "对接方式", "备注")
        )
        self.assertIsNotNone(rows, "保障表缺失")
        self.assertEqual(
            {"情报支撑", "技术支撑", "法制支撑", "车辆与押解", "看管与送押"},
            {row[0] for row in rows},
        )

    def test_after_arrest_checklist_has_ten_items_inside_its_block(self):
        text = _read("案后处理清单.template.md")
        block = _block_text(text, "案后处理")
        rows = _table_after_header(block, EXPECTED_HEADERS["案后处理清单.template.md"])
        self.assertIsNotNone(rows, "案后处理表不在托管块内")
        self.assertEqual(AFTER_ARREST_ITEMS, tuple(row[0] for row in rows))
        for row in rows:
            allowed = row[2] in {"当日", "法定时限", "持续"} or bool(
                re.match(r"^\d{4}-\d{2}-\d{2}$", row[2])
            )
            self.assertEqual(True, allowed, "期限越界：%r" % row)


class TransferChecklistTest(unittest.TestCase):
    def test_transfer_checklist_has_the_five_groups(self):
        headings = _headings(_read("移送前自检清单.template.md"))
        self.assertEqual({"文书", "证据", "手续", "涉案财物", "在逃人员"}, set(headings))


if __name__ == "__main__":
    unittest.main()
