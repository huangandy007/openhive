"""状态字面量常量（``scripts/lib/constants.py``）与模板实际字面量的防漂移测试。

data-model §9「状态字面量总表」要求常量在 ``constants.py`` **各一份**，模板与校验器
引用同一份。本文件把每个域与 ``assets/`` 下模板里实际写出的字面量逐项精确比对
（元组相等 ⇒ 值、个数与展示顺序都钉住）：

- 12 个域能直接从 29 份模板里取到原文（含默认关闭的 F 清单——它的状态写在
  小节说明里，不是可解析表格）；
- 「平台解析状态」是**只读**域，模板明确要求「不抄进来」，``assets/`` 里一个都不
  出现；因此该域断言两件事：常量等于 data-model §9 的六个值，且模板里确实没有
  任何一个是伪造进来的。

比对失败的提示会带上模板文件与整行原文，便于定位漂移。
"""

import os
import unittest

from scripts.lib import constants

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")
REFERENCES_DIR = os.path.join(SKILL_DIR, "references")

# 常量属性 -> (模板文件, 该行包含的标签)。标签之后的「甲 / 乙 / 丙」即模板字面量。
DOMAIN_SOURCES = {
    "M_STATUSES": ("材料登记表.template.md", "状态只取："),
    "E_LEGAL_KINDS": ("证据索引.template.md", "法定种类："),
    "E_STATUSES": ("证据索引.template.md", "状态："),
    "A_STATUSES": ("研判索引.template.md", "状态五档："),
    "A_CONFIDENCES": ("研判索引.template.md", "置信度："),
    "F_STATUSES": ("案件信息.template.md", "状态只取 "),
    "L_STATUSES": ("线索台账.template.md", "状态："),
    "V_RESULTS": ("印证台账.template.md", "结果："),
    "T_STATUSES": ("任务台账.template.md", "状态："),
    "P_STATUSES": ("人员台账.template.md", "状态："),
    "D_STATUSES": ("文书登记表.template.md", "状态："),
    "STAGE_STATUSES": ("案件信息.template.md", "状态只取："),
}

# data-model §9 的第六个只读域；模板里禁止出现这些值。
PLATFORM_PARSE_STATUSES = (
    "未入队",
    "排队中",
    "解析中",
    "已解析",
    "有问题",
    "已跳过",
)


def _read(skill_relative):
    with open(os.path.join(SKILL_DIR, skill_relative), "r", encoding="utf-8") as handle:
        return handle.read()


def _line_containing(skill_relative, needle):
    for line in _read(skill_relative).splitlines():
        if needle in line:
            return line
    raise AssertionError("%s 中找不到含「%s」的行" % (skill_relative, needle))


def _literals(line, label, stop_chars=("；", "。")):
    rest = line[line.index(label) + len(label):]
    for char in stop_chars:
        position = rest.find(char)
        if position != -1:
            rest = rest[:position]
    parts = [part.strip().strip("`").strip() for part in rest.split("/")]
    return tuple(part for part in parts if part)


class StatusDomainTest(unittest.TestCase):
    def test_all_thirteen_data_model_domains_are_compared(self):
        # §9 共 13 个域：12 个从模板取值 + 1 个只读的平台解析状态。
        self.assertEqual(13, len(DOMAIN_SOURCES) + 1)
        for attribute in list(DOMAIN_SOURCES) + ["PLATFORM_PARSE_STATUSES"]:
            with self.subTest(domain=attribute):
                self.assertEqual(True, hasattr(constants, attribute), attribute)

    def test_every_domain_is_an_ordered_tuple_without_duplicates(self):
        for attribute in DOMAIN_SOURCES:
            with self.subTest(domain=attribute):
                value = getattr(constants, attribute)
                self.assertEqual(True, isinstance(value, tuple), attribute)
                self.assertEqual(True, len(value) > 0, attribute)
                self.assertEqual(len(value), len(set(value)), "%s 有重复字面量" % attribute)

    def test_each_domain_equals_the_literals_written_in_its_template(self):
        for attribute, (template, label) in DOMAIN_SOURCES.items():
            with self.subTest(domain=attribute):
                line = _line_containing(os.path.join("assets", template), label)
                self.assertEqual(
                    _literals(line, label),
                    getattr(constants, attribute),
                    "%s 与 %s 不一致：%r" % (attribute, template, line),
                )

    def test_f_list_is_closed_but_its_status_literals_still_match(self):
        # 案件信息 的 F 小节默认关闭（表头不可解析），字面量只写在小节说明里；
        # 该域比对的是说明行，不是伪造一张表。
        self.assertEqual(("未覆盖", "部分覆盖", "已覆盖"), constants.F_STATUSES)
        self.assertEqual(False, "| F编号" in _read(os.path.join("assets", "案件信息.template.md")))

    def test_platform_parse_statuses_are_spec_only_and_never_copied_into_templates(self):
        # data-model §9 的只读域：材料登记表 明确「平台解析状态不抄进来」。
        # 模板里一个都不出现，所以这里只能比对「常量 == §9 六个值」+「模板里没有」。
        self.assertEqual(PLATFORM_PARSE_STATUSES, constants.PLATFORM_PARSE_STATUSES)
        for name in sorted(os.listdir(ASSETS_DIR)):
            if not name.endswith(".template.md"):
                continue
            text = _read(os.path.join("assets", name))
            for value in PLATFORM_PARSE_STATUSES:
                with self.subTest(template=name, literal=value):
                    self.assertEqual(
                        False,
                        value in text,
                        "%s 不应内嵌平台解析状态「%s」" % (name, value),
                    )


class DerivedStatusTest(unittest.TestCase):
    def test_overdue_is_derived_and_never_a_writable_t_status(self):
        self.assertEqual(False, "逾期" in constants.T_STATUSES)
        self.assertEqual(("逾期",), constants.T_DERIVED_STATUSES)


class NamingConstantsTest(unittest.TestCase):
    def test_forbidden_filename_words_match_the_naming_reference(self):
        label = "禁用词（不得出现在我方新建文件名中）："
        line = _line_containing(os.path.join("references", "命名与编号.md"), label)
        self.assertEqual(
            ("最终版", "最新", "修改版", "副本", "新建", "未命名"),
            constants.FORBIDDEN_FILENAME_WORDS,
        )
        self.assertEqual(
            _literals(line, label, stop_chars=("。",)),
            constants.FORBIDDEN_FILENAME_WORDS,
        )

    def test_conclusion_markers_are_the_minimal_pair_without_naming_charges(self):
        self.assertEqual(("构成", "涉嫌"), constants.CONCLUSION_CHARGE_MARKERS)
        self.assertEqual(
            False,
            any("罪" in marker for marker in constants.CONCLUSION_CHARGE_MARKERS),
        )
        line = _line_containing(
            os.path.join("references", "研判规则.md"),
            "不写「构成…罪」「涉嫌…罪」",
        )
        for marker in constants.CONCLUSION_CHARGE_MARKERS:
            with self.subTest(marker=marker):
                self.assertIn(marker, line)


if __name__ == "__main__":
    unittest.main()
