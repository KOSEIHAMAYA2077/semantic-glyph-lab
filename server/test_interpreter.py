import math
import unittest

from catalog import DEFAULT_FORM
from interpreter import Interpreter, attributes, bounded_previous, explicit_object


class FakeModel:
    def __init__(self, candidates):
        self.candidates = candidates
        self.calls = 0

    def search(self, _text):
        self.calls += 1
        return self.candidates


class InterpretationTests(unittest.TestCase):
    def setUp(self):
        self.engine = Interpreter()

    def test_object_and_attributes_are_independent(self):
        result = self.engine.interpret("四角い花瓶", mode="rules")
        self.assertEqual(result["spec"]["object"], "vase")
        self.assertEqual(result["spec"]["squareness"], 1)
        result = self.engine.interpret("長くねじれた剣", mode="rules")
        self.assertEqual(result["spec"]["object"], "sword")
        self.assertGreater(result["spec"]["twist"], 0)
        self.assertGreater(result["spec"]["elongation"], 1)

    def test_longer_noun_wins(self):
        self.assertEqual(explicit_object("花瓶"), "vase")
        self.assertEqual(explicit_object("瓶に花を入れる"), "flower")

    def test_attributes_alone_keep_previous_object_and_other_attributes(self):
        model = FakeModel([{"object": "cone", "score": .9}, {"object": "rock", "score": .3}])
        engine = Interpreter(model)
        result = engine.interpret("もっと長くして", dict(DEFAULT_FORM, object="vase", twist=.4))
        self.assertEqual(result["spec"]["object"], "vase")
        self.assertEqual(result["spec"]["twist"], .4)
        self.assertEqual(model.calls, 0)

    def test_color_alone_never_changes_object(self):
        result = self.engine.interpret("赤色にして", dict(DEFAULT_FORM, object="sword"))
        self.assertEqual(result["spec"]["object"], "sword")
        self.assertEqual(result["ink"], "#ef6969")

    def test_explicit_noun_bypasses_embedding(self):
        model = FakeModel([])
        result = Interpreter(model).interpret("緑の椅子")
        self.assertEqual(result["spec"]["object"], "chair")
        self.assertEqual(model.calls, 0)

    def test_semantic_acceptance_and_abstention(self):
        for candidates, expected in [([{"object": "chair", "score": .7}, {"object": "table", "score": .4}], "chair"),
                                     ([{"object": "chair", "score": .7}, {"object": "table", "score": .68}], "sphere"),
                                     ([{"object": "chair", "score": .3}, {"object": "table", "score": .1}], "sphere")]:
            result = Interpreter(FakeModel(candidates)).interpret("座って休めるもの")
            self.assertEqual(result["spec"]["object"], expected)

    def test_rules_do_not_call_model(self):
        model = FakeModel([])
        Interpreter(model).interpret("座って休めるもの", mode="rules")
        self.assertEqual(model.calls, 0)

    def test_single_han_alias_does_not_match_unrelated_compound(self):
        self.assertIsNone(explicit_object("木曜日に作家と会う"))
        self.assertEqual(explicit_object("大きな木"), "tree")

    def test_short_kana_alias_does_not_match_inside_prose(self):
        self.assertIsNone(explicit_object("ひとりで遠くまで歩くもの"))
        self.assertIsNone(explicit_object("それではないと思う"))
        self.assertEqual(explicit_object("くも"), "cloud")
        self.assertEqual(explicit_object("とり"), "bird")

    def test_normalization_counts_and_bounds(self):
        self.assertEqual(self.engine.interpret("８個の輪")["spec"]["count"], 8)
        self.assertEqual(self.engine.interpret("三個の花瓶")["spec"]["count"], 3)
        self.assertEqual(self.engine.interpret("99個の輪")["spec"]["count"], 8)

    def test_modifier_reversal(self):
        result = self.engine.interpret("ねじれなしでまっすぐに", dict(DEFAULT_FORM, twist=.4, bend=.4))
        self.assertEqual(result["spec"]["twist"], 0)
        self.assertEqual(result["spec"]["bend"], 0)

    def test_previous_untrusted_numbers_and_ids(self):
        form = bounded_previous({"object": "<script>", "twist": float("nan"), "bend": float("inf"), "count": 1000, "elongation": -99})
        self.assertEqual(form["object"], "sphere")
        self.assertEqual(form["count"], 8)
        self.assertEqual(form["elongation"], .5)
        self.assertTrue(all(math.isfinite(v) for k, v in form.items() if k != "object"))
        self.assertEqual(bounded_previous({"object": ["vase"]})["object"], "sphere")

    def test_empty_and_invalid_input(self):
        self.assertEqual(self.engine.interpret("")["source"], "unchanged")
        for text in [None, [], "a" * 4001]:
            with self.assertRaises(ValueError):
                self.engine.interpret(text)
        with self.assertRaises(ValueError):
            self.engine.interpret("花瓶", mode="execute")


if __name__ == "__main__":
    unittest.main()
