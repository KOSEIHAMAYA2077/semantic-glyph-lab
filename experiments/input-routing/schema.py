"""Strict, code-free contract for an independent shape-intent experiment."""
from __future__ import annotations

import json
import math
from typing import Any

FORMS = (
    "sphere", "cube", "vase", "sword", "tree", "flower", "fish", "bird",
    "chair", "table", "mug", "bottle", "house", "tower", "ring", "star",
    "heart", "knot", "shell", "cone", "pyramid", "rock", "cloud", "mushroom",
)
BOUNDS = {"squareness": (0, 1), "elongation": (.5, 2.5), "twist": (-1, 1),
          "bend": (-1, 1), "roughness": (0, 1), "count": (1, 8)}
DEFAULTS = {"squareness": 0, "elongation": 1, "twist": 0, "bend": 0, "roughness": 0, "count": 1}


class SchemaError(ValueError):
    pass


def _object(value: Any, keys: set[str], name: str) -> dict:
    if type(value) is not dict or set(value) != keys:
        raise SchemaError(f"{name}: exact keys required")
    return value


def _english(value: Any) -> str:
    if type(value) is not str or not 1 <= len(value) <= 300 or value != value.strip():
        raise SchemaError("object_en: nonempty trimmed string, at most 300 characters")
    if not all(32 <= ord(char) <= 126 for char in value) or not any(char.isalpha() for char in value):
        raise SchemaError("object_en: printable ASCII with English letters required")
    if len(value.split()) > 45:
        raise SchemaError("object_en: at most 45 words")
    return value


def attributes(value: Any, *, complete: bool = False) -> dict:
    if type(value) is not dict or not set(value) <= set(BOUNDS):
        raise SchemaError("Unknown attributes")
    if complete and set(value) != set(BOUNDS):
        raise SchemaError("Context requires all six attributes")
    for key, number in value.items():
        if type(number) not in (int, float) or (type(number) is float and not math.isfinite(number)):
            raise SchemaError("Attribute must be a finite number, not a boolean")
        low, high = BOUNDS[key]
        if not low <= number <= high:
            raise SchemaError("Attribute outside bounds")
        if key == "count" and type(number) is not int:
            raise SchemaError("count must be an integer")
    return dict(value)


def target(value: Any) -> dict:
    _object(value, {"form", "object_en"}, "target")
    if value["form"] is not None:
        if type(value["form"]) is not str or value["form"] not in FORMS or value["object_en"] is not None:
            raise SchemaError("Known form must be exact, with object_en null")
    elif value["object_en"] is not None:
        _english(value["object_en"])
    else:
        raise SchemaError("Empty target")
    return dict(value)


def context(value: Any) -> dict:
    _object(value, {"target", "attributes"}, "current shape")
    return {"target": target(value["target"]), "attributes": attributes(value["attributes"], complete=True)}


def validate(value: Any) -> dict:
    _object(value, {"action", "target", "changes"}, "intent")
    action = value["action"]
    if type(action) is not str or action not in {"new", "edit", "keep"}:
        raise SchemaError("Unknown action")
    changes = attributes(value["changes"])
    if action == "new":
        destination = target(value["target"])
    else:
        if value["target"] is not None:
            raise SchemaError("edit and keep must preserve target")
        destination = None
        if action == "keep" and changes:
            raise SchemaError("keep must have no changes")
        if action == "edit" and not changes:
            raise SchemaError("edit must change at least one attribute")
    return {"action": action, "target": destination, "changes": changes}


def transition(current: dict, intent: dict) -> dict:
    """Apply data only: no natural-language repair, dictionary or generated code."""
    before, intent = context(current), validate(intent)
    if intent["action"] == "keep":
        return before
    if intent["action"] == "edit":
        return {"target": before["target"], "attributes": {**before["attributes"], **intent["changes"]}}
    return {"target": intent["target"], "attributes": {**DEFAULTS, **intent["changes"]}}


def parse(raw: str) -> dict:
    if type(raw) is not str:
        raise SchemaError("Output must be a string")
    try:
        size = len(raw.encode("utf-8"))
    except UnicodeError as error:
        raise SchemaError("Output is not valid Unicode") from error
    if size > 4096:
        raise SchemaError("Output exceeds 4096 bytes")
    def no_duplicates(pairs):
        answer = {}
        for key, value in pairs:
            if key in answer:
                raise SchemaError("Duplicate JSON key")
            answer[key] = value
        return answer
    def no_constant(_value):
        raise SchemaError("Non-finite JSON constant")
    try:
        value = json.loads(raw, object_pairs_hook=no_duplicates, parse_constant=no_constant)
    except (ValueError, RecursionError) as error:
        raise SchemaError("Invalid strict JSON") from error
    return validate(value)


def score(value: dict, expected: dict) -> dict:
    """Predeclared exact fields and attribute ranges; English meaning is separate."""
    failures = []
    if value["action"] != expected["action"]:
        failures.append("action")
    wanted = expected.get("target")
    actual = value["target"]
    if wanted == "unknown":
        if actual is None or actual["form"] is not None:
            failures.append("unknown_target_preservation")
    elif type(wanted) is str:
        if actual is None or actual["form"] != wanted:
            failures.append("known_target")
    required = expected.get("changes", {})
    if set(value["changes"]) != set(required):
        failures.append("attribute_keys")
    for key, rule in required.items():
        number = value["changes"].get(key)
        if number is None:
            failures.append(key)
        elif "equals" in rule and number != rule["equals"]:
            failures.append(key)
        elif "range" in rule and not rule["range"][0] <= number <= rule["range"][1]:
            failures.append(key)
        elif "abs_min" in rule and abs(number) < rule["abs_min"]:
            failures.append(key)
    return {"contractPass": not failures, "failures": failures,
            "englishNeedsHumanReview": wanted == "unknown"}
