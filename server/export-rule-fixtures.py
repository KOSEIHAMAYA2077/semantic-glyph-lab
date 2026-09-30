"""Export existing Python rules and artificial parity fixtures; no model or network."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from catalog import CATALOG, DEFAULT_FORM
from interpreter import ATTRIBUTES, COLORS, COUNT_RE, Interpreter, term_pattern

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/rule-data.json"
FIXTURES = ROOT / "src/rule-fixtures.json"


def exported():
    previous = dict(DEFAULT_FORM, object="vase", squareness=.4, elongation=1.4, twist=.4, bend=.4, roughness=.3, count=3)
    phrases = [
        "", "　", "四角くねじれた", "細長い花瓶", "長くねじれた剣", "もっと長くして",
        "普通の形へ戻す", "reset", "元に", "通常の形", "普通の比率", "元の長さ",
        "ねじれなし", "ねじれを戻す", "捻れなし", "untwisted", "まっすぐ", "逆にねじれた", "左巻き",
        "この球体ではなく花瓶", "花瓶ではない", "花瓶ではなく剣", "剣じゃない", "sphereではない",
        "花瓶以外", "花瓶を除く", "剣と花瓶", "花瓶と剣", "瓶に花を入れる",
        "spring", "tablecloth", "swordfish", "homeless", "balloon", "sphere-shaped", "CUBE", "ＣＵＢＥ",
        "木曜日に作家と会う", "大きな木", "ひとりで遠くまで歩くもの", "それではないと思う",
        "はなれていく", "赤色にして", "白色の剣", "red blue", "#aabbcc", "赤 #123456 青", "hundred",
        "８個の輪", "三個の花瓶", "99個の輪", "0個", "球体を4個", "二つの星", "五匹の魚", "四羽の鳥",
        "少しだけ大きく", "もっと小さく", "四角くしてから丸く", "丸くしてから四角く",
        "滑らかで普通の比率", "曲がった花瓶をまっすぐに", "未知の文章を追加するだけ。", "😀 花瓶ではなく剣 🌌",
    ]
    # Every canonical alias is checked, alongside crafted interactions and rejects.
    phrases.extend(alias for item in CATALOG.values() for alias in item["aliases"])
    phrases = list(dict.fromkeys(phrases))
    engine = Interpreter()
    fixtures = []
    for text in phrases:
        expected = engine.interpret(text, previous, mode="rules")
        expected.pop("elapsedMs")
        fixtures.append({"text": text, "previous": previous, "expected": expected})
    return {
        "format": 1,
        "sources": {name: hashlib.sha256((ROOT / "server" / name).read_bytes()).hexdigest() for name in ["catalog.py", "interpreter.py"]},
        "defaultForm": DEFAULT_FORM,
        "objects": [{"id": key, "patterns": [term_pattern(alias) for alias in item["aliases"]]} for key, item in CATALOG.items()],
        "attributes": [{"pattern": pattern, "key": key, "value": value} for pattern, key, value in ATTRIBUTES],
        "colors": [{"pattern": term_pattern(word), "ink": ink} for word, ink in COLORS.items()],
        "countPattern": COUNT_RE.pattern,
        "compatibilityNotes": [
            "Offline rules now follow server rules rather than their older reduced vocabulary.",
            "New object names reset attributes to neutral; modifier-only input retains context.",
            "Negated names are skipped; longest overlapping name and latest remaining name win.",
            "Twist uses 0.65 rather than 0.7; slender uses 2.3; named ink matches server values.",
            "The old blanket reset phrases reset, 元に, 普通の and 通常の no longer reset all attributes. Use explicit reversal phrases or 普通の比率 / 元の長さ.",
            "Boundary matching is not general natural language understanding. This exports existing rules without widening server behavior.",
        ],
        "fixtures": fixtures,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only parity and source-drift check")
    args = parser.parse_args()
    rules = exported()
    cases = rules.pop("fixtures")
    fixtures = {"format": 1, "sources": rules["sources"], "fixtures": cases}
    outputs = {TARGET: json.dumps(rules, ensure_ascii=False, indent=2) + "\n",
               FIXTURES: json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n"}
    if args.check:
        if any(not target.exists() or target.read_text() != text for target, text in outputs.items()):
            raise SystemExit("Rule export has drifted; regenerate and review the JSON diff")
        print("Rule export matches current Python definitions and fixtures")
    else:
        # Version control retains previous exported definitions on intentional regeneration.
        for target, text in outputs.items():
            target.write_text(text)
        print(f"Exported runtime rules and {len(cases)} separate artificial parity fixtures")


if __name__ == "__main__":
    main()
