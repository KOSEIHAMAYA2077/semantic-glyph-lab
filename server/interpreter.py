"""Local, finite-catalog semantics. No input text is stored or sent over a network."""
from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
import threading
import time
import unicodedata

from catalog import CATALOG, DEFAULT_FORM
from fetch_model import MODEL_DIR, MODEL_ID, REVISION, WEIGHT_SHA256

MIN_SCORE = 0.48
MIN_MARGIN = 0.035
MAX_TEXT = 4000

# The surface renderer receives only these bounded numeric parameters, never code.
ATTRIBUTES = [
    (r"四角(?:い|く|な)?|角ば(?:った|る|り|って)?|角張(?:った|る|り|って)?|square|angular", "squareness", 1.0),
    (r"丸(?:い|く)|円形|rounded?", "squareness", 0.0),
    (r"長(?:い|く)|背(?:が|を)?高(?:い|く)|long|tall", "elongation", 1.8),
    (r"細長(?:い|く)|elongated|slender", "elongation", 2.3),
    (r"短(?:い|く)|平た(?:い|く)|short|flat", "elongation", 0.65),
    (r"ねじ(?:れた|れる|れて|れ|る|って)?|捻(?:れた|れる|って|り|る)?|twist(?:ed)?|らせん状|螺旋状", "twist", 0.65),
    (r"逆(?:に)?ねじ(?:れた|れる|れ|る|って)?|左巻き", "twist", -0.65),
    (r"ねじ(?:れ|り)(?:なし|を戻す)|捻(?:れ|り)なし|untwist(?:ed)?", "twist", 0.0),
    (r"曲(?:がった|がる|げる|げた|げて|がり|げ)|湾曲|bend|bent|curved?", "bend", 0.65),
    (r"まっすぐ|真っ直ぐ|straight", "bend", 0.0),
    (r"ごつごつ|ゴツゴツ|でこぼこ|凸凹|凹凸|荒(?:い|く)|rough|bumpy|rugged", "roughness", 0.7),
    (r"滑らか|なめらか|つるつる|ツルツル|smooth", "roughness", 0.0),
    (r"普通の比率|元の長さ|normal proportions", "elongation", 1.0),
]
COLORS = {
    "赤": "#ef6969", "red": "#ef6969", "青": "#79a7ff", "blue": "#79a7ff",
    "黄色": "#efd66b", "黄": "#efd66b", "yellow": "#efd66b",
    "緑": "#8cdca0", "green": "#8cdca0", "紫": "#bd99ef", "purple": "#bd99ef",
    "桃色": "#ec9fc8", "ピンク": "#ec9fc8", "pink": "#ec9fc8",
    "オレンジ": "#efa665", "orange": "#efa665", "白": "#eeeae2", "white": "#eeeae2",
}
COLORS.update({word + "色": COLORS[word] for word in ["赤", "青", "緑", "紫", "白"]})
COUNT_RE = re.compile(r"([0-9]+|[一二三四五六七八九十])\s*(?:個|つ|本|体|輪|枚|匹|羽)")


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).strip().lower()


def bounded_previous(value: object) -> dict:
    if not isinstance(value, dict):
        return dict(DEFAULT_FORM)
    form = dict(DEFAULT_FORM)
    if isinstance(value.get("object"), str) and value["object"] in CATALOG:
        form["object"] = value["object"]
    for key, low, high in [("squareness", 0, 1), ("elongation", 0.5, 2.5),
                           ("twist", -1, 1), ("bend", -1, 1), ("roughness", 0, 1), ("count", 1, 8)]:
        number = value.get(key)
        if isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number):
            form[key] = max(low, min(high, number))
    form["count"] = round(form["count"])
    return form


def term_pattern(word: str) -> str:
    if re.fullmatch(r"[a-z ]+", word):
        return rf"(?<![a-z]){re.escape(word)}(?![a-z])"
    if re.fullmatch(r"[ぁ-ゖ]+", word):
        # Short kana aliases inside ordinary words are not nouns: ひとり != とり.
        # Longer kana sentences can still be interpreted by the embedding model.
        return rf"(?<![ぁ-ゖ]){re.escape(word)}(?![ぁ-ゖ])"
    if re.fullmatch(r"[\u3400-\u9fff]", word):
        return rf"(?<![\u3400-\u9fff]){re.escape(word)}(?![\u3400-\u9fff])"
    return re.escape(word)


def explicit_object(text: str) -> str | None:
    hits = []
    for object_id, item in CATALOG.items():
        for alias in item["aliases"]:
            for match in re.finditer(term_pattern(alias), text):
                # A longer overlapping noun wins (花瓶 over 花 or 瓶).
                hits.append((match.start(), match.end(), object_id))
    hits = [hit for hit in hits if not any(other[0] <= hit[0] and other[1] >= hit[1]
                                          and other[1] - other[0] > hit[1] - hit[0] for other in hits)]
    hits = [hit for hit in hits if not re.match(r"\s*(?:ではなく|ではない|じゃない|以外|でなく|を除く)", text[hit[1]:])]
    return max(hits, key=lambda hit: (hit[0], hit[1] - hit[0]))[2] if hits else None


