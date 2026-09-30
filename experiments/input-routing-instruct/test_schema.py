import json
import unittest

from schema import DEFAULTS, SchemaError, context, parse, score, transition, validate


class RoutingSchemaTests(unittest.TestCase):
    def test_known_and_unknown_new_targets(self):
        for destination in ({"form": "sphere", "object_en": None}, {"form": None, "object_en": "a watering can"}):
            self.assertEqual(validate({"action": "new", "target": destination, "changes": {"count": 8}})["target"], destination)

    def test_edit_cannot_replace_current_unknown(self):
        self.assertEqual(parse('{"action":"edit","target":null,"changes":{"squareness":0.8}}')["action"], "edit")
        with self.assertRaises(SchemaError):
            validate({"action": "edit", "target": {"form": "vase", "object_en": None}, "changes": {"squareness": 1}})

    def test_empty_and_dual_targets_rejected(self):
        for target in (None, {}, {"form": None, "object_en": None}, {"form": None, "object_en": ""},
                       {"form": None, "object_en": "   "}, {"form": "sphere", "object_en": "a sphere"}):
            with self.subTest(target=target), self.assertRaises(SchemaError):
                validate({"action": "new", "target": target, "changes": {}})

    def test_unknown_form_not_accepted_as_identifier(self):
        for form in ("umbrella", "Sphere", "sphere; print(1)", [], 2, True):
            with self.subTest(form=form), self.assertRaises(SchemaError):
                validate({"action": "new", "target": {"form": form, "object_en": None}, "changes": {}})

    def test_finite_numbers_and_inclusive_bounds(self):
        validate({"action": "edit", "target": None, "changes": {"squareness": 1, "elongation": .5, "twist": -1, "bend": 1, "roughness": 0, "count": 8}})
        for name, number in (("squareness", -0.01), ("elongation", 2.51), ("twist", 1.1), ("bend", -1.01),
                             ("roughness", float("nan")), ("roughness", float("inf")), ("count", True),
                             ("count", 2.0), ("count", 0), ("count", 9), ("twist", "0.5"), ("count", 10**400)):
            with self.subTest(name=name, number=number), self.assertRaises(SchemaError):
                validate({"action": "edit", "target": None, "changes": {name: number}})

    def test_keep_and_edit_invariants(self):
        self.assertEqual(validate({"action": "keep", "target": None, "changes": {}})["action"], "keep")
        for action, changes in (("keep", {"count": 1}), ("edit", {}), ("run", {})):
            with self.subTest(action=action), self.assertRaises(SchemaError):
                validate({"action": action, "target": None, "changes": changes})

    def test_strict_json_and_extra_keys(self):
        for raw in ('{"action":"keep","action":"new","target":null,"changes":{}}',
                    '{"action":"edit","target":null,"changes":{"twist":NaN}}',
                    '{"action":"keep","target":null,"changes":{},"code":"print(1)"}',
                    '{"action":"edit","target":null,"changes":{"size":2}}',
                    '```json\n{"action":"keep","target":null,"changes":{}}\n```',
                    '{"action":"keep","target":null,"changes":{}} explanation', '[]', 'x'*4097):
            with self.subTest(raw=raw[:60]), self.assertRaises(SchemaError):
                parse(raw)

    def test_description_bounds(self):
        for description in ("傘", "a\nbox", "x"*301, " ".join(["a"]*46), "123", 123):
            with self.subTest(description=description), self.assertRaises(SchemaError):
                validate({"action": "new", "target": {"form": None, "object_en": description}, "changes": {}})

    def test_invalid_unicode_raises_schema_error(self):
        with self.assertRaises(SchemaError):
            parse('\ud800')

    def test_transitions_preserve_generated_target_and_original_context(self):
        before = {"target": {"form": None, "object_en": "a watering can"}, "attributes": {**DEFAULTS, "roughness": .8}}
        after = transition(before, {"action": "edit", "target": None, "changes": {"squareness": .9}})
        self.assertEqual(after["target"], before["target"])
        self.assertEqual(after["attributes"]["roughness"], .8)
        self.assertEqual(after["attributes"]["squareness"], .9)
        self.assertEqual(before["attributes"]["squareness"], 0)
        self.assertEqual(transition(before, {"action": "keep", "target": None, "changes": {}}), before)
        new = transition(before, {"action": "new", "target": {"form": "cube", "object_en": None}, "changes": {}})
        self.assertEqual(new["attributes"], DEFAULTS)

    def test_full_current_context_and_attribute_target_separation(self):
        current = {"target": {"form": None, "object_en": "a watering can"}, "attributes": DEFAULTS}
        self.assertEqual(context(current)["target"]["object_en"], "a watering can")
        with self.assertRaises(SchemaError):
            context({"target": current["target"], "attributes": {"count": 1}})

    def test_score_never_treats_catalog_substitution_as_unknown(self):
        expected = {"action": "new", "target": "unknown", "changes": {}}
        value = {"action": "new", "target": {"form": "cone", "object_en": None}, "changes": {}}
        self.assertIn("unknown_target_preservation", score(value, expected)["failures"])
        value["target"] = {"form": None, "object_en": "a funnel"}
        self.assertTrue(score(value, expected)["contractPass"])
        self.assertTrue(score(value, expected)["englishNeedsHumanReview"])


if __name__ == "__main__":
    unittest.main()
