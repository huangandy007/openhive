"""技能包骨架与规则文件（T001）的结构测试。

断言对象是「包结构」而不是文案措辞：
- SKILL.md 的 frontmatter 精确只有 name / description 两键；
- references/ 精确是约定的 9 份文件；
- 每份文件的二级标题精确等于约定小节（不做子串/存在性判断）。
"""

import os
import re
import unittest

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REFERENCES_DIR = os.path.join(SKILL_DIR, "references")
SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")

EXPECTED_REFERENCES = {
    "初始化.md",
    "内勤工作流.md",
    "证据规则.md",
    "研判规则.md",
    "命名与编号.md",
    "阶段检查表.md",
    "时限参考.md",
    "法律适用规范.md",
    "专案协同规则.md",
}

EXPECTED_SKILL_SECTIONS = {
    "何时使用",
    "入口一：建一个案件工作区",
    "入口二：记录今日动态",
    "无脚本步骤索引",
    "按需加载的规则文件",
    "硬边界",
}

EXPECTED_SECTIONS = {
    "初始化.md": {
        "触发与入场判断",
        "预检",
        "目录清单",
        "文件清单",
        "幂等与非覆盖",
        "只预演",
        "无脚本步骤",
        "完成自检",
    },
    "内勤工作流.md": {
        "入口与固定顺序",
        "口述入账",
        "原始记录整理",
        "收尾：校验与看板",
    },
    "证据规则.md": {
        "定位",
        "字段与分组",
        "法定种类与待定",
        "待证事实受控类别",
        "证明内容与法律结论边界",
        "来源与保管链",
        "F 清单",
        "状态与校验",
    },
    "研判规则.md": {
        "定位与组织方式",
        "索引字段与状态",
        "溯源块",
        "研判闭环",
        "结论边界",
        "修订与替代",
        "复核与校验",
    },
    "命名与编号.md": {
        "编号系统",
        "编号分配",
        "文件命名",
        "硬规则与禁用词",
        "目录创建白名单",
        "文件头 frontmatter",
        "外部来件豁免",
    },
    "阶段检查表.md": {
        "七阶段",
        "阶段看板字段",
        "状态五态",
        "法制审核闸门",
        "阶段检查表",
        "移送前自检",
    },
    "时限参考.md": {
        "边界说明",
        "程序性节点",
        "期限字段",
        "逾期判定",
        "提醒机制",
    },
    "法律适用规范.md": {
        "定位与边界",
        "存放规范",
        "文件命名与 frontmatter",
        "索引字段",
        "本案适用分析",
        "保密要求",
    },
    "专案协同规则.md": {
        "定位",
        "子目录与产物",
        "闭环",
        "每日动态与会议",
        "任务台账",
        "线索台账",
        "印证台账",
        "人员与组织",
        "抓捕筹备",
        "原始记录",
    },
}

NUMBERING = re.compile(r"^\d+[.、]\s*")


def _read(relative):
    path = os.path.join(SKILL_DIR, relative)
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _frontmatter(text):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise AssertionError("SKILL.md 缺少 frontmatter 起始行")
    result = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return result
        if ":" not in line:
            raise AssertionError("frontmatter 行缺少冒号：%r" % line)
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    raise AssertionError("frontmatter 未闭合")


def _level_two_headings(text):
    headings = []
    in_fence = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith("## "):
            headings.append(NUMBERING.sub("", stripped[3:].strip()))
    return headings


class SkillFrontmatterTest(unittest.TestCase):
    def test_frontmatter_has_exactly_name_and_description(self):
        front = _frontmatter(_read("SKILL.md"))
        self.assertEqual({"name", "description"}, set(front))
        self.assertEqual("专案内勤", front["name"])
        self.assertTrue(front["description"].strip(), "description 不得为空")


class SkillRoutingTest(unittest.TestCase):
    def test_skill_has_two_entry_routes_and_no_script_index(self):
        headings = _level_two_headings(_read("SKILL.md"))
        self.assertEqual(len(headings), len(set(headings)), "SKILL.md 二级标题重复")
        self.assertEqual(EXPECTED_SKILL_SECTIONS, set(headings))


class ReferencesTest(unittest.TestCase):
    def test_references_are_exactly_the_nine_named_files(self):
        self.assertEqual(EXPECTED_REFERENCES, set(os.listdir(REFERENCES_DIR)))

    def test_each_reference_has_the_agreed_sections(self):
        self.assertEqual(EXPECTED_REFERENCES, set(EXPECTED_SECTIONS))
        for name in sorted(EXPECTED_REFERENCES):
            with self.subTest(reference=name):
                headings = _level_two_headings(_read(os.path.join("references", name)))
                self.assertEqual(len(headings), len(set(headings)), "%s 二级标题重复" % name)
                self.assertEqual(EXPECTED_SECTIONS[name], set(headings), name)

    def test_all_package_files_are_utf8_and_non_empty(self):
        self.assertTrue(os.path.isfile(SKILL_MD))
        for name in sorted(EXPECTED_REFERENCES):
            with self.subTest(reference=name):
                self.assertTrue(_read(os.path.join("references", name)).strip())


if __name__ == "__main__":
    unittest.main()