def attributes(text: str) -> tuple[dict, str | None, str]:
    changes = {}
    spans = []
    choices = {}
    for pattern, key, value in ATTRIBUTES:
        for match in re.finditer(pattern, text, flags=re.I):
            # Longer patterns override nested shorter words; otherwise latest wins.
            existing = choices.get(key)
            candidate = (match.start(), match.end(), value)
            if existing is None or (candidate[0] <= existing[0] and candidate[1] >= existing[1]) or candidate[0] >= existing[1]:
                choices[key] = candidate
            spans.append((match.start(), match.end()))
    changes.update({key: value[2] for key, value in choices.items()})
    for match in COUNT_RE.finditer(text):
        raw = match[1]
        count = int(raw) if raw.isdigit() else "〇一二三四五六七八九十".index(raw)
        changes["count"] = max(1, min(8, count))
        spans.append((match.start(), match.end()))
    ink = None
    ink_pos = -1
    for word, color in COLORS.items():
        for match in re.finditer(term_pattern(word), text):
            if match.start() >= ink_pos:
                ink, ink_pos = color, match.start()
            spans.append((match.start(), match.end()))
    for match in re.finditer(r"#[0-9a-f]{6}(?![0-9a-f])", text):
        ink, ink_pos = match.group(), match.start()
        spans.append((match.start(), match.end()))
    chars = list(text)
    for start, end in spans:
        chars[start:end] = " " * (end - start)
    residual = "".join(chars)
    residual = re.sub(r"もっと|少し|とても|かなり|この|これ|それ|形|感じ|にして|して|する|ください|くれ|欲しい|ほしい|色|に|を|で|と|の|な|please|make|it|more", "", residual)
    residual = re.sub(r"[\s。、,.!！?？:：;；「」『』\[\]()（）\-]+", "", residual)
    return changes, ink, residual


class Embeddings:
    def __init__(self, model_dir: Path = MODEL_DIR):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        weight = model_dir / "onnx/model_qint8_arm64.onnx"
        if hashlib.sha256(weight.read_bytes()).hexdigest() != WEIGHT_SHA256:
            raise RuntimeError("Unexpected model checksum")
        self.np = np
        self.lock = threading.Lock()
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=128, direction="left")
        self.tokenizer.enable_padding(pad_id=self.tokenizer.token_to_id("<pad>"), pad_token="<pad>")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(weight), sess_options=options, providers=["CPUExecutionProvider"])
        self.input_names = {item.name for item in self.session.get_inputs()}
        self.ids = []
        captions = []
        for object_id, item in CATALOG.items():
            captions.extend(item["descriptions"])
            self.ids.extend([object_id] * len(item["descriptions"]))
        self.vectors = np.concatenate([self.encode(captions[i:i+8]) for i in range(0, len(captions), 8)])

    def encode(self, texts: list[str]):
        np = self.np
        with self.lock:
            encoded = self.tokenizer.encode_batch(texts)
            feed = {"input_ids": np.array([item.ids for item in encoded], dtype=np.int64),
                    "attention_mask": np.array([item.attention_mask for item in encoded], dtype=np.int64),
                    "token_type_ids": np.array([item.type_ids for item in encoded], dtype=np.int64)}
            output = self.session.run(None, {key: value for key, value in feed.items() if key in self.input_names})[0]
        mask = feed["attention_mask"][..., None]
        vectors = (output * mask).sum(axis=1) / mask.sum(axis=1).clip(min=1)
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True).clip(min=1e-12)

    def search(self, text: str) -> list[dict]:
        scores = self.vectors @ self.encode([text])[0]
        # Maximum caption similarity gives different descriptions of the same object equal chances.
        by_object = {}
        for object_id, score in zip(self.ids, scores):
            by_object[object_id] = max(by_object.get(object_id, -1.0), float(score))
        return [{"object": key, "score": round(value, 5)} for key, value in
                sorted(by_object.items(), key=lambda pair: pair[1], reverse=True)[:5]]


class Interpreter:
    def __init__(self, embeddings: Embeddings | None = None):
        self.embeddings = embeddings

    def interpret(self, text: str, previous: object = None, mode: str = "semantic") -> dict:
        started = time.perf_counter()
        if not isinstance(text, str) or len(text) > MAX_TEXT:
            raise ValueError(f"text must be a string of at most {MAX_TEXT} characters")
        if mode not in ("semantic", "rules"):
            raise ValueError("mode must be semantic or rules")
        normalized = normalize(text)
        spec = bounded_previous(previous)
        change, ink, residual = attributes(normalized)
        noun = explicit_object(normalized)
        candidates = []
        source = "unchanged"
        note = None
        if noun:
            # A new object begins from neutral attributes; modifier-only instructions retain context.
            if noun != spec["object"]:
                spec = dict(DEFAULT_FORM, object=noun)
            source = "explicit"
            candidates = [{"object": noun, "score": 1.0}]
        elif normalized and residual and mode == "semantic" and self.embeddings is not None:
            candidates = self.embeddings.search(normalized)
            top, runner = candidates[:2]
            if top["score"] >= MIN_SCORE and top["score"] - runner["score"] >= MIN_MARGIN:
                noun = top["object"]
                if noun != spec["object"]:
                    spec = dict(DEFAULT_FORM, object=noun)
                source = "embedding"
            else:
                note = "近い候補を十分に絞れないため、現在の形を保ちました。"
        elif mode == "semantic" and self.embeddings is None:
            note = "意味モデル未読込。明示語と属性のみ使用。"
        spec.update(change)
        if change:
            source = "composed"
        result = {"spec": spec, "source": source, "candidates": candidates,
                  "elapsedMs": round((time.perf_counter() - started) * 1000, 3)}
        if ink:
            result["ink"] = ink
        if note:
            result["note"] = note
        return result
