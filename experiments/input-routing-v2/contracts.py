"""Small stage contracts, sharing frozen numeric rules with the first experiment."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("frozen_routing_schema", DIRECTORY.parent/"input-routing/schema.py")
V1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(V1)
SchemaError = V1.SchemaError


def decode(raw: str, keys: set[str]):
    if type(raw) is not str:
        raise SchemaError("Expected a string")
    try:
        if len(raw.encode("utf-8")) > 4096:
            raise SchemaError("Output too large")
    except UnicodeError as error:
        raise SchemaError("Invalid Unicode") from error
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise SchemaError("Duplicate key")
            result[key] = value
        return result
    def constant(_value):
        raise SchemaError("Non-finite constant")
    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, RecursionError) as error:
        raise SchemaError("One strict JSON object required") from error
    if type(result) is not dict or set(result) != keys:
        raise SchemaError("Unexpected output keys")
    return result


def action(raw: str):
    result = decode(raw, {"action"})
    if type(result["action"]) is not str or result["action"] not in {"new", "edit", "keep"}:
        raise SchemaError("Unknown action")
    return result


def edit(raw: str):
    result = decode(raw, {"changes"})
    changes = V1.attributes(result["changes"])
    if not changes:
        raise SchemaError("No editable attribute identified")
    return {"changes": changes}


def description(raw: str):
    result = decode(raw, {"text_en"})
    if type(result["text_en"]) is not str:
        raise SchemaError("Description must be a string")
    text = result["text_en"].strip()
    V1.target({"form": None, "object_en": text})
    return {"text_en": text}


def summarize_current(current):
    current = V1.context(current)
    subject = current["target"]["object_en"]
    if subject is None:
        subject = "a " + current["target"]["form"]
    return {"subject_en": subject, "attributes": current["attributes"]}


def score_changes(actual: dict, wanted: dict):
    # Target-free reuse of the predeclared key/range criteria.
    return V1.score({"action": "edit", "target": None, "changes": actual}, {"action": "edit", "changes": wanted})
