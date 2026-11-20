#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 docs/署名与授权.md 生成游戏署名页文案。

用法（在任意目录）：

    python tools/attribution.py --check    # 只检查生成物是否和源一致
    python tools/attribution.py --write    # 重新生成（默认）

`tools/build.py` 会自动调用
`sync()`，所以正常改文案只需要跑一次构建。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "docs" / "署名与授权.md"
GAME_TEXT = REPO / "text.json"

GAME_NOTE = (
    "段落里 **两边加星号** 是粗体，[文字](网址) 是链接。"
    "本块由 docs/署名与授权.md 生成，改措辞去改源文件后跑 python tools/build.py；"
    "署名是授权要求，改之前先和作者确认。"
)
TEXT_JS_HEADER = "// 由 tools/build.py 从 text.json 生成，别手改，要改文案去改 text.json\n"
REQUIRED = {
    "游戏署名页": ("标题", "段落"),
}


class SourceError(Exception):
    pass


def _where(lineno: int) -> str:
    return f"{SOURCE.relative_to(REPO)}:{lineno}"


def load_source() -> dict:
    """把 Markdown 解析成 {组: {字段: [行]}}，行号只用于报错。"""
    if not SOURCE.exists():
        raise SourceError(f"找不到源文件：{SOURCE}")
    sections: dict[str, dict[str, list[tuple[int, str]]]] = {}
    h2 = h3 = None
    for lineno, raw in enumerate(SOURCE.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("### "):
            if h2 is None:
                raise SourceError(f"{_where(lineno)}：### 出现在 ## 之前")
            h3 = line[4:].strip()
            if h3 in sections[h2]:
                raise SourceError(f"{_where(lineno)}：字段「{h2}/{h3}」重复")
            sections[h2][h3] = []
            continue
        if line.startswith("## "):
            h2 = line[3:].strip()
            h3 = None
            if h2 in sections:
                raise SourceError(f"{_where(lineno)}：组「{h2}」重复")
            sections[h2] = {}
            continue
        if line.startswith("# "):
            continue
        if h2 is None or h3 is None:
            # 文件开头的说明、引用块等
            continue
        sections[h2][h3].append((lineno, line))

    for group, keys in REQUIRED.items():
        if group not in sections:
            raise SourceError(f"{SOURCE}：缺少「## {group}」")
        for key in keys:
            if not sections[group].get(key):
                raise SourceError(f"{SOURCE}：缺少「### {key}」（在「## {group}」下）")
    return sections


def _bullet(line: str) -> str:
    return line[2:].strip() if line.startswith("- ") else line


def _one(sections: dict, group: str, key: str) -> str:
    lines = sections[group][key]
    values = [_bullet(line) for _, line in lines]
    values = [v for v in values if v]
    if len(values) != 1:
        first = lines[0][0]
        raise SourceError(
            f"{_where(first)}：「{group}/{key}」只能写一行，现在有 {len(values)} 行"
        )
    return values[0]


def markup_error(para: str) -> str:
    """署名页段落的简易标记检查，返回错误说明（空串表示没毛病）。"""
    if para.count("**") % 2:
        return "** 不成对（粗体要两边都加）"
    if para.count("[") != para.count("]") or para.count("](") != para.count("["):
        return "链接要写成 [文字](网址)"
    return ""


def paragraphs(sections: dict) -> list[str]:
    """署名页段落，顺序就是排版顺序；每段顺带检查一遍简易标记。"""
    values = []
    for lineno, raw in sections["游戏署名页"]["段落"]:
        text = _bullet(raw)
        if not text:
            continue
        err = markup_error(text)
        if err:
            raise SourceError(f"{_where(lineno)}：{err}")
        values.append(text)
    if not values:
        raise SourceError(f"{SOURCE}：「游戏署名页/段落」是空的")
    return values


def render() -> dict[str, str]:
    """返回 {相对路径: 文件内容}。"""
    sec = load_source()
    title = _one(sec, "游戏署名页", "标题")
    paras = paragraphs(sec)

    out: dict[str, str] = {}
    if GAME_TEXT.exists():
        out[str(GAME_TEXT.relative_to(REPO))] = patch_text_json(
            GAME_TEXT.read_text(encoding="utf-8"), title, paras, GAME_TEXT
        )
    return out


def patch_text_json(text: str, title: str, paragraphs: list[str], path: Path) -> str:
    """只替换 text.json 的顶层「署名页」块，其余排版和内容原样保留。"""
    m = re.search(r'^  "署名页": ', text, re.M)
    if not m:
        raise SourceError(f"{path}：找不到顶层的 \"署名页\" 键（两格缩进）")
    start = m.end()
    while start < len(text) and text[start] in " \t":
        start += 1
    try:
        old_value, end = json.JSONDecoder().raw_decode(text, start)
    except json.JSONDecodeError as exc:
        raise SourceError(f"{path}：\"署名页\" 不是合法 JSON（{exc}）") from exc
    if not isinstance(old_value, dict):
        raise SourceError(f"{path}：\"署名页\" 应该是对象")

    new_value = {"_说明": GAME_NOTE, "标题": title, "段落": paragraphs}
    dumped = json.dumps(new_value, ensure_ascii=False, indent=2).replace("\n", "\n  ")
    out = text[: m.start()] + '  "署名页": ' + dumped + text[end:]

    # 自检：整份 JSON 仍可解析，除「署名页」外的内容一字不差
    old_data = json.loads(text)
    new_data = json.loads(out)
    if list(old_data) != list(new_data):
        raise SourceError("替换「署名页」后顶层键顺序变了，已停止")
    for key in old_data:
        if key != "署名页" and old_data[key] != new_data[key]:
            raise SourceError(f"替换「署名页」时误改了「{key}」，已停止")
    if new_data["署名页"] != new_value:
        raise SourceError("替换「署名页」后自检失败，已停止")
    return out


def text_js(json_text: str) -> str:
    data = json.loads(json_text)
    pub = {k: v for k, v in data.items() if not str(k).startswith("_")}
    return TEXT_JS_HEADER + "window.TEXT = " + json.dumps(pub, ensure_ascii=False, indent=1) + ";\n"


def update_cache_version(index_text: str, js_bytes: bytes) -> str:
    ver = hashlib.sha1(js_bytes).hexdigest()[:8]
    return re.sub(r"(text\.js)\?v=\w+", lambda m: f"{m.group(1)}?v={ver}", index_text)


def _diff(expected: str, actual: str) -> str:
    exp = expected.splitlines()
    act = actual.splitlines()
    for i in range(max(len(exp), len(act))):
        e = exp[i] if i < len(exp) else "<缺行>"
        a = act[i] if i < len(act) else "<缺行>"
        if e != a:
            return f"第 {i + 1} 行\n  期望: {e[:160]}\n  实际: {a[:160]}"
    return "内容相同但字节不同（换行？）"


def check() -> list[str]:
    expected = render()
    errs = []
    for rel, content in expected.items():
        path = REPO / rel
        if not path.exists():
            errs.append(f"{rel}：文件不存在")
            continue
        actual = path.read_text(encoding="utf-8")
        if actual != content:
            errs.append(f"{rel} 和源不一致，{_diff(content, actual)}")
    return errs


def sync() -> int:
    expected = render()
    changed = 0
    for rel, content in expected.items():
        path = REPO / rel
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old != content:
            path.write_text(content, encoding="utf-8", newline="\n")
            print(f"署名/授权：更新 {rel}")
            changed += 1
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="从 docs/署名与授权.md 生成署名/授权文案")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="只检查，不写文件")
    group.add_argument("--write", action="store_true", help="重新生成（默认）")
    args = parser.parse_args(argv)
    try:
        if args.check:
            errs = check()
            if errs:
                print("署名/授权生成物和源不一致：")
                for err in errs:
                    print(" -", err)
                print("\n跑 python tools/attribution.py --write 重新生成。")
                return 1
            print("署名/授权：生成物与 docs/署名与授权.md 一致")
            return 0
        changed = sync()
        print(f"署名/授权：{'更新了 %d 个文件' % changed if changed else '没有变化'}")
        return 0
    except SourceError as exc:
        print(f"署名/授权源文件有错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
