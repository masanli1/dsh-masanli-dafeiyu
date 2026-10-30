"""把「大肥鱼」这种中文短语转成 sherpa-onnx KWS 认识的拼音 token 串。

KWS 的中文 zipformer 模型是按「声母 + 带声调韵母」切的，一行一个关键词：
    d à f éi y ú @大肥鱼
多音字、轻声、儿化都可能切得不准，所以这里只做最朴素的整词转换，
必要时可以用 --raw 直接给模型 token。
"""
import os
import re
import sys

# 没有 pypinyin 时的兜底：只覆盖最常用的几个唤醒词，够默认场景用
FALLBACK = {
    "大肥鱼": "d à f éi y ú",
    "你好大肥鱼": "n ǐ h ǎo d à f éi y ú",
    "小鱼": "x iǎo y ú",
    "大肥鱼你好": "d à f éi y ú n ǐ h ǎo",
}

_PUNCT = re.compile(r"[\s，。！？、,.!?~～…\-—_]+")


def _tokens_with_pypinyin(text):
    from pypinyin import Style, pinyin

    initials = pinyin(text, style=Style.INITIALS, strict=False)
    finals = pinyin(text, style=Style.FINALS_TONE, strict=False)
    tokens = []
    for (initial,), (final,) in zip(initials, finals):
        if initial:
            tokens.append(initial)
        if final:
            tokens.append(final)
    return " ".join(tokens)


def phrase_tokens(phrase):
    """返回 'd à f éi y ú' 这样的 token 串。"""
    phrase = _PUNCT.sub("", str(phrase or ""))
    if not phrase:
        return ""
    try:
        return _tokens_with_pypinyin(phrase)
    except Exception:
        return FALLBACK.get(phrase, "")


def build_lines(phrases):
    lines = []
    for phrase in phrases:
        phrase = _PUNCT.sub("", str(phrase or ""))
        if not phrase:
            continue
        tokens = phrase_tokens(phrase)
        if not tokens:
            raise SystemExit(f"无法把「{phrase}」转成拼音，请检查是否装了 pypinyin")
        lines.append(f"{tokens} @{phrase}")
    return lines


def write_keywords(phrases, path):
    lines = build_lines(phrases)
    if not lines:
        raise SystemExit("没有可用的唤醒词")
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return lines


def main(argv):
    if len(argv) < 2:
        print("usage: keywords.py <输出文件> <唤醒词> [更多唤醒词...]")
        return 2
    out, phrases = argv[0], argv[1:]
    for line in write_keywords(phrases, out):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
